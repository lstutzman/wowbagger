// src/ledger-repair.js
// The `ledger-repair` domain at contract version 1: duplicate-number recovery
// for a ledger the ordinary mutation gate refuses. The domain is deliberately
// separate from the core contract (version 5) and the work-claim contract
// (version 1), so a repair request and a repair response are never read as
// either of those.
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { createHash } from 'node:crypto';

import { loadLedger } from './ledger.js';
import { pointer, sortIssues } from './request.js';
import { isCalendarDate, validateLedger } from './validate.js';

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


const STAGING_ID = /^[A-Za-z0-9_-]{1,80}$/;
const STAGING_RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/;

export function repairStagingPath(gitCommonDir, namespace, repairId) {
  assertStagingSegment(namespace, 'namespace');
  assertStagingSegment(repairId, 'repair_id');
  return path.join(
    path.resolve(gitCommonDir),
    'wowbagger',
    namespace,
    'repairs',
    repairId,
  );
}

export async function stageNumberRepairCandidates({
  gitCommonDir,
  namespace,
  repairId,
  ledgerSnapshotRevision,
  candidates,
}) {
  assertStagingSegment(namespace, 'namespace');
  assertStagingSegment(repairId, 'repair_id');
  if (!REVISION.test(ledgerSnapshotRevision) || !Array.isArray(candidates) || candidates.length === 0) {
    throw stagingInvalid('manifest-shape');
  }
  const root = repairStagingPath(gitCommonDir, namespace, repairId);
  const candidatesRoot = path.join(root, 'candidates');
  await ensureStagingDirectory(candidatesRoot, path.resolve(gitCommonDir));
  const manifestCandidates = [];
  const seenPaths = new Set();
  const seenItems = new Set();
  for (const candidate of candidates) {
    if (!isPlainObject(candidate)
      || !ITEM_ID.test(candidate.item_id)
      || seenItems.has(candidate.item_id)
      || typeof candidate.path !== 'string'
      || !STAGING_RELATIVE_PATH.test(candidate.path)
      || seenPaths.has(candidate.path)
      || !REVISION.test(candidate.candidate_revision)
      || !Buffer.isBuffer(candidate.candidate_bytes)) {
      throw stagingInvalid('candidate-shape');
    }
    const candidatePath = path.join(candidatesRoot, candidate.path);
    await ensureStagingDirectory(path.dirname(candidatePath), path.resolve(gitCommonDir));
    await writeExclusive(candidatePath, candidate.candidate_bytes);
    manifestCandidates.push({
      item_id: candidate.item_id,
      path: candidate.path,
      candidate_revision: candidate.candidate_revision,
      sha256: revisionOf(candidate.candidate_bytes),
      size: candidate.candidate_bytes.byteLength,
    });
    seenPaths.add(candidate.path);
    seenItems.add(candidate.item_id);
  }
  const manifest = {
    schema_version: 1,
    repair_id: repairId,
    ledger_snapshot_revision: ledgerSnapshotRevision,
    candidates: manifestCandidates,
  };
  await writeExclusive(
    path.join(root, 'manifest.json'),
    Buffer.from(`${JSON.stringify(manifest)}\n`),
  );
  await syncDirectory(root);
  return manifest;
}

export async function readStagedNumberRepair({
  gitCommonDir,
  namespace,
  repairId,
}) {
  const root = repairStagingPath(gitCommonDir, namespace, repairId);
  const manifestPath = path.join(root, 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw stagingInvalid(error?.code === 'ENOENT' ? 'staging-absent' : 'manifest-unreadable');
  }
  if (!isPlainObject(manifest)
    || manifest.schema_version !== 1
    || manifest.repair_id !== repairId
    || !REVISION.test(manifest.ledger_snapshot_revision)
    || !Array.isArray(manifest.candidates)
    || manifest.candidates.length === 0) {
    throw stagingInvalid('manifest-shape');
  }
  const candidates = [];
  const seenPaths = new Set();
  for (const entry of manifest.candidates) {
    if (!isPlainObject(entry)
      || !ITEM_ID.test(entry.item_id)
      || typeof entry.path !== 'string'
      || !STAGING_RELATIVE_PATH.test(entry.path)
      || seenPaths.has(entry.path)
      || !REVISION.test(entry.candidate_revision)
      || entry.sha256 !== entry.candidate_revision
      || !Number.isSafeInteger(entry.size)
      || entry.size < 0) {
      throw stagingInvalid('manifest-candidate');
    }
    const candidatePath = path.join(root, 'candidates', entry.path);
    let bytes;
    try {
      bytes = await readFile(candidatePath);
      const info = await stat(candidatePath);
      if (!info.isFile()) throw stagingInvalid('candidate-not-file');
    } catch (error) {
      if (error?.code === 'LEDGER_REPAIR_STAGING_INVALID') throw error;
      throw stagingInvalid('candidate-absent');
    }
    if (bytes.byteLength !== entry.size || revisionOf(bytes) !== entry.candidate_revision) {
      throw stagingInvalid('candidate-digest-mismatch');
    }
    candidates.push({ ...entry, candidate_bytes: bytes });
    seenPaths.add(entry.path);
  }
  return { manifest, candidates };
}

function assertStagingSegment(value, field) {
  if (typeof value !== 'string' || !STAGING_ID.test(value)) {
    throw stagingInvalid(`invalid-${field}`);
  }
}

async function ensureStagingDirectory(directory, boundary) {
  const relative = path.relative(boundary, directory);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw stagingInvalid('path-traversal');
  let current = boundary;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    await mkdir(current, { recursive: true });
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw stagingInvalid('symlink-directory');
  }
}

async function writeExclusive(file, bytes) {
  let handle;
  try {
    handle = await openNoFollow(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL);
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    if (error?.code === 'EEXIST') throw stagingInvalid('staging-already-exists');
    throw error;
  } finally {
    await handle?.close();
  }
  await syncDirectory(path.dirname(file));
}

async function openNoFollow(file, flags) {
  if (constants.O_NOFOLLOW !== undefined) return open(file, flags | constants.O_NOFOLLOW);
  const info = await lstat(file).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (info?.isSymbolicLink()) throw stagingInvalid('symlink-file');
  return open(file, flags);
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await open(directory, 'r');
    await handle.sync();
  } catch (error) {
    if (['EISDIR', 'EINVAL', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EPERM'].includes(error?.code)) return;
    throw error;
  } finally {
    await handle?.close();
  }
}

function stagingInvalid(reason) {
  const error = new Error('ledger repair staging is invalid');
  error.code = 'LEDGER_REPAIR_STAGING_INVALID';
  error.reason = reason;
  return error;
}
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
export async function numberRepair(request, options = {}) {
  const issues = validateLedgerRepairRequest(request);
  if (issues.length > 0) {
    return ledgerRepairInvalidRequest('number-repair', issues);
  }
  const ledger = await loadLedger(options.ledgerDirectory);
  const validation = validateLedger(ledger);
  const duplicateErrors = validation.errors.filter((error) => error.code === 'duplicate-number');
  if (duplicateErrors.length === 0
    || validation.errors.some((error) => error.code !== 'duplicate-number')) {
    return refusal(
      'number-repair',
      4,
      'ledger-repair-not-applicable',
      'The ledger is not blocked only by duplicate numbers.',
      { validation_errors: validation.errors },
    );
  }
  const actualSnapshot = ledgerSnapshotRevision(options.ledgerDirectory, ledger);
  if (actualSnapshot !== request.ledger_snapshot_revision) {
    return refusal(
      'number-repair',
      4,
      'ledger-repair-revision-conflict',
      'The ledger changed after the repair proposal was generated.',
      {
        expected_snapshot_revision: request.ledger_snapshot_revision,
        actual_snapshot_revision: actualSnapshot,
      },
    );
  }
  const itemsById = new Map(ledger.items.map((item) => [item.data.id, item]));
  for (const change of request.changes) {
    const item = itemsById.get(change.item_id);
    if (!item
      || revisionOf(item.bytes) !== change.expected_revision
      || item.data.number !== change.expected_number) {
      return refusal(
        'number-repair',
        4,
        'ledger-repair-revision-conflict',
        'A repair item witness no longer matches the ledger.',
        {
          item_id: change.item_id,
          expected_revision: change.expected_revision,
          actual_revision: item ? revisionOf(item.bytes) : null,
          expected_number: change.expected_number,
          actual_number: item?.data.number ?? null,
        },
      );
    }
  }
  const expectedChangedIds = new Set();
  const groupedItems = new Map();
  for (const item of ledger.items) {
    const number = item.data.number;
    if (!Number.isSafeInteger(number) || number < 1) continue;
    const members = groupedItems.get(number) ?? [];
    members.push(item);
    groupedItems.set(number, members);
  }
  for (const members of groupedItems.values()) {
    if (members.length < 2) continue;
    for (const item of members.sort((left, right) => compareText(left.data.id, right.data.id)).slice(1)) {
      expectedChangedIds.add(item.data.id);
    }
  }
  const requestedChangedIds = new Set(request.changes.map((change) => change.item_id));
  const missingItemIds = [...expectedChangedIds]
    .filter((itemId) => !requestedChangedIds.has(itemId))
    .sort(compareText);
  const unexpectedItemIds = [...requestedChangedIds]
    .filter((itemId) => !expectedChangedIds.has(itemId))
    .sort(compareText);
  if (missingItemIds.length > 0 || unexpectedItemIds.length > 0) {
    return refusal(
      'number-repair',
      4,
      'ledger-repair-mapping-incomplete',
      'The repair mapping must include exactly the movable item from every duplicate group.',
      { missing_item_ids: missingItemIds, unexpected_item_ids: unexpectedItemIds },
    );
  }
  const occupiedNumbers = new Map(
    ledger.items.map((item) => [item.data.number, item.data.id]),
  );
  const replacementOwners = new Map();
  for (const change of request.changes) {
    const occupiedBy = occupiedNumbers.get(change.replacement_number);
    if (occupiedBy && (occupiedBy === change.item_id || !changedIds.has(occupiedBy))) {
      return refusal(
        'number-repair',
        4,
        'ledger-repair-number-collision',
        'A replacement number belongs to an unchanged ledger item.',
        {
          item_id: change.item_id,
          replacement_number: change.replacement_number,
          occupied_by: occupiedBy,
        },
      );
    }
    const previous = replacementOwners.get(change.replacement_number);
    if (previous) {
      return refusal(
        'number-repair',
        4,
        'ledger-repair-number-collision',
        'Multiple repair items request the same replacement number.',
        {
          replacement_number: change.replacement_number,
          item_ids: [previous, change.item_id],
        },
      );
    }
    replacementOwners.set(change.replacement_number, change.item_id);
  }
  return stageNotInstalled('number-repair');
}

// The read-only proposal takes no request: the ledger it reads is the whole
// input, and it changes nothing.
export async function numberRepairProposal(ledgerDirectory) {
  const ledger = await loadLedger(ledgerDirectory);
  const validation = validateLedger(ledger);
  const duplicateErrors = validation.errors.filter((error) => error.code === 'duplicate-number');
  if (duplicateErrors.length === 0
    || validation.errors.some((error) => error.code !== 'duplicate-number')) {
    return refusal(
      'number-repair-proposal',
      4,
      'ledger-repair-not-applicable',
      'The ledger is not blocked only by duplicate numbers.',
      { validation_errors: validation.errors },
    );
  }

  const groups = new Map();
  for (const item of ledger.items) {
    const number = item.data.number;
    if (!Number.isSafeInteger(number) || number < 1) continue;
    const members = groups.get(number) ?? [];
    members.push(item);
    groups.set(number, members);
  }
  const duplicateGroups = [...groups.entries()]
    .filter(([, members]) => members.length > 1)
    .sort(([left], [right]) => left - right)
    .map(([number, members]) => ({
      number,
      item_ids: members.map((item) => item.data.id).sort(compareText),
    }));
  const affectedIds = new Set(duplicateGroups.flatMap((group) => group.item_ids));
  const affectedItems = ledger.items
    .filter((item) => affectedIds.has(item.data.id))
    .sort((left, right) => compareText(left.data.id, right.data.id));
  const highest = ledger.items.reduce(
    (current, item) => Number.isSafeInteger(item.data.number)
      ? Math.max(current, item.data.number)
      : current,
    0,
  );
  const preserved = new Set(
    duplicateGroups.map((group) => group.item_ids.slice().sort(compareText)[0]),
  );
  const moved = affectedItems
    .filter((item) => !preserved.has(item.data.id))
    .sort((left, right) => compareText(left.data.id, right.data.id));
  const suggestedChanges = moved.map((item, index) => ({
    item_id: item.data.id,
    expected_revision: revisionOf(item.bytes),
    expected_number: item.data.number,
    replacement_number: highest + index + 1,
  }));

  return {
    exit: 0,
    stdout: {
      ok: true,
      namespace: 'ledger-repair',
      command: 'number-repair-proposal',
      contract_version: LEDGER_REPAIR_CONTRACT_VERSION,
      state: 'unchanged',
      result: {
        ledger_snapshot_revision: ledgerSnapshotRevision(ledgerDirectory, ledger),
        duplicate_groups: duplicateGroups,
        items: affectedItems.map((item) => ({
          item_id: item.data.id,
          path: path.relative(path.resolve(ledgerDirectory), item.file),
          revision: revisionOf(item.bytes),
          number: item.data.number,
        })),
        suggested_changes: suggestedChanges,
        preserved_items: [...preserved].sort(compareText),
        references: affectedItems.map((item) => ({
          item_id: item.data.id,
          depends_on: item.data.depends_on ?? [],
          related: item.data.related ?? [],
          parent: item.data.parent ?? null,
        })),
        validation_errors: validation.errors,
      },
    },
  };
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function revisionOf(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function ledgerSnapshotRevision(ledgerDirectory, ledger) {
  const root = path.resolve(ledgerDirectory);
  const hash = createHash('sha256');
  for (const item of ledger.items.slice().sort((left, right) => (
    compareText(left.file, right.file)
  ))) {
    const relative = path.relative(root, item.file).split(path.sep).join('/');
    hash.update(relative);
    hash.update('\0');
    hash.update(item.bytes);
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
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
