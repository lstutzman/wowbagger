import { execFile, spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { listWorktrees } from './git-worktrees.js';
import { recordCount, timePhase } from './instrumentation.js';
import { revisionFor } from './mutation.js';

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;
// Each `git cat-file --batch` record adds an object id, a type, a decimal
// size, and two newlines ahead of the contents. 64 bytes covers that framing
// with room to spare, so the reader can bound its own output against the
// sizes the tree listing already reported.
const BATCH_RECORD_OVERHEAD_BYTES = 64;
const GIT_ENVIRONMENT = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
);

export function readGitHeadLedger(ledgerDirectory) {
  return readGitTreeLedger(ledgerDirectory, 'HEAD');
}

export async function readGitTreeLedger(ledgerDirectory, treeish) {
  const { root, relativeLedger } = await resolveWorktreeLedger(ledgerDirectory);
  if (relativeLedger.startsWith(`..${path.sep}`) || path.isAbsolute(relativeLedger)) {
    throw new Error(`ledger is outside the git worktree: ${relativeLedger}`);
  }
  let commit;
  try {
    commit = (await gitText(root, ['rev-parse', '--verify', treeish])).trim();
  } catch (error) {
    if (error?.code === 128) return { commit: null, items: new Map(), root };
    throw error;
  }
  const gitLedger = toGitPath(relativeLedger);
  const treeArguments = ['ls-tree', '-r', '-l', '-z', treeish];
  if (gitLedger !== '') treeArguments.push('--', gitLedger);
  const listing = await timePhase('head_tree_ms', () => gitBuffer(root, treeArguments));
  const prefix = gitLedger === '' ? '' : `${gitLedger}/`;
  const entries = parseTreeListing(listing);
  recordCount('head_tree_entries', entries.length);
  const blobs = entries.filter((entry) => (
    entry.type === 'blob'
      && entry.name.startsWith(prefix)
      && !entry.name.slice(prefix.length).startsWith('.wowbagger/')
      && entry.name.endsWith('.md')
  ));
  const items = new Map();
  for (const chunk of chunkBySize(blobs, MAX_GIT_OUTPUT_BYTES)) {
    const contents = await timePhase('head_blob_ms', () => readBlobBatch(root, chunk));
    for (let index = 0; index < chunk.length; index += 1) {
      recordCount('head_blobs_read');
      recordCount('head_bytes_read', contents[index].length);
      items.set(chunk[index].name.slice(prefix.length), contents[index]);
    }
  }
  return { commit, items, root };
}

export async function readGitTreeFile(ledgerDirectory, treeish, relativePath) {
  const { root, relativeLedger } = await resolveWorktreeLedger(ledgerDirectory);
  const gitPath = toGitPath(path.join(relativeLedger, relativePath));
  return gitBuffer(root, ['show', `${treeish}:${gitPath}`]);
}

// Which active worktree carries the revision the journal expects. Reachability
// alone proves nothing about ownership: a tag, a remote-tracking ref, or a
// branch nobody has checked out names no worktree that could publish anything.
// So the evidence is the worktree roster, this worktree first, and a revision
// reachable only outside it stays unowned rather than attributed to a ref.
//
// Returns `{ kind, ref?, commit? }`, where `kind` is one of:
//   `current`           this worktree's own history reaches the revision;
//   `named-sibling`     a live sibling worktree on a branch reaches it;
//   `reachable-unowned` Git reaches it, but no live named worktree does;
//   `unreachable`       no reachable commit carries the expected bytes.
export async function findRevisionOwner(ledgerDirectory, itemPath, expectedRevision) {
  const { root, relativeLedger } = await resolveWorktreeLedger(ledgerDirectory);
  const gitPath = toGitPath(path.join(relativeLedger, itemPath));
  const carrierIn = revisionCarrier(root, gitPath, expectedRevision);
  const current = await carrierIn(await pathHistory(root, 'HEAD', gitPath));
  if (current) return { kind: 'current', commit: current };
  const live = (await listWorktrees(root)).filter((record) => (
    !record.bare && !record.prunable && record.head !== null
  ));
  // One expected revision can sit in several live worktrees at once. Branch ref
  // then path is the only ordering both stable across runs and independent of
  // the order Git happened to register the worktrees in.
  for (const record of live.filter((entry) => entry.branch !== null).sort(byBranchThenPath)) {
    const commit = await carrierIn(await pathHistory(root, record.head, gitPath));
    if (commit) return { kind: 'named-sibling', ref: record.branch, commit };
  }
  // A detached worktree is a real writer with no ref to wait on, so it proves
  // reachability and nothing else. So does any remaining ref: a tag, a
  // remote-tracking ref, or a branch no worktree has checked out.
  for (const record of live.filter((entry) => entry.branch === null)) {
    const commit = await carrierIn(await pathHistory(root, record.head, gitPath));
    if (commit) return { kind: 'reachable-unowned', commit };
  }
  const reachable = await carrierIn(await pathHistory(root, '--all', gitPath));
  return reachable ? { kind: 'reachable-unowned', commit: reachable } : { kind: 'unreachable' };
}

// The first commit of a history whose item bytes are the expected revision, or
// null. Sibling histories overlap almost entirely and every answer costs a
// `git show`, so one commit is read at most once per lookup.
function revisionCarrier(root, gitPath, expectedRevision) {
  const answered = new Map();
  return async (commits) => {
    for (const commit of commits) {
      if (!answered.has(commit)) {
        answered.set(commit, await carriesRevision(root, commit, gitPath, expectedRevision));
      }
      if (answered.get(commit)) return commit;
    }
    return null;
  };
}

async function carriesRevision(root, commit, gitPath, expectedRevision) {
  try {
    const bytes = await gitBuffer(root, ['show', `${commit}:${gitPath}`]);
    return revisionFor(bytes) === expectedRevision;
  } catch {
    // The path does not exist in this commit, so it cannot carry the revision.
    return false;
  }
}

// The commits one revision range reaches that touch the item path, newest
// first. An unborn `HEAD` names no commit, so a worktree Git cannot resolve
// reaches nothing.
async function pathHistory(root, revisionRange, gitPath) {
  try {
    return gitLines(await gitText(root, ['rev-list', revisionRange, '--', gitPath]));
  } catch {
    return [];
  }
}

function byBranchThenPath(a, b) {
  if (a.branch !== b.branch) return a.branch < b.branch ? -1 : 1;
  return a.path < b.path ? -1 : 1;
}

async function gitText(cwd, argumentsList) {
  const { stdout } = await execFileAsync('git', argumentsList, {
    cwd,
    encoding: 'utf8',
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    env: GIT_ENVIRONMENT,
  });
  return stdout;
}

async function gitBuffer(cwd, argumentsList) {
  const { stdout } = await execFileAsync('git', argumentsList, {
    cwd,
    encoding: 'buffer',
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    env: GIT_ENVIRONMENT,
  });
  return stdout;
}

// Every path this module hands to git is relative to the worktree root, so both
// readers start from the same pair. The caller decides whether a ledger outside
// the worktree is fatal.
async function resolveWorktreeLedger(ledgerDirectory) {
  const root = (await gitText(ledgerDirectory, ['rev-parse', '--show-toplevel'])).trim();
  return { root, relativeLedger: path.relative(root, await realpath(ledgerDirectory)) };
}

function gitLines(output) {
  return output.trim().split('\n').filter(Boolean);
}

// `git ls-tree -r -l -z` emits `<mode> <type> <object> <size>TAB<name>` records
// separated by NUL. `-z` disables path quoting, so the name is whatever follows
// the first tab, even when it contains a tab of its own.
function parseTreeListing(listing) {
  const entries = [];
  for (const record of listing.toString('utf8').split('\0')) {
    const separator = record.indexOf('\t');
    if (separator === -1) continue;
    const fields = record.slice(0, separator).split(' ').filter((field) => field !== '');
    if (fields.length < 4) continue;
    entries.push({
      type: fields[1],
      oid: fields[2],
      size: Number(fields[3]),
      name: record.slice(separator + 1),
    });
  }
  return entries;
}

// Chunks stay under the per-process output bound the single-file reads used.
// A blob larger than the bound on its own still forms one chunk, so no item
// becomes unreadable because of its size.
function chunkBySize(blobs, limit) {
  const chunks = [];
  let current = [];
  let total = 0;
  for (const blob of blobs) {
    if (current.length > 0 && total + blob.size > limit) {
      chunks.push(current);
      current = [];
      total = 0;
    }
    current.push(blob);
    total += blob.size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function readBlobBatch(cwd, blobs) {
  const limit = blobs.reduce(
    (total, blob) => total + blob.size + BATCH_RECORD_OVERHEAD_BYTES,
    0,
  );
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['cat-file', '--batch'], { cwd, env: GIT_ENVIRONMENT });
    const chunks = [];
    let received = 0;
    let stderr = '';
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(error);
    };
    child.stdout.on('data', (chunk) => {
      received += chunk.length;
      if (received > limit) {
        fail(new Error('git cat-file returned more output than the tree listing described.'));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', fail);
    child.on('close', (code) => {
      if (settled) return;
      if (code !== 0) {
        fail(new Error(`git cat-file exited with ${code}: ${stderr.trim()}`));
        return;
      }
      settled = true;
      try {
        resolve(decodeBlobBatch(Buffer.concat(chunks), blobs));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.on('error', fail);
    child.stdin.end(`${blobs.map((blob) => blob.oid).join('\n')}\n`);
  });
}

// Each record is `<object> <type> <size>\n`, then exactly `<size>` content
// bytes, then one newline. The records answer the requested object ids in
// order, so a mismatch means the reader and git disagree and must not guess.
function decodeBlobBatch(output, blobs) {
  const contents = [];
  let offset = 0;
  for (const blob of blobs) {
    const newline = output.indexOf(0x0a, offset);
    if (newline === -1) {
      throw new Error(`git cat-file ended before object ${blob.oid} was read.`);
    }
    const header = output.toString('utf8', offset, newline).split(' ');
    if (header[0] !== blob.oid || header[1] !== 'blob') {
      throw new Error(`git cat-file did not return blob ${blob.oid}.`);
    }
    const size = Number(header[2]);
    const start = newline + 1;
    const end = start + size;
    if (!Number.isSafeInteger(size) || size < 0 || end > output.length) {
      throw new Error(`git cat-file returned a truncated record for ${blob.oid}.`);
    }
    contents.push(output.subarray(start, end));
    offset = end + 1;
  }
  return contents;
}

function toGitPath(value) {
  return value.split(path.sep).join('/');
}
