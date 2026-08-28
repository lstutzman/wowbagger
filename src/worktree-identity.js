import { randomUUID } from 'node:crypto';
import { open, readFile, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import { withClaimLock } from './claim-store.js';
import { listWorktrees, resolvePrivateGitDir } from './git-worktrees.js';

const IDENTITY_FILE = 'wowbagger-worktree-id';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function invalidIdentity(reason) {
  const error = new Error('worktree identity is invalid');
  error.code = 'CLAIM_WORKTREE_IDENTITY_INVALID';
  error.reason = reason;
  return error;
}

export async function readWorktreeIdentity({ ledgerDirectory, gitCommonDir }) {
  return readIdentityFile(await resolveIdentityPath(ledgerDirectory, gitCommonDir));
}

// Two live worktrees answering to one UUID make every writer attribution in
// the shared journal ambiguous, and an ambiguous writer is exactly what
// reconciliation reasons from. The caller runs this before it classifies or
// publishes anything, so an ambiguous domain refuses rather than guesses.
//
// Nothing here creates an identity file: a worktree that has never written one
// stays anonymous and holds no UUID to collide with.
export async function assertUniqueWorktreeIdentity({ ledgerDirectory }) {
  const identities = await enumerateWorktreeIdentities(ledgerDirectory);
  const holders = new Map();
  for (const identity of identities) {
    if (identity !== null) holders.set(identity, (holders.get(identity) ?? 0) + 1);
  }
  // Sorted so a domain holding more than one collision always names the same
  // one, and the diagnostic an operator reads twice does not move.
  const duplicate = [...holders]
    .filter(([, count]) => count > 1)
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .at(0);
  if (!duplicate) return;
  const error = invalidIdentity('duplicate-worktree-identity');
  error.identityDiagnostic = {
    code: 'duplicate-worktree-identity',
    worktree_id: duplicate[0],
    live_worktree_count: duplicate[1],
  };
  throw error;
}

// One entry per live registered worktree: its recorded UUID, or null when it
// has never written one.
//
// Evidence gathering fails closed, because a roster this function could not
// finish reading is not a roster without duplicates. An enumeration that never
// ran, a private Git directory that will not resolve, a path that vanished
// between the listing and the read, and identity bytes that are present but
// malformed all leave the roster incomplete, so all of them refuse the caller
// rather than shrink the evidence. Silently dropping any of them could hide
// the very duplicate this check exists to find.
//
// Only what Git itself has already disowned is excluded: a record Git marks
// prunable, and a bare repository, which has no checkout to hold an identity.
async function enumerateWorktreeIdentities(ledgerDirectory) {
  try {
    const roster = await listWorktrees(ledgerDirectory);
    return await Promise.all(roster
      .filter((worktree) => !(worktree.bare || worktree.prunable))
      .map(async (worktree) => readIdentityFile(path.join(
        await resolvePrivateGitDir(worktree.path), IDENTITY_FILE,
      ))));
  } catch {
    const error = invalidIdentity('worktree-enumeration-failed');
    // The roster is unknown, so the diagnostic names no UUID and no count.
    error.identityDiagnostic = { code: 'worktree-enumeration-failed' };
    throw error;
  }
}

// A duplicate refusal keeps its caller's existing outer code and reason, and
// adds only this diagnostic to the details a client already tolerates extra
// members in.
export function identityDiagnosticDetails(error) {
  return error?.identityDiagnostic ? { identity_diagnostic: error.identityDiagnostic } : {};
}

// The identity file is created once and never rewritten: a worktree that
// already answers to an ID keeps it, because journal entries elsewhere already
// name it.
//
// Read and create run under a lock keyed on the identity path, which is the
// worktree itself. The namespace write lock cannot stand in for it: two ledger
// namespaces can share one worktree, so they hold different namespace locks
// while contending for one identity file. Without this lock both would observe
// no identity, both would create one, and the later rename would leave the
// earlier writer holding an ID the file no longer contains. The lock is a
// try-lock, so a losing writer is refused with `CLAIM_LOCK_HELD` and retries
// rather than publishing a second identity.
//
// Creation still writes a fresh file in the same directory, fsyncs it, and
// renames it over the final path, so a reader taking no lock at all sees
// either no file or one whole ID. The final path is never opened for writing,
// so a crash can never leave a truncated identity behind.
export async function ensureWorktreeIdentity({ ledgerDirectory, gitCommonDir }) {
  const identityPath = await resolveIdentityPath(ledgerDirectory, gitCommonDir);
  return withClaimLock(identityPath, async () => {
    const existing = await readIdentityFile(identityPath);
    if (existing !== null) return existing;

    const temporaryPath = path.join(
      path.dirname(identityPath),
      `.${IDENTITY_FILE}.${randomUUID()}`,
    );
    try {
      const handle = await open(temporaryPath, 'wx', 0o600);
      try {
        await handle.writeFile(`${randomUUID()}\n`, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporaryPath, identityPath);
    } finally {
      await rm(temporaryPath, { force: true });
    }

    // Read back rather than trust the value just written: the caller must act
    // on the ID the next reader will see, not the one this process intended.
    const written = await readIdentityFile(identityPath);
    if (written === null) throw invalidIdentity('missing-after-write');
    return written;
  });
}

// The verified common directory is the caller's proof of which repository it
// is fencing. A private directory that is neither that directory nor one of
// its linked worktrees belongs to some other repository, and an identity
// written there would name the wrong writer.
async function resolveIdentityPath(ledgerDirectory, gitCommonDir) {
  const privateGitDir = await resolvePrivateGitDir(ledgerDirectory);
  const [privateReal, commonReal] = await Promise.all([
    realpath(privateGitDir),
    realpath(gitCommonDir),
  ]);
  const linked = path.join(commonReal, 'worktrees');
  if (privateReal !== commonReal && path.dirname(privateReal) !== linked) {
    throw invalidIdentity('private-git-dir-outside-common-dir');
  }
  return path.join(privateGitDir, IDENTITY_FILE);
}

async function readIdentityFile(identityPath) {
  let text;
  try {
    text = await readFile(identityPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  if (!text.endsWith('\n')) throw invalidIdentity('missing-terminator');
  const identity = text.slice(0, -1);
  // The anchored pattern rejects a second line as well as a malformed one.
  if (!UUID_V4.test(identity)) throw invalidIdentity('malformed-uuid');
  return identity;
}
