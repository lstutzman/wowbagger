// src/ledger-repair.js
// The `ledger-repair` domain at contract version 1: duplicate-number recovery
// for a ledger the ordinary mutation gate refuses. The domain is deliberately
// separate from the core contract (version 5) and the work-claim contract
// (version 1), so a repair request and a repair response are never read as
// either of those.
import { pointer, sortIssues } from './request.js';
import { isCalendarDate } from './validate.js';

// The repair domain's own version. It is not the core contract version and not
// the work-claim contract version; a future change to the repair request or the
// repaired source shape requires a new version here rather than a silent
// reinterpretation of version 1.
export const LEDGER_REPAIR_CONTRACT_VERSION = 1;

const REQUEST_MEMBERS = ['repair_id', 'ledger_snapshot_revision', 'date', 'changes'];
const CHANGE_MEMBERS = ['item_id', 'expected_revision', 'expected_number', 'replacement_number'];
const REQUEST_MEMBER_SET = new Set(REQUEST_MEMBERS);
const CHANGE_MEMBER_SET = new Set(CHANGE_MEMBERS);
// A repair ID is a bounded, sortable operator handle: `nr_`, the repair date,
// and a four-digit sequence within that date.
const REPAIR_ID = /^nr_\d{8}_\d{4}$/;
const ITEM_ID = /^wb_[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const REVISION = /^sha256:[0-9a-f]{64}$/;

// Returns an array of {path, code, message} issues, sorted, and empty when the
// request is valid. The request must already be JSON-parsed and
// deep-normalized (plain objects/arrays, JsonNumber unwrapped) — this checks
// the request's own shape, never the ledger it names.
export function validateLedgerRepairRequest(request) {
  if (!isPlainObject(request)) {
    return [problem([], 'invalid-type', 'The number-repair request must be a JSON object.')];
  }
  const issues = [];
  for (const member of REQUEST_MEMBERS) {
    if (!Object.hasOwn(request, member)) {
      issues.push(problem([member], 'missing-member', `Required member ${member} is missing.`));
    }
  }
  for (const member of Object.keys(request)) {
    if (!REQUEST_MEMBER_SET.has(member)) {
      issues.push(problem([member], 'unknown-member', `Member ${member} is not allowed.`));
    }
  }
  if (Object.hasOwn(request, 'repair_id') && !REPAIR_ID.test(request.repair_id)) {
    issues.push(problem(['repair_id'], 'invalid-value', 'Member repair_id must match nr_YYYYMMDD_NNNN.'));
  }
  if (Object.hasOwn(request, 'ledger_snapshot_revision')
    && !REVISION.test(request.ledger_snapshot_revision)) {
    issues.push(problem(['ledger_snapshot_revision'], 'invalid-value', 'Member ledger_snapshot_revision must match sha256:[0-9a-f]{64}.'));
  }
  if (Object.hasOwn(request, 'date') && !isCalendarDate(request.date)) {
    issues.push(problem(['date'], 'invalid-value', 'Member date must be an ISO calendar date.'));
  }
  // A repair with no change is a confused request rather than a no-op, so an
  // empty mapping is refused before any entry is read.
  if (Object.hasOwn(request, 'changes')
    && (!Array.isArray(request.changes) || request.changes.length === 0)) {
    issues.push(problem(['changes'], 'invalid-value', 'Member changes must be a non-empty array of number changes.'));
  }
  if (Array.isArray(request.changes)) {
    issues.push(...changeIssues(request.changes));
  }
  return sortIssues(issues);
}

// The mutating apply entrypoint. The request contract is enforced here rather
// than in the CLI so the seam a host calls and the seam the command calls
// refuse identically.
export function numberRepair(request, options) {
  const issues = validateLedgerRepairRequest(request);
  if (issues.length > 0) {
    return ledgerRepairInvalidRequest('number-repair', issues);
  }
  return stageNotInstalled('number-repair');
}

// The read-only proposal takes no request: the ledger it reads is the whole
// input, and it changes nothing.
export function numberRepairProposal(ledgerDirectory) {
  return stageNotInstalled('number-repair-proposal');
}

// The repair domain's own refusal envelope. A consumer dispatches on
// `namespace` before it reads any version member, so a repair refusal is never
// read as a core version 5 or work-claim version 1 response.
export function ledgerRepairInvalidRequest(command, issues) {
  return refusal(command, 2, 'invalid-request', `The ${command} request is invalid.`, { issues });
}

// This build carries the ledger-repair version 1 request and response
// contracts, not the ledger reading, proposal, staging, and publication stages
// the two commands otherwise perform. The refusal states that rather than
// answering as though a repair had been considered: `state` is `unchanged`
// because nothing was read and nothing was written.
function stageNotInstalled(command) {
  return refusal(
    command,
    6,
    'capability-unavailable',
    'This build implements ledger-repair version 1 request validation only.',
    { reason: 'repair-stage-not-installed' },
  );
}

function refusal(command, exit, code, message, details) {
  return {
    exit,
    stdout: {
      ok: false,
      namespace: 'ledger-repair',
      command,
      contract_version: LEDGER_REPAIR_CONTRACT_VERSION,
      state: 'unchanged',
      error: { code, message, details },
    },
  };
}

// Every change is one item's number move. The entry carries its own witnesses,
// so a malformed entry is named by its index rather than collapsing the whole
// mapping into one issue. The repeat checks are request-internal: an item that
// moves twice, or two items that land on one number, make the applied result
// depend on entry order.
function changeIssues(changes) {
  const issues = [];
  const seenItemIds = new Set();
  const seenReplacements = new Set();
  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index];
    const location = ['changes', String(index)];
    if (!isPlainObject(change)) {
      issues.push(problem(location, 'invalid-type', 'Member changes entries must be JSON objects.'));
      continue;
    }
    for (const member of CHANGE_MEMBERS) {
      if (!Object.hasOwn(change, member)) {
        issues.push(problem([...location, member], 'missing-member', `Required member ${member} is missing.`));
      }
    }
    for (const member of Object.keys(change)) {
      if (!CHANGE_MEMBER_SET.has(member)) {
        issues.push(problem([...location, member], 'unknown-member', `Member ${member} is not allowed.`));
      }
    }
    if (Object.hasOwn(change, 'item_id')) {
      if (!ITEM_ID.test(change.item_id)) {
        issues.push(problem([...location, 'item_id'], 'invalid-value', 'Member item_id must be a canonical Wowbagger item ID.'));
      } else if (seenItemIds.has(change.item_id)) {
        issues.push(problem([...location, 'item_id'], 'invalid-value', 'Member item_id must not repeat within changes.'));
      }
      seenItemIds.add(change.item_id);
    }
    if (Object.hasOwn(change, 'expected_revision') && !REVISION.test(change.expected_revision)) {
      issues.push(problem([...location, 'expected_revision'], 'invalid-value', 'Member expected_revision must match sha256:[0-9a-f]{64}.'));
    }
    // The old number is a witness the apply path compares against the item's
    // own number, so a string is a mismatch rather than a spelling.
    if (Object.hasOwn(change, 'expected_number') && !isPositiveInteger(change.expected_number)) {
      issues.push(problem([...location, 'expected_number'], 'invalid-value', 'Member expected_number must be a positive integer.'));
    }
    if (Object.hasOwn(change, 'replacement_number')) {
      if (!isPositiveInteger(change.replacement_number)) {
        issues.push(problem([...location, 'replacement_number'], 'invalid-value', 'Member replacement_number must be a positive integer.'));
      } else if (seenReplacements.has(change.replacement_number)) {
        issues.push(problem([...location, 'replacement_number'], 'invalid-value', 'Member replacement_number must not repeat within changes.'));
      }
      seenReplacements.add(change.replacement_number);
    }
  }
  return issues;
}

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value >= 1;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function problem(location, code, message) {
  return { path: pointer(location), code, message };
}
