import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadLedger } from './ledger.js';
import { JsonNumber, parseJsonRequest, pointer, sortIssues } from './request.js';
import { isCalendarDate, validateLedger } from './validate.js';

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

  return {
    item: {
      id,
      path: item.path.slice(item.path.indexOf('/') + 1),
      revision: revisionFor(item.bytes),
      source_encoding: 'base64',
      source_media_type: 'text/markdown; charset=utf-8',
      source_base64: item.bytes.toString('base64'),
      core: coreView(item.data),
      body: item.body,
    },
  };
}

export function revisionFor(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function validateCreateRequest(request, parseIssues = []) {
  const issues = [...parseIssues];
  if (issues.length > 0) {
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
      issues.push(issue(pointer(['item', field]), 'invalid-value', `Item member ${field} is controlled by Wowbagger.`));
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
  }
  if (hasOwn(item, 'related') && !Array.isArray(item.related)) {
    issues.push(issue('/item/related', 'invalid-type', 'Item member related must be an array.'));
  }
  if (hasOwn(item, 'provenance') && !isMapping(item.provenance)) {
    issues.push(issue('/item/provenance', 'invalid-type', 'Item member provenance must be an object.'));
  }

  return sortIssues(issues);
}

export async function createItem(ledgerDirectory, request, scenario = testScenario()) {
  const root = path.resolve(ledgerDirectory);
  const id = request.id;
  let requiredIds = null;

  for (let attempt = 0; attempt < MAX_LOCK_CLOSURE_RETRIES; attempt += 1) {
    const initial = await loadedValidLedger(root);
    if (!initial.valid) {
      return ledgerInvalid(initial.validation);
    }
    const nextIds = lockIdsForCreate(request, initial.ledger);
    if (scenario === 'expand-lock-closure-through-bounded-retry-limit') {
      return operationFailed(id, 'lock-closure', 'retry-limit-exhausted');
    }
    if (requiredIds && sameIds(requiredIds, nextIds)) {
      return operationFailed(id, 'lock-closure', 'retry-limit-exhausted');
    }
    requiredIds = nextIds;

    let locks;
    try {
      locks = await acquireLocks(root, requiredIds, 'create', scenario);
    } catch (error) {
      if (error instanceof LockHeldError) {
        return lockHeld(id, error.file, await lockDetails(error.file));
      }
      return operationFailed(id, 'lock-closure', 'io-error');
    }

    let preserveLocks = false;
    let temporaryPath = null;
    try {
      const current = await loadedValidLedger(root);
      if (!current.valid) {
        return ledgerInvalid(current.validation);
      }
      const stableIds = lockIdsForCreate(request, current.ledger);
      if (!sameIds(requiredIds, stableIds)) {
        requiredIds = stableIds;
        continue;
      }

      const existing = current.ledger.items.find((item) => item.data.id === id);
      if (existing) {
        return mutationError('id-collision', 'The requested item ID already exists.', 'unchanged', 4, {
          id,
          path: displayItemPath(existing.path),
          actual_revision: revisionFor(existing.bytes),
        });
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
        return mutationError('path-collision', 'The default item path is occupied by a different item.', 'unchanged', 4, details);
      }

      const candidate = createData(request, dateFromId(id));
      const candidateValidation = validateLedger({
        items: [...current.ledger.items, {
          path: `${path.basename(root)}/${id}.md`,
          data: candidate,
        }],
        errors: [],
      });
      if (!candidateValidation.valid) {
        return mutationError('candidate-invalid', 'The proposed item would make the ledger invalid.', 'unchanged', 2, {
          id,
          validation_errors: candidateValidation.errors,
        });
      }

      if (scenario === 'atomic-no-clobber-primitive-unavailable') {
        return mutationError('capability-unavailable', 'Atomic no-clobber publication is unavailable for this ledger.', 'unchanged', 5, {
          capability: 'atomic-no-clobber-publication',
          reason: 'filesystem-primitive-unavailable',
          recovery_artifacts: [],
          recovery_artifacts_truncated: false,
        });
      }

      const bytes = Buffer.from(serializeCreate(candidate, request.body), 'utf8');
      temporaryPath = path.join(root, `.wowbagger-tmp-${id}-${randomSuffix()}`);
      try {
        const temporary = await open(temporaryPath, 'wx');
        try {
          await temporary.writeFile(bytes);
          await temporary.sync();
        } finally {
          await temporary.close();
        }
      } catch {
        return operationFailed(id, 'prepare-temporary', 'io-error');
      }

      try {
        await link(temporaryPath, finalPath);
      } catch (error) {
        if (isUnavailableNoClobber(error)) {
          return mutationError('capability-unavailable', 'Atomic no-clobber publication is unavailable for this ledger.', 'unchanged', 5, {
            capability: 'atomic-no-clobber-publication',
            reason: 'filesystem-primitive-unavailable',
            recovery_artifacts: [],
            recovery_artifacts_truncated: false,
          });
        }
        return operationFailed(id, 'publish', 'io-error');
      }
      await unlink(temporaryPath).catch(() => {});
      temporaryPath = null;

      if (scenario === 'final-verification-read-fails-after-publication') {
        return mutationError('write-outcome-unknown', 'The create publication outcome could not be verified.', 'unknown', 6, {
          id,
          recovery_artifacts: [{
            path: `${id}.md`,
            kind: 'final-item',
            sha256: null,
            size_bytes: null,
          }],
          recovery_artifacts_truncated: false,
        });
      }

      let published;
      try {
        published = await readRegularFile(finalPath);
      } catch {
        return mutationError('write-outcome-unknown', 'The create publication outcome could not be verified.', 'unknown', 6, {
          id,
          recovery_artifacts: [{
            path: `${id}.md`,
            kind: 'final-item',
            sha256: null,
            size_bytes: null,
          }],
          recovery_artifacts_truncated: false,
        });
      }
      if (!published.equals(bytes)) {
        return mutationError('write-outcome-unknown', 'The create publication outcome could not be verified.', 'unknown', 6, {
          id,
          recovery_artifacts: [{
            path: `${id}.md`,
            kind: 'final-item',
            sha256: revisionFor(published),
            size_bytes: published.length,
          }],
          recovery_artifacts_truncated: false,
        });
      }

      if (scenario === 'final-bytes-verified-directory-sync-and-lock-cleanup-fail') {
        const lock = locks.find((entry) => entry.id === id);
        await writeFixtureRecoveryLock(lock.file, id);
        preserveLocks = true;
        return mutationError('post-commit-recovery-required', 'The item was committed, but cleanup requires recovery.', 'committed', 6, {
          id,
          revision: revisionFor(bytes),
          recovery_artifacts: [await artifactFor(lock.file, root, 'lock-file')],
          recovery_artifacts_truncated: false,
        });
      }

      const result = await inspectItem(root, id);
      return mutationSuccess(result.item);
    } finally {
      if (temporaryPath) {
        await unlink(temporaryPath).catch(() => {});
      }
      if (!preserveLocks) {
        await releaseLocks(locks);
      }
    }
  }

  return operationFailed(id, 'lock-closure', 'retry-limit-exhausted');
}

export function validateTransitionRequest(request, parseIssues = []) {
  const issues = [...parseIssues];
  if (issues.length > 0) {
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

export async function transitionItem(ledgerDirectory, request, scenario = testScenario()) {
  const root = path.resolve(ledgerDirectory);
  const id = request.id;
  let requiredIds = null;

  for (let attempt = 0; attempt < MAX_LOCK_CLOSURE_RETRIES; attempt += 1) {
    const initial = await loadedValidLedger(root);
    if (!initial.valid) {
      return ledgerInvalid(initial.validation);
    }
    const target = findItem(initial.ledger, id);
    if (!target) {
      return mutationError('item-not-found', 'The requested item was not found.', 'unchanged', 2, { id });
    }
    const nextIds = lockIdsForTransition(target, initial.ledger);
    if (scenario === 'expand-lock-closure-through-bounded-retry-limit') {
      return operationFailed(id, 'lock-closure', 'retry-limit-exhausted');
    }
    if (requiredIds && sameIds(requiredIds, nextIds)) {
      return operationFailed(id, 'lock-closure', 'retry-limit-exhausted');
    }
    requiredIds = nextIds;

    let locks;
    try {
      locks = await acquireLocks(root, requiredIds, 'transition', scenario);
    } catch (error) {
      if (error instanceof LockHeldError) {
        return lockHeld(id, error.file, await lockDetails(error.file));
      }
      return operationFailed(id, 'lock-closure', 'io-error');
    }

    let temporaryPath = null;
    try {
      const current = await loadedValidLedger(root);
      if (!current.valid) {
        return ledgerInvalid(current.validation);
      }
      const lockedTarget = findItem(current.ledger, id);
      if (!lockedTarget) {
        return mutationError('item-not-found', 'The requested item was not found.', 'unchanged', 2, { id });
      }
      const stableIds = lockIdsForTransition(lockedTarget, current.ledger);
      if (!sameIds(requiredIds, stableIds)) {
        requiredIds = stableIds;
        continue;
      }

      const actualRevision = revisionFor(lockedTarget.bytes);
      if (actualRevision !== request.expected_revision) {
        return mutationError('revision-conflict', 'The item changed after it was inspected.', 'unchanged', 4, {
          id,
          expected_revision: request.expected_revision,
          actual_revision: actualRevision,
        });
      }

      const edge = transitionEdge(lockedTarget.data.kind, lockedTarget.data.status, request.to_status);
      const issues = transitionPreconditions(lockedTarget, current.ledger, request, edge);
      const blockers = transitionBlockers(lockedTarget, current.ledger, request.to_status);
      if (blockers.length > 0) {
        return mutationError('atomic-scope-required', 'The requested transition requires multi-item atomicity.', 'unchanged', 5, {
          id,
          blockers,
          precondition_issues: issues,
        });
      }
      if (issues.length > 0) {
        return mutationError('transition-precondition-failed', 'The requested lifecycle transition failed its preconditions.', 'unchanged', 2, {
          id,
          issues,
        });
      }
      if (edge.requiresDecision && !isMapping(request.decision)) {
        return invalidTransitionDecision();
      }
      if (!edge.requiresDecision && hasOwn(request, 'decision')) {
        return invalidTransitionDecision();
      }

      const successor = transitionData(lockedTarget.data, request, edge, current.ledger);
      const candidateValidation = validateLedger({
        items: current.ledger.items.map((item) => item.data.id === id
          ? { ...item, data: successor }
          : item),
        errors: [],
      });
      if (!candidateValidation.valid) {
        return mutationError('candidate-invalid', 'The proposed item would make the ledger invalid.', 'unchanged', 2, {
          id,
          validation_errors: candidateValidation.errors,
        });
      }

      const bytes = Buffer.from(serializeTransition(lockedTarget.source, successor, edge), 'utf8');
      temporaryPath = path.join(root, `.wowbagger-tmp-${id}-${randomSuffix()}`);
      try {
        const temporary = await open(temporaryPath, 'wx');
        try {
          await temporary.writeFile(bytes);
          await temporary.sync();
        } finally {
          await temporary.close();
        }
      } catch {
        return operationFailed(id, 'prepare-temporary', 'io-error');
      }

      try {
        await rename(temporaryPath, lockedTarget.file);
        temporaryPath = null;
      } catch {
        return operationFailed(id, 'publish', 'io-error');
      }

      let published;
      try {
        published = await readRegularFile(lockedTarget.file);
      } catch {
        return mutationError('write-outcome-unknown', 'The transition publication outcome could not be verified.', 'unknown', 6, {
          id,
          recovery_artifacts: [{
            path: displayItemPath(lockedTarget.path),
            kind: 'final-item',
            sha256: null,
            size_bytes: null,
          }],
          recovery_artifacts_truncated: false,
        });
      }
      if (!published.equals(bytes)) {
        return mutationError('write-outcome-unknown', 'The transition publication outcome could not be verified.', 'unknown', 6, {
          id,
          recovery_artifacts: [{
            path: displayItemPath(lockedTarget.path),
            kind: 'final-item',
            sha256: revisionFor(published),
            size_bytes: published.length,
          }],
          recovery_artifacts_truncated: false,
        });
      }
      const result = await inspectItem(root, id);
      return mutationSuccess(result.item);
    } finally {
      if (temporaryPath) {
        await unlink(temporaryPath).catch(() => {});
      }
      await releaseLocks(locks);
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
  const lines = source.slice(bounds.start, bounds.end).split(/\r?\n/);
  replaceScalar(lines, 'status', successor.status);
  replaceScalar(lines, 'updated', successor.updated);
  removeScalar(lines, 'completed');
  removeScalar(lines, 'killed');
  removeScalar(lines, 'archived');
  const terminal = terminalField(successor.status);
  if (terminal) {
    insertAfterScalar(lines, 'updated', `${terminal}: ${successor[terminal]}`);
  }
  if (edge.requiresDecision) {
    appendDecision(lines, successor.decisions.at(-1));
  }
  return `${source.slice(0, bounds.start)}${lines.join('\n')}${source.slice(bounds.end)}`;
}

function frontmatterBounds(source) {
  let start = 0;
  let line = 0;
  while (start <= source.length) {
    const newline = source.indexOf('\n', start);
    const next = newline === -1 ? source.length : newline + 1;
    const raw = source.slice(start, newline === -1 ? source.length : newline);
    const content = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line > 0 && content === '---') {
      const frontmatterStart = source.indexOf('\n') + 1;
      const frontmatterEnd = raw.startsWith('\r') ? start - 2 : start - 1;
      return { start: frontmatterStart, end: frontmatterEnd };
    }
    start = next;
    line += 1;
  }
  throw new Error('missing frontmatter delimiter');
}

function replaceScalar(lines, key, value) {
  const index = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (index !== -1) {
    lines[index] = `${key}: ${value}`;
  }
}

function removeScalar(lines, key) {
  const index = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (index !== -1) {
    lines.splice(index, 1);
  }
}

function insertAfterScalar(lines, key, value) {
  const index = lines.findIndex((line) => line.startsWith(`${key}:`));
  lines.splice(index + 1, 0, value);
}

function appendDecision(lines, decision) {
  const start = lines.findIndex((line) => line.startsWith('decisions:'));
  const rendered = decisionLines(decision);
  if (start === -1) {
    lines.push('decisions:', ...rendered);
    return;
  }
  let end = start + 1;
  while (end < lines.length && (lines[end].startsWith(' ') || lines[end].startsWith('\t') || lines[end] === '')) {
    end += 1;
  }
  lines.splice(end, 0, ...rendered);
}

function decisionLines(decision) {
  const lines = [
    `  - action: ${decision.action}`,
    `    date: ${decision.date}`,
    `    summary: ${quote(decision.summary)}`,
    `    rationale: ${quote(decision.rationale)}`,
  ];
  if (decision.rollup) {
    lines.push('    rollup:');
    for (const entry of decision.rollup) {
      lines.push(`      - id: ${entry.id}`, `        status: ${entry.status}`);
    }
  }
  return lines;
}

function terminalField(status) {
  return { done: 'completed', killed: 'killed', archived: 'archived' }[status] ?? null;
}

async function loadedValidLedger(root) {
  const ledger = await loadLedger(root);
  const validation = validateLedger(ledger);
  return { ledger, validation, valid: validation.valid };
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
      try {
        await handle.writeFile(lockSource(id, operation, scenario));
        await handle.sync();
      } finally {
        await handle.close();
      }
      locks.push({ id, file });
    }
    return locks;
  } catch (error) {
    await releaseLocks(locks);
    throw error;
  }
}

async function releaseLocks(locks) {
  await Promise.all(locks.map(({ file }) => unlink(file).catch(() => {})));
}

class LockHeldError extends Error {
  constructor(file) {
    super('lock held');
    this.file = file;
  }
}

function issue(pathValue, code, message) {
  return { path: pathValue, code, message };
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

function operationFailed(id, operation, reason) {
  return mutationError('operation-failed', 'The mutation operation failed before a commit was established.', 'unchanged', 6, {
    id,
    operation,
    reason,
    recovery_artifacts: [],
    recovery_artifacts_truncated: false,
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
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
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
        owner_diagnostic: code === 'duplicate-key' ? 'duplicate-key' : 'invalid-json',
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
    && (owner.operation === 'create' || owner.operation === 'transition')
    && typeof owner.writer_id === 'string'
    && /^[\x21-\x7e]{1,128}$/.test(owner.writer_id)
    && typeof owner.started_at === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(owner.started_at);
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
    const bytes = await readFile(file);
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

function testScenario() {
  return process.env.NODE_ENV === 'test' ? process.env.WOWBAGGER_TEST_SCENARIO : undefined;
}

async function readRegularFile(file) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new Error('Published path is not a regular file.');
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
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
  const controlled = new Set([
    'schema_version', 'id', 'title', 'kind', 'status', 'created', 'updated',
    'provenance', 'depends_on', 'related', 'parent', 'snoozed_until',
    'completed', 'killed', 'archived', 'decisions', 'body',
  ]);
  return Object.fromEntries(Object.entries(item).filter(([key]) => !controlled.has(key)));
}

function provenanceExtensions(provenance) {
  return Object.fromEntries(Object.entries(provenance)
    .filter(([key]) => key !== 'source' && key !== 'recorded_at'));
}

function yamlLines(key, value, indentation) {
  const prefix = ' '.repeat(indentation);
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [`${prefix}${key}: []`];
    }
    const lines = [`${prefix}${key}:`];
    for (const entry of value) {
      if (isMapping(entry)) {
        const entries = Object.entries(entry);
        if (entries.length === 0) {
          lines.push(`${prefix}  - {}`);
          continue;
        }
        const [[firstKey, firstValue], ...remaining] = entries;
        lines.push(`${prefix}  - ${firstKey}: ${yamlScalar(firstValue)}`);
        for (const [childKey, childValue] of remaining) {
          lines.push(...yamlLines(childKey, childValue, indentation + 4));
        }
      } else {
        lines.push(`${prefix}  - ${yamlScalar(entry)}`);
      }
    }
    return lines;
  }
  if (value !== null && typeof value === 'object') {
    const lines = [`${prefix}${key}:`];
    for (const [childKey, childValue] of Object.entries(value)) {
      lines.push(...yamlLines(childKey, childValue, indentation + 2));
    }
    return lines;
  }
  return [`${prefix}${key}: ${yamlScalar(value)}`];
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

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isMapping(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof JsonNumber);
}

function isJsonInteger(value, expected) {
  return value === expected || (value instanceof JsonNumber && value.source === String(expected));
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
