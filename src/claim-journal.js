import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { validateClaimRequest } from './claim-request.js';

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
]);
// The reconciliation log is a tracked derived artifact. Entry types that every
// invocation appends, including refusals and read-only verification, stay out
// of it so a mutation that changes nothing leaves the working tree unchanged.
const UNPROJECTED_ENTRY_TYPES = new Set(['clock', 'publish-finalization']);

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
  let state = emptyClaimState(namespace);
  const operations = { acquire: claimAcquire, release: claimRelease, renew: claimRenew };
  for (const entry of entries) {
    if (entry.type === 'clock') {
      advanceClockFloor(state, entry.floor);
    } else if (entry.type === 'claim' && Object.hasOwn(operations, entry.command)) {
      state = operations[entry.command](state, entry.request, entry.physical_now).state;
    }
  }
  return { state, entries };
}

export async function writeReconcileLog(logPath, namespace, entries) {
  const mergeableEntries = entries.filter((entry) => !UNPROJECTED_ENTRY_TYPES.has(entry.type));
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
      && ['patch-v1', 'transition-v1'].includes(entry.command)
      && typeof entry.expected_revision === 'string'
      && typeof entry.candidate_revision === 'string'
      && (!Object.hasOwn(entry, 'item_path') || typeof entry.item_path === 'string')
      && typeof entry.observed_at === 'string';
  }
  if (entry.type === 'legacy-mutation') {
    return (!Object.hasOwn(entry, 'attempt_id') || typeof entry.attempt_id === 'string')
      && typeof entry.ledger_namespace === 'string'
      && (namespace === null || entry.ledger_namespace === namespace)
      && typeof entry.item_id === 'string'
      && ['patch-v1', 'transition-v1'].includes(entry.command)
      && typeof entry.committed_revision === 'string'
      && (!Object.hasOwn(entry, 'item_path') || typeof entry.item_path === 'string')
      && typeof entry.observed_at === 'string';
  }
  if (entry.type === 'legacy-mutation-abort') {
    return typeof entry.attempt_id === 'string'
      && typeof entry.ledger_namespace === 'string'
      && (namespace === null || entry.ledger_namespace === namespace)
      && typeof entry.item_id === 'string'
      && typeof entry.observed_revision === 'string'
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
  if (entry.type === 'publish-intent') {
    return typeof entry.operation_id === 'string'
      && typeof entry.operation_digest === 'string'
      && typeof entry.item_id === 'string'
      && typeof entry.expected_revision === 'string'
      && typeof entry.candidate_sha256 === 'string'
      && (!Object.hasOwn(entry, 'item_path') || typeof entry.item_path === 'string')
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
      && validPublicationOutcome(entry);
  }
  return typeof entry.operation_id === 'string'
    && typeof entry.item_id === 'string'
    && typeof entry.committed_revision === 'string'
    && typeof entry.git_commit === 'string';
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
