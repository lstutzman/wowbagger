import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { validateClaimRequest } from './claim-request.js';
import { isCalendarDate } from './validate.js';

import { advanceClockFloor, claimAcquire, claimRelease, claimRenew } from './claim-operations.js';
import { emptyClaimState } from './claim-store.js';

const MAX_JOURNAL_ENTRIES = 65536;
const MAX_JOURNAL_BYTES = 8388608;
const MAX_RECONCILE_LOG_BYTES = MAX_JOURNAL_BYTES + 1024;
const JOURNAL_ENTRY_TYPES = new Set([
  'claim',
  'clock',
  'legacy-mutation',
  'legacy-mutation-abort',
  'legacy-mutation-intent',
  'publish-final',
  'publish-finalization',
  'publish-intent',
  'revision-adoption',
  'number-repair-intent',
  'number-repair-final',
]);
// Every command the legacy mutation fence journals.
const LEGACY_MUTATION_COMMANDS = new Set(['patch-v1', 'transition-v1', 'create-v1']);
// The reconciliation log is a tracked derived artifact. Entry types that every
// invocation appends, including refusals and read-only verification, stay out
// of it so a mutation that changes nothing leaves the working tree unchanged.
const UNPROJECTED_ENTRY_TYPES = new Set(['clock', 'publish-finalization']);

// The one place that answers whether the reconciliation log carries an entry.
export function isProjectedJournalEntry(entry) {
  return !UNPROJECTED_ENTRY_TYPES.has(entry.type);
}

export function claimJournalPath(commonDir, namespace) {
  return path.join(commonDir, 'wowbagger', namespace, 'journal.ndjson');
}

export function claimReconcileLogPath(ledgerDirectory, namespace) {
  return path.join(ledgerDirectory, '.wowbagger', `reconcile-${namespace}.md`);
}

export async function appendClaimEntry(journalPath, entry) {
  const entries = await readJournalEntries(journalPath);
  if (entries.length >= MAX_JOURNAL_ENTRIES) throw journalCapacityExceeded();
  const persisted = { seq: entries.length + 1, ...entry };
  const line = `${JSON.stringify(persisted)}\n`;
  const existingBytes = await fileSize(journalPath);
  if (existingBytes + Buffer.byteLength(line) > MAX_JOURNAL_BYTES) throw journalCapacityExceeded();
  await ensureDurableJournal(journalPath);
  const handle = await open(journalPath, 'a');
  try {
    await handle.writeFile(line, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  return persisted;
}

export async function assertClaimJournalCapacity(journalPath, plannedEntries) {
  const entries = await readJournalEntries(journalPath);
  if (entries.length + plannedEntries.length > MAX_JOURNAL_ENTRIES) {
    throw journalCapacityExceeded();
  }
  let plannedBytes = await fileSize(journalPath);
  for (const [index, entry] of plannedEntries.entries()) {
    const persisted = { seq: entries.length + index + 1, ...entry };
    plannedBytes += Buffer.byteLength(`${JSON.stringify(persisted)}\n`);
  }
  if (plannedBytes > MAX_JOURNAL_BYTES) throw journalCapacityExceeded();
}

export async function replayClaimJournal(journalPath, namespace) {
  const entries = await readJournalEntries(journalPath, namespace);
  return { state: replayClaimEntries(entries, namespace), entries };
}

export function replayClaimEntries(entries, namespace) {
  let state = emptyClaimState(namespace);
  const operations = { acquire: claimAcquire, release: claimRelease, renew: claimRenew };
  for (const entry of entries) {
    if (entry.type === 'clock') {
      advanceClockFloor(state, entry.floor);
    } else if (entry.type === 'claim' && Object.hasOwn(operations, entry.command)) {
      state = operations[entry.command](state, entry.request, entry.physical_now).state;
    }
  }
  return state;
}

export async function writeReconcileLog(logPath, namespace, entries) {
  const mergeableEntries = entries.filter(isProjectedJournalEntry);
  const content = [
    `# Wowbagger reconciliation log \`${namespace}\``,
    '',
    'Derived from the authoritative common-directory journal. Preserve sequence order when merging.',
    '',
    '```jsonl',
    ...mergeableEntries.map((entry) => JSON.stringify(entry)),
    '```',
    '',
  ].join('\n');
  if (Buffer.byteLength(content) > MAX_RECONCILE_LOG_BYTES) throw journalCapacityExceeded();
  await mkdir(path.dirname(logPath), { recursive: true });
  const handle = await openNoFollow(logPath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export function parseReconcileLog(source, namespace) {
  const lines = source.toString('utf8').split('\n');
  const start = lines.indexOf('```jsonl');
  if (start < 0) return [];
  const end = lines.indexOf('```', start + 1);
  if (end < 0) return { error: { code: 'ambiguous-journal', reason: 'unterminated-jsonl-block' } };
  const entries = [];
  for (const line of lines.slice(start + 1, end)) {
    if (line.trim() === '') continue;
    try {
      const entry = JSON.parse(line);
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        return { error: { code: 'ambiguous-journal', reason: 'entry-not-object' } };
      }
      if (Object.hasOwn(entry, 'seq') && !validSequence(entry.seq)) {
        return { error: { code: 'ambiguous-journal', reason: 'sequence-out-of-range' } };
      }
      const entryNamespace = entry.ledger_namespace
        ?? entry.request?.ledger_namespace
        ?? entry.fence?.ledger_namespace;
      if (entryNamespace !== undefined && entryNamespace !== namespace) {
        return { error: { code: 'ambiguous-journal', reason: 'namespace-mismatch' } };
      }
      entries.push(entry);
    } catch {
      return { error: { code: 'ambiguous-journal', reason: 'entry-not-json' } };
    }
  }
  return entries;
}

// O_NOFOLLOW is undefined on win32, so the no-follow guarantee falls back to
// an lstat immediately before the open. The TOCTOU window that leaves is the
// platform's best available answer; the thrown code stays ELOOP so every
// existing symlink handler keeps working.
async function openNoFollow(file, flags) {
  if (constants.O_NOFOLLOW !== undefined) {
    return open(file, flags | constants.O_NOFOLLOW);
  }
  let info = null;
  try {
    info = await lstat(file);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (info?.isSymbolicLink()) {
    const error = new Error(`refusing to follow a symbolic link at ${file}`);
    error.code = 'ELOOP';
    throw error;
  }
  return open(file, flags);
}

async function readJournalEntries(journalPath, namespace = null) {
  let source;
  try {
    const info = await stat(journalPath);
    if (info.size > MAX_JOURNAL_BYTES) throw journalCapacityExceeded();
    source = await readFile(journalPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const lines = source.split('\n').filter(Boolean);
  if (lines.length > MAX_JOURNAL_ENTRIES) throw journalCapacityExceeded();
  const entries = lines.map((line) => JSON.parse(line));
  const createAttempts = new Map();
  const repairIntents = new Map();
  const repairFinals = new Set();
  for (let index = 0; index < entries.length; index += 1) {
    if (!Number.isSafeInteger(entries[index]?.seq) || entries[index].seq !== index + 1) {
      throw journalInvalid('non-contiguous-sequence');
    }
    if (!JOURNAL_ENTRY_TYPES.has(entries[index].type)) {
      throw journalInvalid('unknown-entry-type');
    }
    if (!validJournalEntry(entries[index], namespace)) {
      throw journalInvalid('invalid-entry');
    }
    if (!validCreateResolution(entries[index], createAttempts)) {
      throw journalInvalid('invalid-entry');
    }
    if (!validRepairResolution(entries[index], repairIntents, repairFinals)) {
      throw journalInvalid('invalid-entry');
    }
  }
  return entries;
}

async function ensureDurableJournal(journalPath) {
  const journalDirectory = path.dirname(journalPath);
  await mkdir(journalDirectory, { recursive: true });
  const directories = [
    path.dirname(path.dirname(journalDirectory)),
    path.dirname(journalDirectory),
    journalDirectory,
  ];
  for (const directory of new Set(directories)) {
    await syncDirectory(directory);
  }

  let handle;
  try {
    handle = await open(journalPath, 'ax');
  } catch (error) {
    if (error?.code === 'EEXIST') return;
    throw error;
  }
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(journalDirectory);
}

// Directory fsync is attempted and tolerated as unsupported, exactly like the
// mutation engine's syncDirectoryIfSupported: platforms without the primitive
// (win32 cannot open a directory handle) rely on their own metadata
// durability, and every other failure stays loud.
async function syncDirectory(directory) {
  let handle;
  try {
    handle = await open(directory, 'r');
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

async function fileSize(file) {
  try {
    return (await stat(file)).size;
  } catch (error) {
    if (error?.code === 'ENOENT') return 0;
    throw error;
  }
}

function journalCapacityExceeded() {
  const error = new Error('claim journal capacity exceeded');
  error.code = 'CLAIM_JOURNAL_CAPACITY';
  error.reason = 'journal-capacity-exceeded';
  return error;
}

function journalInvalid(reason) {
  const error = new Error('claim journal is invalid');
  error.code = 'CLAIM_JOURNAL_INVALID';
  error.reason = reason;
  return error;
}

// A committed sequence outside the journal's own capacity names no reachable
// journal position, so it fails closed here rather than reaching hydration,
// which would otherwise fill every absent position below it.
function validSequence(seq) {
  return Number.isSafeInteger(seq) && seq >= 1 && seq <= MAX_JOURNAL_ENTRIES;
}

function validJournalEntry(entry, namespace) {
  if (entry.type === 'clock') {
    return typeof entry.now === 'string' && typeof entry.floor === 'string';
  }
  if (entry.type === 'claim') {
    return ['acquire', 'read', 'release', 'renew'].includes(entry.command)
      && typeof entry.physical_now === 'string'
      && validateClaimRequest(entry.command, entry.request).length === 0
      && (namespace === null || entry.request.ledger_namespace === namespace);
  }
  if (entry.type === 'legacy-mutation-intent') {
    return typeof entry.attempt_id === 'string'
      && typeof entry.ledger_namespace === 'string'
      && (namespace === null || entry.ledger_namespace === namespace)
      && typeof entry.item_id === 'string'
      && LEGACY_MUTATION_COMMANDS.has(entry.command)
      && (entry.command === 'create-v1'
        ? entry.expected_revision === null
        : typeof entry.expected_revision === 'string')
      && typeof entry.candidate_revision === 'string'
      && (!Object.hasOwn(entry, 'item_path') || typeof entry.item_path === 'string')
      && (!Object.hasOwn(entry, 'writer_worktree_id')
        || typeof entry.writer_worktree_id === 'string')
      && typeof entry.observed_at === 'string';
  }
  if (entry.type === 'legacy-mutation') {
    return (!Object.hasOwn(entry, 'attempt_id') || typeof entry.attempt_id === 'string')
      && typeof entry.ledger_namespace === 'string'
      && (namespace === null || entry.ledger_namespace === namespace)
      && typeof entry.item_id === 'string'
      && LEGACY_MUTATION_COMMANDS.has(entry.command)
      && typeof entry.committed_revision === 'string'
      && (!Object.hasOwn(entry, 'item_path') || typeof entry.item_path === 'string')
      && (!Object.hasOwn(entry, 'writer_worktree_id')
        || typeof entry.writer_worktree_id === 'string')
      && typeof entry.observed_at === 'string';
  }
  if (entry.type === 'legacy-mutation-abort') {
    // A create abort names no predecessor revision, so the absence of one is
    // its evidence. Patch and transition aborts keep their exact legacy shape
    // and never carry a command.
    const validAbortRevision = (
      !Object.hasOwn(entry, 'command') && typeof entry.observed_revision === 'string'
    ) || (
      entry.command === 'create-v1' && entry.observed_revision === null
    );
    return typeof entry.attempt_id === 'string'
      && typeof entry.ledger_namespace === 'string'
      && (namespace === null || entry.ledger_namespace === namespace)
      && typeof entry.item_id === 'string'
      && validAbortRevision
      && typeof entry.observed_at === 'string';
  }
  if (entry.type === 'revision-adoption') {
    return typeof entry.ledger_namespace === 'string'
      && (namespace === null || entry.ledger_namespace === namespace)
      && typeof entry.item_id === 'string'
      && typeof entry.from_revision === 'string'
      && typeof entry.to_revision === 'string'
      && entry.from_revision !== entry.to_revision
      && typeof entry.adopted_by === 'string'
      && typeof entry.adopted_at === 'string'
      && typeof entry.git_commit === 'string'
      && (!Object.hasOwn(entry, 'item_path') || typeof entry.item_path === 'string');
  }
  if (entry.type === 'number-repair-intent') {
    return validRepairIntent(entry, namespace);
  }
  if (entry.type === 'number-repair-final') {
    return validRepairFinal(entry, namespace);
  }
  if (entry.type === 'publish-intent') {
    return typeof entry.operation_id === 'string'
      && typeof entry.operation_digest === 'string'
      && typeof entry.item_id === 'string'
      && typeof entry.expected_revision === 'string'
      && typeof entry.candidate_sha256 === 'string'
      && (!Object.hasOwn(entry, 'item_path') || typeof entry.item_path === 'string')
      && (!Object.hasOwn(entry, 'writer_worktree_id')
        || typeof entry.writer_worktree_id === 'string')
      && isRecord(entry.fence)
      && (namespace === null || entry.fence.ledger_namespace === namespace)
      && entry.fence.item_id === entry.item_id;
  }
  if (entry.type === 'publish-final') {
    return typeof entry.operation_id === 'string'
      && typeof entry.operation_digest === 'string'
      && typeof entry.ledger_namespace === 'string'
      && (namespace === null || entry.ledger_namespace === namespace)
      && typeof entry.item_id === 'string'
      && (!Object.hasOwn(entry, 'writer_worktree_id')
        || typeof entry.writer_worktree_id === 'string')
      && validPublicationOutcome(entry);
  }
  return typeof entry.operation_id === 'string'
    && typeof entry.item_id === 'string'
    && typeof entry.committed_revision === 'string'
    && typeof entry.git_commit === 'string';
}

const REPAIR_ID = /^nr_\d{8}_\d{4}$/;
const REPAIR_ITEM_ID = /^wb_[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const REPAIR_REVISION = /^sha256:[0-9a-f]{64}$/;
const REPAIR_STAGING_ID = /^[A-Za-z0-9_-]{1,80}$/;

function validRepairIntent(entry, namespace) {
  return REPAIR_ID.test(entry.repair_id)
    && typeof entry.ledger_namespace === 'string'
    && (namespace === null || entry.ledger_namespace === namespace)
    && REPAIR_REVISION.test(entry.ledger_snapshot_revision)
    && isCalendarDate(entry.date)
    && REPAIR_STAGING_ID.test(entry.staging_id)
    && validRepairItems(entry.items, { includeExpected: true });
}

function validRepairFinal(entry, namespace) {
  return REPAIR_ID.test(entry.repair_id)
    && typeof entry.ledger_namespace === 'string'
    && (namespace === null || entry.ledger_namespace === namespace)
    && REPAIR_STAGING_ID.test(entry.staging_id)
    && typeof entry.observed_at === 'string'
    && validRepairItems(entry.items, { includeCommitted: true });
}

function validRepairItems(items, options) {
  if (!Array.isArray(items) || items.length === 0) return false;
  const seen = new Set();
  for (const item of items) {
    if (!isRecord(item)
      || !REPAIR_ITEM_ID.test(item.item_id)
      || seen.has(item.item_id)
      || typeof item.item_path !== 'string'
      || !REPAIR_REVISION.test(item.candidate_revision)) {
      return false;
    }
    if (options.includeExpected
      && (!REPAIR_REVISION.test(item.expected_revision)
        || !Number.isSafeInteger(item.expected_number)
        || item.expected_number < 1
        || !Number.isSafeInteger(item.replacement_number)
        || item.replacement_number < 1)) {
      return false;
    }
    if (options.includeCommitted && !REPAIR_REVISION.test(item.committed_revision)) return false;
    seen.add(item.item_id);
  }
  return true;
}

function validRepairResolution(entry, intents, finals) {
  if (entry.type === 'number-repair-intent') {
    if (intents.has(entry.repair_id)) return false;
    intents.set(entry.repair_id, entry);
    return true;
  }
  if (entry.type !== 'number-repair-final') return true;
  const intent = intents.get(entry.repair_id);
  if (!intent || finals.has(entry.repair_id) || intent.staging_id !== entry.staging_id) return false;
  const expected = new Map(intent.items.map((item) => [item.item_id, item.candidate_revision]));
  if (entry.items.length !== expected.size) return false;
  for (const item of entry.items) {
    if (expected.get(item.item_id) !== item.candidate_revision) return false;
  }
  finals.add(entry.repair_id);
  return true;
}

// A journal-fenced create is only meaningful as a pair: the terminal that ends
// an attempt must name the intent that opened it, so a standalone create
// terminal names no authorized attempt and fails closed. Patch and transition
// entries remain valid standing alone, so only create-v1 attempts are tracked.
function validCreateResolution(entry, attempts) {
  if (entry.command !== 'create-v1') return true;
  if (entry.type === 'legacy-mutation-intent') {
    attempts.set(entry.attempt_id, entry);
    return true;
  }
  if (entry.type !== 'legacy-mutation' && entry.type !== 'legacy-mutation-abort') return true;
  const intent = attempts.get(entry.attempt_id);
  if (intent === undefined || intent.item_id !== entry.item_id) return false;
  // A committed create publishes exactly the revision its intent proposed; an
  // aborted one publishes none.
  if (entry.type === 'legacy-mutation' && intent.candidate_revision !== entry.committed_revision) {
    return false;
  }
  // One attempt resolves once, so the intent is consumed here and a repeated
  // resolution finds no open attempt to end.
  attempts.delete(entry.attempt_id);
  return true;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validPublicationOutcome(entry) {
  const outcome = entry.outcome;
  if (!isRecord(outcome) || !Number.isInteger(outcome.exit) || !isRecord(outcome.stdout)) return false;
  const stdout = outcome.stdout;
  if (
    stdout.namespace !== 'ledger-publication'
      || stdout.command !== 'publish-claimed'
      || stdout.contract_version !== 1
      || stdout.operation_id !== entry.operation_id
      || !['committed', 'unchanged', 'unknown'].includes(stdout.state)
  ) return false;
  if (stdout.ok === true) {
    return outcome.exit === 0
      && stdout.state === 'committed'
      && isRecord(stdout.result)
      && stdout.result.ledger_namespace === entry.ledger_namespace
      && stdout.result.item_id === entry.item_id
      && typeof stdout.result.committed_revision === 'string'
      && isRecord(stdout.result.claim_fence)
      && stdout.result.claim_fence.ledger_namespace === entry.ledger_namespace
      && stdout.result.claim_fence.item_id === entry.item_id;
  }
  if (stdout.ok !== false || !isRecord(stdout.error)) return false;
  const details = stdout.error.details;
  return !isRecord(details)
    || ((!Object.hasOwn(details, 'operation_id') || details.operation_id === entry.operation_id)
      && (!Object.hasOwn(details, 'ledger_namespace') || details.ledger_namespace === entry.ledger_namespace)
      && (!Object.hasOwn(details, 'item_id') || details.item_id === entry.item_id));
}
