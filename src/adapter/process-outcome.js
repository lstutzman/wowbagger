import { createHash } from 'node:crypto';

import { parseLedgerItemSource } from '../ledger.js';
import {
  createCandidateSource,
  validateCreateRequest,
  validateTransitionRequest,
} from '../mutation.js';
import { normalizeJsonValue, parseJsonRequest } from '../request.js';
import { validateLedger } from '../validate.js';
import { CORE_COMMAND_ORDER, CORE_CONTRACT_VERSION, verifyCoreProbe } from './core-probe.js';
import { isSafeLogicalPath } from './paths.js';
import { hasExactMembers, isNonNegativeSafeInteger, sameJson } from './schema-helpers.js';

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const WOWBAGGER_ID = /^wb_[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/;
const MESSAGES = Object.freeze({
  'mutation-outcome-unknown': 'The mutation may have been applied; inspect current state before retrying.',
  'output-limit-exceeded': 'The core output exceeded the requested bound.',
});

const CORE_ERROR_EXIT_CODES = new Map([
  ['invalid-request', 2],
  ['item-not-found', 2],
  ['transition-precondition-failed', 2],
  ['patch-precondition-failed', 2],
  ['candidate-invalid', 2],
  ['items-directory-unavailable', 2],
  ['ledger-invalid', 3],
  ['revision-conflict', 4],
  ['lock-held', 4],
  ['id-collision', 4],
  ['path-collision', 4],
  ['atomic-scope-required', 5],
  ['capability-unavailable', 5],
  ['operation-failed', 6],
  ['post-commit-recovery-required', 6],
  ['write-outcome-unknown', 6],
]);
const MUTATION_ERROR_STATES = new Map([
  ['post-commit-recovery-required', 'committed'],
  ['write-outcome-unknown', 'unknown'],
]);
const CORE_ERROR_CODES_BY_COMMAND = Object.freeze({
  inspect: new Set(['invalid-request', 'item-not-found', 'ledger-invalid']),
  create: new Set([
    'invalid-request', 'ledger-invalid', 'lock-held', 'id-collision', 'path-collision',
    'candidate-invalid', 'items-directory-unavailable', 'capability-unavailable',
    'operation-failed', 'post-commit-recovery-required', 'write-outcome-unknown',
  ]),
  transition: new Set([
    'invalid-request', 'item-not-found', 'ledger-invalid', 'lock-held',
    'revision-conflict', 'atomic-scope-required', 'transition-precondition-failed',
    'candidate-invalid', 'operation-failed', 'post-commit-recovery-required',
    'write-outcome-unknown',
  ]),
  patch: new Set([
    'invalid-request', 'item-not-found', 'ledger-invalid', 'lock-held',
    'revision-conflict', 'patch-precondition-failed', 'candidate-invalid',
    'operation-failed', 'post-commit-recovery-required', 'write-outcome-unknown',
  ]),
});
const INVALID_REQUEST_CODES = new Set([
  'invalid-json', 'duplicate-key', 'missing-member', 'unknown-member', 'invalid-type',
  'invalid-value', 'missing-argument', 'repeated-argument', 'unknown-argument',
]);
const TRANSITION_ISSUE_MESSAGES = Object.freeze({
  'date-before-created': 'Transition date must not be earlier than the current created date.',
  'date-before-updated': 'Transition date must not be earlier than the current updated date.',
  'invalid-edge': 'The requested lifecycle edge is not allowed for this item.',
  'live-dependencies': 'Completion requires an empty depends_on list.',
  'nonterminal-children': 'Epic completion requires every direct child to be done or killed.',
});
const TRANSITION_ISSUE_FIELDS = Object.freeze({
  'date-before-created': 'date',
  'date-before-updated': 'date',
  'invalid-edge': 'to_status',
  'live-dependencies': 'depends_on',
  'nonterminal-children': 'parent',
});
const PATCH_ISSUE_MESSAGES = Object.freeze({
  'date-before-created': 'Patch date must not be earlier than the current created date.',
  'date-before-updated': 'Patch date must not be earlier than the current updated date.',
});
const DATE_ISSUE_CODES = new Set(['date-before-created', 'date-before-updated']);
const TRANSITION_BLOCKER_FIELDS = Object.freeze({
  'dependent-cleanup': 'depends_on',
  'dependent-disposition': 'depends_on',
  'child-disposition': 'parent',
});

function error(code, details) {
  return { code, message: MESSAGES[code] ?? `The adapter refused the operation (${code}).`, details };
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function decodeCanonicalBase64(value) {
  if (typeof value !== 'string' || value.includes('\n') || value.includes('\r')) return null;
  const bytes = Buffer.from(value, 'base64');
  return bytes.toString('base64') === value ? bytes : null;
}

function decodeUtf8(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function isCalendarDate(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const monthLengths = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= monthLengths[month - 1];
}

function isCoreRfc3339Utc(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(value);
  return match !== null && isCalendarDate(match[1])
    && Number(match[2]) <= 23 && Number(match[3]) <= 59 && Number(match[4]) <= 59;
}

function nonEmptyTrimmedString(value) {
  return typeof value === 'string' && value.trim().length > 0 && !CONTROL_CHARACTER.test(value);
}

function nonEmptyControlFreeString(value) {
  return typeof value === 'string' && value.length > 0 && !CONTROL_CHARACTER.test(value);
}

function isSafeLedgerDirectoryPath(value) {
  return isSafeLogicalPath(value) && value !== '.' && !value.endsWith('.md');
}

function isSafeLedgerDisplayPath(value) {
  return isSafeLogicalPath(value) && value !== '.' && value.endsWith('.md');
}

function isSafeArtifactPath(value) {
  return isSafeLogicalPath(value) && value !== '.' && [...value].length <= 1024;
}

function compareText(left, right) {
  const leftPoints = [...left];
  const rightPoints = [...right];
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    const difference = leftPoints[index].codePointAt(0) - rightPoints[index].codePointAt(0);
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

function isOrdered(values, compare) {
  return values.every((value, index) => index === 0 || compare(values[index - 1], value) <= 0);
}

function isJsonPointer(value) {
  if (typeof value !== 'string' || CONTROL_CHARACTER.test(value)) return false;
  return value === '' || /^\/(?:[^~]|~[01])*(?:\/(?:[^~]|~[01])*)*$/.test(value);
}

function isMutationCommand(command) {
  return command === 'create' || command === 'transition' || command === 'patch';
}

function observationIssue(process) {
  if (!hasExactMembers(process, [
    'started', 'process_tree_contained', 'orphaned', 'exit_code', 'signal', 'timed_out',
    'stdout_complete', 'stderr_complete', 'stdout_base64', 'stderr_base64',
  ])) return 'members';
  for (const member of [
    'started', 'process_tree_contained', 'orphaned', 'timed_out', 'stdout_complete', 'stderr_complete',
  ]) {
    if (typeof process[member] !== 'boolean') return member;
  }
  if (process.signal !== null && (typeof process.signal !== 'string' || process.signal.length === 0)) return 'signal';
  if (process.exit_code !== null && !isNonNegativeSafeInteger(process.exit_code)) return 'exit_code';
  const stdout = decodeCanonicalBase64(process.stdout_base64);
  const stderr = decodeCanonicalBase64(process.stderr_base64);
  if (stdout === null) return 'stdout_base64';
  if (stderr === null) return 'stderr_base64';
  if (!process.started) {
    if (process.exit_code !== null || process.signal !== null || process.timed_out
      || !process.process_tree_contained || process.orphaned
      || !process.stdout_complete || !process.stderr_complete
      || stdout.length > 0 || stderr.length > 0) return 'not-started-state';
    return null;
  }
  if ((process.timed_out || process.signal !== null) && process.exit_code !== null) {
    return 'contradictory-exit-state';
  }
  const incomplete = process.timed_out || process.signal !== null
    || !process.process_tree_contained || process.orphaned
    || !process.stdout_complete || !process.stderr_complete;
  return process.exit_code === null && !incomplete ? 'exit_code' : null;
}

function hasRequiredFinalLf(bytes) {
  if (bytes.length <= 1 || bytes[bytes.length - 1] !== 0x0A
    || bytes[bytes.length - 2] === 0x0A || bytes[bytes.length - 2] === 0x0D) return false;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < bytes.length - 1; index += 1) {
    const byte = bytes[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (byte === 0x5C) escaped = true;
      else if (byte === 0x22) inString = false;
      continue;
    }
    if (byte === 0x22) inString = true;
    else if (byte === 0x09 || byte === 0x0A || byte === 0x0D || byte === 0x20) return false;
  }
  return !inString && !escaped;
}

function validValidationErrors(value) {
  return Array.isArray(value) && value.every((error) => hasExactMembers(error, [
    'path', 'field', 'code', 'message',
  ])
    && nonEmptyControlFreeString(error.path)
    && nonEmptyControlFreeString(error.field)
    && nonEmptyControlFreeString(error.code)
    && nonEmptyControlFreeString(error.message))
    && isOrdered(value, compareValidationErrors);
}

function compareValidationErrors(left, right) {
  return compareText(left.path, right.path)
    || compareText(left.field, right.field)
    || compareText(left.code, right.code)
    || compareText(left.message, right.message);
}

function validCoreValidateEnvelope(value, exitCode) {
  return hasExactMembers(value, ['valid', 'errors'])
    && typeof value.valid === 'boolean'
    && validValidationErrors(value.errors)
    && exitCode === (value.valid ? 0 : 1)
    && (value.valid ? value.errors.length === 0 : value.errors.length > 0);
}

function validCoreReadyEnvelope(value, exitCode, responseContext) {
  const coreRequest = responseCoreRequest(responseContext, 'ready');
  if (coreRequest === null) return false;
  if (value?.valid === true) {
    return hasExactMembers(value, ['as_of', 'valid', 'ready'])
      && isCalendarDate(value.as_of)
      && (coreRequest === undefined || value.as_of === coreRequest.as_of)
      && validCoreRelationList(value.ready)
      && exitCode === 0;
  }
  return value?.valid === false
    && hasExactMembers(value, ['valid', 'errors'])
    && validValidationErrors(value.errors) && value.errors.length > 0 && exitCode === 1;
}

function validCoreCapabilitiesEnvelope(value, exitCode) {
  return verifyCoreProbe({
    core: {
      required_core_contract_version: CORE_CONTRACT_VERSION,
      commands: [...CORE_COMMAND_ORDER],
    },
    optional_features: {
      claims: value?.result?.operations?.work_claim?.supported === true,
      policy: false,
    },
  }, value).ok && exitCode === 0;
}

function validCoreReadEnvelope(value, command, exitCode, responseContext) {
  const coreRequest = responseCoreRequest(responseContext, command);
  if (coreRequest === null) return false;
  if (!plainObject(value)
    || value.command !== command || value.contract_version !== CORE_CONTRACT_VERSION) return false;
  if (value.ok === true) {
    return hasExactMembers(value, ['ok', 'command', 'contract_version', 'result'])
      && hasExactMembers(value.result, ['item'])
      && validCoreItemShape(value.result.item)
      && (coreRequest === undefined || value.result.item.id === coreRequest.id)
      && exitCode === 0;
  }
  return value.ok === false
    && hasExactMembers(value, ['ok', 'command', 'contract_version', 'error'])
    && validCoreErrorAtExit(value.error, command, exitCode, responseContext);
}

function validCoreItemShape(value) {
  if (!hasExactMembers(value, [
    'id', 'path', 'revision', 'source_encoding', 'source_media_type',
    'source_base64', 'core', 'body',
  ])) return false;
  if (!hasExactMembers(value.core, [
    'schema_version', 'id', 'title', 'kind', 'status', 'created', 'updated',
    'provenance', 'depends_on', 'related',
  ], [
    'parent', 'snoozed_until', 'completed', 'killed', 'archived', 'number',
    'priority', 'decisions',
  ])) return false;
  if (!WOWBAGGER_ID.test(value.id)
    || !isSafeLedgerDisplayPath(value.path)
    || !DIGEST.test(value.revision)
    || value.source_encoding !== 'base64'
    || value.source_media_type !== 'text/markdown; charset=utf-8'
    || typeof value.body !== 'string'
    || !validCoreView(value.core)) return false;
  const source = decodeCanonicalBase64(value.source_base64);
  if (source === null || sha256(source) !== value.revision) return false;
  const sourceText = decodeUtf8(source);
  if (sourceText === null) return false;
  const parsed = parseLedgerItemSource(sourceText);
  const sourceCore = parsed.error ? null : sourceCoreView(parsed.data);
  return sourceCore !== null
    && value.id === value.core.id
    && value.body === parsed.body
    && sameJson(value.core, sourceCore)
    && validReturnedItemSemantics(value.path, parsed.data);
}

function validCoreView(value) {
  if (!plainObject(value)
    || (value.schema_version !== 1 && value.schema_version !== 2)
    || !WOWBAGGER_ID.test(value.id)
    || !nonEmptyTrimmedString(value.title)
    || !new Set(['task', 'epic']).has(value.kind)
    || !new Set(['triage', 'backlog', 'in-progress', 'done', 'killed', 'archived']).has(value.status)
    || !isCalendarDate(value.created)
    || !isCalendarDate(value.updated)
    || value.updated < value.created
    || !hasExactMembers(value.provenance, ['source', 'recorded_at'])
    || !nonEmptyTrimmedString(value.provenance.source)
    || !isCoreRfc3339Utc(value.provenance.recorded_at)
    || !validCoreRelationList(value.depends_on)
    || !validCoreRelationList(value.related)) return false;

  for (const field of ['parent']) {
    if (Object.hasOwn(value, field) && !WOWBAGGER_ID.test(value[field])) return false;
  }
  for (const field of ['snoozed_until', 'completed', 'killed', 'archived']) {
    if (Object.hasOwn(value, field) && !isCalendarDate(value[field])) return false;
  }
  if (Object.hasOwn(value, 'number')
    && (!Number.isSafeInteger(value.number) || value.number < 1)) return false;
  if (Object.hasOwn(value, 'priority')
    && (!Number.isSafeInteger(value.priority) || value.priority < 0)) return false;
  if (!validCoreTerminalDates(value)) return false;
  return !Object.hasOwn(value, 'decisions') || validCoreDecisions(value.decisions);
}

function validCoreRelationList(value) {
  return Array.isArray(value)
    && value.every((id) => WOWBAGGER_ID.test(id))
    && new Set(value).size === value.length;
}

function validCoreTerminalDates(value) {
  const terminalFields = ['completed', 'killed', 'archived'];
  const required = { done: 'completed', killed: 'killed', archived: 'archived' }[value.status] ?? null;
  if (required === null) return terminalFields.every((field) => !Object.hasOwn(value, field));
  return terminalFields.every((field) => field === required
    ? Object.hasOwn(value, field) && value[field] === value.updated
    : !Object.hasOwn(value, field));
}

function validCoreDecisions(value) {
  if (!Array.isArray(value)) return false;
  return value.every((decision) => {
    if (!hasExactMembers(decision, ['action', 'date', 'summary', 'rationale'], ['rollup'])
      || !new Set([
        'accept', 'complete', 'kill', 'archive', 'restore', 'replace-dependency',
        'waive-dependency', 'reparent', 'record',
      ]).has(decision.action)
      || !isCalendarDate(decision.date)
      || !nonEmptyTrimmedString(decision.summary)
      || !nonEmptyTrimmedString(decision.rationale)) return false;
    if (!Object.hasOwn(decision, 'rollup')) return true;
    return Array.isArray(decision.rollup)
      && decision.rollup.every((entry) => hasExactMembers(entry, ['id', 'status'])
        && WOWBAGGER_ID.test(entry.id)
        && new Set(['done', 'killed']).has(entry.status));
  });
}

function sourceCoreView(data) {
  if (!plainObject(data)) return null;
  const core = {};
  for (const field of [
    'schema_version', 'id', 'title', 'kind', 'status', 'created', 'updated',
  ]) {
    if (!Object.hasOwn(data, field)) return null;
    core[field] = data[field];
  }
  if (!plainObject(data.provenance)
    || !Object.hasOwn(data.provenance, 'source')
    || !Object.hasOwn(data.provenance, 'recorded_at')
    || !Array.isArray(data.depends_on)
    || (Object.hasOwn(data, 'related') && !Array.isArray(data.related))) return null;
  core.provenance = {
    source: data.provenance.source,
    recorded_at: data.provenance.recorded_at,
  };
  core.depends_on = data.depends_on;
  core.related = data.related ?? [];
  for (const field of ['parent', 'snoozed_until', 'completed', 'killed', 'archived', 'number', 'priority']) {
    if (Object.hasOwn(data, field)) core[field] = data[field];
  }
  if (Object.hasOwn(data, 'decisions')) {
    if (!Array.isArray(data.decisions)) return null;
    core.decisions = [];
    for (const decision of data.decisions) {
      if (!plainObject(decision)
        || !['action', 'date', 'summary', 'rationale'].every((field) => Object.hasOwn(decision, field))) {
        return null;
      }
      const normalized = {
        action: decision.action,
        date: decision.date,
        summary: decision.summary,
        rationale: decision.rationale,
      };
      if (Object.hasOwn(decision, 'rollup')) {
        if (!Array.isArray(decision.rollup)) return null;
        normalized.rollup = [];
        for (const entry of decision.rollup) {
          if (!plainObject(entry)) return null;
          normalized.rollup.push({ id: entry.id, status: entry.status });
        }
      }
      core.decisions.push(normalized);
    }
  }
  return core;
}

function semanticSupportItems(data) {
  const parentIds = new Set();
  const referenceIds = new Set();
  const rollupChildren = new Map();
  if (Object.hasOwn(data, 'parent') && data.parent !== data.id) parentIds.add(data.parent);
  for (const relation of ['depends_on', 'related']) {
    for (const id of data[relation] ?? []) {
      if (id !== data.id) referenceIds.add(id);
    }
  }
  const rollup = matchingEpicRollup(data);
  for (const entry of rollup) {
    if (entry.id !== data.id && !rollupChildren.has(entry.id)) {
      rollupChildren.set(entry.id, entry.status);
    }
  }

  const ids = new Set([...parentIds, ...referenceIds, ...rollupChildren.keys()]);
  return [...ids].sort().map((id) => {
    if (parentIds.has(id)) return semanticSupportItem(id, { kind: 'epic' });
    if (rollupChildren.has(id)) {
      return semanticSupportItem(id, {
        status: rollupChildren.get(id),
        parent: data.id,
      });
    }
    return semanticSupportItem(id);
  });
}

function matchingEpicRollup(data) {
  if (data.kind !== 'epic' || data.status !== 'done' || !Array.isArray(data.decisions)) return [];
  const decision = data.decisions.find((candidate) => candidate?.action === 'complete'
    && candidate.date === data.completed && Array.isArray(candidate.rollup));
  return decision?.rollup ?? [];
}

function semanticSupportItem(id, { kind = 'task', status = 'backlog', parent = null } = {}) {
  const date = dateFromWowbaggerId(id);
  const terminal = {
    done: ['completed', 'complete'],
    killed: ['killed', 'kill'],
    archived: ['archived', 'archive'],
  }[status] ?? null;
  const data = {
    schema_version: 1,
    id,
    title: `Adapter semantic support ${id}`,
    kind,
    status,
    created: date,
    updated: date,
    provenance: {
      source: 'adapter-semantic-support',
      recorded_at: `${date}T00:00:00Z`,
    },
    depends_on: [],
    related: [],
    ...(parent === null ? {} : { parent }),
  };
  if (terminal) {
    const [field, action] = terminal;
    data[field] = date;
    data.decisions = [{
      action,
      date,
      summary: `Support ${action} decision.`,
      rationale: 'Synthetic relation support for adapter response validation.',
      ...(kind === 'epic' && status === 'done' ? { rollup: [] } : {}),
    }];
  }
  return { path: `.adapter-semantic-support/${id}.md`, data };
}

function dateFromWowbaggerId(id) {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let milliseconds = 0;
  for (const character of id.slice(3, 13)) {
    milliseconds = (milliseconds * 32) + alphabet.indexOf(character);
  }
  return new Date(milliseconds).toISOString().slice(0, 10);
}

function validReturnedItemSemantics(itemPath, data) {
  const ledger = {
    errors: [],
    items: [
      { path: itemPath, data },
      ...semanticSupportItems(data),
    ],
  };
  return !validateLedger(ledger).errors.some((internal) => internal.path === itemPath);
}

function validCoreMutationEnvelope(value, command, exitCode, responseContext) {
  const mutationRequest = responseMutationRequest(responseContext, command);
  const canonicalMutationRequest = hasCanonicalMutationRequest(responseContext, command);
  if (!plainObject(value)
    || value.command !== command || value.contract_version !== CORE_CONTRACT_VERSION) return false;
  if (value.ok === true) {
    return canonicalMutationRequest && value.state === 'committed'
      && hasExactMembers(value, ['ok', 'command', 'contract_version', 'state', 'result'])
      && hasExactMembers(value.result, ['item'])
      && validCoreItemShape(value.result.item)
      && validMutationResultCorrelation(value.result.item, command, mutationRequest)
      && exitCode === 0;
  }
  return value.ok === false
    && new Set(['unchanged', 'committed', 'unknown']).has(value.state)
    && hasExactMembers(value, ['ok', 'command', 'contract_version', 'state', 'error'])
    && validCoreErrorAtExit(value.error, command, exitCode, responseContext)
    && value.state === (MUTATION_ERROR_STATES.get(value.error.code) ?? 'unchanged');
}

function responseCoreRequest(responseContext, command) {
  if (responseContext === null || responseContext === undefined) return undefined;
  const coreRequest = responseContext.core_request;
  return plainObject(coreRequest) && coreRequest.command === command ? coreRequest : null;
}

function responseMutationInput(responseContext, command) {
  const coreRequest = responseCoreRequest(responseContext, command);
  if (coreRequest === undefined) return undefined;
  if (coreRequest === null || !isMutationCommand(command)) return null;
  if (!Object.hasOwn(responseContext, 'mutation_input')) return undefined;
  return responseContext.mutation_input instanceof Uint8Array
    ? responseContext.mutation_input
    : null;
}

function responseMutationRequest(responseContext, command) {
  const coreRequest = responseCoreRequest(responseContext, command);
  if (coreRequest === undefined) return undefined;
  if (coreRequest === null || !isMutationCommand(command)) return null;
  const mutationInput = responseMutationInput(responseContext, command);
  if (mutationInput !== undefined) {
    if (mutationInput === null) return null;
    const parsed = parseJsonRequest(mutationInput);
    return plainObject(parsed.value) ? parsed.value : null;
  }
  return plainObject(responseContext.mutation_request) ? responseContext.mutation_request : null;
}

function responseItemId(responseContext, command) {
  if (command === 'inspect') {
    const coreRequest = responseCoreRequest(responseContext, command);
    if (coreRequest === undefined) return undefined;
    return WOWBAGGER_ID.test(coreRequest?.id) ? coreRequest.id : null;
  }
  const mutationRequest = responseMutationRequest(responseContext, command);
  if (mutationRequest === undefined) return undefined;
  return WOWBAGGER_ID.test(mutationRequest?.id) ? mutationRequest.id : null;
}

function responseExpectedRevision(responseContext, command) {
  const mutationRequest = responseMutationRequest(responseContext, command);
  if (mutationRequest === undefined) return undefined;
  return (command === 'transition' || command === 'patch') && DIGEST.test(mutationRequest?.expected_revision)
    ? mutationRequest.expected_revision
    : null;
}

function expectedCreateCandidateRevision(responseContext, command) {
  if (command !== 'create') return null;
  const mutationRequest = responseMutationRequest(responseContext, command);
  if (mutationRequest === undefined) return undefined;
  if (!hasCanonicalMutationRequest(responseContext, command)) return null;
  try {
    return sha256(createCandidateSource(mutationRequest));
  } catch {
    return null;
  }
}

function hasCanonicalMutationRequest(responseContext, command) {
  const mutationInput = responseMutationInput(responseContext, command);
  if (mutationInput !== undefined) {
    if (mutationInput === null) return false;
    const parsed = parseJsonRequest(mutationInput);
    if (parsed.issues.length > 0 || !plainObject(parsed.value)) return false;
    if (command === 'create') return validateCreateRequest(parsed.value).length === 0;
    if (command === 'transition') return validateTransitionRequest(parsed.value).length === 0;
    if (command === 'patch') return validPatchRequest(parsed.value);
    return false;
  }
  const mutationRequest = responseMutationRequest(responseContext, command);
  if (mutationRequest === undefined) return true;
  if (!plainObject(mutationRequest)) return false;
  if (command === 'create') return validateCreateRequest(mutationRequest).length === 0;
  if (command === 'transition') return validateTransitionRequest(mutationRequest).length === 0;
  if (command === 'patch') return validPatchRequest(mutationRequest);
  return false;
}

function validMutationResultCorrelation(item, command, mutationRequest) {
  if (mutationRequest === undefined) return true;
  if (command === 'create') return validCreateResultCorrelation(item, mutationRequest);
  if (command === 'patch') return validPatchResultCorrelation(item, mutationRequest);
  return validTransitionResultCorrelation(item, mutationRequest);
}

function validCreateResultCorrelation(item, request) {
  if (!plainObject(request) || !plainObject(request.item)
    || item.id !== request.id || item.path !== `${request.id}.md` || item.body !== request.body
    || item.core.schema_version !== 1 || item.core.status !== 'triage'
    || item.core.title !== request.item.title || item.core.kind !== request.item.kind
    || !sameJson(item.core.provenance, {
      source: request.item.provenance?.source,
      recorded_at: request.item.provenance?.recorded_at,
    })
    || !sameJson(item.core.depends_on, request.item.depends_on)
    || !sameJson(item.core.related, request.item.related ?? [])) return false;
  for (const field of ['parent', 'snoozed_until']) {
    if (Object.hasOwn(item.core, field) !== Object.hasOwn(request.item, field)
      || (Object.hasOwn(item.core, field) && item.core[field] !== request.item[field])) return false;
  }
  if (['completed', 'killed', 'archived', 'decisions'].some((field) => Object.hasOwn(item.core, field))) {
    return false;
  }
  const source = decodeCanonicalBase64(item.source_base64);
  try {
    return source !== null && source.equals(createCandidateSource(request));
  } catch {
    return false;
  }
}

function validTransitionResultCorrelation(item, request) {
  return plainObject(request)
    && item.id === request.id
    && item.revision !== request.expected_revision
    && item.core.status === request.to_status
    && item.core.updated === request.date
    && (!Object.hasOwn(request, 'decision')
      || (plainObject(request.decision) && Array.isArray(item.core.decisions)
        && item.core.decisions.some((decision) => {
          const actions = request.to_status === 'backlog'
            ? new Set(['accept', 'restore'])
            : new Set(['complete', 'kill', 'archive']);
          return actions.has(decision.action)
            && decision.date === request.date
            && decision.summary === request.decision.summary
            && decision.rationale === request.decision.rationale;
        })));
}

function validPatchRequest(request) {
  if (!hasExactMembers(request, ['id', 'expected_revision', 'date', 'set'])
    || !WOWBAGGER_ID.test(request.id)
    || !DIGEST.test(request.expected_revision)
    || !isCalendarDate(request.date)
    || !hasExactMembers(request.set, [], ['number', 'priority'])
    || Object.keys(request.set).length === 0) return false;
  for (const [field, value] of Object.entries(request.set)) {
    if (value === null) continue;
    const minimum = field === 'number' ? 1 : 0;
    if (parsedIntegerValue(value, minimum) === undefined) return false;
  }
  return true;
}

function parsedIntegerValue(value, minimum) {
  if (Number.isSafeInteger(value) && value >= minimum) return value;
  if (value === null || typeof value !== 'object'
    || Object.getPrototypeOf(value)?.constructor?.name !== 'JsonNumber'
    || !hasExactMembers(value, ['source'])
    || typeof value.source !== 'string'
    || !/^(0|[1-9][0-9]*)$/.test(value.source)) return undefined;
  const parsed = Number(value.source);
  return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : undefined;
}

function validPatchResultCorrelation(item, request) {
  return validPatchRequest(request)
    && item.id === request.id
    && item.revision !== request.expected_revision
    && item.core.updated === request.date
    && Object.entries(request.set).every(([field, requested]) => {
      if (requested === null) return !Object.hasOwn(item.core, field);
      return item.core[field] === parsedIntegerValue(requested, field === 'number' ? 1 : 0);
    });
}

function validCoreErrorAtExit(value, command, exitCode, responseContext) {
  if (!hasExactMembers(value, ['code', 'message', 'details'])
    || !CORE_ERROR_CODES_BY_COMMAND[command]?.has(value.code)
    || CORE_ERROR_EXIT_CODES.get(value.code) !== exitCode
    || !coreErrorMessageMatches(value.code, command, value.message)) return false;
  return validCoreErrorDetails(value.code, value.details, command, responseContext);
}

function coreErrorMessageMatches(code, command, message) {
  const expected = {
    'item-not-found': 'The requested item was not found.',
    'ledger-invalid': 'The configured ledger is invalid.',
    'transition-precondition-failed': 'The requested lifecycle transition failed its preconditions.',
    'patch-precondition-failed': 'The requested patch failed its preconditions.',
    'candidate-invalid': 'The proposed item would make the ledger invalid.',
    'items-directory-unavailable': 'The configured items directory is unavailable.',
    'revision-conflict': 'The item changed after it was inspected.',
    'lock-held': 'The item is locked by another cooperative Wowbagger writer.',
    'id-collision': 'The requested item ID already exists.',
    'path-collision': 'The default item path is occupied by a different item.',
    'atomic-scope-required': 'The requested transition requires multi-item atomicity.',
    'capability-unavailable': 'Atomic no-clobber publication is unavailable for this ledger.',
    'operation-failed': 'The mutation operation failed before a commit was established.',
    'post-commit-recovery-required': 'The item was committed, but cleanup requires recovery.',
    'write-outcome-unknown': `The ${command} publication outcome could not be verified.`,
  }[code] ?? `The ${command} request is invalid.`;
  return message === expected;
}

function validCoreErrorDetails(code, details, command, responseContext) {
  const expectedItemId = responseItemId(responseContext, command);
  const expectedRevision = responseExpectedRevision(responseContext, command);
  const expectedCreateRevision = expectedCreateCandidateRevision(responseContext, command);
  const matchesItemId = (id) => expectedItemId === undefined || id === expectedItemId;
  if (code !== 'invalid-request' && !hasCanonicalMutationRequest(responseContext, command)) {
    return false;
  }
  switch (code) {
    case 'invalid-request': return !hasCanonicalMutationRequest(responseContext, command)
      && validInvalidRequestDetails(details);
    case 'item-not-found': return hasExactMembers(details, ['id'])
      && WOWBAGGER_ID.test(details.id) && matchesItemId(details.id);
    case 'ledger-invalid': return hasExactMembers(details, ['validation_errors'])
      && validValidationErrors(details.validation_errors) && details.validation_errors.length > 0;
    case 'transition-precondition-failed': return hasExactMembers(details, ['id', 'issues'])
      && WOWBAGGER_ID.test(details.id) && matchesItemId(details.id)
      && validTransitionIssues(details.issues) && details.issues.length > 0;
    case 'patch-precondition-failed': return hasExactMembers(details, ['id', 'issues'])
      && WOWBAGGER_ID.test(details.id) && matchesItemId(details.id)
      && validPatchIssues(details.issues) && details.issues.length > 0;
    case 'candidate-invalid': return hasExactMembers(details, ['id', 'validation_errors'])
      && WOWBAGGER_ID.test(details.id) && matchesItemId(details.id)
      && validValidationErrors(details.validation_errors) && details.validation_errors.length > 0;
    case 'revision-conflict': return hasExactMembers(details, [
      'id', 'expected_revision', 'actual_revision',
    ]) && WOWBAGGER_ID.test(details.id) && matchesItemId(details.id)
      && DIGEST.test(details.expected_revision) && DIGEST.test(details.actual_revision)
      && details.actual_revision !== details.expected_revision
      && (expectedRevision === undefined || details.expected_revision === expectedRevision);
    case 'lock-held': return validLockHeldDetails(details) && matchesItemId(details.id);
    case 'id-collision': return hasExactMembers(details, ['id', 'path', 'actual_revision'])
      && WOWBAGGER_ID.test(details.id) && matchesItemId(details.id)
      && isSafeLedgerDisplayPath(details.path)
      && DIGEST.test(details.actual_revision);
    case 'path-collision': return validPathCollisionDetails(details) && matchesItemId(details.id)
      && (command !== 'create' || expectedItemId === undefined
        || details.path === `${expectedItemId}.md`);
    case 'atomic-scope-required': return hasExactMembers(details, [
      'id', 'blockers', 'precondition_issues',
    ]) && WOWBAGGER_ID.test(details.id) && matchesItemId(details.id)
      && validTransitionBlockers(details.blockers)
      && validTransitionIssues(details.precondition_issues);
    case 'items-directory-unavailable': return validItemsDirectoryDetails(details)
      && matchesItemId(details.id);
    case 'capability-unavailable': return validCapabilityUnavailableDetails(details);
    case 'operation-failed': return validOperationFailedDetails(details) && matchesItemId(details.id);
    case 'post-commit-recovery-required': return hasExactMembers(details, [
      'id', 'revision', 'recovery_artifacts', 'recovery_artifacts_truncated',
    ]) && WOWBAGGER_ID.test(details.id) && matchesItemId(details.id) && DIGEST.test(details.revision)
      && (command !== 'create' || expectedCreateRevision === undefined
        || details.revision === expectedCreateRevision)
      && ((command !== 'transition' && command !== 'patch')
        || expectedRevision === undefined || details.revision !== expectedRevision)
      && validRecoveryArtifacts(details.recovery_artifacts, details.recovery_artifacts_truncated);
    case 'write-outcome-unknown': return hasExactMembers(details, [
      'id', 'recovery_artifacts', 'recovery_artifacts_truncated',
    ]) && WOWBAGGER_ID.test(details.id) && matchesItemId(details.id)
      && validRecoveryArtifacts(details.recovery_artifacts, details.recovery_artifacts_truncated);
    default: return false;
  }
}

function validInvalidRequestDetails(value) {
  return hasExactMembers(value, ['issues']) && Array.isArray(value.issues) && value.issues.length > 0
    && value.issues.every((issue) => hasExactMembers(issue, ['path', 'code', 'message'])
      && isJsonPointer(issue.path)
      && INVALID_REQUEST_CODES.has(issue.code)
      && nonEmptyControlFreeString(issue.message))
    && isOrdered(value.issues, compareInvalidRequestIssues);
}

function compareInvalidRequestIssues(left, right) {
  return compareText(left.path, right.path)
    || compareText(left.code, right.code)
    || compareText(left.message, right.message);
}

// A date refusal carries the item's own dates; every other code keeps the
// four-member shape. The member set is exact in both directions, so a missing
// date member and a stray one are equally refused.
function issueMembers(code) {
  return DATE_ISSUE_CODES.has(code)
    ? ['code', 'field', 'message', 'related_ids', 'item_created', 'item_updated']
    : ['code', 'field', 'message', 'related_ids'];
}

function validIssueDates(issue) {
  return !DATE_ISSUE_CODES.has(issue.code)
    || (isCalendarDate(issue.item_created) && isCalendarDate(issue.item_updated)
      && issue.item_created <= issue.item_updated);
}

function validTransitionIssues(value) {
  if (!Array.isArray(value)) return false;
  return value.every((issue) => hasExactMembers(issue, issueMembers(issue?.code))
    && Object.hasOwn(TRANSITION_ISSUE_MESSAGES, issue.code)
    && issue.field === TRANSITION_ISSUE_FIELDS[issue.code]
    && issue.message === TRANSITION_ISSUE_MESSAGES[issue.code]
    && validIssueDates(issue)
    && validSortedUniqueIds(issue.related_ids))
    && isOrdered(value, compareTransitionIssues);
}

function validPatchIssues(value) {
  if (!Array.isArray(value)) return false;
  return value.every((issue) => hasExactMembers(issue, issueMembers(issue?.code))
    && Object.hasOwn(PATCH_ISSUE_MESSAGES, issue.code)
    && issue.field === 'date'
    && issue.message === PATCH_ISSUE_MESSAGES[issue.code]
    && validIssueDates(issue)
    && sameJson(issue.related_ids, []))
    && isOrdered(value, compareTransitionIssues);
}

function compareTransitionIssues(left, right) {
  return compareText(left.code, right.code)
    || compareText(left.field, right.field)
    || compareText(left.related_ids.join('\0'), right.related_ids.join('\0'));
}

function validTransitionBlockers(value) {
  if (!Array.isArray(value) || value.length === 0) return false;
  const seen = new Set();
  for (const [index, blocker] of value.entries()) {
    if (!hasExactMembers(blocker, ['code', 'item_id', 'field'])
      || !Object.hasOwn(TRANSITION_BLOCKER_FIELDS, blocker.code)
      || !WOWBAGGER_ID.test(blocker.item_id)
      || blocker.field !== TRANSITION_BLOCKER_FIELDS[blocker.code]
      || (index > 0 && compareTransitionBlockers(value[index - 1], blocker) > 0)) return false;
    const key = `${blocker.code}\0${blocker.item_id}\0${blocker.field}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

function compareTransitionBlockers(left, right) {
  return compareText(left.code, right.code)
    || compareText(left.item_id, right.item_id)
    || compareText(left.field, right.field);
}

function validLockHeldDetails(value) {
  if (!hasExactMembers(value, ['id', 'lock_path', 'owner', 'owner_diagnostic'])
    || !WOWBAGGER_ID.test(value.id)
    || value.lock_path !== `.wowbagger-locks/${value.id}.lock`) return false;
  const diagnostics = new Set(['too-large', 'invalid-utf8', 'duplicate-key', 'invalid-json', 'invalid-shape']);
  if (value.owner === null) return diagnostics.has(value.owner_diagnostic);
  return value.owner_diagnostic === null
    && hasExactMembers(value.owner, ['lock_version', 'item_id', 'operation', 'writer_id', 'started_at'])
    && value.owner.lock_version === 1
    && value.owner.item_id === value.id
    && new Set(['create', 'transition', 'patch']).has(value.owner.operation)
    && typeof value.owner.writer_id === 'string'
    && /^[\x21-\x7e]{1,128}$/.test(value.owner.writer_id)
    && isCoreRfc3339Utc(value.owner.started_at);
}

function validPathCollisionDetails(value) {
  if (!hasExactMembers(value, ['id', 'path', 'occupant_kind'], ['occupying_id'])
    || !WOWBAGGER_ID.test(value.id)
    || !isSafeLedgerDisplayPath(value.path)
    || !new Set(['item', 'directory']).has(value.occupant_kind)) return false;
  return value.occupant_kind === 'item'
    ? Object.hasOwn(value, 'occupying_id') && WOWBAGGER_ID.test(value.occupying_id)
    : !Object.hasOwn(value, 'occupying_id');
}

// The configured items directory is ledger setup, not a request member: the
// refusal names the ledger-relative directory and the operator action that
// makes create possible.
function validItemsDirectoryDetails(value) {
  if (!hasExactMembers(value, ['id', 'path', 'reason', 'remediation'])
    || !WOWBAGGER_ID.test(value.id)
    || !isSafeLedgerDirectoryPath(value.path)
    || !new Set(['absent', 'not-a-directory']).has(value.reason)
    || typeof value.remediation !== 'string') return false;
  return value.remediation.includes(value.path) && value.remediation.includes('create');
}

function validCapabilityUnavailableDetails(value) {
  return hasExactMembers(value, [
    'capability', 'reason', 'recovery_artifacts', 'recovery_artifacts_truncated',
  ]) && value.capability === 'atomic-no-clobber-publication'
    && value.reason === 'filesystem-primitive-unavailable'
    && validRecoveryArtifacts(value.recovery_artifacts, value.recovery_artifacts_truncated);
}

function validOperationFailedDetails(value) {
  if (!hasExactMembers(value, [
    'id', 'operation', 'reason', 'recovery_artifacts', 'recovery_artifacts_truncated',
  ]) || !WOWBAGGER_ID.test(value.id)
    || !new Set([
      'lock-closure', 'prepare-temporary', 'sync-temporary', 'publish',
      'verify-publication', 'cleanup',
    ]).has(value.operation)
    || !new Set(['retry-limit-exhausted', 'io-error', 'verification-failed']).has(value.reason)
    || !validRecoveryArtifacts(value.recovery_artifacts, value.recovery_artifacts_truncated)) return false;
  return (value.reason !== 'retry-limit-exhausted' || value.operation === 'lock-closure')
    && (value.reason !== 'verification-failed'
      || value.operation === 'publish' || value.operation === 'verify-publication');
}

function validRecoveryArtifacts(value, truncated) {
  if (!Array.isArray(value) || typeof truncated !== 'boolean' || value.length > 16
    || (truncated && value.length !== 16)) return false;
  const seen = new Set();
  for (const artifact of value) {
    if (!hasExactMembers(artifact, ['path', 'kind', 'sha256', 'size_bytes'])
      || !isSafeArtifactPath(artifact.path)
      || !new Set(['temporary-file', 'lock-file', 'final-item']).has(artifact.kind)) return false;
    const readable = DIGEST.test(artifact.sha256) && isNonNegativeSafeInteger(artifact.size_bytes);
    if (!readable && !(artifact.sha256 === null && artifact.size_bytes === null)) return false;
    const key = artifact.path;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return isOrdered(value, compareRecoveryArtifacts);
}

function compareRecoveryArtifacts(left, right) {
  return compareText(left.path, right.path) || compareText(left.kind, right.kind);
}

function validSortedUniqueIds(value) {
  return Array.isArray(value)
    && value.every((id) => WOWBAGGER_ID.test(id))
    && new Set(value).size === value.length
    && value.every((id, index) => index === 0 || value[index - 1] < id);
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function envelopeState(process, command = null, responseContext = null) {
  const bytes = decodeCanonicalBase64(process?.stdout_base64);
  if (bytes === null) return { present: false, valid: false };
  const parsed = parseJsonRequest(bytes);
  const value = parsed.issues.length === 0
    ? normalizeJsonValue(parsed.value)
    : null;
  const valid = hasRequiredFinalLf(bytes) && parsed.issues.length === 0
    && validCoreCommandEnvelope(value, command, process?.exit_code, responseContext);
  return {
    present: bytes.length > 0,
    valid,
    mutation_state: valid && isMutationCommand(command)
      ? value.state
      : null,
  };
}

function validCoreCommandEnvelope(value, command, exitCode, responseContext) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  if (command === 'validate') return validCoreValidateEnvelope(value, exitCode);
  if (command === 'ready') return validCoreReadyEnvelope(value, exitCode, responseContext);
  if (command === 'capabilities') return validCoreCapabilitiesEnvelope(value, exitCode);
  if (command === 'inspect') return validCoreReadEnvelope(value, command, exitCode, responseContext);
  if (isMutationCommand(command)) {
    return validCoreMutationEnvelope(value, command, exitCode, responseContext);
  }
  return false;
}

function processSummary(process, command, responseContext) {
  const envelope = envelopeState(process, command, responseContext);
  return {
    started: process?.started ?? null,
    process_tree_contained: process?.process_tree_contained ?? null,
    orphaned: process?.orphaned ?? null,
    exit_code: process?.exit_code ?? null,
    signal: process?.signal ?? null,
    timed_out: process?.timed_out ?? null,
    stdout_complete: process?.stdout_complete ?? null,
    stderr_complete: process?.stderr_complete ?? null,
    core_envelope_present: envelope.present,
    core_envelope_valid: envelope.valid,
  };
}

function capturedStreamsOverLimit(process, stdoutLimit, stderrLimit) {
  const streams = [];
  for (const [stream, limit] of [
    ['stdout', stdoutLimit],
    ['stderr', stderrLimit],
  ]) {
    if (limit === undefined) continue;
    if (!isNonNegativeSafeInteger(limit)) return ['stdout', 'stderr'];
    const bytes = decodeCanonicalBase64(process[`${stream}_base64`]);
    if (bytes !== null && bytes.length > limit) streams.push(stream);
  }
  return streams;
}

function mutationUnknown(base, command, itemId, expectedRevision, process, processIssue, responseContext) {
  const recovery = command === 'create'
    ? {
        action: 'inspect-caller-known-id',
        validate_ledger_first: true,
        retry: 'only-after-item-not-found-and-audited-artifact-recovery',
      }
    : {
        action: 'validate-inspect-and-compare-revision',
        expected_revision: expectedRevision,
        retry: 'never-before-current-state-review',
      };
  const details = { command, item_id: itemId, recovery };
  if (processIssue) details.process_issue = processIssue;
  return {
    ...base,
    mutation_outcome: 'unknown',
    error: error('mutation-outcome-unknown', details),
    process: processSummary(process, command, responseContext),
  };
}

export function mapProcessOutcome({
  adapter_contract_version: adapterContractVersion,
  request_id: requestId,
  command,
  core_request: coreRequest = null,
  mutation_request: mutationRequest = null,
  mutation_input: mutationInput,
  item_id: itemId,
  expected_revision: expectedRevision,
  stdout_limit_bytes: stdoutLimit,
  stderr_limit_bytes: stderrLimit,
  process,
}) {
  const base = { ok: false, adapter_contract_version: adapterContractVersion, request_id: requestId };
  const mutation = isMutationCommand(command);
  const responseContext = coreRequest === null
    ? null
    : {
        core_request: coreRequest,
        mutation_request: mutationRequest,
        ...(mutationInput === undefined ? {} : { mutation_input: mutationInput }),
      };
  const issue = observationIssue(process);
  if (issue) {
    // A contradicted or unsigned observation on a mutation can never prove the
    // mutation did not apply, so it is always outcome-unknown. The launchState
    // 'not-started' is only reachable when issue is null (a clean non-start), so
    // every truthy issue on a mutation maps to unknown regardless of `started`.
    if (mutation) {
      return mutationUnknown(base, command, itemId, expectedRevision, process, issue, responseContext);
    }
    return {
      ...base,
      error: error('core-observation-incomplete', { reason: 'invalid-process-observation', member: issue }),
      process: processSummary(process, command, responseContext),
    };
  }
  if (!process.started) {
    return { ...base, error: error('core-launch-failed', {}), process: processSummary(process, command, responseContext) };
  }
  const envelope = envelopeState(process, command, responseContext);
  const overLimitStreams = capturedStreamsOverLimit(process, stdoutLimit, stderrLimit);
  const ambiguous = process.timed_out || process.signal !== null
    || !process.process_tree_contained || process.orphaned
    || !process.stdout_complete || !process.stderr_complete || overLimitStreams.length > 0
    || !envelope.present || !envelope.valid
    || envelope.mutation_state === 'unknown';
  if (mutation && ambiguous) {
    return mutationUnknown(base, command, itemId, expectedRevision, process, null, responseContext);
  }
  if (process.timed_out) {
    return { ...base, error: error('core-timeout', {}), process: processSummary(process, command, responseContext) };
  }
  if (process.signal !== null) {
    return { ...base, error: error('core-signaled', { signal: process.signal }), process: processSummary(process, command, responseContext) };
  }
  if (!process.process_tree_contained || process.orphaned) {
    return { ...base, error: error('core-observation-incomplete', {}), process: processSummary(process, command, responseContext) };
  }
  if (!process.stdout_complete || !process.stderr_complete || overLimitStreams.length > 0) {
    const streams = new Set(overLimitStreams);
    if (!process.stdout_complete) streams.add('stdout');
    if (!process.stderr_complete) streams.add('stderr');
    return {
      ...base,
      error: error('output-limit-exceeded', { streams: [...streams] }),
      process: processSummary(process, command, responseContext),
    };
  }
  if (!envelope.present || !envelope.valid) {
    return {
      ...base,
      error: error('core-protocol-error', { envelope_present: envelope.present, envelope_valid: envelope.valid }),
      process: processSummary(process, command, responseContext),
    };
  }
  return null;
}
