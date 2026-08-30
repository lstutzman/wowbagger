// src/claim-request.js
// Schema validation for work-claim requests (docs/work-claim-contract.md section 5).
// This intentionally re-implements the rules test/work-claim-reference.js's
// requestSchemaError encodes for the reference model — production code must not
// depend on test code, so the rules are duplicated here rather than imported.
import { pointer } from './request.js';
import { validateLedgerRepairRequest } from './ledger-repair.js';

const NAMESPACE_ID = /^wbns_[a-f0-9]{32}$/;
const ITEM_ID = /^wb_[0-9A-HJKMNP-TV-Z]{26}$/;
const OWNER_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const UTC_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/;
const REVISION = /^sha256:[0-9a-f]{64}$/;
const MAX_EPOCH = 18446744073709551615n;
const MAX_LEASE_DURATION_MS = 86400000;

const REQUIRED_MEMBERS = {
  read: ['ledger_namespace', 'item_id'],
  acquire: ['ledger_namespace', 'item_id', 'owner_id', 'lease_duration_ms', 'expected'],
  renew: ['ledger_namespace', 'item_id', 'owner_id', 'epoch', 'expected_expires_at', 'lease_duration_ms'],
  release: ['ledger_namespace', 'item_id', 'owner_id', 'epoch', 'expected_expires_at'],
  'claim-adopt': ['ledger_namespace', 'item_id', 'from_revision', 'to_revision', 'adopted_by'],
};

// Returns an array of {path, code, message} issues (empty when the request is valid).
// The request must already be JSON-parsed and deep-normalized (plain objects/arrays,
// JsonNumber unwrapped) — this module only checks shape, not JSON syntax.
//
// `number-repair` is a ledger-repair request, not a work-claim one. It is
// answered here because the claim journal validates every entry it replays
// through this seam, so a repair request the journal accepts must be the exact
// request the command accepts. Its members are the repair domain's own.
export function validateClaimRequest(operation, request) {
  if (operation === 'number-repair') {
    return validateLedgerRepairRequest(request);
  }
  const required = REQUIRED_MEMBERS[operation];
  if (!isPlainObject(request)) {
    return [problem([], 'invalid-type', `The ${operation} request must be a JSON object.`)];
  }

  const actual = Object.keys(request).sort().join(',');
  const expected = [...required].sort().join(',');
  if (actual !== expected) {
    return [problem([], 'invalid-value', `The ${operation} request must have exactly: ${required.join(', ')}.`)];
  }

  const issues = [];
  if (!NAMESPACE_ID.test(request.ledger_namespace)) {
    issues.push(problem(['ledger_namespace'], 'invalid-value', 'Member ledger_namespace must match wbns_[a-f0-9]{32}.'));
  }
  if (!ITEM_ID.test(request.item_id)) {
    issues.push(problem(['item_id'], 'invalid-value', 'Member item_id must match wb_[0-9A-HJKMNP-TV-Z]{26}.'));
  }
  if (required.includes('owner_id') && !isOwnerId(request.owner_id)) {
    issues.push(problem(['owner_id'], 'invalid-value', 'Member owner_id must match [A-Za-z0-9][A-Za-z0-9._:/-]{0,127}.'));
  }
  if (required.includes('epoch') && !isCanonicalUint64(request.epoch, false)) {
    issues.push(problem(['epoch'], 'invalid-value', 'Member epoch must be a canonical unsigned-64 decimal string.'));
  }
  if (required.includes('expected_expires_at') && !isStrictUtcInstant(request.expected_expires_at)) {
    issues.push(problem(['expected_expires_at'], 'invalid-value', 'Member expected_expires_at must match YYYY-MM-DDTHH:MM:SS.mmmZ.'));
  }
  if (required.includes('lease_duration_ms') && !isLeaseDuration(request.lease_duration_ms)) {
    issues.push(problem(['lease_duration_ms'], 'invalid-value', `Member lease_duration_ms must be an integer from 1 through ${MAX_LEASE_DURATION_MS}.`));
  }
  if (required.includes('expected')) {
    issues.push(...expectedIssues(request.expected));
  }
  if (required.includes('adopted_by') && !isOwnerId(request.adopted_by)) {
    issues.push(problem(['adopted_by'], 'invalid-value', 'Member adopted_by must match [A-Za-z0-9][A-Za-z0-9._:/-]{0,127}.'));
  }
  for (const member of ['from_revision', 'to_revision']) {
    if (required.includes(member) && !isRevision(request[member])) {
      issues.push(problem([member], 'invalid-value', `Member ${member} must match sha256:[0-9a-f]{64}.`));
    }
  }
  // Adopting the revision already authorized is not a no-op request, it is a
  // confused one: the operator either read a stale witness or means a different
  // revision. Refuse instead of journaling an adoption that rules nothing.
  if (required.includes('from_revision') && request.from_revision === request.to_revision) {
    issues.push(problem(['to_revision'], 'invalid-value', 'Member to_revision must differ from from_revision.'));
  }
  return issues;
}

function expectedIssues(expected) {
  if (!isPlainObject(expected)) {
    return [problem(['expected'], 'invalid-value', 'Member expected must be an object with exactly last_epoch and active.')];
  }
  const keys = Object.keys(expected).sort().join(',');
  if (keys !== 'active,last_epoch') {
    return [problem(['expected'], 'invalid-value', 'Member expected must have exactly last_epoch and active.')];
  }

  const issues = [];
  if (!isCanonicalUint64(expected.last_epoch, true)) {
    issues.push(problem(['expected', 'last_epoch'], 'invalid-value', 'Member expected.last_epoch must be a canonical unsigned-64 decimal string.'));
  }
  const active = expected.active;
  if (active !== null) {
    if (!isPlainObject(active)) {
      issues.push(problem(['expected', 'active'], 'invalid-value', 'Member expected.active must be null or an object.'));
      return issues;
    }
    const activeKeys = Object.keys(active).sort().join(',');
    if (activeKeys !== 'epoch,expires_at,issued_at,owner_id') {
      issues.push(problem(['expected', 'active'], 'invalid-value', 'Member expected.active must have exactly owner_id, epoch, issued_at, and expires_at.'));
      return issues;
    }
    if (!isOwnerId(active.owner_id)) {
      issues.push(problem(['expected', 'active', 'owner_id'], 'invalid-value', 'Member expected.active.owner_id must match [A-Za-z0-9][A-Za-z0-9._:/-]{0,127}.'));
    }
    if (!isCanonicalUint64(active.epoch, false)) {
      issues.push(problem(['expected', 'active', 'epoch'], 'invalid-value', 'Member expected.active.epoch must be a canonical unsigned-64 decimal string.'));
    }
    if (!isStrictUtcInstant(active.issued_at)) {
      issues.push(problem(['expected', 'active', 'issued_at'], 'invalid-value', 'Member expected.active.issued_at must match YYYY-MM-DDTHH:MM:SS.mmmZ.'));
    }
    if (!isStrictUtcInstant(active.expires_at)) {
      issues.push(problem(['expected', 'active', 'expires_at'], 'invalid-value', 'Member expected.active.expires_at must match YYYY-MM-DDTHH:MM:SS.mmmZ.'));
    }
  }
  return issues;
}

function isOwnerId(value) {
  return typeof value === 'string' && OWNER_ID.test(value);
}

function isRevision(value) {
  return typeof value === 'string' && REVISION.test(value);
}

function isCanonicalUint64(value, allowZero) {
  const pattern = allowZero ? /^(0|[1-9][0-9]{0,19})$/ : /^[1-9][0-9]{0,19}$/;
  if (typeof value !== 'string' || !pattern.test(value)) {
    return false;
  }
  try {
    return BigInt(value) <= MAX_EPOCH;
  } catch {
    return false;
  }
}

function isStrictUtcInstant(value) {
  const match = typeof value === 'string' ? UTC_INSTANT.exec(value) : null;
  if (!match) {
    return false;
  }
  const [, year, month, day, hour, minute, second, millis] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millis));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    && date.getUTCHours() === hour && date.getUTCMinutes() === minute && date.getUTCSeconds() === second
    && date.getUTCMilliseconds() === millis;
}

function isLeaseDuration(value) {
  return Number.isInteger(value) && value >= 1 && value <= MAX_LEASE_DURATION_MS;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function problem(location, code, message) {
  return { path: pointer(location), code, message };
}
