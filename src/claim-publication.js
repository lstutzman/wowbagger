import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
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
import { readGitHeadLedger } from './git-reconciliation.js';
import { publishClaimedCandidate, revisionFor } from './mutation.js';
import { validateLedger } from './validate.js';

const ITEM_ID = /^wb_[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const NAMESPACE_ID = /^wbns_[a-f0-9]{32}$/;
const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REVISION = /^sha256:[a-f0-9]{64}$/;
const EPOCH = /^(?:[1-9][0-9]{0,18}|1[0-7][0-9]{18}|18[0-3][0-9]{17}|184[0-3][0-9]{16}|1844[0-5][0-9]{15}|18446[0-6][0-9]{14}|184467[0-3][0-9]{13}|1844674[0-3][0-9]{12}|18446744[0-6][0-9]{11}|184467440[0-6][0-9]{10}|1844674407[0-2][0-9]{9}|18446744073[0-6][0-9]{8}|1844674407370[0-8][0-9]{6}|18446744073709[0-4][0-9]{4}|184467440737095[0-4][0-9]{3}|1844674407370955[0-9]{2}|18446744073709551[0-5])$/;
const MAX_CANDIDATE_BYTES = 8388608;
const MAX_CANDIDATE_BASE64_CHARS = Math.ceil(MAX_CANDIDATE_BYTES / 3) * 4;

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
  if (request.candidate_source_base64.length > MAX_CANDIDATE_BASE64_CHARS) {
    return canonicalBase64Error(request);
  }
  let candidate;
  try {
    candidate = Buffer.from(request.candidate_source_base64, 'base64');
  } catch {
    return canonicalBase64Error(request);
  }
  if (candidate.length > MAX_CANDIDATE_BYTES
    || candidate.toString('base64') !== request.candidate_source_base64) {
    return canonicalBase64Error(request);
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
    return await withClaimLock(storePath, async () => {
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
      const terminalKeys = new Set(replayed.entries
        .filter((entry) => entry.type === 'publish-final')
        .map((entry) => `${entry.operation_id}\0${entry.item_id}`));
      if (replayed.entries.some((entry) => (
        entry.type === 'publish-intent'
          && !terminalKeys.has(`${entry.operation_id}\0${entry.item_id}`)
      ))) {
        const reconciled = await reconcileClaimJournal({
          ledgerDirectory,
          gitCommonDir,
          namespace,
          replayed,
          physicalNow: new Date().toISOString(),
        });
        if (reconciled.unsafe) return publicationUnknown(request);
        replayed = { entries: reconciled.entries, state: reconciled.state };
        const reconciledPrior = replayed.entries.find((entry) => (
          entry.type === 'publish-final'
            && entry.operation_id === request.operation_id
        ));
        if (reconciledPrior) {
          return reconciledPrior.operation_digest === digest
            ? reconciledPrior.outcome
            : idempotencyConflict(request.operation_id, reconciledPrior.operation_digest, digest);
        }
      }
      const candidateError = await validateCandidateLedger(ledgerDirectory, request);
      if (candidateError) return candidateError;
      const physicalNow = new Date().toISOString();
      const observedAt = advanceClockFloor(replayed.state, physicalNow);
      let clockEntry;
      try {
        clockEntry = await appendClaimEntry(journalPath, {
          type: 'clock',
          now: physicalNow,
          floor: observedAt,
        });
      } catch {
        return publicationError(request, 'clock-floor-persistence-failed',
          'The authoritative clock floor could not be persisted.', {
            ledger_namespace: request.ledger_namespace,
            item_id: request.item_id,
          }, 6);
      }
      const entries = [...replayed.entries, clockEntry];
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
      const mutation = await publishClaimedCandidate(ledgerDirectory, request, scenario);
      if (!mutation.ok) {
        const outcome = mutationFailure(request, mutation);
        return persistTerminal(entries, journalPath, ledgerDirectory, namespace, request, outcome, replayed.state, storePath);
      }
      await publicationTestCheckpoint(scenario, 'after-ledger-commit');
      const outcome = publicationSuccess(request, record, observedAt);
      return persistTerminal(entries, journalPath, ledgerDirectory, namespace, request, outcome, replayed.state, storePath);
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
    const unknownPath = itemPathRelativeToLedger(ledgerDirectory, item?.file)
      ?? intent.item_path
      ?? null;
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
    const authorized = entries.filter((entry) => (
      (entry.type === 'publish-final'
        && entry.item_id === itemId
        && entry.outcome?.stdout?.state === 'committed')
        || (entry.type === 'legacy-mutation' && entry.item_id === itemId)
    ));
    const latestAuthorized = authorized.at(-1);
    const expectedRevision = latestAuthorized?.type === 'legacy-mutation'
      ? latestAuthorized.committed_revision
      : latestAuthorized?.outcome.stdout.result.committed_revision;
    const authorizedRevisions = new Set(authorized.map((entry) => (
      entry.type === 'legacy-mutation'
        ? entry.committed_revision
        : entry.outcome.stdout.result.committed_revision
    )));
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
    observedAt,
    state: replayed.state,
    unsafe: findings.some((finding) => finding.code !== 'pending-intent-resolved'),
  };
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
      remediation: `Run claim-verify in the worktree that wrote ${pathLabel} after committing it, or synchronize this worktree to that commit.`,
    };
  }
  return {
    reason: 'unauthorized-revision',
    ...(expectedPath ? { expected_path: expectedPath } : {}),
    remediation: `Restore the authorized revision at ${pathLabel}, then run claim-verify.`,
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
            publications: publicationStatuses(reconciled.entries),
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

async function validateCandidateLedger(ledgerDirectory, request) {
  const ledger = await loadLedger(path.resolve(ledgerDirectory));
  const candidateBytes = Buffer.from(request.candidate_source_base64, 'base64');
  const source = candidateBytes.toString('utf8');
  const parsed = parseLedgerItemSource(source);
  const target = ledger.items.find((item) => item.data.id === request.item_id);
  if (parsed.error || parsed.data?.id !== request.item_id || !target) {
    return publicationError(request, 'ledger-invalid', 'The candidate ledger is invalid.', {
      item_id: request.item_id,
      reason: parsed.error?.code ?? (target ? 'item-id-mismatch' : 'item-not-found'),
    }, 3);
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
    return publicationError(request, 'ledger-invalid', 'The candidate ledger is invalid.', validation.errors, 3);
  }
  return null;
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


async function publicationTestCheckpoint(scenario, point) {
  if (scenario !== `fail:${point}`) return;
  const error = new Error(`test checkpoint failed: ${point}`);
  error.code = 'TEST_CHECKPOINT';
  throw error;
}