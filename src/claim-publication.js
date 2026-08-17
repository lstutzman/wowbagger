import { createHash } from 'node:crypto';
import { access, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  appendClaimEntry,
  claimJournalPath,
  claimReconcileLogPath,
  replayClaimJournal,
  writeReconcileLog,
} from './claim-journal.js';
import { advanceClockFloor, readBack } from './claim-operations.js';
import { claimStorePath, withClaimLock, writeClaimState } from './claim-store.js';
import { loadLedger, parseLedgerItemSource } from './ledger.js';
import { MAX_ITEM_SOURCE_BYTES } from './limits.js';
import { readGitHeadLedger } from './git-reconciliation.js';
import { publishClaimedCandidate, revisionFor } from './mutation.js';
import { validateLedger } from './validate.js';

const ITEM_ID = /^wb_[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const NAMESPACE_ID = /^wbns_[a-f0-9]{32}$/;
const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REVISION = /^sha256:[a-f0-9]{64}$/;
const EPOCH = /^(?:[1-9][0-9]{0,18}|1[0-7][0-9]{18}|18[0-3][0-9]{17}|184[0-3][0-9]{16}|1844[0-5][0-9]{15}|18446[0-6][0-9]{14}|184467[0-3][0-9]{13}|1844674[0-3][0-9]{12}|18446744[0-6][0-9]{11}|184467440[0-6][0-9]{10}|1844674407[0-2][0-9]{9}|18446744073[0-6][0-9]{8}|1844674407370[0-8][0-9]{6}|18446744073709[0-4][0-9]{4}|184467440737095[0-4][0-9]{3}|1844674407370955[0-9]{2}|18446744073709551[0-5])$/;
const PUBLICATION_MEMBERS = [
  'candidate_sha256',
  'candidate_source_base64',
  'claim_fence',
  'expected_revision',
  'item_id',
  'ledger_namespace',
  'operation_id',
];

export function validatePublicationRequest(request) {
  if (isExactObject(request, ['operation_id'])
    && OPERATION_ID.test(request.operation_id)) {
    return publicationError(
      request,
      'invalid-request',
      'The publish-claimed retry must include its complete request.',
      {},
      2,
    );
  }
  if (!isExactObject(request, PUBLICATION_MEMBERS)
    || !OPERATION_ID.test(request.operation_id)
    || !NAMESPACE_ID.test(request.ledger_namespace)
    || !ITEM_ID.test(request.item_id)
    || !REVISION.test(request.expected_revision)
    || !REVISION.test(request.candidate_sha256)
    || !isExactObject(request.claim_fence, ['epoch', 'item_id', 'ledger_namespace', 'owner_id'])
    || !NAMESPACE_ID.test(request.claim_fence.ledger_namespace)
    || !ITEM_ID.test(request.claim_fence.item_id)
    || typeof request.claim_fence.owner_id !== 'string'
    || request.claim_fence.owner_id.length === 0
    || !EPOCH.test(request.claim_fence.epoch)
    || typeof request.candidate_source_base64 !== 'string') {
    return publicationError(request, 'invalid-request', 'The request does not match publish-claimed version 1.', {}, 2);
  }
  let candidate;
  try {
    candidate = Buffer.from(request.candidate_source_base64, 'base64');
  } catch {
    return canonicalBase64Error(request);
  }
  // Spelling first: without canonical base64 there is no item source to
  // measure. The serialized-request bound already caps what this decodes, so no
  // separate character precheck is needed, and keeping one would answer a
  // genuine size refusal with a false base64 message.
  if (candidate.toString('base64') !== request.candidate_source_base64) {
    return canonicalBase64Error(request);
  }
  if (candidate.length > MAX_ITEM_SOURCE_BYTES) {
    return itemSourceTooLarge(request, candidate.length);
  }
  if (revisionFor(candidate) !== request.candidate_sha256) {
    return publicationError(
      request,
      'candidate-digest-mismatch',
      'The candidate digest does not match the candidate source.',
      { operation_id: request.operation_id },
      2,
    );
  }
  return null;
}

export function validatePublicationReadRequest(request) {
  const required = ['item_id', 'ledger_namespace', 'operation_id'];
  if (!isExactObject(request, required)
    || !OPERATION_ID.test(request.operation_id ?? '')
    || !NAMESPACE_ID.test(request.ledger_namespace ?? '')
    || !ITEM_ID.test(request.item_id ?? '')) {
    return publicationReadError(request, 'invalid-request',
      'The request does not match ledger-publication.read version 1.', {
        expected_members: required,
      });
  }
  return null;
}

export async function readPublicationOutcome({ gitCommonDir, namespace, request }) {
  const journalPath = claimJournalPath(gitCommonDir, namespace);
  try {
    const replayed = await replayClaimJournal(journalPath, namespace);
    const outcome = replayed.entries.find((entry) => (
      entry.type === 'publish-final'
        && entry.operation_id === request.operation_id
        && entry.item_id === request.item_id
    ));
    if (!outcome) {
      return publicationReadError(request, 'operation-not-found',
        'The publication operation outcome was not found.', {
          operation_id: request.operation_id,
          ledger_namespace: request.ledger_namespace,
          item_id: request.item_id,
        });
    }
    return {
      exit: 0,
      stdout: {
        ok: true,
        namespace: 'ledger-publication',
        command: 'read',
        contract_version: 1,
        state: 'committed',
        operation_id: request.operation_id,
        result: {
          operation_id: request.operation_id,
          ledger_namespace: request.ledger_namespace,
          item_id: request.item_id,
          operation_digest: outcome.operation_digest,
          outcome: structuredClone(outcome.outcome),
        },
      },
    };
  } catch (error) {
    return publicationReadError(request, 'claim-store-unavailable',
      'The durable claim store is unavailable.', {
        reason: error?.code === 'CLAIM_LOCK_HELD' ? 'claim-store-locked' : 'claim-store-unreadable',
      }, 6);
  }
}

export async function publishClaimed({ ledgerDirectory, gitCommonDir, namespace, request, scenario }) {
  if (request.ledger_namespace !== namespace) {
    return publicationError(request, 'ledger-namespace-unbound',
      'The ledger namespace is not provisioned for this endpoint.', {
        ledger_namespace: request.ledger_namespace,
      }, 2);
  }

  const storePath = claimStorePath(gitCommonDir, namespace);
  const journalPath = claimJournalPath(gitCommonDir, namespace);
  try {
    return await withClaimLock(storePath, async (namespaceLock) => {
      let replayed = await replayClaimJournal(journalPath, namespace);
      const digest = operationDigest(request);
      const prior = replayed.entries.find((entry) => (
        entry.type === 'publish-final'
          && entry.operation_id === request.operation_id
      ));
      if (prior) {
        return prior.operation_digest === digest
          ? prior.outcome
          : idempotencyConflict(request.operation_id, prior.operation_digest, digest);
      }
      // A claimed publication is a mutation, so it reconciles before it
      // authorizes one, exactly as the legacy fence does. Reconciling only
      // behind an unresolved publish-intent let an uncommitted legacy mutation
      // — which refuses every other mutating command — pass this one.
      //
      // Every unlocked read this publication performs happens inside one claim
      // lock hold on one directory, and nothing between them writes an item
      // file, so the first of them is the snapshot the rest share. The read
      // under lock, which the mutation engine still performs on its own, is
      // what makes the revision compare-and-swap meaningful.
      let reconciled;
      try {
        reconciled = await reconcileClaimJournal({
          ledgerDirectory,
          gitCommonDir,
          namespace,
          replayed,
          physicalNow: new Date().toISOString(),
        });
      } catch (error) {
        if (error?.code !== 'CLOCK_FLOOR_PERSISTENCE_FAILED') throw error;
        return publicationError(request, 'clock-floor-persistence-failed',
          'The authoritative clock floor could not be persisted.', {
            ledger_namespace: request.ledger_namespace,
            item_id: request.item_id,
          }, 6);
      }
      if (reconciled.unsafe) {
        return publicationError(request, 'claim-store-unavailable',
          'The durable claim store is unavailable.', {
            reason: 'publication-reconciliation-required',
            findings: reconciled.findings,
          }, 6);
      }
      replayed = { entries: reconciled.entries, state: reconciled.state };
      let ledgerSnapshot = reconciled.ledger;
      const reconciledPrior = replayed.entries.find((entry) => (
        entry.type === 'publish-final'
          && entry.operation_id === request.operation_id
      ));
      if (reconciledPrior) {
        return reconciledPrior.operation_digest === digest
          ? reconciledPrior.outcome
          : idempotencyConflict(request.operation_id, reconciledPrior.operation_digest, digest);
      }
      const candidate = await validateCandidateLedger(ledgerDirectory, request, ledgerSnapshot);
      if (candidate.error) return candidate.error;
      ledgerSnapshot = candidate.ledger;
      // Reconciliation already persisted this hold's clock floor.
      const observedAt = reconciled.observedAt;
      const entries = [...replayed.entries];
      const record = replayed.state.claims.find((entry) => entry.item_id === request.item_id)
        ?? { item_id: request.item_id, last_epoch: '0', active: null };
      const rejection = fenceRejectionReason(request, record.active, observedAt);
      if (rejection) {
        const outcome = publicationError(request, 'claim-fence-rejected',
          'The supplied claim fence is not the active owner generation.', {
            ledger_namespace: request.ledger_namespace,
            item_id: request.item_id,
            observed_at: observedAt,
            reason: rejection,
            supplied_owner_id: request.claim_fence.owner_id,
            supplied_epoch: request.claim_fence.epoch,
            active_owner_id: record.active?.owner_id ?? null,
            active_epoch: record.active?.epoch ?? null,
          }, 4);
        return persistTerminal(entries, journalPath, ledgerDirectory, namespace, request, outcome, replayed.state, storePath);
      }
      await publicationTestCheckpoint(scenario, 'before-publish-intent', ledgerDirectory);
      const intent = await appendClaimEntry(journalPath, {
        type: 'publish-intent',
        operation_id: request.operation_id,
        operation_digest: operationDigest(request),
        item_id: request.item_id,
        expected_revision: request.expected_revision,
        candidate_sha256: request.candidate_sha256,
        fence: request.claim_fence,
        floor: observedAt,
        state: 'pending',
      });
      entries.push(intent);
      await publicationTestCheckpoint(scenario, 'after-publish-intent', ledgerDirectory);
      const mutation = await publishClaimedCandidate({
        ledgerDirectory, request, scenario, ledgerSnapshot, namespaceLock, storePath,
      });
      if (!mutation.ok) {
        const outcome = mutationFailure(request, mutation);
        return persistTerminal(entries, journalPath, ledgerDirectory, namespace, request, outcome, replayed.state, storePath);
      }
      await publicationTestCheckpoint(scenario, 'after-ledger-commit', ledgerDirectory);
      const outcome = publicationSuccess(request, record, observedAt);
      const terminal = await persistTerminal(entries, journalPath, ledgerDirectory, namespace, request, outcome, replayed.state, storePath);
      await publicationTestCheckpoint(scenario, 'after-terminal-record', ledgerDirectory);
      return terminal;
    });
  } catch (error) {
    if (error?.code === 'CLAIM_LOCK_HELD') {
      return publicationError(request, 'claim-store-unavailable', 'The durable claim store is unavailable.', {
        reason: 'claim-store-locked',
      }, 6);
    }
    return publicationUnknown(request);
  }
}

export async function reconcileClaimJournal({
  ledgerDirectory,
  gitCommonDir,
  namespace,
  replayed,
  physicalNow,
}) {
  const storePath = claimStorePath(gitCommonDir, namespace);
  const journalPath = claimJournalPath(gitCommonDir, namespace);
  const ledger = await loadLedger(path.resolve(ledgerDirectory));
  const items = new Map(ledger.items.map((item) => [item.data.id, item]));
  const terminalKeys = new Set(replayed.entries
    .filter((entry) => entry.type === 'publish-final')
    .map((entry) => `${entry.operation_id}\0${entry.item_id}`));
  const pending = replayed.entries.filter((entry) => (
    entry.type === 'publish-intent'
      && !terminalKeys.has(`${entry.operation_id}\0${entry.item_id}`)
  ));
  const entries = [...replayed.entries];
  const findings = [];
  const observedAt = advanceClockFloor(replayed.state, physicalNow);
  try {
    entries.push(await appendClaimEntry(journalPath, {
      type: 'clock',
      now: physicalNow,
      floor: observedAt,
    }));
  } catch (cause) {
    const error = new Error('The authoritative clock floor could not be persisted.', { cause });
    error.code = 'CLOCK_FLOOR_PERSISTENCE_FAILED';
    throw error;
  }
  const legacyMutationTerminals = new Set(entries
    .filter((entry) => (
      ['legacy-mutation', 'legacy-mutation-abort'].includes(entry.type)
        && typeof entry.attempt_id === 'string'
    ))
    .map((entry) => entry.attempt_id));
  const pendingLegacyMutations = entries.filter((entry) => (
    entry.type === 'legacy-mutation-intent'
      && !legacyMutationTerminals.has(entry.attempt_id)
  ));
  for (const intent of pendingLegacyMutations) {
    const item = items.get(intent.item_id);
    const actualRevision = item ? revisionFor(item.bytes) : null;
    if (actualRevision === intent.candidate_revision) {
      entries.push(await appendClaimEntry(journalPath, {
        type: 'legacy-mutation',
        attempt_id: intent.attempt_id,
        ledger_namespace: namespace,
        item_id: intent.item_id,
        command: intent.command,
        committed_revision: actualRevision,
        ...(intent.item_path ? { item_path: intent.item_path } : {}),
        observed_at: observedAt,
      }));
    } else if (actualRevision === intent.expected_revision) {
      entries.push(await appendClaimEntry(journalPath, {
        type: 'legacy-mutation-abort',
        attempt_id: intent.attempt_id,
        ledger_namespace: namespace,
        item_id: intent.item_id,
        observed_revision: actualRevision,
        observed_at: observedAt,
      }));
    } else {
      const expectedPath = itemPathRelativeToLedger(ledgerDirectory, item?.file)
        ?? intent.item_path
        ?? null;
      const pathLabel = expectedPath ?? `item ${intent.item_id}`;
      findings.push({
        code: 'legacy-mutation-outcome-unknown',
        item_id: intent.item_id,
        attempt_id: intent.attempt_id,
        actual_revision: actualRevision,
        expected_revision: intent.expected_revision,
        candidate_revision: intent.candidate_revision,
        ...(expectedPath ? { expected_path: expectedPath } : {}),
        remediation: `Restore ${pathLabel} to the expected or candidate revision recorded for attempt ${intent.attempt_id}, then run claim-verify.`,
      });
    }
  }

  for (const intent of pending) {
    const item = items.get(intent.item_id);
    const actualRevision = item ? revisionFor(item.bytes) : null;
    const record = replayed.state.claims.find((entry) => entry.item_id === intent.item_id)
      ?? { item_id: intent.item_id, last_epoch: '0', active: null };
    const higherEpoch = BigInt(record.last_epoch) > BigInt(intent.fence.epoch);
    let outcome;
    if (actualRevision === intent.candidate_sha256 && !higherEpoch) {
      outcome = publicationSuccess({
        operation_id: intent.operation_id,
        ledger_namespace: namespace,
        item_id: intent.item_id,
        candidate_sha256: intent.candidate_sha256,
        claim_fence: intent.fence,
      }, record, observedAt);
    } else if (higherEpoch) {
      outcome = publicationError({
        operation_id: intent.operation_id,
      }, 'claim-fence-rejected',
      'The supplied claim fence is not the active owner generation.', {
        ledger_namespace: namespace,
        item_id: intent.item_id,
        observed_at: observedAt,
        reason: 'epoch-mismatch',
        supplied_owner_id: intent.fence.owner_id,
        supplied_epoch: intent.fence.epoch,
        active_owner_id: record.active?.owner_id ?? null,
        active_epoch: record.active?.epoch ?? null,
      }, 4);
    } else if (
      actualRevision === intent.expected_revision
        || entries.some((entry) => (
          entry.type === 'publish-final'
            && entry.item_id === intent.item_id
            && entry.outcome?.stdout?.state === 'committed'
            && entry.outcome.stdout.result.committed_revision === actualRevision
        ))
    ) {
      outcome = publicationError({
        operation_id: intent.operation_id,
      }, 'ledger-revision-conflict',
      'The durable ledger revision no longer matches this publication.', {
        ledger_namespace: namespace,
        item_id: intent.item_id,
        expected_revision: intent.candidate_sha256,
        actual_revision: actualRevision,
      }, 4);
    } else {
      outcome = publicationUnknown({
        operation_id: intent.operation_id,
        ledger_namespace: namespace,
        item_id: intent.item_id,
      });
    }
    entries.push(await appendClaimEntry(journalPath, {
      type: 'publish-final',
      operation_id: intent.operation_id,
      operation_digest: intent.operation_digest,
      ledger_namespace: namespace,
      item_id: intent.item_id,
      outcome,
    }));
    const unknownPath = itemPathRelativeToLedger(ledgerDirectory, item?.file);
    findings.push({
      code: outcome.stdout.state === 'unknown'
        ? 'publication-outcome-unknown'
        : 'pending-intent-resolved',
      item_id: intent.item_id,
      operation_id: intent.operation_id,
      outcome: outcome.stdout.state,
      ...(outcome.stdout.state === 'unknown' ? {
        ...(unknownPath ? { expected_path: unknownPath } : {}),
        remediation: `Inspect publication ${intent.operation_id} for ${unknownPath ?? `item ${intent.item_id}`}, complete its documented recovery, then run claim-verify.`,
      } : {}),
    });
  }

  const headItems = new Map();
  let gitHead = null;
  try {
    await access(path.join(gitCommonDir, 'HEAD'));
    gitHead = await readGitHeadLedger(ledgerDirectory);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (gitHead) {
    for (const [file, bytes] of gitHead.items) {
      const parsed = parseLedgerItemSource(bytes.toString('utf8'));
      if (!parsed.error && typeof parsed.data?.id === 'string') {
        headItems.set(parsed.data.id, { bytes, file });
      }
    }
    const finalizedKeys = new Set(entries
      .filter((entry) => entry.type === 'publish-finalization')
      .map((entry) => `${entry.operation_id}\0${entry.item_id}`));
    for (const terminal of entries) {
      if (
        terminal.type !== 'publish-final'
          || terminal.outcome?.stdout?.state !== 'committed'
          || finalizedKeys.has(`${terminal.operation_id}\0${terminal.item_id}`)
      ) continue;
      const committedRevision = terminal.outcome.stdout.result.committed_revision;
      const headItem = headItems.get(terminal.item_id);
      if (!headItem || revisionFor(headItem.bytes) !== committedRevision) continue;
      const finalization = await appendClaimEntry(journalPath, {
        type: 'publish-finalization',
        operation_id: terminal.operation_id,
        item_id: terminal.item_id,
        committed_revision: committedRevision,
        git_commit: gitHead.commit,
      });
      entries.push(finalization);
      finalizedKeys.add(`${terminal.operation_id}\0${terminal.item_id}`);
    }
  }

  const coordinatedItems = new Set(entries
    .filter((entry) => (
      entry.type === 'publish-finalization'
        || entry.type === 'legacy-mutation'
    ))
    .map((entry) => entry.item_id));
  for (const itemId of coordinatedItems) {
    const authorized = authorizingEntries(entries, itemId);
    const latestAuthorized = authorized.at(-1);
    const expectedRevision = authorizedRevisionOf(latestAuthorized);
    const authorizedRevisions = new Set(authorized.map(authorizedRevisionOf));
    for (const intent of entries) {
      if (intent.type === 'legacy-mutation-intent' && intent.item_id === itemId) {
        authorizedRevisions.add(intent.expected_revision);
      }
    }
    if (!expectedRevision) continue;
    const item = items.get(itemId);
    const actualRevision = item ? revisionFor(item.bytes) : null;
    const headItem = headItems.get(itemId);
    const headRevision = headItem ? revisionFor(headItem.bytes) : null;
    const workingTreeChanged = actualRevision !== expectedRevision;
    const gitHeadChanged = gitHead !== null && !authorizedRevisions.has(headRevision);
    if (!workingTreeChanged && !gitHeadChanged) continue;
    const record = replayed.state.claims.find((entry) => entry.item_id === itemId);
    const expectedPath = itemPathRelativeToLedger(ledgerDirectory, item?.file)
      ?? headItem?.file
      ?? latestAuthorized.item_path
      ?? null;
    const activeMismatch = activePublicationMismatch(
      entries,
      record,
      actualRevision,
      observedAt,
    );
    if (activeMismatch?.earlier) {
      const pathLabel = expectedPath ?? `item ${itemId}`;
      findings.push({
        code: 'stale-write-detected',
        item_id: itemId,
        actual_revision: actualRevision,
        expected_revision: activeMismatch.expectedRevision,
        active_fence: {
          ledger_namespace: namespace,
          item_id: itemId,
          owner_id: record.active.owner_id,
          epoch: record.active.epoch,
        },
        observed_surface: 'working-tree',
        reason: 'claimed-publication-pending',
        ...(expectedPath ? { expected_path: expectedPath } : {}),
        remediation: `Inspect publication ${activeMismatch.expected.operation_id} for ${pathLabel}, then complete its documented recovery.`,
        stale_fence: structuredClone(activeMismatch.earlier.outcome.stdout.result.claim_fence),
      });
      continue;
    }
    const diagnosis = reconciliationDiagnosis({
      actualRevision,
      expectedPath,
      expectedRevision,
      headRevision,
      workingTreeChanged,
    });
    findings.push({
      code: 'stale-write-detected',
      item_id: itemId,
      actual_revision: workingTreeChanged ? actualRevision : headRevision,
      expected_revision: expectedRevision,
      observed_surface: workingTreeChanged ? 'working-tree' : 'git-head',
      ...diagnosis,
      ...(record?.active ? {
        active_fence: {
          ledger_namespace: namespace,
          item_id: itemId,
          owner_id: record.active.owner_id,
          epoch: record.active.epoch,
        },
      } : {}),
    });
  }


  for (const record of replayed.state.claims) {
    if (coordinatedItems.has(record.item_id)) continue;
    const item = items.get(record.item_id);
    const actualRevision = item ? revisionFor(item.bytes) : null;
    const activeMismatch = activePublicationMismatch(
      entries,
      record,
      actualRevision,
      observedAt,
    );
    if (!activeMismatch) continue;
    const {
      earlier,
      expected,
      expectedRevision,
    } = activeMismatch;
    const expectedPath = itemPathRelativeToLedger(ledgerDirectory, item?.file)
      ?? expected.item_path
      ?? null;
    const pathLabel = expectedPath ?? `item ${record.item_id}`;
    findings.push({
      code: earlier ? 'stale-write-detected' : 'revision-regression',
      item_id: record.item_id,
      actual_revision: actualRevision,
      expected_revision: expectedRevision,
      active_fence: {
        ledger_namespace: namespace,
        item_id: record.item_id,
        owner_id: record.active.owner_id,
        epoch: record.active.epoch,
      },
      ...(earlier ? {
        observed_surface: 'working-tree',
        reason: 'claimed-publication-pending',
        ...(expectedPath ? { expected_path: expectedPath } : {}),
        remediation: `Inspect publication ${expected.operation_id} for ${pathLabel}, then complete its documented recovery.`,
        stale_fence: structuredClone(earlier.outcome.stdout.result.claim_fence),
      } : {
        ...(expectedPath ? { expected_path: expectedPath } : {}),
        remediation: `Restore the authorized revision at ${pathLabel}, then run claim-verify.`,
      }),
    });
  }

  await writeReconcileLog(
    claimReconcileLogPath(path.resolve(ledgerDirectory), namespace),
    namespace,
    entries,
  );
  try {
    await writeClaimState(storePath, replayed.state);
  } catch {
    // The snapshot is a rebuildable memo. The fsync'd journal is authoritative.
  }
  return {
    entries,
    findings,
    gitHead,
    headItems,
    // The snapshot reconciliation judged. Reconciliation writes only the
    // journal, the claim state, and the ledger's `.wowbagger` reconcile log,
    // none of which a complete ledger load reads, so these are still the bytes
    // on disk when reconciliation returns. A caller holding the claim lock may
    // reuse it instead of loading the same directory again, provided every
    // decision it draws from the snapshot is re-made under lock.
    ledger,
    observedAt,
    state: replayed.state,
    unsafe: findings.some((finding) => finding.code !== 'pending-intent-resolved'),
  };
}

// An item's authorized revision is whatever the journal last ruled legitimate:
// a committed claimed publication, a legacy mutation, or an operator adoption.
// Adoption is the only one of the three that changes no item byte.
function authorizingEntries(entries, itemId) {
  return entries.filter((entry) => (
    entry.item_id === itemId
      && (entry.type === 'legacy-mutation'
        || entry.type === 'revision-adoption'
        || (entry.type === 'publish-final' && entry.outcome?.stdout?.state === 'committed'))
  ));
}

function authorizedRevisionOf(entry) {
  if (!entry) return undefined;
  if (entry.type === 'legacy-mutation') return entry.committed_revision;
  if (entry.type === 'revision-adoption') return entry.to_revision;
  return entry.outcome.stdout.result.committed_revision;
}

function itemPathRelativeToLedger(ledgerDirectory, file) {
  if (!file) return null;
  return path.relative(path.resolve(ledgerDirectory), file).split(path.sep).join('/');
}

function reconciliationDiagnosis({
  actualRevision,
  expectedPath,
  expectedRevision,
  headRevision,
  workingTreeChanged,
}) {
  const pathLabel = expectedPath ?? 'the item path';
  if (!workingTreeChanged && headRevision !== expectedRevision) {
    return {
      reason: 'git-finalization-required',
      ...(expectedPath ? { expected_path: expectedPath } : {}),
      remediation: `Commit ${pathLabel} in Git, then run claim-verify.`,
    };
  }
  if (actualRevision === null && headRevision !== expectedRevision) {
    return {
      reason: 'worktree-synchronization-required',
      ...(expectedPath ? { expected_path: expectedPath } : {}),
      remediation: `Synchronize this worktree to the commit that wrote ${pathLabel} (pull or merge), then run claim-verify.`,
    };
  }
  // Two remedies, both named, in the order that makes the cost obvious. The
  // field report behind item #113 read the single restore sentence as the only
  // way out and discarded reviewed, merged work to obey it.
  return {
    reason: 'unauthorized-revision',
    ...(expectedPath ? { expected_path: expectedPath } : {}),
    remediation: `Restore the authorized revision at ${pathLabel}, then run claim-verify; that discards the edit. Or adopt the committed revision of ${pathLabel} with claim-adopt, then run claim-verify; that keeps the edit.`,
  };
}

function activePublicationMismatch(entries, record, actualRevision, observedAt) {
  if (!record || record.active === null || observedAt >= record.active.expires_at) return null;
  const expected = entries.filter((entry) => (
    entry.type === 'publish-final'
      && entry.item_id === record.item_id
      && entry.outcome?.stdout?.state === 'committed'
      && entry.outcome.stdout.result.claim_fence.epoch === record.active.epoch
  )).at(-1);
  if (!expected) return null;
  const expectedRevision = expected.outcome.stdout.result.committed_revision;
  if (actualRevision === expectedRevision) return null;
  const earlier = entries.find((entry) => (
    entry.type === 'publish-final'
      && entry.item_id === record.item_id
      && entry.outcome?.stdout?.state === 'committed'
      && entry.outcome.stdout.result.committed_revision === actualRevision
      && BigInt(entry.outcome.stdout.result.claim_fence.epoch) < BigInt(record.active.epoch)
  ));
  return { earlier, expected, expectedRevision };
}

function publicationStatuses(entries) {
  const finalizations = new Map(entries
    .filter((entry) => entry.type === 'publish-finalization')
    .map((entry) => [`${entry.operation_id}\0${entry.item_id}`, entry]));
  return entries
    .filter((entry) => (
      entry.type === 'publish-final'
        && entry.outcome?.stdout?.state === 'committed'
    ))
    .map((entry) => {
      const finalization = finalizations.get(`${entry.operation_id}\0${entry.item_id}`);
      return {
        operation_id: entry.operation_id,
        item_id: entry.item_id,
        committed_revision: entry.outcome.stdout.result.committed_revision,
        git_finalized: finalization !== undefined,
        git_commit: finalization?.git_commit ?? null,
      };
    });
}


// claim-verify is the verb every remediation string names, so a consistent
// journal alone is a misleading answer while ledger validation blocks every
// mutation. The report names that blocker without pretending it is a claim
// finding: findings and the exit status still describe claim state only.
function ledgerValidationReport(ledger) {
  const validation = validateLedger(ledger);
  if (validation.valid) return validation;
  return {
    ...validation,
    remediation: 'The ledger is invalid and every mutation is blocked; claim state is consistent. Repair each validation error, commit the repair, then run claim-verify.',
  };
}

export async function verifyClaimJournal({ ledgerDirectory, gitCommonDir, namespace }) {
  const storePath = claimStorePath(gitCommonDir, namespace);
  const journalPath = claimJournalPath(gitCommonDir, namespace);
  try {
    return await withClaimLock(storePath, async () => {
      const reconciled = await reconcileClaimJournal({
        ledgerDirectory,
        gitCommonDir,
        namespace,
        replayed: await replayClaimJournal(journalPath, namespace),
        physicalNow: new Date().toISOString(),
      });
      return {
        exit: reconciled.unsafe ? 6 : 0,
        stdout: {
          ok: !reconciled.unsafe,
          namespace: 'work-claim',
          command: 'claim-verify',
          contract_version: 1,
          state: reconciled.unsafe ? 'unknown' : 'committed',
          result: {
            ledger_namespace: namespace,
            observed_at: reconciled.observedAt,
            findings: reconciled.findings,
            ledger_validation: ledgerValidationReport(reconciled.ledger),
            publications: publicationStatuses(reconciled.entries),
          },
        },
      };
    });
  } catch (error) {
    // TEMPORARY win32 CI diagnostic; removed with .github/win32-claim-diagnose.mjs.
    if (process.env.WOWBAGGER_DEBUG_CLAIM_STORE) console.error(error?.stack ?? error);
    return {
      exit: 6,
      stdout: {
        ok: false,
        namespace: 'work-claim',
        command: 'claim-verify',
        contract_version: 1,
        state: 'unchanged',
        error: {
          code: 'claim-store-unavailable',
          message: 'The durable claim store is unavailable.',
          details: {
            reason: error?.code === 'CLAIM_LOCK_HELD'
              ? 'claim-store-locked'
              : 'claim-store-unreadable',
          },
        },
      },
    };
  }
}

// Adoption is the non-destructive half of the unauthorized-revision remedy: it
// re-baselines the coordinator's authorized revision onto bytes that are
// already committed, and writes no item byte. It runs while reconciliation is
// unsafe on purpose — clearing that state is the point — so it never refuses on
// `publication-reconciliation-required` the way a claim lifecycle operation
// does. Every precondition is checked under the claim lock against the state
// reconciliation just observed.
export async function adoptItemRevision({ ledgerDirectory, gitCommonDir, namespace, request }) {
  const storePath = claimStorePath(gitCommonDir, namespace);
  const journalPath = claimJournalPath(gitCommonDir, namespace);
  try {
    return await withClaimLock(storePath, async () => {
      const reconciled = await reconcileClaimJournal({
        ledgerDirectory,
        gitCommonDir,
        namespace,
        replayed: await replayClaimJournal(journalPath, namespace),
        physicalNow: new Date().toISOString(),
      });
      const refusal = adoptionRefusal(reconciled, ledgerDirectory, request);
      if (refusal) return refusal;

      const item = reconciled.ledger.items.find((entry) => entry.data.id === request.item_id);
      const itemPath = itemPathRelativeToLedger(ledgerDirectory, item?.file)
        ?? reconciled.headItems.get(request.item_id)?.file
        ?? null;
      const persisted = await appendClaimEntry(journalPath, {
        type: 'revision-adoption',
        ledger_namespace: namespace,
        item_id: request.item_id,
        from_revision: request.from_revision,
        to_revision: request.to_revision,
        adopted_by: request.adopted_by,
        adopted_at: reconciled.observedAt,
        git_commit: reconciled.gitHead.commit,
        ...(itemPath ? { item_path: itemPath } : {}),
      });
      try {
        await writeReconcileLog(
          claimReconcileLogPath(path.resolve(ledgerDirectory), namespace),
          namespace,
          [...reconciled.entries, persisted],
        );
      } catch {
        // The tracked reconciliation log is derived. The fsync'd journal
        // already committed the adoption and the next operation rebuilds it.
      }
      return {
        exit: 0,
        stdout: {
          ok: true,
          namespace: 'work-claim',
          command: 'claim-adopt',
          contract_version: 1,
          state: 'committed',
          result: {
            ledger_namespace: namespace,
            item_id: request.item_id,
            from_revision: request.from_revision,
            to_revision: request.to_revision,
            adopted_by: request.adopted_by,
            adopted_at: reconciled.observedAt,
          },
        },
      };
    });
  } catch (error) {
    return {
      exit: 6,
      stdout: {
        ok: false,
        namespace: 'work-claim',
        command: 'claim-adopt',
        contract_version: 1,
        state: 'unchanged',
        error: {
          code: error?.code === 'CLOCK_FLOOR_PERSISTENCE_FAILED'
            ? 'clock-floor-persistence-failed'
            : 'claim-store-unavailable',
          message: error?.code === 'CLOCK_FLOOR_PERSISTENCE_FAILED'
            ? 'The authoritative clock floor could not be persisted.'
            : 'The durable claim store is unavailable.',
          details: error?.code === 'CLOCK_FLOOR_PERSISTENCE_FAILED' ? {} : {
            reason: error?.code === 'CLAIM_LOCK_HELD'
              ? 'claim-store-locked'
              : 'claim-store-unreadable',
          },
        },
      },
    };
  }
}

function adoptionRefusal(reconciled, ledgerDirectory, request) {
  const authorized = authorizedRevisionOf(
    authorizingEntries(reconciled.entries, request.item_id).at(-1),
  ) ?? null;
  if (authorized !== request.from_revision) {
    return adoptionError('adoption-witness-mismatch',
      'The adoption witness no longer names the authorized revision.', {
        ledger_namespace: reconciled.state.ledger_namespace,
        item_id: request.item_id,
        authorized_revision: authorized,
        requested_from_revision: request.from_revision,
      });
  }
  const record = reconciled.state.claims.find((entry) => entry.item_id === request.item_id);
  if (record?.active && reconciled.observedAt < record.active.expires_at) {
    return {
      exit: 4,
      stdout: {
        ok: false,
        namespace: 'work-claim',
        command: 'claim-adopt',
        contract_version: 1,
        state: 'unchanged',
        error: {
          code: 'claim-held',
          message: 'The item has an unexpired active claim.',
          details: readBack(
            reconciled.state.ledger_namespace,
            request.item_id,
            reconciled.observedAt,
            record,
          ),
        },
      },
    };
  }
  // The adopted revision must be visible to every cooperating checkout, not
  // only to the operator's working tree. A ledger with no Git HEAD at all
  // cannot satisfy that, so it refuses on the same code.
  const item = reconciled.ledger.items.find((entry) => entry.data.id === request.item_id);
  const headItem = reconciled.headItems.get(request.item_id);
  const surfaces = [
    ['git-head', headItem ? revisionFor(headItem.bytes) : null],
    ['working-tree', item ? revisionFor(item.bytes) : null],
  ];
  for (const [surface, observed] of surfaces) {
    if (observed === request.to_revision) continue;
    return adoptionError('adoption-revision-uncommitted',
      'The adopted revision is not committed at Git HEAD.', {
        ledger_namespace: reconciled.state.ledger_namespace,
        item_id: request.item_id,
        requested_to_revision: request.to_revision,
        observed_surface: surface,
        observed_revision: observed,
      });
  }
  const validation = validateLedger(reconciled.ledger);
  if (!validation.valid) {
    return {
      exit: 3,
      stdout: {
        ok: false,
        namespace: 'work-claim',
        command: 'claim-adopt',
        contract_version: 1,
        state: 'unchanged',
        error: {
          code: 'adoption-ledger-invalid',
          message: 'The complete ledger is invalid with the adopted revision.',
          details: {
            ledger_namespace: reconciled.state.ledger_namespace,
            item_id: request.item_id,
            errors: validation.errors,
          },
        },
      },
    };
  }
  return null;
}

function adoptionError(code, message, details) {
  return {
    exit: 4,
    stdout: {
      ok: false,
      namespace: 'work-claim',
      command: 'claim-adopt',
      contract_version: 1,
      state: 'unchanged',
      error: { code, message, details },
    },
  };
}

export function operationDigest(request) {
  return `sha256:${createHash('sha256').update(canonicalJson(request)).digest('hex')}`;
}

async function persistTerminal(entries, journalPath, ledgerDirectory, namespace, request, outcome, state, storePath) {
  const terminal = await appendClaimEntry(journalPath, {
    type: 'publish-final',
    operation_id: request.operation_id,
    operation_digest: operationDigest(request),
    ledger_namespace: request.ledger_namespace,
    item_id: request.item_id,
    outcome,
  });
  entries.push(terminal);
  await writeReconcileLog(
    claimReconcileLogPath(path.resolve(ledgerDirectory), namespace),
    namespace,
    entries,
  );
  try {
    await writeClaimState(storePath, state);
  } catch {
    // The snapshot is a rebuildable memo. The fsync'd journal is authoritative.
  }
  return outcome;
}

// The unlocked pre-read of a claimed publication. It fails fast on a candidate
// that would make the ledger invalid; every decision it makes is re-made under
// lock in the mutation engine, so it may run against a snapshot the caller
// already read under the same claim lock. It returns the ledger it judged so
// the mutation engine's own pre-lock read can share it.
async function validateCandidateLedger(ledgerDirectory, request, ledgerSnapshot) {
  const ledger = ledgerSnapshot ?? await loadLedger(path.resolve(ledgerDirectory));
  const candidateBytes = Buffer.from(request.candidate_source_base64, 'base64');
  const source = candidateBytes.toString('utf8');
  const parsed = parseLedgerItemSource(source);
  const target = ledger.items.find((item) => item.data.id === request.item_id);
  if (parsed.error || parsed.data?.id !== request.item_id || !target) {
    return {
      error: publicationError(request, 'ledger-invalid', 'The candidate ledger is invalid.', {
        item_id: request.item_id,
        reason: parsed.error?.code ?? (target ? 'item-id-mismatch' : 'item-not-found'),
      }, 3),
    };
  }
  const candidate = {
    path: target.path,
    file: target.file,
    bytes: candidateBytes,
    source,
    body: parsed.body,
    data: parsed.data,
  };
  const validation = validateLedger({
    errors: ledger.errors,
    items: ledger.items.map((item) => item.data.id === request.item_id ? candidate : item),
  });
  if (!validation.valid) {
    return { error: publicationError(request, 'ledger-invalid', 'The candidate ledger is invalid.', validation.errors, 3) };
  }
  return { error: null, ledger };
}

function fenceRejectionReason(request, active, observedAt) {
  if (request.claim_fence.ledger_namespace !== request.ledger_namespace) return 'ledger-namespace-mismatch';
  if (request.claim_fence.item_id !== request.item_id) return 'item-id-mismatch';
  if (active === null) return 'no-active-claim';
  if (active.owner_id !== request.claim_fence.owner_id) return 'owner-mismatch';
  if (active.epoch !== request.claim_fence.epoch) return 'epoch-mismatch';
  if (observedAt >= active.expires_at) return 'claim-expired';
  return null;
}

function mutationFailure(request, mutation) {
  if (mutation.error?.code === 'revision-conflict') {
    return publicationError(request, 'ledger-revision-conflict',
      'The durable ledger revision no longer matches this publication.', {
        ledger_namespace: request.ledger_namespace,
        item_id: request.item_id,
        expected_revision: request.expected_revision,
        actual_revision: mutation.error.details.actual_revision,
      }, 4);
  }
  if (mutation.error?.code === 'item-source-too-large') {
    return itemSourceTooLarge(request, mutation.error.details.size_bytes);
  }
  if (mutation.error?.code === 'candidate-invalid') {
    return publicationError(request, 'ledger-invalid', 'The candidate ledger is invalid.', mutation.error.details.validation_errors, 3);
  }
  return publicationUnknown(request);
}

function publicationSuccess(request, record, observedAt) {
  return {
    exit: 0,
    stdout: {
      ok: true,
      namespace: 'ledger-publication',
      command: 'publish-claimed',
      contract_version: 1,
      state: 'committed',
      operation_id: request.operation_id,
      result: {
        ledger_namespace: request.ledger_namespace,
        item_id: request.item_id,
        committed_revision: request.candidate_sha256,
        claim_fence: structuredClone(request.claim_fence),
        claim_read_back: readBack(request.ledger_namespace, request.item_id, observedAt, record),
      },
    },
  };
}

function publicationUnknown(request) {
  return publicationError(request, 'publication-outcome-unknown',
    'The publication outcome could not be determined.', {
      operation_id: request.operation_id,
      ledger_namespace: request.ledger_namespace,
      item_id: request.item_id,
    }, 6, 'unknown');
}

// The ledger-publication spelling of the one named item-source refusal: the
// same code, message, and limit as the core domain, with this domain's item_id
// detail and its top-level operation_id.
function itemSourceTooLarge(request, sizeBytes) {
  return publicationError(
    request,
    'item-source-too-large',
    'The proposed item source exceeds the supported byte limit.',
    { item_id: request.item_id, size_bytes: sizeBytes, limit_bytes: MAX_ITEM_SOURCE_BYTES },
    2,
  );
}

function canonicalBase64Error(request) {
  return publicationError(request, 'invalid-request', 'The candidate source is not canonical base64.', {
    field: 'candidate_source_base64',
  }, 2);
}

function idempotencyConflict(operationId, expectedDigest, actualDigest) {
  return {
    exit: 4,
    stdout: {
      ok: false,
      namespace: 'ledger-publication',
      command: 'publish-claimed',
      contract_version: 1,
      state: 'unchanged',
      operation_id: operationId,
      error: {
        code: 'idempotency-conflict',
        message: 'The operation identity is already bound to a different request.',
        details: {
          operation_id: operationId,
          expected_operation_digest: expectedDigest,
          actual_operation_digest: actualDigest,
        },
      },
    },
  };
}

function publicationError(request, code, message, details, exit, state = 'unchanged') {
  return {
    exit,
    stdout: {
      ok: false,
      namespace: 'ledger-publication',
      command: 'publish-claimed',
      contract_version: 1,
      state,
      ...(request?.operation_id ? { operation_id: request.operation_id } : {}),
      error: { code, message, details },
    },
  };
}
function publicationReadError(request, code, message, details, exit = 2) {
  return {
    exit,
    stdout: {
      ok: false,
      namespace: 'ledger-publication',
      command: 'read',
      contract_version: 1,
      state: 'unchanged',
      ...(request?.operation_id ? { operation_id: request.operation_id } : {}),
      error: { code, message, details },
    },
  };
}


function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isExactObject(value, keys) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}


// Fault and kill points for the publication barriers. `fail:<point>` raises at
// the barrier; `hang:<point>` announces that the barrier was reached and then
// stops, so a test can kill this process there and let a successor recover the
// namespace lock and the journal. The scenario is a module argument that no
// CLI path can supply, and the hang is bounded so a test that forgets to kill
// the process fails instead of running forever.
const KILL_POINT_DEADLINE_MS = 30_000;

async function publicationTestCheckpoint(scenario, point, ledgerDirectory) {
  if (scenario === `fail:${point}`) {
    const error = new Error(`test checkpoint failed: ${point}`);
    error.code = 'TEST_CHECKPOINT';
    throw error;
  }
  if (scenario !== `hang:${point}`) return;
  await writeFile(path.join(path.resolve(ledgerDirectory), `.wowbagger-test-reached-${point}`), 'reached\n');
  await new Promise((resolve) => setTimeout(resolve, KILL_POINT_DEADLINE_MS));
  throw new Error(`kill point ${point} was never killed`);
}