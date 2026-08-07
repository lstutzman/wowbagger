import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { isAlias, isMap, isScalar, isSeq, parseDocument, Scalar } from 'yaml';
import { loadLedger, parseLedgerItemSource } from './ledger.js';
import { JsonNumber, parseJsonRequest, pointer, sortIssues } from './request.js';
import { isCalendarDate, isRfc3339Utc, validateLedger } from './validate.js';

const REQUIRED_CORE_FIELDS = [
  'schema_version',
  'id',
  'title',
  'kind',
  'status',
  'created',
  'updated',
];
const OPTIONAL_CORE_FIELDS = [
  'parent',
  'snoozed_until',
  'completed',
  'killed',
  'archived',
];
const CONTROLLED_ITEM_FIELDS = new Set([
  ...REQUIRED_CORE_FIELDS,
  ...OPTIONAL_CORE_FIELDS,
  'provenance',
  'depends_on',
  'related',
  'decisions',
  'body',
]);
const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ULID_PATTERN = /^wb_([0-7][0-9A-HJKMNP-TV-Z]{25})$/;
const MAX_LOCK_CLOSURE_RETRIES = 3;

export async function inspectItem(ledgerDirectory, id) {
  const ledger = await loadLedger(ledgerDirectory);
  const validation = validateLedger(ledger);
  if (!validation.valid) {
    return { validation };
  }

  const item = ledger.items.find((candidate) => candidate.data.id === id);
  if (!item) {
    return { item: null };
  }

  return { item: inspectedItem(displayItemPath(item.path), item.bytes, item.data, item.body) };
}

export function revisionFor(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function inspectedPublishedItem(displayPath, bytes) {
  const parsed = parseLedgerItemSource(bytes.toString('utf8'));
  if (parsed.error) {
    throw new Error('Published bytes could not be parsed.');
  }
  return inspectedItem(displayPath, bytes, parsed.data, parsed.body);
}

function inspectedItem(displayPath, bytes, data, body) {
  return {
    path: displayPath,
    revision: revisionFor(bytes),
    source_encoding: 'base64',
    source_media_type: 'text/markdown; charset=utf-8',
    source_base64: bytes.toString('base64'),
    core: coreView(data),
    body,
  };
}

export function validateCreateRequest(request, parseIssues = []) {
  const issues = [...parseIssues];
  if (issues.some((entry) => entry.code === 'invalid-json')) {
    return sortIssues(issues);
  }
  if (!isMapping(request)) {
    issues.push(issue('', 'invalid-type', 'Request input must be a JSON object.'));
    return sortIssues(issues);
  }

  validateObjectMembers(request, [], ['id', 'item', 'body'], issues, 'Request member');
  validateRequiredMember(request, [], 'id', issues);
  validateRequiredMember(request, [], 'item', issues);
  validateRequiredMember(request, [], 'body', issues);

  if (hasOwn(request, 'id') && (typeof request.id !== 'string' || !ULID_PATTERN.test(request.id))) {
    issues.push(issue('/id', 'invalid-value', 'Member id must be a canonical Wowbagger item ID.'));
  }
  if (hasOwn(request, 'body') && typeof request.body !== 'string') {
    issues.push(issue('/body', 'invalid-type', 'Member body must be a string.'));
  }

  if (!isMapping(request.item)) {
    if (hasOwn(request, 'item')) {
      issues.push(issue('/item', 'invalid-type', 'Member item must be an object.'));
    }
    return sortIssues(issues);
  }

  const item = request.item;
  for (const field of ['title', 'kind', 'provenance', 'depends_on']) {
    validateRequiredMember(item, ['item'], field, issues);
  }
  const controlled = new Set([
    'schema_version', 'id', 'status', 'created', 'updated', 'completed',
    'killed', 'archived', 'decisions', 'body',
  ]);
  for (const field of Object.keys(item)) {
    if (controlled.has(field)) {
      issues.push(issue(pointer(['item', field]), 'invalid-value', field === 'status'
        ? 'Item member status is controlled by Wowbagger. Create assigns triage; call transition to accept the item into backlog.'
        : `Item member ${field} is controlled by Wowbagger.`));
    }
  }
  if (hasOwn(item, 'title') && (typeof item.title !== 'string' || item.title.trim().length === 0)) {
    issues.push(issue('/item/title', 'invalid-type', 'Item member title must be a non-empty string.'));
  }
  if (hasOwn(item, 'kind') && (item.kind !== 'task' && item.kind !== 'epic')) {
    issues.push(issue('/item/kind', 'invalid-value', 'Item member kind must be task or epic.'));
  }
  if (hasOwn(item, 'depends_on') && !Array.isArray(item.depends_on)) {
    issues.push(issue('/item/depends_on', 'invalid-type', 'Item member depends_on must be an array.'));
  } else if (Array.isArray(item.depends_on)) {
    validateRelationEntries(item.depends_on, 'depends_on', issues);
  }
  if (hasOwn(item, 'related') && !Array.isArray(item.related)) {
    issues.push(issue('/item/related', 'invalid-type', 'Item member related must be an array.'));
  } else if (Array.isArray(item.related)) {
    validateRelationEntries(item.related, 'related', issues);
  }
  if (hasOwn(item, 'provenance') && !isMapping(item.provenance)) {
    issues.push(issue('/item/provenance', 'invalid-type', 'Item member provenance must be an object.'));
  } else if (isMapping(item.provenance)) {
    for (const field of ['source', 'recorded_at']) {
      if (!hasOwn(item.provenance, field)) {
        issues.push(issue(`/item/provenance/${field}`, 'missing-member', `Provenance member ${field} is missing.`));
      }
    }
    if (hasOwn(item.provenance, 'source')
      && (typeof item.provenance.source !== 'string' || item.provenance.source.trim().length === 0)) {
      issues.push(issue('/item/provenance/source', 'invalid-type', 'Provenance member source must be a non-empty string.'));
    }
    if (hasOwn(item.provenance, 'recorded_at') && !isRfc3339Utc(item.provenance.recorded_at)) {
      issues.push(issue('/item/provenance/recorded_at', 'invalid-value', 'Provenance member recorded_at must be an RFC 3339 UTC instant.'));
    }
  }
  if (hasOwn(item, 'parent') && (typeof item.parent !== 'string' || !ULID_PATTERN.test(item.parent))) {
    issues.push(issue('/item/parent', 'invalid-value', 'Item member parent must be a canonical Wowbagger item ID.'));
  }
  if (hasOwn(item, 'snoozed_until') && !isCalendarDate(item.snoozed_until)) {
    issues.push(issue('/item/snoozed_until', 'invalid-value', 'Item member snoozed_until must be an ISO calendar date.'));
  }

  return sortIssues(issues);
}

export async function createItem(ledgerDirectory, request, scenario) {
  const root = path.resolve(ledgerDirectory);
  const id = request.id;

  for (let attempt = 0; attempt < MAX_LOCK_CLOSURE_RETRIES; attempt += 1) {
    const initial = await loadedValidLedger(root);
    if (!initial.valid) {
      return ledgerInvalid(initial.validation);
    }
    const nextIds = lockIdsForCreate(request, initial.ledger);
    if (scenario === 'expand-lock-closure-through-bounded-retry-limit') {
      return operationFailed(id, 'lock-closure', 'retry-limit-exhausted');
    }
    let locks;
    try {
      locks = await acquireLocks(root, nextIds, 'create', scenario);
    } catch (error) {
      if (error instanceof ResourceFailure) {
        return operationFailed(id, error.operation, 'io-error', await artifactsForLocks(error.locks, root));
      }
      if (error instanceof LockHeldError) {
        return lockHeld(id, error.file, await lockDetails(error.file));
      }
      return operationFailed(id, 'lock-closure', 'io-error');
    }

    let preserveLocks = false;
    let temporaryPath = null;
    const finishUncommitted = async (outcome, artifacts = []) => {
      const finished = await finishUncommittedResources(id, outcome, locks, root, scenario, artifacts);
      locks = finished.locks;
      preserveLocks = finished.preserveLocks;
      return finished.outcome;
    };
    const finishUnknown = async (outcome) => {
      const finished = await finishUnknownResources(outcome, locks, root, scenario);
      locks = finished.locks;
      preserveLocks = finished.preserveLocks;
      return finished.outcome;
    };
    const finishCommittedRecovery = async (bytes, artifacts = []) => {
      const finished = await finishCommittedResources(id, bytes, locks, root, scenario, artifacts);
      locks = finished.locks;
      preserveLocks = finished.preserveLocks;
      return finished.outcome;
    };
    try {
      const current = await loadedValidLedger(root);
      if (!current.valid) {
        return await finishUncommitted(ledgerInvalid(current.validation));
      }
      const stableIds = lockIdsForCreate(request, current.ledger);
      if (!sameIds(nextIds, stableIds)) {
        const cleanupFailure = await finishUncommitted(null);
        if (cleanupFailure) {
          return cleanupFailure;
        }
        continue;
      }

      const existing = current.ledger.items.find((item) => item.data.id === id);
      if (existing) {
        return await finishUncommitted(mutationError('id-collision', 'The requested item ID already exists.', 'unchanged', 4, {
          id,
          path: displayItemPath(existing.path),
          actual_revision: revisionFor(existing.bytes),
        }));
      }

      const finalPath = path.join(root, `${id}.md`);
      const occupant = await pathOccupant(finalPath, current.ledger);
      if (occupant) {
        const details = {
          id,
          path: `${id}.md`,
          occupant_kind: occupant.kind,
        };
        if (occupant.id) {
          details.occupying_id = occupant.id;
        }
        return await finishUncommitted(mutationError('path-collision', 'The default item path is occupied by a different item.', 'unchanged', 4, details));
      }

      const bytes = createCandidateSource(request);
      const candidateValidation = validateSerializedCandidate(
        current.ledger,
        null,
        bytes,
        `${path.basename(root)}/${id}.md`,
        finalPath,
      );
      if (!candidateValidation.valid) {
        return await finishUncommitted(mutationError('candidate-invalid', 'The proposed item would make the ledger invalid.', 'unchanged', 2, {
          id,
          validation_errors: candidateValidation.errors,
        }));
      }

      if (scenario === 'atomic-no-clobber-primitive-unavailable') {
        return await finishUncommitted(mutationError('capability-unavailable', 'Atomic no-clobber publication is unavailable for this ledger.', 'unchanged', 5, {
          capability: 'atomic-no-clobber-publication',
          reason: 'filesystem-primitive-unavailable',
          recovery_artifacts: [],
          recovery_artifacts_truncated: false,
        }));
      }

      temporaryPath = path.join(root, `.wowbagger-tmp-${id}-${randomSuffix()}`);
      const temporaryFailure = await prepareTemporary(temporaryPath, bytes, scenario);
      if (temporaryFailure) {
        const artifacts = await cleanupTemporary(temporaryPath, root, scenario);
        temporaryPath = artifacts.length > 0 ? temporaryPath : null;
        return await finishUncommitted(operationFailed(id, temporaryFailure, 'io-error', artifacts), artifacts);
      }

      let publicationError = null;
      try {
        await link(temporaryPath, finalPath);
        if (scenarioName(scenario) === 'create-link-applied-then-error') {
          await writeFile(path.join(root, '.wowbagger-test-publication-fault'), 'link applied before error\n');
          throw new Error('fixture link applied then error');
        }
      } catch (error) {
        publicationError = error;
      }
      if (publicationError) {
        const evidence = await observePublication(finalPath, bytes);
        if (evidence.state !== 'expected') {
          const artifacts = await cleanupTemporary(temporaryPath, root, scenario);
          temporaryPath = artifacts.length > 0 ? temporaryPath : null;
          if (evidence.state === 'absent') {
            if (isUnavailableNoClobber(publicationError)) {
              return await finishUncommitted(mutationError('capability-unavailable', 'Atomic no-clobber publication is unavailable for this ledger.', 'unchanged', 5, {
                capability: 'atomic-no-clobber-publication',
                reason: 'filesystem-primitive-unavailable',
                recovery_artifacts: boundedArtifacts(artifacts).artifacts,
                recovery_artifacts_truncated: boundedArtifacts(artifacts).truncated,
              }), artifacts);
            }
            return await finishUncommitted(operationFailed(id, 'publish', 'io-error', artifacts), artifacts);
          }
          return await finishUnknown(unknownPublication('create', id, `${id}.md`, evidence.bytes, artifacts));
        }
      }

      if (scenario === 'final-mismatch-and-temporary-unlink-fail') {
        await unlink(finalPath);
        await writeFile(finalPath, 'fixture different final bytes\n');
      } else if (scenario === 'final-absence-and-temporary-unlink-fail') {
        await unlink(finalPath);
      }

      const evidence = scenario === 'final-verification-read-fails-after-publication'
        ? { state: 'unknown', bytes: null }
        : await observePublication(finalPath, bytes);
      if (evidence.state !== 'expected') {
        const artifacts = await cleanupTemporary(temporaryPath, root, scenario);
        temporaryPath = artifacts.length > 0 ? temporaryPath : null;
        if (evidence.state === 'absent') {
          return await finishUncommitted(operationFailed(id, 'verify-publication', 'verification-failed', artifacts), artifacts);
        }
        return await finishUnknown(unknownPublication('create', id, `${id}.md`, evidence.bytes, artifacts));
      }

      let directorySyncFailed = false;
      try {
        await syncDirectoryIfSupported(root);
      } catch {
        directorySyncFailed = true;
      }

      const temporaryArtifacts = await cleanupTemporary(temporaryPath, root, scenario);
      temporaryPath = temporaryArtifacts.length > 0 ? temporaryPath : null;
      if (directorySyncFailed || temporaryArtifacts.length > 0) {
        return await finishCommittedRecovery(bytes, temporaryArtifacts);
      }

      if (scenario === 'final-bytes-verified-directory-sync-and-lock-cleanup-fail') {
        const lock = locks.find((entry) => entry.id === id);
        await writeFixtureRecoveryLock(lock.file, id);
        return await finishCommittedRecovery(bytes);
      }

      const result = inspectedPublishedItem(`${id}.md`, evidence.bytes);
      const failedLocks = await releaseLocks(locks, scenario);
      locks = failedLocks;
      if (failedLocks.length > 0) {
        preserveLocks = true;
        return postCommitRecovery(id, bytes, await artifactsForLocks(failedLocks, root));
      }
      await testCheckpoint(root, scenario, 'after-success-release');
      return mutationSuccess(result);
    } finally {
      if (temporaryPath) {
        await cleanupTemporary(temporaryPath, root, scenario);
      }
      if (!preserveLocks) {
        await releaseLocks(locks, scenario);
      }
    }
  }

  return operationFailed(id, 'lock-closure', 'retry-limit-exhausted');
}

export function validateTransitionRequest(request, parseIssues = []) {
  const issues = [...parseIssues];
  if (issues.some((entry) => entry.code === 'invalid-json')) {
    return sortIssues(issues);
  }
  if (!isMapping(request)) {
    return [issue('', 'invalid-type', 'Request input must be a JSON object.')];
  }
  validateObjectMembers(request, [], ['id', 'expected_revision', 'to_status', 'date', 'decision'], issues, 'Request member');
  for (const field of ['id', 'expected_revision', 'to_status', 'date']) {
    validateRequiredMember(request, [], field, issues);
  }
  if (hasOwn(request, 'id') && (typeof request.id !== 'string' || !ULID_PATTERN.test(request.id))) {
    issues.push(issue('/id', 'invalid-value', 'Member id must be a canonical Wowbagger item ID.'));
  }
  if (hasOwn(request, 'expected_revision') && (typeof request.expected_revision !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(request.expected_revision))) {
    issues.push(issue('/expected_revision', 'invalid-value', 'Member expected_revision must be a lowercase SHA-256 revision token.'));
  }
  if (hasOwn(request, 'to_status') && typeof request.to_status !== 'string') {
    issues.push(issue('/to_status', 'invalid-type', 'Member to_status must be a string.'));
  }
  if (hasOwn(request, 'date') && (typeof request.date !== 'string' || !isCalendarDate(request.date))) {
    issues.push(issue('/date', 'invalid-value', 'Member date must be an ISO calendar date.'));
  }
  if (hasOwn(request, 'decision') && !isMapping(request.decision)) {
    issues.push(issue('/decision', 'invalid-type', 'Member decision must be an object.'));
  }
  if (isMapping(request.decision)) {
    validateObjectMembers(request.decision, ['decision'], ['summary', 'rationale'], issues, 'Decision member');
    for (const field of ['summary', 'rationale']) {
      if (!hasOwn(request.decision, field)) {
        issues.push(issue(pointer(['decision', field]), 'missing-member', `Decision member ${field} is missing.`));
      } else if (typeof request.decision[field] !== 'string' || request.decision[field].trim().length === 0) {
        issues.push(issue(pointer(['decision', field]), 'invalid-type', `Decision member ${field} must be a non-empty string.`));
      }
    }
  }
  return sortIssues(issues);
}

export function validatePatchRequest(request, parseIssues = []) {
  const issues = [...parseIssues];
  if (issues.some((entry) => entry.code === 'invalid-json')) {
    return sortIssues(issues);
  }
  if (!isMapping(request)) {
    return [issue('', 'invalid-type', 'Request input must be a JSON object.')];
  }
  validateObjectMembers(request, [], ['id', 'expected_revision', 'patch', 'date', 'decision'], issues, 'Request member');
  for (const field of ['id', 'expected_revision', 'patch', 'date', 'decision']) {
    validateRequiredMember(request, [], field, issues);
  }
  if (hasOwn(request, 'id') && (typeof request.id !== 'string' || !ULID_PATTERN.test(request.id))) {
    issues.push(issue('/id', 'invalid-value', 'Member id must be a canonical Wowbagger item ID.'));
  }
  if (hasOwn(request, 'expected_revision') && (typeof request.expected_revision !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(request.expected_revision))) {
    issues.push(issue('/expected_revision', 'invalid-value', 'Member expected_revision must be a lowercase SHA-256 revision token.'));
  }
  if (hasOwn(request, 'date') && (typeof request.date !== 'string' || !isCalendarDate(request.date))) {
    issues.push(issue('/date', 'invalid-value', 'Member date must be an ISO calendar date.'));
  }
  if (!isMapping(request.patch)) {
    if (hasOwn(request, 'patch')) {
      issues.push(issue('/patch', 'invalid-type', 'Member patch must be an object.'));
    }
  } else {
    validateObjectMembers(
      request.patch,
      ['patch'],
      ['priority', 'number', 'parent', 'depends_on', 'title'],
      issues,
      'Patch member',
    );
    if (Object.keys(request.patch).length === 0) {
      issues.push(issue('/patch', 'invalid-value', 'Member patch must contain at least one patchable field.'));
    }
    if (hasOwn(request.patch, 'priority') && !validOptionalInteger(request.patch.priority, 0)) {
      issues.push(issue('/patch/priority', 'invalid-type', 'Patch member priority must be null or a non-negative integer.'));
    }
    if (hasOwn(request.patch, 'number') && !validOptionalInteger(request.patch.number, 1)) {
      issues.push(issue('/patch/number', 'invalid-type', 'Patch member number must be null or a positive integer.'));
    }
    if (hasOwn(request.patch, 'parent') && request.patch.parent !== null
      && (typeof request.patch.parent !== 'string' || !ULID_PATTERN.test(request.patch.parent))) {
      issues.push(issue('/patch/parent', 'invalid-value', 'Patch member parent must be null or a canonical Wowbagger item ID.'));
    }
    if (hasOwn(request.patch, 'depends_on') && !Array.isArray(request.patch.depends_on)) {
      issues.push(issue('/patch/depends_on', 'invalid-type', 'Patch member depends_on must be an array.'));
    } else if (Array.isArray(request.patch.depends_on)) {
      validatePatchRelationEntries(request.patch.depends_on, 'depends_on', issues);
    }
    if (hasOwn(request.patch, 'title')
      && (typeof request.patch.title !== 'string' || request.patch.title.trim().length === 0)) {
      issues.push(issue('/patch/title', 'invalid-type', 'Patch member title must be a non-empty string.'));
    }
  }
  validatePatchDecision(request.decision, issues);
  return sortIssues(issues);
}

function validatePatchDecision(decision, issues) {
  if (!isMapping(decision)) {
    if (decision !== undefined) {
      issues.push(issue('/decision', 'invalid-type', 'Member decision must be an object.'));
    }
    return;
  }
  validateObjectMembers(decision, ['decision'], ['summary', 'rationale'], issues, 'Decision member');
  for (const field of ['summary', 'rationale']) {
    if (!hasOwn(decision, field)) {
      issues.push(issue(pointer(['decision', field]), 'missing-member', `Decision member ${field} is missing.`));
    } else if (typeof decision[field] !== 'string' || decision[field].trim().length === 0) {
      issues.push(issue(pointer(['decision', field]), 'invalid-type', `Decision member ${field} must be a non-empty string.`));
    }
  }
}

export async function transitionItem(ledgerDirectory, request, scenario) {
  return replaceItem(ledgerDirectory, request, 'transition', scenario);
}

export async function patchItem(ledgerDirectory, request, scenario) {
  return replaceItem(ledgerDirectory, request, 'patch', scenario);
}

async function replaceItem(ledgerDirectory, request, operation, scenario) {
  const root = path.resolve(ledgerDirectory);
  const id = request.id;

  for (let attempt = 0; attempt < MAX_LOCK_CLOSURE_RETRIES; attempt += 1) {
    const initial = await loadedValidLedger(root);
    if (!initial.valid) {
      return ledgerInvalid(initial.validation);
    }
    const target = findItem(initial.ledger, id);
    if (!target) {
      return mutationError('item-not-found', 'The requested item was not found.', 'unchanged', 2, { id });
    }
    const nextIds = operation === 'transition'
      ? lockIdsForTransition(target, initial.ledger)
      : lockIdsForPatch(target, request);
    if (scenario === 'expand-lock-closure-through-bounded-retry-limit') {
      return operationFailed(id, 'lock-closure', 'retry-limit-exhausted');
    }
    let locks;
    try {
      locks = await acquireLocks(root, nextIds, operation, scenario);
    } catch (error) {
      if (error instanceof ResourceFailure) {
        return operationFailed(id, error.operation, 'io-error', await artifactsForLocks(error.locks, root));
      }
      if (error instanceof LockHeldError) {
        return lockHeld(id, error.file, await lockDetails(error.file));
      }
      return operationFailed(id, 'lock-closure', 'io-error');
    }

    let preserveLocks = false;
    let temporaryPath = null;
    const finishUncommitted = async (outcome, artifacts = []) => {
      const finished = await finishUncommittedResources(id, outcome, locks, root, scenario, artifacts);
      locks = finished.locks;
      preserveLocks = finished.preserveLocks;
      return finished.outcome;
    };
    const finishUnknown = async (outcome) => {
      const finished = await finishUnknownResources(outcome, locks, root, scenario);
      locks = finished.locks;
      preserveLocks = finished.preserveLocks;
      return finished.outcome;
    };
    const finishCommittedRecovery = async (bytes, artifacts = []) => {
      const finished = await finishCommittedResources(id, bytes, locks, root, scenario, artifacts);
      locks = finished.locks;
      preserveLocks = finished.preserveLocks;
      return finished.outcome;
    };
    try {
      const current = await loadedValidLedger(root);
      if (!current.valid) {
        return await finishUncommitted(ledgerInvalid(current.validation));
      }
      const lockedTarget = findItem(current.ledger, id);
      if (!lockedTarget) {
        return await finishUncommitted(mutationError('item-not-found', 'The requested item was not found.', 'unchanged', 2, { id }));
      }
      const stableIds = operation === 'transition'
        ? lockIdsForTransition(lockedTarget, current.ledger)
        : lockIdsForPatch(lockedTarget, request);
      if (!sameIds(nextIds, stableIds)) {
        const cleanupFailure = await finishUncommitted(null);
        if (cleanupFailure) {
          return cleanupFailure;
        }
        continue;
      }

      const actualRevision = revisionFor(lockedTarget.bytes);
      if (actualRevision !== request.expected_revision) {
        return await finishUncommitted(mutationError('revision-conflict', 'The item changed after it was inspected.', 'unchanged', 4, {
          id,
          expected_revision: request.expected_revision,
          actual_revision: actualRevision,
        }));
      }

      let successor;
      let bytes;
      if (operation === 'transition') {
        const edge = transitionEdge(lockedTarget.data.kind, lockedTarget.data.status, request.to_status);
        const issues = transitionPreconditions(lockedTarget, current.ledger, request, edge);
        const blockers = transitionBlockers(lockedTarget, current.ledger, request.to_status);
        if (blockers.length > 0) {
          return await finishUncommitted(mutationError('atomic-scope-required', 'The requested transition requires multi-item atomicity.', 'unchanged', 5, {
            id,
            blockers,
            precondition_issues: issues,
          }));
        }
        if (issues.length > 0) {
          return await finishUncommitted(mutationError('transition-precondition-failed', 'The requested lifecycle transition failed its preconditions.', 'unchanged', 2, {
            id,
            issues,
          }));
        }
        if (edge.requiresDecision && !isMapping(request.decision)) {
          return await finishUncommitted(invalidTransitionDecision());
        }
        if (!edge.requiresDecision && hasOwn(request, 'decision')) {
          return await finishUncommitted(invalidTransitionDecision());
        }
        successor = transitionData(lockedTarget.data, request, edge, current.ledger);
        bytes = Buffer.from(serializeTransition(lockedTarget.source, successor, edge), 'utf8');
      } else {
        const blockers = patchBlockers(lockedTarget, current.ledger, request.patch);
        if (blockers.length > 0) {
          return await finishUncommitted(mutationError('atomic-scope-required', 'The requested patch requires multi-item atomicity.', 'unchanged', 5, {
            id,
            blockers,
            precondition_issues: [],
          }));
        }
        successor = patchData(lockedTarget.data, request);
        bytes = Buffer.from(serializePatch(lockedTarget.source, successor, request.patch), 'utf8');
      }
      const candidateValidation = validateSerializedCandidate(
        current.ledger,
        id,
        bytes,
        lockedTarget.path,
        lockedTarget.file,
        successor,
        lockedTarget.source,
        operation === 'patch' ? Object.keys(request.patch) : [],
      );
      if (!candidateValidation.valid) {
        return await finishUncommitted(mutationError('candidate-invalid', 'The proposed item would make the ledger invalid.', 'unchanged', 2, {
          id,
          validation_errors: candidateValidation.errors,
        }));
      }

      const targetDirectory = path.dirname(lockedTarget.file);
      temporaryPath = path.join(targetDirectory, `.wowbagger-tmp-${id}-${randomSuffix()}`);
      if (scenarioName(scenario) === 'transition-rename-applied-then-error') {
        await writeFile(path.join(root, '.wowbagger-test-transition-paths.json'), JSON.stringify({
          temporary_directory: relativeDirectory(root, path.dirname(temporaryPath)),
          final_directory: relativeDirectory(root, targetDirectory),
          synced_directory: null,
        }));
      }
      const temporaryFailure = await prepareTemporary(temporaryPath, bytes, scenario);
      if (temporaryFailure) {
        const artifacts = await cleanupTemporary(temporaryPath, root, scenario);
        temporaryPath = artifacts.length > 0 ? temporaryPath : null;
        return await finishUncommitted(operationFailed(id, temporaryFailure, 'io-error', artifacts), artifacts);
      }

      let publicationError = null;
      try {
        await rename(temporaryPath, lockedTarget.file);
        temporaryPath = null;
        if (scenarioName(scenario) === 'transition-rename-applied-then-error') {
          await writeFile(path.join(root, '.wowbagger-test-publication-fault'), 'rename applied before error\n');
          throw new Error('fixture rename applied then error');
        }
      } catch (error) {
        publicationError = error;
      }
      if (publicationError) {
        const evidence = await observePublication(lockedTarget.file, bytes, lockedTarget.bytes);
        if (evidence.state === 'expected') {
          temporaryPath = null;
        } else {
          const artifacts = temporaryPath ? await cleanupTemporary(temporaryPath, root, scenario) : [];
          temporaryPath = artifacts.length > 0 ? temporaryPath : null;
          if (evidence.state === 'original') {
            return await finishUncommitted(operationFailed(id, 'publish', 'verification-failed', artifacts), artifacts);
          }
          return await finishUnknown(unknownPublication(
            operation,
            id,
            displayItemPath(lockedTarget.path),
            evidence.bytes,
            artifacts,
          ));
        }
      }

      let published;
      try {
        published = await readRegularFile(lockedTarget.file);
      } catch {
        return await finishUnknown(mutationError('write-outcome-unknown', `The ${operation} publication outcome could not be verified.`, 'unknown', 6, {
          id,
          recovery_artifacts: [{
            path: displayItemPath(lockedTarget.path),
            kind: 'final-item',
            sha256: null,
            size_bytes: null,
          }],
          recovery_artifacts_truncated: false,
        }));
      }
      if (!published.equals(bytes)) {
        return await finishUnknown(mutationError('write-outcome-unknown', `The ${operation} publication outcome could not be verified.`, 'unknown', 6, {
          id,
          recovery_artifacts: [{
            path: displayItemPath(lockedTarget.path),
            kind: 'final-item',
            sha256: revisionFor(published),
            size_bytes: published.length,
          }],
          recovery_artifacts_truncated: false,
        }));
      }
      try {
        await syncDirectoryIfSupported(targetDirectory);
        if (scenarioName(scenario) === 'transition-rename-applied-then-error') {
          await writeFile(path.join(root, '.wowbagger-test-transition-paths.json'), JSON.stringify({
            temporary_directory: relativeDirectory(root, targetDirectory),
            final_directory: relativeDirectory(root, targetDirectory),
            synced_directory: relativeDirectory(root, targetDirectory),
          }));
        }
      } catch {
        return await finishCommittedRecovery(bytes);
      }
      const result = inspectedPublishedItem(displayItemPath(lockedTarget.path), published);
      const failedLocks = await releaseLocks(locks, scenario);
      locks = failedLocks;
      if (failedLocks.length > 0) {
        preserveLocks = true;
        return postCommitRecovery(id, bytes, await artifactsForLocks(failedLocks, root));
      }
      await testCheckpoint(root, scenario, 'after-success-release');
      return mutationSuccess(result);
    } finally {
      if (temporaryPath) {
        await cleanupTemporary(temporaryPath, root, scenario);
      }
      if (!preserveLocks) {
        await releaseLocks(locks, scenario);
      }
    }
  }

  return operationFailed(id, 'lock-closure', 'retry-limit-exhausted');
}

function invalidTransitionDecision() {
  return mutationError('invalid-request', 'The transition request is invalid.', 'unchanged', 2, {
    issues: [issue('/decision', 'invalid-value', 'Decision evidence does not match the requested lifecycle edge.')],
  });
}

function findItem(ledger, id) {
  return ledger.items.find((item) => item.data.id === id);
}

function lockIdsForTransition(target, ledger) {
  const ids = [target.data.id];
  if (target.data.parent) {
    ids.push(target.data.parent);
  }
  ids.push(...(target.data.depends_on ?? []));
  for (const item of ledger.items) {
    if ((item.data.depends_on ?? []).includes(target.data.id)) {
      ids.push(item.data.id);
    }
    if (target.data.kind === 'epic' && item.data.parent === target.data.id) {
      ids.push(item.data.id);
    }
  }
  return [...new Set(ids)].sort(compareText);
}

function lockIdsForPatch(target, request) {
  const ids = [target.data.id];
  if (target.data.parent) {
    ids.push(target.data.parent);
  }
  ids.push(...(target.data.depends_on ?? []));
  if (typeof request.patch.parent === 'string') {
    ids.push(request.patch.parent);
  }
  if (Array.isArray(request.patch.depends_on)) {
    ids.push(...request.patch.depends_on);
  }
  return [...new Set(ids)].sort(compareText);
}

function patchBlockers(target, ledger, patch) {
  if (!hasOwn(patch, 'parent')) {
    return [];
  }
  const oldParent = target.data.parent ?? null;
  const newParent = patch.parent;
  if (oldParent === newParent) {
    return [];
  }
  return [...new Set([oldParent, newParent].filter(Boolean))]
    .filter((id) => findItem(ledger, id)?.data.status === 'done')
    .map((id) => ({ code: 'child-disposition', item_id: id, field: 'parent' }))
    .sort((left, right) => compareText(left.item_id, right.item_id));
}

function patchData(data, request) {
  const successor = {
    ...data,
    provenance: { ...data.provenance },
    depends_on: [...(data.depends_on ?? [])],
    related: [...(data.related ?? [])],
    updated: request.date,
    decisions: [...(data.decisions ?? []), {
      action: 'record',
      date: request.date,
      summary: request.decision.summary,
      rationale: request.decision.rationale,
    }],
  };
  if (hasOwn(request.patch, 'priority')) {
    if (request.patch.priority === null) {
      delete successor.priority;
    } else {
      successor.priority = jsonIntegerValue(request.patch.priority);
    }
  }
  if (hasOwn(request.patch, 'number')) {
    if (request.patch.number === null) {
      delete successor.number;
    } else {
      successor.number = jsonIntegerValue(request.patch.number);
    }
  }
  if (hasOwn(request.patch, 'parent')) {
    if (request.patch.parent === null) {
      delete successor.parent;
    } else {
      successor.parent = request.patch.parent;
    }
  }
  if (hasOwn(request.patch, 'depends_on')) {
    successor.depends_on = [...request.patch.depends_on];
  }
  if (hasOwn(request.patch, 'title')) {
    successor.title = request.patch.title;
  }
  return successor;
}

function serializePatch(source, successor, patch) {
  const bounds = frontmatterBounds(source);
  const frontmatter = source.slice(bounds.start, bounds.end);
  const document = parseDocument(frontmatter, {
    intAsBigInt: true,
    keepSourceTokens: true,
    prettyErrors: false,
    schema: 'core',
    uniqueKeys: true,
  });
  if (document.errors.length > 0 || !isMap(document.contents)) {
    throw new Error('Unable to mutate malformed frontmatter.');
  }
  setRootScalar(document, 'updated', successor.updated);
  if (hasOwn(patch, 'priority')) {
    if (patch.priority === null) {
      document.delete('priority');
    } else {
      setRootScalar(document, 'priority', successor.priority);
    }
  }
  if (hasOwn(patch, 'number')) {
    if (patch.number === null) {
      document.delete('number');
    } else {
      setRootScalar(document, 'number', successor.number);
    }
  }
  if (hasOwn(patch, 'parent')) {
    if (patch.parent === null) {
      document.delete('parent');
    } else {
      setRootScalar(document, 'parent', successor.parent);
    }
  }
  if (hasOwn(patch, 'depends_on')) {
    document.set('depends_on', successor.depends_on);
  }
  if (hasOwn(patch, 'title')) {
    setRootScalar(document, 'title', successor.title);
  }
  appendDecisionNode(document, successor.decisions.at(-1));
  let serialized = document.toString({ lineWidth: 0 });
  if (bounds.newline === '\r\n') {
    serialized = serialized.replaceAll('\n', '\r\n');
  }
  if (!frontmatter.endsWith(bounds.newline)) {
    serialized = serialized.slice(0, -bounds.newline.length);
  }
  return `${source.slice(0, bounds.start)}${serialized}${source.slice(bounds.end)}`;
}

function transitionEdge(kind, from, to) {
  const action = {
    'task:triage:backlog': 'accept',
    'epic:triage:backlog': 'accept',
    'task:triage:killed': 'kill',
    'epic:triage:killed': 'kill',
    'task:backlog:archived': 'archive',
    'task:backlog:killed': 'kill',
    'task:in-progress:done': 'complete',
    'task:in-progress:killed': 'kill',
    'epic:backlog:done': 'complete',
    'epic:backlog:archived': 'archive',
    'epic:backlog:killed': 'kill',
    'task:archived:backlog': 'restore',
    'epic:archived:backlog': 'restore',
  }[`${kind}:${from}:${to}`] ?? null;
  const allowed = (from === 'triage' && (to === 'backlog' || to === 'killed'))
    || (kind === 'task' && from === 'backlog' && ['in-progress', 'archived', 'killed'].includes(to))
    || (kind === 'task' && from === 'in-progress' && ['backlog', 'done', 'killed'].includes(to))
    || (kind === 'epic' && from === 'backlog' && ['done', 'archived', 'killed'].includes(to))
    || (from === 'archived' && to === 'backlog');
  return { allowed, action, requiresDecision: action !== null };
}

function transitionPreconditions(target, ledger, request, edge) {
  const issues = [];
  if (request.date < target.data.created) {
    issues.push(transitionIssue('date-before-created', 'date', 'Transition date must not be earlier than the current created date.', []));
  }
  if (request.date < target.data.updated) {
    issues.push(transitionIssue('date-before-updated', 'date', 'Transition date must not be earlier than the current updated date.', []));
  }
  if (!edge.allowed) {
    issues.push(transitionIssue('invalid-edge', 'to_status', 'The requested lifecycle edge is not allowed for this item.', []));
  }
  if (request.to_status === 'done' && (target.data.depends_on ?? []).length > 0) {
    issues.push(transitionIssue('live-dependencies', 'depends_on', 'Completion requires an empty depends_on list.', [...target.data.depends_on].sort(compareText)));
  }
  if (target.data.kind === 'epic' && request.to_status === 'done') {
    const children = ledger.items.filter((item) => item.data.parent === target.data.id);
    const nonterminal = children.filter((item) => !['done', 'killed'].includes(item.data.status))
      .map((item) => item.data.id).sort(compareText);
    if (nonterminal.length > 0) {
      issues.push(transitionIssue('nonterminal-children', 'parent', 'Epic completion requires every direct child to be done or killed.', nonterminal));
    }
  }
  return issues.sort(compareTransitionIssues);
}

function transitionBlockers(target, ledger, toStatus) {
  const blockers = [];
  const terminalizing = ['done', 'killed', 'archived'].includes(toStatus);
  if (terminalizing) {
    for (const item of ledger.items) {
      if (item.data.id === target.data.id || !(item.data.depends_on ?? []).includes(target.data.id)) {
        continue;
      }
      blockers.push({
        code: toStatus === 'done' ? 'dependent-cleanup' : 'dependent-disposition',
        item_id: item.data.id,
        field: 'depends_on',
      });
    }
  }
  if (target.data.kind === 'epic' && ['killed', 'archived'].includes(toStatus)) {
    for (const item of ledger.items) {
      if (item.data.parent === target.data.id && ['triage', 'backlog', 'in-progress'].includes(item.data.status)) {
        blockers.push({ code: 'child-disposition', item_id: item.data.id, field: 'parent' });
      }
    }
  }
  return blockers.sort((left, right) => compareText(left.code, right.code)
    || compareText(left.item_id, right.item_id)
    || compareText(left.field, right.field));
}

function transitionIssue(code, field, message, relatedIds) {
  return { code, field, message, related_ids: relatedIds };
}

function compareTransitionIssues(left, right) {
  return compareText(left.code, right.code)
    || compareText(left.field, right.field)
    || compareText(left.related_ids.join('\u0000'), right.related_ids.join('\u0000'));
}

function transitionData(data, request, edge, ledger) {
  const successor = {
    ...data,
    provenance: { ...data.provenance },
    depends_on: [...(data.depends_on ?? [])],
    related: [...(data.related ?? [])],
    status: request.to_status,
    updated: request.date,
  };
  delete successor.completed;
  delete successor.killed;
  delete successor.archived;
  if (request.to_status === 'done') {
    successor.completed = request.date;
  } else if (request.to_status === 'killed') {
    successor.killed = request.date;
  } else if (request.to_status === 'archived') {
    successor.archived = request.date;
  }
  if (edge.requiresDecision) {
    const decision = {
      action: edge.action,
      date: request.date,
      summary: request.decision.summary,
      rationale: request.decision.rationale,
    };
    if (data.kind === 'epic' && request.to_status === 'done') {
      decision.rollup = ledger.items
        .filter((item) => item.data.parent === data.id)
        .map((item) => ({ id: item.data.id, status: item.data.status }))
        .sort((left, right) => compareText(left.id, right.id));
    }
    successor.decisions = [...(data.decisions ?? []), decision];
  }
  return successor;
}

function serializeTransition(source, successor, edge) {
  const bounds = frontmatterBounds(source);
  const frontmatter = source.slice(bounds.start, bounds.end);
  const document = parseDocument(frontmatter, {
    intAsBigInt: true,
    keepSourceTokens: true,
    prettyErrors: false,
    schema: 'core',
    uniqueKeys: true,
  });
  if (document.errors.length > 0 || !isMap(document.contents)) {
    throw new Error('Unable to mutate malformed frontmatter.');
  }
  setRootScalar(document, 'status', successor.status);
  setRootScalar(document, 'updated', successor.updated);
  document.delete('completed');
  document.delete('killed');
  document.delete('archived');
  const terminal = terminalField(successor.status);
  if (terminal) {
    insertRootAfter(document, 'updated', terminal, successor[terminal]);
  }
  if (edge.requiresDecision) {
    appendDecisionNode(document, successor.decisions.at(-1));
  }
  let serialized = document.toString({ lineWidth: 0 });
  if (bounds.newline === '\r\n') {
    serialized = serialized.replaceAll('\n', '\r\n');
  }
  if (!frontmatter.endsWith(bounds.newline)) {
    serialized = serialized.slice(0, -bounds.newline.length);
  }
  return `${source.slice(0, bounds.start)}${serialized}${source.slice(bounds.end)}`;
}

function setRootScalar(document, key, value) {
  const node = document.get(key, true);
  if (isScalar(node)) {
    node.value = value;
    return;
  }
  document.set(key, value);
}

function insertRootAfter(document, afterKey, key, value) {
  const existing = document.contents.items.findIndex((pair) => pair.key?.value === key);
  if (existing >= 0) {
    document.contents.items.splice(existing, 1);
  }
  const index = document.contents.items.findIndex((pair) => pair.key?.value === afterKey);
  document.contents.items.splice(index + 1, 0, document.createPair(key, value));
}

function appendDecisionNode(document, decision) {
  const existing = document.get('decisions', true);
  let decisions = existing;
  if (isAlias(existing)) {
    const resolved = existing.resolve(document);
    if (isSeq(resolved)) {
      decisions = resolved.clone(document.schema);
      decisions.anchor = undefined;
      document.set('decisions', decisions);
    }
  }
  const node = document.createNode(decision);
  node.flow = false;
  node.get('summary', true).type = Scalar.QUOTE_DOUBLE;
  node.get('rationale', true).type = Scalar.QUOTE_DOUBLE;
  if (isSeq(decisions)) {
    decisions.add(node);
    return;
  }
  const sequence = document.createNode([]);
  sequence.flow = false;
  sequence.add(node);
  document.set('decisions', sequence);
}

function frontmatterBounds(source) {
  const opening = nextLine(source, 0);
  if (opening.content !== '---' || opening.next === null) {
    throw new Error('missing frontmatter delimiter');
  }
  const start = opening.next;
  let cursor = start;
  while (cursor < source.length) {
    const line = nextLine(source, cursor);
    if (line.content === '---') {
      return { start, end: cursor, newline: opening.newline ?? line.newline ?? '\n' };
    }
    if (line.next === null) {
      break;
    }
    cursor = line.next;
  }
  throw new Error('missing frontmatter delimiter');
}

function nextLine(source, start) {
  const lf = source.indexOf('\n', start);
  if (lf === -1) {
    return { content: source.slice(start), newline: null, next: null };
  }
  const carriageReturn = lf > start && source[lf - 1] === '\r';
  return {
    content: source.slice(start, carriageReturn ? lf - 1 : lf),
    newline: carriageReturn ? '\r\n' : '\n',
    next: lf + 1,
  };
}

function terminalField(status) {
  return { done: 'completed', killed: 'killed', archived: 'archived' }[status] ?? null;
}

async function loadedValidLedger(root) {
  const ledger = await loadLedger(root);
  const validation = validateLedger(ledger);
  return { ledger, validation, valid: validation.valid };
}

function validateSerializedCandidate(
  ledger,
  replacementId,
  bytes,
  displayPath,
  file,
  expectedData,
  expectedSource,
  changedSourceFields = [],
) {
  const source = bytes.toString('utf8');
  const parsed = parseLedgerItemSource(source);
  const errors = parsed.error ? [{ path: displayPath, ...parsed.error }] : [];
  const coreMatches = parsed.error || !expectedData
    || isDeepStrictEqual(coreView(parsed.data), coreView(expectedData));
  const extensionsMatch = parsed.error || !expectedSource
    || isDeepStrictEqual(
      extensionNodeIdentity(source, changedSourceFields),
      extensionNodeIdentity(expectedSource, changedSourceFields),
    );
  if (!parsed.error && (!coreMatches || !extensionsMatch)) {
    errors.push({
      path: displayPath,
      field: 'frontmatter',
      code: 'mutation-successor-mismatch',
      message: 'Serialized frontmatter does not exactly match the requested successor.',
    });
  }
  const candidate = parsed.error ? null : {
    path: displayPath,
    file,
    bytes,
    source,
    body: parsed.body,
    data: parsed.data,
  };
  const items = replacementId
    ? ledger.items.map((item) => item.data.id === replacementId ? candidate : item)
    : [...ledger.items, candidate];
  return validateLedger({ items: items.filter(Boolean), errors });
}

function extensionNodeIdentity(source, ignoredFields = []) {
  const bounds = frontmatterBounds(source);
  const document = parseDocument(source.slice(bounds.start, bounds.end), {
    keepSourceTokens: true,
    prettyErrors: false,
    schema: 'core',
    uniqueKeys: true,
  });
  if (document.errors.length > 0 || !isMap(document.contents)) {
    return null;
  }

  const identity = [];
  for (const pair of document.contents.items) {
    const key = isScalar(pair.key) ? pair.key.value : undefined;
    if (ignoredFields.includes(key)) {
      continue;
    }
    if (!CONTROLLED_ITEM_FIELDS.has(key)) {
      identity.push(['item', sourceNodeIdentity(pair)]);
      continue;
    }
    if (key !== 'provenance' || !isMap(pair.value)) {
      continue;
    }
    for (const provenancePair of pair.value.items) {
      const provenanceKey = isScalar(provenancePair.key) ? provenancePair.key.value : undefined;
      if (provenanceKey !== 'source' && provenanceKey !== 'recorded_at') {
        identity.push(['provenance', sourceNodeIdentity(provenancePair)]);
      }
    }
  }
  return identity;
}

function sourceNodeIdentity(node) {
  if (node && Object.hasOwn(node, 'key') && Object.hasOwn(node, 'value')) {
    return ['pair', sourceNodeIdentity(node.key), sourceNodeIdentity(node.value)];
  }
  const presentation = [node?.tag ?? null, node?.anchor ?? null, node?.commentBefore ?? null, node?.comment ?? null, node?.spaceBefore ?? false];
  if (isAlias(node)) {
    return ['alias', node.source, ...presentation];
  }
  if (isScalar(node)) {
    return ['scalar', node.source ?? String(node.value), node.type ?? null, ...presentation];
  }
  if (isMap(node) || isSeq(node)) {
    return [isMap(node) ? 'map' : 'sequence', node.flow ?? false, ...presentation, node.items.map(sourceNodeIdentity)];
  }
  return ['absent'];
}

function lockIdsForCreate(request, ledger) {
  const existingIds = new Set(ledger.items.map((item) => item.data.id));
  const references = [request.item.parent, ...(request.item.depends_on ?? [])]
    .filter((id) => existingIds.has(id));
  return [request.id, ...references].sort(compareText);
}

async function acquireLocks(root, ids, operation, scenario) {
  const lockDirectory = path.join(root, '.wowbagger-locks');
  await mkdir(lockDirectory, { recursive: true });
  const locks = [];
  try {
    for (const id of [...new Set(ids)].sort(compareText)) {
      const file = path.join(lockDirectory, `${id}.lock`);
      let handle;
      try {
        handle = await open(file, 'wx');
      } catch (error) {
        if (error?.code === 'EEXIST') {
          throw new LockHeldError(file);
        }
        throw error;
      }
      const lock = {
        id,
        file,
        source: Buffer.from(lockSource(id, operation), 'utf8'),
        device: null,
        inode: null,
        metadataComplete: false,
        released: false,
      };
      locks.push(lock);
      let failure = null;
      try {
        const stat = await handle.stat();
        lock.device = stat.dev;
        lock.inode = stat.ino;
        if (scenarioName(scenario) === 'lock-metadata-write-fails'
          || scenarioName(scenario) === 'lock-metadata-write-and-unlink-fail') {
          throw new Error('fixture lock metadata write failure');
        }
        await handle.writeFile(lock.source);
        if (scenarioName(scenario) === 'lock-metadata-sync-fails') {
          throw new Error('fixture lock metadata sync failure');
        }
        await handle.sync();
        lock.metadataComplete = true;
      } catch (error) {
        failure = error;
      }
      try {
        await handle.close();
        if (scenarioName(scenario) === 'lock-metadata-close-fails') {
          throw new Error('fixture lock metadata close failure');
        }
      } catch (error) {
        failure ??= error;
      }
      if (failure) {
        const failedLocks = await releaseLocks(locks, scenario);
        throw new ResourceFailure('lock-closure', failedLocks);
      }
    }
    await testCheckpoint(root, scenario, 'after-lock-acquired');
    return locks;
  } catch (error) {
    if (error instanceof ResourceFailure) {
      throw error;
    }
    const failedLocks = await releaseLocks(locks, scenario);
    if (failedLocks.length > 0) {
      throw new ResourceFailure('cleanup', failedLocks);
    }
    throw error;
  }
}

async function releaseLocks(locks, scenario) {
  const failed = [];
  await Promise.all(locks.map(async (lock) => {
    if (lock.released) {
      return;
    }
    try {
      if (scenarioName(scenario) === 'lock-unlink-fails-after-publication'
        || scenarioName(scenario) === 'lock-metadata-write-and-unlink-fail') {
        failed.push(lock);
        return;
      }
      if (!await lockPathIsOwned(lock)) {
        failed.push(lock);
        return;
      }
      await unlink(lock.file);
      lock.released = true;
    } catch (error) {
      if (error?.code === 'ENOENT') {
        lock.released = true;
        return;
      }
      failed.push(lock);
    }
  }));
  return failed;
}

async function finishUncommittedResources(id, outcome, locks, root, scenario, artifacts) {
  const failedLocks = await releaseLocks(locks, scenario);
  if (failedLocks.length === 0) {
    return { locks: [], preserveLocks: false, outcome };
  }
  return {
    locks: failedLocks,
    preserveLocks: true,
    outcome: operationFailed(id, 'cleanup', 'io-error', [
      ...artifacts,
      ...await artifactsForLocks(failedLocks, root),
    ]),
  };
}

async function finishUnknownResources(outcome, locks, root, scenario) {
  const failedLocks = await releaseLocks(locks, scenario);
  if (failedLocks.length === 0) {
    return { locks: [], preserveLocks: false, outcome };
  }
  const lockArtifacts = await artifactsForLocks(failedLocks, root);
  const bounded = boundedArtifacts([...outcome.error.details.recovery_artifacts, ...lockArtifacts]);
  outcome.error.details.recovery_artifacts = bounded.artifacts;
  outcome.error.details.recovery_artifacts_truncated = bounded.truncated;
  return { locks: failedLocks, preserveLocks: true, outcome };
}

async function finishCommittedResources(id, bytes, locks, root, scenario, artifacts) {
  const failedLocks = await releaseLocks(locks, scenario);
  return {
    locks: failedLocks,
    preserveLocks: failedLocks.length > 0,
    outcome: postCommitRecovery(id, bytes, [
      ...artifacts,
      ...await artifactsForLocks(failedLocks, root),
    ]),
  };
}

async function lockPathIsOwned(lock) {
  const stat = await lstat(lock.file);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    return false;
  }
  if (lock.device !== null && lock.inode !== null
    && (stat.dev !== lock.device || stat.ino !== lock.inode)) {
    return false;
  }
  if (lock.metadataComplete) {
    if (lock.source.length !== stat.size) {
      return false;
    }
    try {
      return (await readRegularFile(lock.file, lock.source.length + 1)).equals(lock.source);
    } catch {
      return false;
    }
  }
  return lock.device !== null && lock.inode !== null;
}

class LockHeldError extends Error {
  constructor(file) {
    super('lock held');
    this.file = file;
  }
}

class ResourceFailure extends Error {
  constructor(operation, locks) {
    super(operation);
    this.operation = operation;
    this.locks = locks;
  }
}

function issue(pathValue, code, message) {
  return { path: pathValue, code, message };
}

function validateRelationEntries(references, field, issues) {
  for (let index = 0; index < references.length; index += 1) {
    const reference = references[index];
    if (typeof reference !== 'string' || !ULID_PATTERN.test(reference)) {
      issues.push(issue(
        `/item/${field}/${index}`,
        'invalid-value',
        `Item member ${field} entries must be canonical Wowbagger item IDs.`,
      ));
    }
  }
}

function validatePatchRelationEntries(references, field, issues) {
  for (let index = 0; index < references.length; index += 1) {
    const reference = references[index];
    if (typeof reference !== 'string' || !ULID_PATTERN.test(reference)) {
      issues.push(issue(
        `/patch/${field}/${index}`,
        'invalid-value',
        `Patch member ${field} entries must be canonical Wowbagger item IDs.`,
      ));
    }
  }
}

function validateObjectMembers(value, location, allowed, issues, noun) {
  const allowedMembers = new Set(allowed);
  for (const member of Object.keys(value)) {
    if (!allowedMembers.has(member)) {
      issues.push(issue(pointer([...location, member]), 'unknown-member', `${noun} ${member} is not allowed.`));
    }
  }
}

function validateRequiredMember(value, location, member, issues) {
  if (!hasOwn(value, member)) {
    issues.push(issue(pointer([...location, member]), 'missing-member', `Required member ${member} is missing.`));
  }
}

function mutationSuccess(item) {
  return { ok: true, exit: 0, state: 'committed', item };
}

function mutationError(code, message, state, exit, details) {
  return {
    ok: false,
    exit,
    state,
    error: { code, message, details },
  };
}

function ledgerInvalid(validation) {
  return mutationError('ledger-invalid', 'The configured ledger is invalid.', 'unchanged', 3, {
    validation_errors: validation.errors,
  });
}

function operationFailed(id, operation, reason, recoveryArtifacts = []) {
  const { artifacts, truncated } = boundedArtifacts(recoveryArtifacts);
  return mutationError('operation-failed', 'The mutation operation failed before a commit was established.', 'unchanged', 6, {
    id,
    operation,
    reason,
    recovery_artifacts: artifacts,
    recovery_artifacts_truncated: truncated,
  });
}

function lockHeld(id, file, details) {
  return mutationError('lock-held', 'The item is locked by another cooperative Wowbagger writer.', 'unchanged', 4, {
    id,
    lock_path: `.wowbagger-locks/${path.basename(file)}`,
    owner: details.owner,
    owner_diagnostic: details.owner_diagnostic,
  });
}

async function lockDetails(file) {
  let handle;
  try {
    const pathStat = await lstat(file);
    if (!pathStat.isFile() || pathStat.isSymbolicLink()) {
      return { owner: null, owner_diagnostic: 'invalid-shape' };
    }
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const fileStat = await handle.stat();
    if (!fileStat.isFile()) {
      return { owner: null, owner_diagnostic: 'invalid-shape' };
    }
    const bytes = Buffer.alloc(4097);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead >= 4097) {
      return { owner: null, owner_diagnostic: 'too-large' };
    }
    const parsed = parseJsonRequest(bytes.subarray(0, bytesRead));
    if (parsed.issues.length > 0) {
      const code = parsed.issues[0].code;
      return {
        owner: null,
        owner_diagnostic: parsed.inputDiagnostic ?? (code === 'duplicate-key' ? 'duplicate-key' : 'invalid-json'),
      };
    }
    const owner = parsed.value;
    if (!validLockOwner(owner, file)) {
      return { owner: null, owner_diagnostic: 'invalid-shape' };
    }
    return {
      owner: {
        lock_version: 1,
        item_id: owner.item_id,
        operation: owner.operation,
        writer_id: owner.writer_id,
        started_at: owner.started_at,
      },
      owner_diagnostic: null,
    };
  } catch {
    return { owner: null, owner_diagnostic: 'invalid-json' };
  } finally {
    await handle?.close();
  }
}

function validLockOwner(owner, file) {
  if (!isMapping(owner)) {
    return false;
  }
  const expectedId = path.basename(file, '.lock');
  const expected = new Set(['lock_version', 'item_id', 'operation', 'writer_id', 'started_at']);
  if (Object.keys(owner).length !== expected.size || Object.keys(owner).some((key) => !expected.has(key))) {
    return false;
  }
  return isJsonInteger(owner.lock_version, 1)
    && owner.item_id === expectedId
    && (owner.operation === 'create' || owner.operation === 'patch' || owner.operation === 'transition')
    && typeof owner.writer_id === 'string'
    && /^[\x21-\x7e]{1,128}$/.test(owner.writer_id)
    && isRfc3339Utc(owner.started_at);
}

function lockSource(id, operation) {
  return `${JSON.stringify({
    lock_version: 1,
    item_id: id,
    operation,
    writer_id: randomBytes(18).toString('base64url'),
    started_at: new Date().toISOString(),
  })}\n`;
}

async function writeFixtureRecoveryLock(file, id) {
  await writeFile(file, `{
  "lock_version": 1,
  "item_id": "${id}",
  "operation": "create",
  "writer_id": "fixture-create-writer",
  "started_at": "2030-01-10T12:34:56.789Z"
}
`);
}

async function artifactFor(file, root, kind) {
  try {
    const bytes = await readRegularFile(file);
    return {
      path: path.relative(root, file).split(path.sep).join('/'),
      kind,
      sha256: revisionFor(bytes),
      size_bytes: bytes.length,
    };
  } catch {
    return {
      path: path.relative(root, file).split(path.sep).join('/'),
      kind,
      sha256: null,
      size_bytes: null,
    };
  }
}

async function artifactsForLocks(locks, root) {
  const artifacts = await Promise.all(locks.map(({ file }) => artifactFor(file, root, 'lock-file')));
  return artifacts.sort((left, right) => compareText(left.path, right.path));
}

function postCommitRecovery(id, bytes, recoveryArtifacts) {
  const bounded = boundedArtifacts(recoveryArtifacts);
  return mutationError('post-commit-recovery-required', 'The item was committed, but cleanup requires recovery.', 'committed', 6, {
    id,
    revision: revisionFor(bytes),
    recovery_artifacts: bounded.artifacts,
    recovery_artifacts_truncated: bounded.truncated,
  });
}

function boundedArtifacts(recoveryArtifacts) {
  const unique = new Map();
  for (const artifact of recoveryArtifacts) {
    unique.set(`${artifact.path}\0${artifact.kind}`, artifact);
  }
  const all = [...unique.values()].sort((left, right) => compareText(left.path, right.path)
    || compareText(left.kind, right.kind));
  return { artifacts: all.slice(0, 16), truncated: all.length > 16 };
}

async function syncDirectoryIfSupported(directory) {
  let handle;
  try {
    handle = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
    await handle.sync();
  } catch (error) {
    if (['EISDIR', 'EINVAL', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EPERM'].includes(error?.code)) {
      return;
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

async function pathOccupant(finalPath, ledger) {
  let stat;
  try {
    stat = await lstat(finalPath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  if (stat.isDirectory()) {
    return { kind: 'directory' };
  }
  const item = ledger.items.find((candidate) => candidate.file === finalPath);
  return { kind: 'item', id: item?.data.id };
}

function isUnavailableNoClobber(error) {
  return ['EPERM', 'EOPNOTSUPP', 'ENOTSUP', 'EXDEV'].includes(error?.code);
}

function sameIds(left, right) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function displayItemPath(displayPath) {
  return displayPath.slice(displayPath.indexOf('/') + 1);
}

function relativeDirectory(root, directory) {
  const relative = path.relative(root, directory).split(path.sep).join('/');
  return relative || '.';
}

async function observePublication(file, expectedBytes, originalBytes = null) {
  try {
    const bytes = await readRegularFile(file);
    if (bytes.equals(expectedBytes)) {
      return { state: 'expected', bytes };
    }
    if (originalBytes && bytes.equals(originalBytes)) {
      return { state: 'original', bytes };
    }
    return { state: 'different', bytes };
  } catch (error) {
    return { state: error?.code === 'ENOENT' ? 'absent' : 'unknown', bytes: null };
  }
}

function unknownPublication(command, id, displayPath, bytes, otherArtifacts = []) {
  const finalArtifact = {
    path: displayPath,
    kind: 'final-item',
    sha256: bytes ? revisionFor(bytes) : null,
    size_bytes: bytes?.length ?? null,
  };
  const bounded = boundedArtifacts([finalArtifact, ...otherArtifacts]);
  return mutationError(
    'write-outcome-unknown',
    `The ${command} publication outcome could not be verified.`,
    'unknown',
    6,
    {
      id,
      recovery_artifacts: bounded.artifacts,
      recovery_artifacts_truncated: bounded.truncated,
    },
  );
}

async function readRegularFile(file, maximumBytes = null) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new Error('Published path is not a regular file.');
    }
    if (maximumBytes !== null && stat.size >= maximumBytes) {
      throw new Error('Published path exceeds its read bound.');
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function testCheckpoint(root, scenario, point) {
  const [name, suffix] = typeof scenario === 'string' ? scenario.split(':', 2) : [];
  if (!suffix) {
    return;
  }
  if (name === 'pause-after-success-release' && point === 'after-success-release') {
    await writeFile(path.join(root, `.wowbagger-test-${suffix}-released`), 'released\n');
    await waitForTestMarker(path.join(root, `.wowbagger-test-${suffix}-acquired`));
  }
  if (name === 'pause-after-lock-acquired' && point === 'after-lock-acquired') {
    await writeFile(path.join(root, `.wowbagger-test-${suffix}-acquired`), 'acquired\n');
    await waitForTestMarker(path.join(root, `.wowbagger-test-${suffix}-allow-successor`));
  }
}

async function waitForTestMarker(file) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      await lstat(file);
      return;
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for test marker ${path.basename(file)}.`);
}

export function createCandidateSource(request) {
  return Buffer.from(serializeCreate(createData(request, dateFromId(request.id)), request.body), 'utf8');
}

function createData(request, date) {
  return {
    schema_version: 1,
    id: request.id,
    title: request.item.title,
    kind: request.item.kind,
    status: 'triage',
    created: date,
    updated: date,
    provenance: request.item.provenance,
    depends_on: request.item.depends_on,
    related: request.item.related ?? [],
    ...(hasOwn(request.item, 'parent') ? { parent: request.item.parent } : {}),
    ...(hasOwn(request.item, 'snoozed_until') ? { snoozed_until: request.item.snoozed_until } : {}),
    ...extensionMembers(request.item),
  };
}

function serializeCreate(data, body) {
  const lines = [
    '---',
    'schema_version: 1',
    `id: ${data.id}`,
    `title: ${quote(data.title)}`,
    `kind: ${data.kind}`,
    'status: triage',
    `created: ${data.created}`,
    `updated: ${data.updated}`,
    'provenance:',
    `  source: ${quote(data.provenance.source)}`,
    `  recorded_at: ${quote(data.provenance.recorded_at)}`,
  ];

  for (const [key, value] of Object.entries(provenanceExtensions(data.provenance))) {
    lines.push(...yamlLines(key, value, 2));
  }
  lines.push(
    `depends_on: ${referenceList(data.depends_on)}`,
    `related: ${referenceList(data.related)}`,
  );
  if (hasOwn(data, 'parent')) {
    lines.push(`parent: ${data.parent}`);
  }
  if (hasOwn(data, 'snoozed_until')) {
    lines.push(`snoozed_until: ${data.snoozed_until}`);
  }

  for (const [key, value] of Object.entries(extensionMembers(data))) {
    lines.push(...yamlLines(key, value, 0));
  }

  lines.push('---');
  return `${lines.join('\n')}\n${body}`;
}

function extensionMembers(item) {
  return Object.fromEntries(Object.entries(item).filter(([key]) => !CONTROLLED_ITEM_FIELDS.has(key)));
}

function provenanceExtensions(provenance) {
  return Object.fromEntries(Object.entries(provenance)
    .filter(([key]) => key !== 'source' && key !== 'recorded_at'));
}

function yamlLines(key, value, indentation) {
  const prefix = ' '.repeat(indentation);
  const renderedKey = yamlKey(key);
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [`${prefix}${renderedKey}: []`];
    }
    return [`${prefix}${renderedKey}:`, ...yamlSequenceLines(value, indentation + 2)];
  }
  if (isMapping(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return [`${prefix}${renderedKey}: {}`];
    }
    return [`${prefix}${renderedKey}:`, ...yamlMappingLines(entries, indentation + 2)];
  }
  return [`${prefix}${renderedKey}: ${yamlScalar(value)}`];
}

function yamlMappingLines(entries, indentation) {
  return entries.flatMap(([key, value]) => yamlLines(key, value, indentation));
}

function yamlSequenceLines(values, indentation) {
  const prefix = ' '.repeat(indentation);
  return values.flatMap((value) => {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return [`${prefix}- []`];
      }
      return [`${prefix}-`, ...yamlSequenceLines(value, indentation + 2)];
    }
    if (isMapping(value)) {
      const entries = Object.entries(value);
      if (entries.length === 0) {
        return [`${prefix}- {}`];
      }
      const [[firstKey, firstValue], ...remaining] = entries;
      const first = yamlLines(firstKey, firstValue, indentation + 2);
      first[0] = `${prefix}- ${first[0].slice(indentation + 2)}`;
      return [...first, ...yamlMappingLines(remaining, indentation + 2)];
    }
    return [`${prefix}- ${yamlScalar(value)}`];
  });
}

function yamlKey(key) {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) ? key : quote(key);
}

function yamlScalar(value) {
  if (typeof value === 'string') {
    return quote(value);
  }
  if (value === null) {
    return 'null';
  }
  if (value instanceof JsonNumber) {
    return value.source;
  }
  return String(value);
}

function quote(value) {
  return JSON.stringify(value);
}

function referenceList(references) {
  return references.length === 0 ? '[]' : `[${references.join(', ')}]`;
}

function dateFromId(id) {
  const ulid = id.slice(3);
  let milliseconds = 0;
  for (const character of ulid.slice(0, 10)) {
    milliseconds = (milliseconds * 32) + ULID_ALPHABET.indexOf(character);
  }
  return new Date(milliseconds).toISOString().slice(0, 10);
}

function randomSuffix() {
  return createHash('sha256').update(`${process.pid}:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 24);
}

async function prepareTemporary(file, bytes, scenario) {
  let handle;
  try {
    handle = await open(file, 'wx');
  } catch {
    return 'prepare-temporary';
  }

  let failure = null;
  try {
    await handle.writeFile(bytes);
  } catch {
    failure = 'prepare-temporary';
  }
  if (!failure) {
    try {
      if (scenario === 'temporary-file-sync-fails') {
        throw new Error('fixture temporary sync failure');
      }
      await handle.sync();
    } catch {
      failure = 'sync-temporary';
    }
  }
  try {
    await handle.close();
    if (scenarioName(scenario) === 'temporary-close-fails'
      || scenarioName(scenario) === 'temporary-close-and-unlink-fail') {
      throw new Error('fixture temporary close failure');
    }
  } catch {
    failure ??= 'sync-temporary';
  }
  return failure;
}

async function cleanupTemporary(file, root, scenario) {
  if (scenarioName(scenario) === 'temporary-close-and-unlink-fail'
    || scenarioName(scenario) === 'temporary-unlink-fails-after-publication'
    || scenario === 'final-mismatch-and-temporary-unlink-fail'
    || scenario === 'final-absence-and-temporary-unlink-fail') {
    return [await artifactFor(file, root, 'temporary-file')];
  }
  try {
    await unlink(file);
    return [];
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    return [await artifactFor(file, root, 'temporary-file')];
  }
}

function scenarioName(scenario) {
  return typeof scenario === 'string' ? scenario.split(':', 1)[0] : '';
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isMapping(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof JsonNumber);
}

function isJsonInteger(value, expected) {
  return value === expected || (value instanceof JsonNumber && value.source === String(expected));
}

function jsonIntegerValue(value) {
  return value instanceof JsonNumber ? Number(value.source) : value;
}

function validOptionalInteger(value, minimum) {
  if (value === null) {
    return true;
  }
  const integer = jsonIntegerValue(value);
  return Number.isSafeInteger(integer) && integer >= minimum;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function coreView(data) {
  const core = {};
  for (const field of REQUIRED_CORE_FIELDS) {
    core[field] = data[field];
  }

  for (const field of OPTIONAL_CORE_FIELDS) {
    if (Object.hasOwn(data, field)) {
      core[field] = data[field];
    }
  }

  core.provenance = {
    source: data.provenance.source,
    recorded_at: data.provenance.recorded_at,
  };
  core.depends_on = data.depends_on;
  core.related = data.related ?? [];

  if (Object.hasOwn(data, 'decisions')) {
    core.decisions = data.decisions.map((decision) => {
      const normalized = {
        action: decision.action,
        date: decision.date,
        summary: decision.summary,
        rationale: decision.rationale,
      };
      if (Object.hasOwn(decision, 'rollup')) {
        normalized.rollup = decision.rollup.map(({ id, status }) => ({ id, status }));
      }
      return normalized;
    });
  }

  return core;
}
