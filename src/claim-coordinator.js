import { randomUUID } from 'node:crypto';
import path from 'node:path';

import {
  appendClaimEntry,
  assertClaimJournalCapacity,
  claimJournalPath,
  claimReconcileLogPath,
  replayClaimJournal,
  writeReconcileLog,
} from './claim-journal.js';
import { resolveWorkClaimCapability } from './claim-capabilities.js';
import { readBack } from './claim-operations.js';
import { reconcileClaimJournal } from './claim-publication.js';
import { claimStorePath, resolveVerifiedGitCommonDir, withClaimLock } from './claim-store.js';
import { readNamespace } from './namespace.js';
import {
  assertUniqueWorktreeIdentity,
  ensureWorktreeIdentity,
  identityDiagnosticDetails,
} from './worktree-identity.js';

export async function withLegacyMutationFence(
  ledgerDirectory,
  itemId,
  command,
  write,
  { responseCommand = command } = {},
) {
  let gitCommonDir;
  try {
    gitCommonDir = await resolveVerifiedGitCommonDir(ledgerDirectory, { failClosed: true });
  } catch {
    return claimStoreUnavailable(responseCommand, 'git-verification-failed');
  }
  const namespace = gitCommonDir ? await readNamespace(ledgerDirectory) : null;
  const capability = resolveWorkClaimCapability({ gitCommonDir, namespace });
  if (!capability.claim_protected_publication) return write();

  // A create is the one mutation that reads an identity it was not given: it
  // allocates the ledger's next number from the items this checkout holds. Its
  // reconciliation therefore stays target-scoped like every other mutation, and
  // gains one extra barrier below, for the coordinated items this working
  // ledger cannot see at all.
  const create = command === 'create-v1';
  const storePath = claimStorePath(gitCommonDir, namespace);
  const journalPath = claimJournalPath(gitCommonDir, namespace);
  let intent = null;
  try {
    return await withClaimLock(storePath, async () => {
      // The writer's own identity must exist before anything it does can be
      // attributed, so it is established under the same lock that serializes
      // the journal, ahead of reconciliation and of any intent append. Its own
      // file is judged first, so bytes this worktree owns keep reporting as its
      // own invalid identity rather than as an unreadable roster.
      const currentWorktreeId = await ensureWorktreeIdentity({ ledgerDirectory, gitCommonDir });
      // Then the domain: a UUID two live worktrees answer to attributes
      // nothing, so nothing may be written from it.
      await assertUniqueWorktreeIdentity({ ledgerDirectory });
      const replayed = await replayClaimJournal(journalPath, namespace);
      const reconciled = await reconcileClaimJournal({
        ledgerDirectory,
        gitCommonDir,
        namespace,
        replayed,
        currentWorktreeId,
        physicalNow: new Date().toISOString(),
        targetItemId: itemId,
        writeLogOnUnsafe: false,
        writeLogWhenEmpty: !create,
      });
      if (reconciled.unsafe) {
        return claimStoreUnavailable(responseCommand, 'publication-reconciliation-required', {
          findings: reconciled.findings,
        });
      }
      // A coordinated item this checkout does not hold carries a number nobody
      // here can read, so the next number this create would allocate may be one
      // a sibling worktree already published. A stale revision of an item that
      // is present hides no number: an item's number is immutable, so target
      // scoping above still lets that create through.
      if (create && reconciled.missingCoordinatedItems.length > 0) {
        return claimStoreUnavailable(responseCommand, 'publication-reconciliation-required', {
          findings: reconciled.findings,
        });
      }
      const observedAt = reconciled.observedAt;
      // The reconciliation log must gain this command's own journal entries
      // before the command returns, so the item and the log form one
      // post-mutation commit set.
      const projected = [...reconciled.entries];
      const record = reconciled.state.claims.find((entry) => entry.item_id === itemId)
        ?? { item_id: itemId, last_epoch: '0', active: null };
      const mustRefuse = create
        ? record.last_epoch !== '0'
        : record.active !== null && observedAt < record.active.expires_at;
      if (mustRefuse) return legacyRefusal(responseCommand, namespace, itemId, observedAt, record);

      const authorize = async (expectedRevision, candidateRevision, itemPath) => {
        const attemptId = randomUUID();
        const intentEntry = {
          type: 'legacy-mutation-intent',
          attempt_id: attemptId,
          ledger_namespace: namespace,
          item_id: itemId,
          command,
          expected_revision: expectedRevision,
          candidate_revision: candidateRevision,
          item_path: itemPath,
          writer_worktree_id: currentWorktreeId,
          observed_at: observedAt,
        };
        const terminalEntry = {
          type: 'legacy-mutation',
          attempt_id: attemptId,
          ledger_namespace: namespace,
          item_id: itemId,
          command,
          committed_revision: candidateRevision,
          item_path: itemPath,
          writer_worktree_id: currentWorktreeId,
          observed_at: observedAt,
        };
        const abortEntry = {
          type: 'legacy-mutation-abort',
          attempt_id: attemptId,
          ledger_namespace: namespace,
          item_id: itemId,
          ...(create ? { command } : {}),
          observed_revision: expectedRevision,
          observed_at: observedAt,
        };
        const resolutionEntry = Buffer.byteLength(JSON.stringify(terminalEntry))
          >= Buffer.byteLength(JSON.stringify(abortEntry))
          ? terminalEntry
          : abortEntry;
        await assertClaimJournalCapacity(journalPath, [
          intentEntry,
          { type: 'clock', now: observedAt, floor: observedAt },
          resolutionEntry,
        ]);
        intent = await appendClaimEntry(journalPath, intentEntry);
        projected.push(intent);
      };
      let outcome;
      try {
        // Reconciliation already read the complete ledger under this same
        // claim lock and changed nothing a load would see. The write reuses
        // that snapshot for its pre-lock phase and re-reads under lock.
        outcome = await write(authorize, reconciled.ledger);
      } catch (error) {
        if (intent) {
          return claimStoreUnavailable(responseCommand, 'legacy-mutation-outcome-unknown', {
            attempt_id: intent.attempt_id,
            candidate_revision: intent.candidate_revision,
          }, 'unknown');
        }
        throw error;
      }
      if (!intent) {
        return outcome?.state === 'committed'
          ? { ...outcome, changed_paths: [outcome.item?.path].filter(Boolean) }
          : outcome;
      }
      if (outcome?.state === 'committed') {
        const committedRevision = outcome.ok === true
          ? outcome.item?.revision
          : outcome.error?.details?.revision;
        if (committedRevision !== intent.candidate_revision) {
          return claimStoreUnavailable(responseCommand, 'legacy-mutation-outcome-unknown', {
            attempt_id: intent.attempt_id,
            candidate_revision: intent.candidate_revision,
          }, 'unknown');
        }
        try {
          projected.push(await appendClaimEntry(journalPath, {
            type: 'legacy-mutation',
            attempt_id: intent.attempt_id,
            ledger_namespace: namespace,
            item_id: itemId,
            command,
            committed_revision: committedRevision,
            observed_at: observedAt,
            item_path: intent.item_path,
            writer_worktree_id: currentWorktreeId,
          }));
        } catch {
          return claimStoreUnavailable(responseCommand, 'legacy-mutation-record-failed', {
            attempt_id: intent.attempt_id,
            committed_revision: committedRevision,
          }, 'unknown');
        }
      } else if (outcome?.state === 'unchanged') {
        try {
          projected.push(await appendClaimEntry(journalPath, {
            type: 'legacy-mutation-abort',
            attempt_id: intent.attempt_id,
            ledger_namespace: namespace,
            item_id: itemId,
            ...(create ? { command } : {}),
            observed_revision: intent.expected_revision,
            observed_at: observedAt,
          }));
        } catch {
          return claimStoreUnavailable(responseCommand, 'legacy-mutation-record-failed');
        }
      }
      try {
        await writeReconcileLog(
          claimReconcileLogPath(path.resolve(ledgerDirectory), namespace),
          namespace,
          projected,
        );
      } catch {
        // The tracked reconciliation log is derived. The fsync'd journal
        // already recorded the mutation and the next command rebuilds it.
      }
      return outcome?.state === 'committed'
        ? {
          ...outcome,
          changed_paths: [
            outcome.item?.path,
            `.wowbagger/reconcile-${namespace}.md`,
          ].filter(Boolean),
        }
        : outcome;
    });
  } catch (error) {
    return claimStoreUnavailable(responseCommand, error?.code === 'CLAIM_LOCK_HELD'
      ? 'claim-store-locked'
      : 'claim-store-unreadable', identityDiagnosticDetails(error), intent ? 'unknown' : 'unchanged');
  }
}

function legacyRefusal(command, namespace, itemId, observedAt, record) {
  const create = command === 'create-v1';
  return {
    exit: 4,
    stdout: {
      ok: false,
      namespace: 'ledger-mutation',
      command,
      contract_version: 1,
      state: 'unchanged',
      error: {
        code: create ? 'claimed-item-write-refused' : 'active-claim-write-refused',
        message: create
          ? 'Legacy create cannot write an item identity with claim history.'
          : 'Legacy transition cannot write an item with an active claim.',
        details: readBack(namespace, itemId, observedAt, record),
      },
    },
  };
}

function claimStoreUnavailable(command, reason, details = {}, state = 'unchanged') {
  return {
    exit: 6,
    stdout: {
      ok: false,
      namespace: 'ledger-mutation',
      command,
      contract_version: 1,
      state,
      error: {
        code: 'claim-store-unavailable',
        message: 'The durable claim store is unavailable.',
        details: { reason, ...details },
      },
    },
  };
}
