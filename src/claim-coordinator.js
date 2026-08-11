
import { claimJournalPath, replayClaimJournal } from './claim-journal.js';
import { resolveWorkClaimCapability } from './claim-capabilities.js';
import { readBack } from './claim-operations.js';
import { reconcileClaimJournal } from './claim-publication.js';
import { claimStorePath, resolveVerifiedGitCommonDir, withClaimLock } from './claim-store.js';
import { readNamespace } from './namespace.js';

export async function withLegacyMutationFence(ledgerDirectory, itemId, command, write) {
  const gitCommonDir = await resolveVerifiedGitCommonDir(ledgerDirectory);
  const namespace = gitCommonDir ? await readNamespace(ledgerDirectory) : null;
  const capability = resolveWorkClaimCapability({ gitCommonDir, namespace });
  if (!capability.claim_protected_publication) return write();

  const storePath = claimStorePath(gitCommonDir, namespace);
  const journalPath = claimJournalPath(gitCommonDir, namespace);
  try {
    return await withClaimLock(storePath, async () => {
      const replayed = await replayClaimJournal(journalPath, namespace);
      const reconciled = await reconcileClaimJournal({
        ledgerDirectory,
        gitCommonDir,
        namespace,
        replayed,
        physicalNow: new Date().toISOString(),
      });
      if (reconciled.unsafe) {
        return claimStoreUnavailable(command, 'publication-reconciliation-required', {
          findings: reconciled.findings,
        });
      }
      const observedAt = reconciled.observedAt;
      const record = reconciled.state.claims.find((entry) => entry.item_id === itemId)
        ?? { item_id: itemId, last_epoch: '0', active: null };
      const mustRefuse = command === 'create-v1'
        ? record.last_epoch !== '0'
        : record.active !== null && observedAt < record.active.expires_at;
      if (!mustRefuse) return write();
      return legacyRefusal(command, namespace, itemId, observedAt, record);
    });
  } catch (error) {
    return claimStoreUnavailable(command, error?.code === 'CLAIM_LOCK_HELD'
      ? 'claim-store-locked'
      : 'claim-store-unreadable');
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

function claimStoreUnavailable(command, reason, details = {}) {
  return {
    exit: 6,
    stdout: {
      ok: false,
      namespace: 'ledger-mutation',
      command,
      contract_version: 1,
      state: 'unchanged',
      error: {
        code: 'claim-store-unavailable',
        message: 'The durable claim store is unavailable.',
        details: { reason, ...details },
      },
    },
  };
}
