// Git finalization for `--auto-commit`.
//
// The flag folds the commit-per-mutation ceremony into one invocation on a
// provisioned ledger. This module owns every Git write and nothing else: the
// mutation engine runs unchanged, and a mutation that changed no item byte
// never reaches a Git command here.
//
// The safety model is two snapshots, not a transaction. Item publication, the
// Git commit, and journal finalization cannot be one atomic step in the
// merge-coordinated profile, so this module refuses on any pre-existing staged
// or dirty ledger state, repeats the same checks after publication, and names
// every post-publication failure instead of guessing which bytes to commit.
import { spawn } from 'node:child_process';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { resolveWorkClaimCapability } from './claim-capabilities.js';
import { claimReconcileLogPath } from './claim-journal.js';
import { verifyClaimJournal } from './claim-publication.js';
import { resolveVerifiedGitCommonDir, withClaimLock } from './claim-store.js';
import { loadLedger } from './ledger.js';
import { revisionFor } from './mutation.js';
import { readNamespace } from './namespace.js';

const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_REPORTED_PATHS = 16;
const MAX_RECOVERY_TOKEN_CHARS = 4096;
// The read-only reconciliation reader strips every GIT_ variable. This module
// commits, so it strips a narrower, named set instead: the variables that would
// retarget the repository, work tree, index, or object store out from under the
// commit it verified. Identity, configuration-source, hook, and signing
// variables stay, because the design requires Git's own author, committer,
// hook, and signing resolution rather than an invented one.
const RETARGETING_GIT_VARIABLES = new Set([
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CEILING_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_DIR',
  'GIT_DISCOVERY_ACROSS_FILESYSTEM',
  'GIT_INDEX_FILE',
  'GIT_INDEX_VERSION',
  'GIT_NAMESPACE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_WORK_TREE',
]);
const GIT_ENVIRONMENT = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !RETARGETING_GIT_VARIABLES.has(name)),
);

const COMMIT_SUBJECT_VERBS = {
  create: 'create',
  transition: 'transition',
  'parent-migrate': 'parent-migrate',
  snooze: 'snooze',
  patch: 'patch',
  'publish-claimed': 'publish claimed',
};

export async function withAutoCommit({
  ledgerDirectory,
  command,
  operationId = null,
  targetItemId = null,
  run,
  scenario,
}) {
  const shape = command === 'publish-claimed' ? publicationShape(operationId) : coreShape(command);
  let gitCommonDir;
  try {
    gitCommonDir = await resolveVerifiedGitCommonDir(ledgerDirectory, { failClosed: true });
  } catch {
    return shape.capabilityUnavailable('git-verification-failed');
  }
  const namespace = gitCommonDir ? await readNamespace(ledgerDirectory) : null;
  const capability = resolveWorkClaimCapability({ gitCommonDir, namespace });
  if (capability.mode !== 'merge-coordinated' || !capability.claim_protected_publication) {
    return shape.capabilityUnavailable(gitCommonDir ? 'ledger-namespace-unbound' : 'git-directory-not-found');
  }

  let placement;
  try {
    placement = await resolvePlacement(ledgerDirectory);
  } catch {
    return shape.preflightFailed('git-unavailable', {});
  }

  // One mutex per working tree. It serializes cooperating auto-commit calls in
  // this checkout; it cannot see a foreign process, which is why the before and
  // after snapshots, not the mutex, carry the safety.
  const mutexPath = path.join(placement.gitDir, 'wowbagger', 'auto-commit');
  try {
    return await withClaimLock(mutexPath, () => finalize({
      command,
      gitCommonDir,
      ledgerDirectory,
      namespace,
      placement,
      targetItemId,
      run,
      scenario,
      shape,
    }));
  } catch (error) {
    if (error?.code === 'CLAIM_LOCK_HELD') return shape.preflightFailed('mutex-held', {});
    throw error;
  }
}

async function finalize({
  command,
  gitCommonDir,
  ledgerDirectory,
  namespace,
  placement,
  targetItemId,
  run,
  scenario,
  shape,
}) {
  const { root, prefix } = placement;
  const logPath = ledgerRelative(ledgerDirectory, claimReconcileLogPath(path.resolve(ledgerDirectory), namespace));
  const journalOwned = command !== 'create';

  // Preflight, before any Wowbagger write. Any staged path and every dirty
  // ledger path except the journal-owning command's derived log refuse: a broad
  // commit would otherwise absorb foreign work.
  const before = await inspectWorktree(root, prefix);
  if (before.staged.length > 0) {
    return shape.preflightFailed('staged-paths-present', { staged_paths: bounded(before.staged) });
  }
  const foreignDirtyBefore = before.dirtyLedger.filter((entry) => (
    !(journalOwned && entry === logPath)
  ));
  if (foreignDirtyBefore.length > 0) {
    return shape.preflightFailed('ledger-not-clean', { dirty_paths: bounded(foreignDirtyBefore) });
  }
  if (!await hasCommitIdentity(root)) {
    return shape.preflightFailed('identity-unavailable', {});
  }
  const head = await headOid(root);
  if (head === null) return shape.preflightFailed('unborn-head', {});

  // The pre-mutation reconciliation the invariant requires. It also closes the
  // publishClaimed gap where reconciliation ran only for an unresolved
  // publish-intent: an unreconciled prior mutation refuses here.
  //
  // A nonzero claim-verify is exactly the unsafe claim state, so this one check
  // is the whole gate. An invalid ledger is deliberately NOT re-checked here:
  // every one of the auto-commit mutations already refuses it with
  // ledger-invalid and state unchanged, and duplicating that would add a
  // branch no fixture can distinguish from the mutation's own refusal.
  const verified = await verifyClaimJournal({
    ledgerDirectory,
    gitCommonDir,
    namespace,
    targetItemId,
    writeLogOnUnsafe: false,
    writeLogWhenEmpty: false,
  });
  if (verified.exit !== 0 || verified.stdout.ok !== true) {
    const details = claimVerificationFailureDetails(verified);
    return shape.preflightFailed('claim-state-unreconciled', {
      ...details,
      retryable: details.claim_verify_reason === 'claim-store-locked',
    });
  }

  // Reconciliation rewrites the tracked log. Only a command that will commit
  // that log may proceed with it dirty; create commits the item alone.
  const afterVerify = await inspectWorktree(root, prefix);
  if (afterVerify.staged.length > 0) {
    return shape.preflightFailed('staged-paths-present', { staged_paths: bounded(afterVerify.staged) });
  }
  const strayBefore = afterVerify.dirtyLedger.filter((entry) => !(journalOwned && entry === logPath));
  if (strayBefore.length > 0) {
    return shape.preflightFailed('ledger-not-clean', { dirty_paths: bounded(strayBefore) });
  }

  const outcome = await run();
  const state = shape.stateOf(outcome);
  // A refused or unknown mutation performs no Git action, log side effects
  // included. The published-bytes claim is the only warrant for a commit.
  if (state !== 'committed') return outcome;
  await autoCommitCheckpoint(root, scenario, 'before-stage');

  // The published revision comes from the mutation outcome, never from disk.
  // Reading it from disk would make the byte comparison below compare the file
  // with itself.
  const identity = shape.publishedIdentity(outcome);
  let published = null;
  if (identity.revision !== null) {
    try {
      published = await locateItem(ledgerDirectory, identity.id);
    } catch {
      published = null;
    }
  }
  if (published === null) {
    return shape.commitFailed({
      ...shape.identityDetails(identity, namespace),
      published_revision: identity.revision,
      commit_set: [],
      pre_commit_head: head,
      failure_stage: 'prepare-commit-set',
      reason: 'tree-changed',
      recovery_token: null,
    });
  }
  published.revision = identity.revision;
  const itemChanged = await itemDiffersFromHead(root, prefix, published.path, published.revision);
  const commitSet = [
    ...(itemChanged ? [published.path] : []),
    ...(journalOwned ? [logPath] : []),
  ].sort(compareText);
  const subject = commitSubject(command, published.number, published.id);
  const witness = journalOwned ? shape.terminalWitness(outcome, published) : null;
  const context = {
    command,
    head,
    identity: shape.identityDetails(identity, namespace),
    itemId: published.id,
    itemPath: published.path,
    namespace,
    operationId: shape.operationId(outcome),
    publishedRevision: published.revision,
    subject,
    witness,
  };

  const digests = new Map([[published.path, published.revision]]);
  const failure = await prepareCommitSet({
    context,
    commitSet,
    digests,
    journalOwned,
    ledgerDirectory,
    logPath,
    ownArtifacts: shape.recoveryArtifactPaths(outcome),
    prefix,
    root,
    witness,
  });
  if (failure) return shape.commitFailed(failureDetails(context, commitSet, digests, failure));

  const gitPaths = commitSet.map((entry) => `${prefix}${entry}`);
  const staged = await git(root, ['add', '--pathspec-from-file=-', '--pathspec-file-nul'], {
    stdin: `${literalPathspecs(gitPaths).join('\0')}\0`,
  });
  // `git add` exit status alone is not the answer. It exits nonzero when a
  // pathspec matches an ignore rule even though the path is tracked and was
  // staged correctly. The cached path set is the authority; the add status only
  // chooses which reason a mismatch reports.
  const cached = await git(root, ['diff', '--cached', '--name-only', '-z']);
  if (cached.code !== 0 || !sameSet(splitNul(cached.stdout.toString('utf8')), gitPaths)) {
    return shape.commitFailed(failureDetails(context, commitSet, digests, {
      stage: 'stage',
      reason: staged.code === 0 && cached.code === 0 ? 'tree-changed' : 'index-unavailable',
    }));
  }

  let commit;
  try {
    commit = await commitExactSet(root, subject, gitPaths, head, digests, prefix);
  } catch {
    return shape.commitFailed(failureDetails(context, commitSet, digests, {
      stage: 'commit', reason: 'commit-command-failed',
    }));
  }
  if (commit.outcome === 'failed') {
    return shape.commitFailed(failureDetails(context, commitSet, digests, {
      stage: 'commit', reason: commit.reason,
    }));
  }
  if (commit.outcome === 'unknown') {
    return shape.outcomeUnknown(failureDetails(context, commitSet, digests, {
      stage: commit.stage, reason: commit.reason,
    }));
  }

  const evidence = {
    git_commit: commit.commit,
    commit_paths: commitSet,
    claim_verified: true,
  };
  const reconciled = await verifyClaimJournal({
    ledgerDirectory,
    gitCommonDir,
    namespace,
    targetItemId: published.id,
    writeLogWhenEmpty: journalOwned,
  });
  const reconciliation = reconciliationFailureReason(reconciled, commit.commit, context.operationId, published.id);
  if (reconciliation) {
    return shape.reconciliationFailed({
      ...context.identity,
      published_revision: published.revision,
      git_commit: commit.commit,
      commit_paths: commitSet,
      ...reconciliation,
    });
  }
  return shape.decorate(outcome, evidence);
}

// Every check that must hold between publication and staging. Returning a
// reason here means the item is published and no Git write has happened yet.
async function prepareCommitSet({
  context, commitSet, digests, journalOwned, ledgerDirectory, logPath, ownArtifacts, prefix, root, witness,
}) {
  let itemBytes;
  try {
    itemBytes = await readFile(path.join(path.resolve(ledgerDirectory), context.itemPath));
  } catch {
    return { stage: 'prepare-commit-set', reason: 'tree-changed' };
  }
  if (revisionFor(itemBytes) !== context.publishedRevision) {
    return { stage: 'prepare-commit-set', reason: 'tree-changed' };
  }
  if (await headOid(root) !== context.head) {
    return { stage: 'prepare-commit-set', reason: 'head-changed' };
  }
  const after = await inspectWorktree(root, prefix);
  if (after.staged.length > 0) return { stage: 'prepare-commit-set', reason: 'index-unavailable' };
  // A transient lock or temporary file this very invocation could not remove is
  // not foreign work. The outcome already reports it as a bounded recovery
  // artifact, it is never staged, and refusing on it would make an
  // already-published item impossible to commit.
  const stray = after.dirtyLedger.filter((entry) => (
    !commitSet.includes(entry) && !ownArtifacts.includes(entry)
  ));
  if (stray.length > 0) return { stage: 'prepare-commit-set', reason: 'tree-changed' };

  if (!journalOwned) return null;
  let logBytes;
  try {
    logBytes = await readFile(path.join(path.resolve(ledgerDirectory), logPath));
  } catch {
    return { stage: 'prepare-commit-set', reason: 'log-unavailable' };
  }
  // The log must already carry this invocation's terminal. The legacy
  // coordinator treats a log write failure as rebuildable and still returns the
  // item outcome; auto mode must name that case rather than make an item-only
  // commit.
  if (!carriesTerminal(logBytes.toString('utf8'), witness)) {
    return { stage: 'prepare-commit-set', reason: 'log-unavailable' };
  }
  digests.set(logPath, revisionFor(logBytes));
  return null;
}

// Stage-then-commit with an explicit pathspec. Never a pathless commit, never a
// broad add, never --no-verify, and never a blind retry.
async function commitExactSet(root, subject, gitPaths, head, digests, prefix) {
  const committed = await git(root, ['commit', '-m', subject, '--', ...literalPathspecs(gitPaths)]);
  const observed = await headOid(root);
  if (committed.code !== 0) {
    if (observed === head) return { outcome: 'failed', reason: 'commit-command-failed' };
    const verification = await verifyCommit(root, observed, head, subject, gitPaths, digests, prefix);
    if (verification.ok) return { outcome: 'committed', commit: observed };
    return { outcome: 'unknown', stage: 'commit', reason: verification.reason };
  }
  if (observed === head || observed === null) {
    return { outcome: 'unknown', stage: 'commit', reason: 'head-changed' };
  }
  const verification = await verifyCommit(root, observed, head, subject, gitPaths, digests, prefix);
  if (!verification.ok) return { outcome: 'unknown', stage: 'verify-commit', reason: verification.reason };
  return { outcome: 'committed', commit: observed };
}

// A commit is this invocation's only when its parent, message, changed-path
// set, and every blob match what was prepared. A hook that rewrote the tree
// fails here rather than passing as success.
async function verifyCommit(root, commit, parent, subject, gitPaths, digests, prefix, witness = null) {
  const parents = await git(root, ['rev-list', '--parents', '-1', commit]);
  if (parents.code !== 0) return { ok: false, reason: 'commit-command-failed' };
  const fields = parents.stdout.toString('utf8').trim().split(/\s+/u);
  if (fields.length !== 2 || fields[1] !== parent) return { ok: false, reason: 'head-changed' };
  const message = await git(root, ['log', '-1', '--format=%s', commit]);
  if (message.code !== 0 || message.stdout.toString('utf8').trim() !== subject) {
    return { ok: false, reason: 'commit-scope-mismatch' };
  }
  const changed = await git(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', commit]);
  if (changed.code !== 0 || !sameSet(splitNul(changed.stdout.toString('utf8')), gitPaths)) {
    return { ok: false, reason: 'commit-scope-mismatch' };
  }
  for (const gitPath of gitPaths) {
    const blob = await git(root, ['show', `${commit}:${gitPath}`], { buffer: true });
    if (blob.code !== 0) return { ok: false, reason: 'commit-scope-mismatch' };
    const expected = digests.get(gitPath.slice(prefix.length)) ?? null;
    // A path with no observed digest is the reconciliation log during recovery.
    // The committed blob still has to carry the terminal the token names, which
    // is what makes recovery idempotent after a later, legitimate claim-verify
    // rewrote the working-tree log.
    if (expected === null) {
      if (!carriesTerminal(blob.stdout.toString('utf8'), witness)) {
        return { ok: false, reason: 'commit-scope-mismatch' };
      }
      continue;
    }
    if (revisionFor(blob.stdout) !== expected) {
      return { ok: false, reason: 'commit-scope-mismatch' };
    }
  }
  return { ok: true, reason: null };
}

function claimVerificationFailureDetails(verified) {
  const error = verified.stdout.error;
  const findings = verified.stdout.result?.findings ?? error?.details?.findings;
  return {
    ...(error?.code ? { claim_verify_code: error.code } : {}),
    ...(error?.details?.reason ? { claim_verify_reason: error.details.reason } : {}),
    ...(findings ? { findings } : {}),
  };
}

function reconciliationFailureReason(verified, commit, operationId, itemId) {
  if (verified.exit !== 0 || verified.stdout.ok !== true) {
    return { reason: 'claim-verify-refused', ...claimVerificationFailureDetails(verified) };
  }
  const result = verified.stdout.result;
  if (result.ledger_validation.valid !== true) return { reason: 'ledger-invalid', findings: [] };
  if (operationId === null) return null;
  const row = result.publications.find((entry) => (
    entry.operation_id === operationId && entry.item_id === itemId
  ));
  if (!row || row.git_finalized !== true || row.git_commit !== commit) {
    return { reason: 'publication-not-finalized', findings: [] };
  }
  return null;
}

function failureDetails(context, commitSet, digests, failure) {
  const set = commitSet.map((entry) => ({ path: entry, sha256: digests.get(entry) ?? null }));
  return {
    ...context.identity,
    published_revision: context.publishedRevision,
    expected_path: context.itemPath,
    commit_set: set,
    pre_commit_head: context.head,
    failure_stage: failure.stage,
    reason: failure.reason,
    recovery_token: recoveryToken(context, set),
  };
}

// The token is a witness, never authority to select paths. `mutation-finalize`
// re-derives every path from the ledger and namespace and refuses on any
// mismatch; a null digest means "unobserved, so re-derive it and require this
// invocation's terminal".
function recoveryToken(context, commitSet) {
  const payload = {
    v: 1,
    command: context.command,
    ledger_namespace: context.namespace,
    item_id: context.itemId,
    ...(context.operationId === null ? {} : { operation_id: context.operationId }),
    item_path: context.itemPath,
    published_revision: context.publishedRevision,
    pre_commit_head: context.head,
    commit_set: commitSet,
    message: context.subject,
    terminal_witness: context.witness,
  };
  const token = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return token.length > MAX_RECOVERY_TOKEN_CHARS ? null : token;
}

export function parseRecoveryToken(token) {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_RECOVERY_TOKEN_CHARS) return null;
  if (!/^[A-Za-z0-9_-]+$/u.test(token)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (payload?.v !== 1
    || !Object.hasOwn(COMMIT_SUBJECT_VERBS, payload.command)
    || typeof payload.ledger_namespace !== 'string'
    || typeof payload.item_id !== 'string'
    || typeof payload.item_path !== 'string'
    || typeof payload.published_revision !== 'string'
    || typeof payload.pre_commit_head !== 'string'
    || typeof payload.message !== 'string'
    || !Array.isArray(payload.commit_set)
    || payload.commit_set.length === 0
    || payload.commit_set.length > 2) return null;
  for (const entry of payload.commit_set) {
    if (typeof entry?.path !== 'string') return null;
    if (entry.sha256 !== null && typeof entry.sha256 !== 'string') return null;
  }
  return payload;
}

export function commitSubject(command, number, itemId) {
  const verb = COMMIT_SUBJECT_VERBS[command];
  // A schema-1 item has no number. The canonical item ID identifies it instead;
  // no title, body, decision, or caller text ever reaches a commit message.
  return `wowbagger: ${verb} item ${typeof number === 'number' ? `#${number}` : itemId}`;
}

// The reconciliation log is the projected journal. This invocation's terminal
// must already be in it before the log can join the commit.
export function carriesTerminal(logSource, witness) {
  if (witness === null) return true;
  for (const line of logSource.split('\n')) {
    if (!line.startsWith('{')) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.type !== witness.type || entry.item_id !== witness.item_id) continue;
    if (witness.type === 'legacy-mutation' && entry.committed_revision === witness.committed_revision) return true;
    if (witness.type === 'publish-final' && entry.operation_id === witness.operation_id) return true;
  }
  return false;
}

// Where the item lives and what its human handle is. It deliberately does not
// answer what revision was published: only the mutation outcome or a recovery
// token knows that.
async function locateItem(ledgerDirectory, itemId) {
  const ledger = await loadLedger(path.resolve(ledgerDirectory));
  const item = ledger.items.find((entry) => entry.data.id === itemId);
  if (!item) throw new Error('the published item is not readable');
  return {
    id: itemId,
    number: typeof item.data.number === 'number' ? item.data.number : null,
    path: ledgerRelative(ledgerDirectory, item.file),
    revision: null,
  };
}

// An auto-commit republishing the bytes HEAD already carries has no item change
// to stage, so the item joins the commit set only when it actually differs.
async function itemDiffersFromHead(root, prefix, itemPath, publishedRevision) {
  const observed = await git(root, ['show', `HEAD:${prefix}${itemPath}`]);
  return observed.code !== 0 || revisionFor(observed.stdout) !== publishedRevision;
}

// The one test-only seam in this module: it pauses between item publication and
// staging so a fixture can prove that a late foreign change, a moved HEAD, or a
// held index becomes a named failure instead of being absorbed into the commit.
async function autoCommitCheckpoint(root, scenario, point) {
  const [name, suffix] = typeof scenario === 'string' ? scenario.split(':', 2) : [];
  if (!suffix) return;
  if (name === 'pause-before-auto-commit-stage' && point === 'before-stage') {
    await writeFile(path.join(root, `.wowbagger-test-${suffix}-published`), 'published\n');
    const marker = path.join(root, `.wowbagger-test-${suffix}-continue`);
    const deadline = Date.now() + 10_000;
    for (;;) {
      try {
        await lstat(marker);
        return;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      if (Date.now() >= deadline) throw new Error('Timed out waiting for the auto-commit test marker.');
      await new Promise((resolve) => { setTimeout(resolve, 5); });
    }
  }
}

// --- worktree observation -------------------------------------------------

async function resolvePlacement(ledgerDirectory) {
  const top = await git(ledgerDirectory, ['rev-parse', '--show-toplevel'], { required: true });
  const gitDir = await git(ledgerDirectory, ['rev-parse', '--absolute-git-dir'], { required: true });
  const root = top.stdout.toString('utf8').trim();
  const relative = path.relative(await realpath(root), await realpath(ledgerDirectory));
  if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('ledger is outside the git worktree');
  }
  const gitPath = relative.split(path.sep).join('/');
  return { gitDir: gitDir.stdout.toString('utf8').trim(), prefix: gitPath === '' ? '' : `${gitPath}/`, root };
}

// One `git status` reading, split into what is staged anywhere and what is
// dirty under the ledger. Unstaged and untracked paths outside the ledger are
// allowed and are never staged.
async function inspectWorktree(root, prefix) {
  const status = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { required: true });
  const fields = splitNul(status.stdout.toString('utf8'));
  const staged = [];
  const dirtyLedger = [];
  for (let index = 0; index < fields.length; index += 1) {
    const record = fields[index];
    if (record.length < 4 || record[2] !== ' ') continue;
    const indexStatus = record[0];
    const treeStatus = record[1];
    const gitPath = record.slice(3);
    // A rename or copy records its origin as the following NUL-separated field.
    if (indexStatus === 'R' || indexStatus === 'C') index += 1;
    if (indexStatus !== ' ' && indexStatus !== '?') staged.push(gitPath);
    if (prefixed(gitPath, prefix) && (indexStatus !== ' ' || treeStatus !== ' ')) {
      dirtyLedger.push(gitPath.slice(prefix.length));
    }
  }
  return { dirtyLedger: dirtyLedger.sort(compareText), staged: staged.sort(compareText) };
}

async function headOid(root) {
  const result = await git(root, ['rev-parse', '--verify', 'HEAD']);
  return result.code === 0 ? result.stdout.toString('utf8').trim() : null;
}

// Identity is the one commit precondition Git can answer without committing.
async function hasCommitIdentity(root) {
  for (const variable of ['GIT_AUTHOR_IDENT', 'GIT_COMMITTER_IDENT']) {
    const result = await git(root, ['var', variable]);
    if (result.code !== 0 || result.stdout.toString('utf8').trim() === '') return false;
  }
  return true;
}

function git(cwd, argumentsList, { stdin = null, required = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', argumentsList, { cwd, env: GIT_ENVIRONMENT });
    const chunks = [];
    let received = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(error);
    };
    child.stdout.on('data', (chunk) => {
      received += chunk.length;
      if (received > MAX_GIT_OUTPUT_BYTES) {
        fail(new Error('git produced more output than the reader accepts'));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.resume();
    child.on('error', fail);
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (required && code !== 0) {
        reject(new Error(`git ${argumentsList[0]} exited with ${code}`));
        return;
      }
      resolve({ code, stdout: Buffer.concat(chunks, received) });
    });
    child.stdin.on('error', fail);
    if (stdin === null) child.stdin.end();
    else child.stdin.end(stdin, 'utf8');
  });
}

// --- response shapes ------------------------------------------------------

function coreShape(command) {
  return {
    capabilityUnavailable: (reason) => coreError('capability-unavailable',
      'Auto-commit requires a provisioned merge-coordinated ledger.', 'unchanged', 5, { reason }),
    decorate: (outcome, evidence) => (outcome.ok === true
      ? { ...outcome, resultExtra: evidence }
      : { ...outcome, error: { ...outcome.error, details: { ...outcome.error.details, ...evidence } } }),
    identityDetails: (identity) => ({ id: identity.id }),
    operationId: () => null,
    preflightFailed: (reason, details) => coreError('auto-commit-preflight-failed',
      'Auto-commit refused before the mutation ran.', 'unchanged', 4, preflightDetails(reason, details)),
    publishedIdentity: (outcome) => (outcome.ok === true
      ? { id: outcome.item.id, revision: outcome.item.revision }
      : { id: outcome.error.details.id, revision: outcome.error.details.revision ?? null }),
    recoveryArtifactPaths: (outcome) => (outcome.ok === true
      ? []
      : (outcome.error.details.recovery_artifacts ?? []).map((artifact) => artifact.path)),
    commitFailed: (details) => coreError('git-commit-failed',
      'The item was published, but its Git commit was not established.', 'committed', 6, details),
    outcomeUnknown: (details) => coreError('git-commit-outcome-unknown',
      'The item was published, but the Git commit outcome could not be determined.', 'committed', 6, details),
    reconciliationFailed: (details) => coreError('post-commit-reconciliation-failed',
      'The item was published and committed, but claim reconciliation did not verify.', 'committed', 6, details),
    stateOf: (outcome) => (outcome.stdout ? outcome.stdout.state : outcome.state),
    terminalWitness: (outcome, published) => ({
      type: 'legacy-mutation',
      item_id: published.id,
      committed_revision: published.revision,
    }),
    command,
  };
}

function coreError(code, message, state, exit, details) {
  return { ok: false, exit, state, error: { code, message, details } };
}

// Both shapes report the same preflight refusal. A held mutex is the one reason
// the identical request can succeed later, so it is the only retryable one.
function preflightDetails(reason, details) {
  return { reason, retryable: reason === 'mutex-held', ...details };
}

// Every envelope this shape builds keeps the claimed-publication domain and its
// top-level operation_id, so a failure answers where the success would have.
function publicationShape(operationId) {
  const envelope = (state, exit, body) => ({
    exit,
    stdout: {
      ok: false,
      namespace: 'ledger-publication',
      command: 'publish-claimed',
      contract_version: 1,
      state,
      ...(operationId === null ? {} : { operation_id: operationId }),
      ...body,
    },
  });
  const error = (code, message, state, exit, details) => envelope(state, exit, {
    error: { code, message, details },
  });
  return {
    capabilityUnavailable: (reason) => error('capability-unavailable',
      'Auto-commit requires a provisioned merge-coordinated ledger.', 'unchanged', 5, { reason }),
    decorate: (outcome, evidence) => {
      const stdout = outcome.stdout;
      if (stdout.ok === true) {
        return { ...outcome, stdout: { ...stdout, result: { ...stdout.result, ...evidence } } };
      }
      return {
        ...outcome,
        stdout: { ...stdout, error: { ...stdout.error, details: { ...stdout.error.details, ...evidence } } },
      };
    },
    identityDetails: (identity, namespace) => ({
      ledger_namespace: namespace,
      item_id: identity.id,
    }),
    operationId: (outcome) => outcome.stdout.operation_id ?? null,
    preflightFailed: (reason, details) => error('auto-commit-preflight-failed',
      'Auto-commit refused before the mutation ran.', 'unchanged', 4, preflightDetails(reason, details)),
    publishedIdentity: (outcome) => ({
      id: outcome.stdout.result?.item_id ?? outcome.stdout.error?.details?.item_id,
      revision: outcome.stdout.result?.committed_revision ?? null,
    }),
    // A claimed publication reports no recovery artifacts of its own; the
    // mutation engine's are folded into its publication-outcome envelope.
    recoveryArtifactPaths: () => [],
    commitFailed: (details) => error('git-commit-failed',
      'The item was published, but its Git commit was not established.', 'committed', 6, details),
    outcomeUnknown: (details) => error('git-commit-outcome-unknown',
      'The item was published, but the Git commit outcome could not be determined.', 'committed', 6, details),
    reconciliationFailed: (details) => error('post-commit-reconciliation-failed',
      'The item was published and committed, but claim reconciliation did not verify.', 'committed', 6, details),
    stateOf: (outcome) => outcome.stdout.state,
    terminalWitness: (outcome, published) => ({
      type: 'publish-final',
      item_id: published.id,
      operation_id: outcome.stdout.operation_id,
    }),
    command: 'publish-claimed',
  };
}

// --- small shared helpers -------------------------------------------------

export function ledgerRelative(ledgerDirectory, file) {
  return path.relative(path.resolve(ledgerDirectory), file).split(path.sep).join('/');
}

// Every commit-set path is passed as an exact `:(literal)` pathspec, never as a
// glob. Today the ledger's own validator makes magic unreachable — an
// items_directory component matches [A-Za-z0-9._-]+, a namespace is
// wbns_[a-f0-9]{32}, and an item file is a ULID — so this is defence against a
// later relaxation, not a live hole. It is cheap and the design requires it.
function literalPathspecs(gitPaths) {
  return gitPaths.map((gitPath) => `:(literal)${gitPath}`);
}

function prefixed(gitPath, prefix) {
  return prefix === '' || gitPath.startsWith(prefix);
}

function splitNul(text) {
  return text.split('\0').filter((entry) => entry !== '');
}

function sameSet(left, right) {
  const a = [...left].sort(compareText);
  const b = [...right].sort(compareText);
  return a.length === b.length && a.every((entry, index) => entry === b[index]);
}

function bounded(paths) {
  return paths.slice(0, MAX_REPORTED_PATHS);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}


// --- mutation-finalize ----------------------------------------------------

// The one idempotent recovery verb. It answers in the work-claim domain because
// it changes Git reconciliation state, not item bytes: it never writes an item,
// never resets, amends, or force-updates a ref, and never rewrites history.
export async function finalizeFromRecoveryToken({ ledgerDirectory, token }) {
  const payload = parseRecoveryToken(token);
  if (payload === null) {
    return workClaimError('invalid-request', 'The mutation-finalize request is invalid.', 'unchanged', 2, {
      reason: 'recovery-token-invalid',
    });
  }
  let gitCommonDir;
  try {
    gitCommonDir = await resolveVerifiedGitCommonDir(ledgerDirectory, { failClosed: true });
  } catch {
    return claimStoreUnavailable('git-verification-failed');
  }
  const namespace = gitCommonDir ? await readNamespace(ledgerDirectory) : null;
  const capability = resolveWorkClaimCapability({ gitCommonDir, namespace });
  if (capability.mode !== 'merge-coordinated' || !capability.claim_protected_publication) {
    return claimStoreUnavailable(gitCommonDir ? 'ledger-namespace-unbound' : 'git-directory-not-found');
  }
  if (payload.ledger_namespace !== namespace) {
    return workClaimError('ledger-namespace-unbound',
      'The ledger namespace is not provisioned for this endpoint.', 'unchanged', 2, {
        requested_namespace: payload.ledger_namespace,
        provisioned_namespace: namespace,
      });
  }
  let placement;
  try {
    placement = await resolvePlacement(ledgerDirectory);
  } catch {
    return finalizeRefused('git-unavailable', {});
  }
  const mutexPath = path.join(placement.gitDir, 'wowbagger', 'auto-commit');
  try {
    return await withClaimLock(mutexPath, () => runFinalize({
      gitCommonDir, ledgerDirectory, namespace, payload, placement,
    }));
  } catch (error) {
    if (error?.code === 'CLAIM_LOCK_HELD') return finalizeRefused('mutex-held', {});
    throw error;
  }
}

async function runFinalize({ gitCommonDir, ledgerDirectory, namespace, payload, placement }) {
  const { root, prefix } = placement;
  const journalOwned = payload.command !== 'create';
  const logPath = ledgerRelative(ledgerDirectory, claimReconcileLogPath(path.resolve(ledgerDirectory), namespace));
  const witness = payload.terminal_witness ?? null;

  // Every path is re-derived from the ledger and the provisioned namespace. The
  // token only has to agree with what the ledger says; it never selects a path.
  let derived;
  try {
    derived = await locateItem(ledgerDirectory, payload.item_id);
  } catch {
    return finalizeRefused('item-not-readable', {});
  }
  const subject = commitSubject(payload.command, derived.number, derived.id);
  const digests = new Map(payload.commit_set.map((entry) => [entry.path, entry.sha256]));
  digests.set(derived.path, payload.published_revision);
  const head = await headOid(root);
  if (head === null) return finalizeRefused('unborn-head', {});
  const headUnchanged = head === payload.pre_commit_head;

  const tokenPaths = payload.commit_set.map((entry) => entry.path);
  let commitSet;
  if (headUnchanged) {
    const itemChanged = await itemDiffersFromHead(root, prefix, derived.path, payload.published_revision);
    commitSet = [
      ...(itemChanged ? [derived.path] : []),
      ...(journalOwned ? [logPath] : []),
    ].sort(compareText);
  } else {
    commitSet = [...tokenPaths].sort(compareText);
  }
  const allowedCommitSets = journalOwned
    ? [[logPath], [derived.path, logPath]]
    : [[derived.path]];
  const tokenMatchesMutation = allowedCommitSets.some((allowed) => sameSet(tokenPaths, allowed));
  if (payload.item_path !== derived.path
    || !tokenMatchesMutation
    || (headUnchanged && !sameSet(tokenPaths, commitSet))
    || payload.message !== subject) {
    return finalizeRefused('commit-set-mismatch', {
      expected_path: derived.path,
      commit_paths: commitSet,
    });
  }
  const gitPaths = commitSet.map((entry) => `${prefix}${entry}`);

  // The commit may already exist: a lost response is the same condition as a
  // failed commit, and both recover through this one command.
  if (!headUnchanged) {
    const verification = await verifyCommit(
      root, head, payload.pre_commit_head, subject, gitPaths, digests, prefix, witness,
    );
    if (!verification.ok) return finalizeRefused('head-changed', { pre_commit_head: payload.pre_commit_head });
    return finalizeVerified({
      commit: head, commitSet, derived, gitCommonDir, ledgerDirectory, namespace, payload,
    });
  }

  const refusal = await finalizePreconditions({
    commitSet, derived, digests, gitPaths, journalOwned, ledgerDirectory, logPath, payload, prefix, root, witness,
  });
  if (refusal) return finalizeRefused(refusal.reason, refusal.details);

  const staged = await git(root, ['add', '--pathspec-from-file=-', '--pathspec-file-nul'], {
    stdin: `${literalPathspecs(gitPaths).join('\0')}\0`,
  });
  const cached = await git(root, ['diff', '--cached', '--name-only', '-z']);
  if (cached.code !== 0 || !sameSet(splitNul(cached.stdout.toString('utf8')), gitPaths)) {
    return commitFailedInWorkClaim(payload, commitSet, digests, {
      stage: 'stage',
      reason: staged.code === 0 && cached.code === 0 ? 'tree-changed' : 'index-unavailable',
    });
  }
  let commit;
  try {
    commit = await commitExactSet(root, subject, gitPaths, payload.pre_commit_head, digests, prefix);
  } catch {
    return commitFailedInWorkClaim(payload, commitSet, digests, {
      stage: 'commit', reason: 'commit-command-failed',
    });
  }
  if (commit.outcome === 'failed') {
    return commitFailedInWorkClaim(payload, commitSet, digests, { stage: 'commit', reason: commit.reason });
  }
  if (commit.outcome === 'unknown') {
    return workClaimError('git-commit-outcome-unknown',
      'The Git commit outcome could not be determined.', 'unknown', 6, {
        ledger_namespace: payload.ledger_namespace,
        item_id: payload.item_id,
        published_revision: payload.published_revision,
        pre_commit_head: payload.pre_commit_head,
        failure_stage: commit.stage,
        reason: commit.reason,
      });
  }
  return finalizeVerified({
    commit: commit.commit, commitSet, derived, gitCommonDir, ledgerDirectory, namespace, payload,
  });
}

async function finalizePreconditions({
  commitSet, derived, digests, gitPaths, journalOwned, ledgerDirectory, logPath, payload, prefix, root, witness,
}) {
  let itemBytes;
  try {
    itemBytes = await readFile(path.join(path.resolve(ledgerDirectory), derived.path));
  } catch {
    return { reason: 'item-not-readable', details: {} };
  }
  if (revisionFor(itemBytes) !== payload.published_revision) {
    return { reason: 'item-changed', details: { published_revision: payload.published_revision } };
  }
  const observed = await inspectWorktree(root, prefix);
  // The failed attempt staged its own commit set and, by design, never unstaged
  // it. That residue is expected here; anything else staged is foreign work this
  // command must not absorb.
  const stagedOutside = observed.staged.filter((entry) => !gitPaths.includes(entry));
  if (stagedOutside.length > 0) {
    return { reason: 'staged-paths-present', details: { staged_paths: bounded(stagedOutside) } };
  }
  const stray = observed.dirtyLedger.filter((entry) => !commitSet.includes(entry));
  if (stray.length > 0) return { reason: 'ledger-not-clean', details: { dirty_paths: bounded(stray) } };
  if (!journalOwned) return null;
  let logBytes;
  try {
    logBytes = await readFile(path.join(path.resolve(ledgerDirectory), logPath));
  } catch {
    return { reason: 'log-unavailable', details: {} };
  }
  if (!carriesTerminal(logBytes.toString('utf8'), witness)) {
    return { reason: 'log-unavailable', details: {} };
  }
  const expected = digests.get(logPath) ?? null;
  if (expected !== null && revisionFor(logBytes) !== expected) {
    return { reason: 'log-changed', details: {} };
  }
  digests.set(logPath, revisionFor(logBytes));
  return null;
}

async function finalizeVerified({
  commit, commitSet, derived, gitCommonDir, ledgerDirectory, namespace, payload,
}) {
  const reconciled = await verifyClaimJournal({
    ledgerDirectory,
    gitCommonDir,
    namespace,
    targetItemId: derived.id,
  });
  const operationId = payload.operation_id ?? null;
  const reconciliation = reconciliationFailureReason(reconciled, commit, operationId, derived.id);
  if (reconciliation) {
    return workClaimError('post-commit-reconciliation-failed',
      'The Git commit is established, but claim reconciliation did not verify.', 'committed', 6, {
        ledger_namespace: namespace,
        item_id: derived.id,
        ...(operationId === null ? {} : { operation_id: operationId }),
        git_commit: commit,
        commit_paths: commitSet,
        reason: reconciliation.reason,
        findings: reconciliation.findings,
      });
  }
  return {
    exit: 0,
    stdout: {
      ok: true,
      namespace: 'work-claim',
      command: 'mutation-finalize',
      contract_version: 1,
      state: 'committed',
      result: {
        ledger_namespace: namespace,
        item_id: derived.id,
        ...(operationId === null ? {} : { operation_id: operationId }),
        published_revision: payload.published_revision,
        git_commit: commit,
        commit_paths: commitSet,
        claim_verified: true,
      },
    },
  };
}

function commitFailedInWorkClaim(payload, commitSet, digests, failure) {
  return workClaimError('git-commit-failed',
    'The item is published, but its Git commit was not established.', 'unchanged', 6, {
      ledger_namespace: payload.ledger_namespace,
      item_id: payload.item_id,
      published_revision: payload.published_revision,
      commit_set: commitSet.map((entry) => ({ path: entry, sha256: digests.get(entry) ?? null })),
      pre_commit_head: payload.pre_commit_head,
      failure_stage: failure.stage,
      reason: failure.reason,
    });
}

function finalizeRefused(reason, details) {
  return workClaimError('mutation-finalize-refused',
    'Recovery refused before any Git write.', 'unchanged', 4, { reason, ...details });
}

function claimStoreUnavailable(reason) {
  return workClaimError('claim-store-unavailable', 'The durable claim store is unavailable.', 'unchanged', 6, {
    reason,
  });
}

function workClaimError(code, message, state, exit, details) {
  return {
    exit,
    stdout: {
      ok: false,
      namespace: 'work-claim',
      command: 'mutation-finalize',
      contract_version: 1,
      state,
      error: { code, message, details },
    },
  };
}
