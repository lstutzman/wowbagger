// Every proven post-publication Git failure, and the one precondition Git can
// answer before publication.
//
// The rule these fixtures pin: a failure that proves the item is published and
// the commit is absent is git-commit-failed; a failure that leaves the Git
// outcome genuinely ambiguous is git-commit-outcome-unknown. Nothing here rolls
// back an item, retries a commit, or rewrites history.
import assert from 'node:assert/strict';
import { appendFile, chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  ITEM_ID,
  SECOND_ITEM_ID,
  git,
  ledgerFile,
  pausedRun,
  provisionedLedger,
  requestFile,
  run,
  sha256,
  transitionRequest,
  tryGit,
} from './auto-commit-fixture.js';

async function twoItems() {
  return provisionedLedger({ items: [[ITEM_ID, 1], [SECOND_ITEM_ID, 2]] });
}

function assertHeadUnchanged(fixture, head) {
  assert.equal(git(fixture.root, 'rev-parse', 'HEAD'), head);
  assert.equal(git(fixture.root, 'diff', '--cached', '--name-only'), '');
}

// A recovery token is opaque to a consumer. These tests only read the members
// the contract promises, by decoding what the CLI emitted.
function decodeToken(token) {
  return JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
}

async function hook(fixture, name, script) {
  const directory = path.join(fixture.base, 'hooks');
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, name);
  await writeFile(file, script);
  await chmod(file, 0o755);
  git(fixture.root, 'config', 'core.hooksPath', directory);
}

test('missing Git identity refuses before the mutation', async () => {
  const fixture = await twoItems();
  git(fixture.root, 'config', '--unset', 'user.email');
  git(fixture.root, 'config', '--unset', 'user.name');
  git(fixture.root, 'config', 'user.useConfigOnly', 'true');
  const head = git(fixture.root, 'rev-parse', 'HEAD');
  const request = await requestFile(fixture, 'transition.json', transitionRequest(fixture));

  // An empty file rather than /dev/null: the point is that Git finds no
  // identity outside the repository, and only POSIX has that device node.
  const emptyConfig = path.join(fixture.base, 'empty-git-config');
  await writeFile(emptyConfig, '');

  // CI jobs export GIT_AUTHOR_*/GIT_COMMITTER_* for the fixtures that need an
  // identity; this test needs Git to find none anywhere, so those variables
  // are removed from the child (spawn omits keys whose value is undefined).
  const result = run(fixture.root, 'transition', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit', {
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_CONFIG_SYSTEM: emptyConfig,
    GIT_AUTHOR_NAME: undefined,
    GIT_AUTHOR_EMAIL: undefined,
    GIT_COMMITTER_NAME: undefined,
    GIT_COMMITTER_EMAIL: undefined,
  });

  assert.equal(result.exit, 4, result.stdout);
  assert.equal(result.envelope.state, 'unchanged');
  assert.equal(result.envelope.error.code, 'auto-commit-preflight-failed');
  assert.equal(result.envelope.error.details.reason, 'identity-unavailable');
  assert.equal(await ledgerFile(fixture, `items/${ITEM_ID}.md`), fixture.sources.get(ITEM_ID));
  assertHeadUnchanged(fixture, head);
});

test('a reconciliation log that lost this invocation terminal is git-commit-failed', async () => {
  const fixture = await twoItems();
  const request = await requestFile(fixture, 'transition.json', transitionRequest(fixture));
  const head = git(fixture.root, 'rev-parse', 'HEAD');

  const paused = pausedRun(fixture, 'log', [
    'transition', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit',
  ]);
  await paused.published;
  // The legacy coordinator treats a log write failure as rebuildable and still
  // returns the item outcome. Auto mode must name that, not commit the item
  // alone.
  await writeFile(path.join(fixture.ledger, fixture.logPath), '# Wowbagger reconciliation log\n\n```jsonl\n```\n');
  const result = await paused.release();

  assert.equal(result.exit, 6, result.stdout);
  assert.equal(result.envelope.state, 'committed');
  assert.equal(result.envelope.error.code, 'git-commit-failed');
  assert.equal(result.envelope.error.details.failure_stage, 'prepare-commit-set');
  assert.equal(result.envelope.error.details.reason, 'log-unavailable');
  assert.equal(result.envelope.error.details.expected_path, `items/${ITEM_ID}.md`);
  assert.deepEqual(
    result.envelope.error.details.commit_set.map((entry) => entry.path),
    [fixture.logPath, `items/${ITEM_ID}.md`],
  );
  // The log digest was never observed, so the token carries a null for it and
  // mutation-finalize must re-derive and re-check that path.
  const token = decodeToken(result.envelope.error.details.recovery_token);
  assert.equal(token.commit_set.find((entry) => entry.path === fixture.logPath).sha256, null);
  assert.equal(
    token.commit_set.find((entry) => entry.path === `items/${ITEM_ID}.md`).sha256,
    result.envelope.error.details.published_revision,
  );
  assertHeadUnchanged(fixture, head);
});

test('a missing reconciliation log is git-commit-failed', async () => {
  const fixture = await twoItems();
  const request = await requestFile(fixture, 'transition.json', transitionRequest(fixture));
  const head = git(fixture.root, 'rev-parse', 'HEAD');

  const paused = pausedRun(fixture, 'nolog', [
    'transition', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit',
  ]);
  await paused.published;
  await rm(path.join(fixture.ledger, fixture.logPath));
  const result = await paused.release();

  assert.equal(result.exit, 6, result.stdout);
  assert.equal(result.envelope.error.code, 'git-commit-failed');
  assert.equal(result.envelope.error.details.reason, 'log-unavailable');
  assertHeadUnchanged(fixture, head);
});

test('a held index at stage time is git-commit-failed', async () => {
  const fixture = await twoItems();
  const request = await requestFile(fixture, 'transition.json', transitionRequest(fixture));
  const head = git(fixture.root, 'rev-parse', 'HEAD');
  const gitDir = git(fixture.root, 'rev-parse', '--absolute-git-dir');

  const paused = pausedRun(fixture, 'index', [
    'transition', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit',
  ]);
  await paused.published;
  await writeFile(path.join(gitDir, 'index.lock'), '');
  const result = await paused.release();

  assert.equal(result.exit, 6, result.stdout);
  assert.equal(result.envelope.state, 'committed');
  assert.equal(result.envelope.error.code, 'git-commit-failed');
  assert.equal(result.envelope.error.details.reason, 'index-unavailable');
  assert.equal(typeof result.envelope.error.details.recovery_token, 'string');
  await rm(path.join(gitDir, 'index.lock'));
  assertHeadUnchanged(fixture, head);
});

test('HEAD movement after publication is git-commit-failed', async () => {
  const fixture = await twoItems();
  const request = await requestFile(fixture, 'transition.json', transitionRequest(fixture));
  const head = git(fixture.root, 'rev-parse', 'HEAD');

  const paused = pausedRun(fixture, 'head', [
    'transition', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit',
  ]);
  await paused.published;
  await writeFile(path.join(fixture.root, 'outside.txt'), 'foreign commit\n');
  git(fixture.root, 'add', 'outside.txt');
  git(fixture.root, 'commit', '-qm', 'A foreign commit');
  const moved = git(fixture.root, 'rev-parse', 'HEAD');
  const result = await paused.release();

  assert.equal(result.exit, 6, result.stdout);
  assert.equal(result.envelope.error.code, 'git-commit-failed');
  assert.equal(result.envelope.error.details.reason, 'head-changed');
  assert.equal(result.envelope.error.details.pre_commit_head, head);
  assert.equal(git(fixture.root, 'rev-parse', 'HEAD'), moved);
  assert.equal(git(fixture.root, 'diff', '--cached', '--name-only'), '');
  assert.notEqual(moved, head);
});

test('a pre-commit hook refusal through core.hooksPath is git-commit-failed', async () => {
  const fixture = await twoItems();
  await hook(fixture, 'pre-commit', '#!/bin/sh\nexit 1\n');
  const head = git(fixture.root, 'rev-parse', 'HEAD');
  const request = await requestFile(fixture, 'transition.json', transitionRequest(fixture));

  const result = run(fixture.root, 'transition', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit');

  assert.equal(result.exit, 6, result.stdout);
  assert.equal(result.envelope.state, 'committed');
  assert.equal(result.envelope.error.code, 'git-commit-failed');
  assert.equal(result.envelope.error.details.failure_stage, 'commit');
  assert.equal(result.envelope.error.details.reason, 'commit-command-failed');
  // The hook ran, so --no-verify was never passed.
  assert.equal(git(fixture.root, 'rev-parse', 'HEAD'), head);
  // The item is published; nothing rolled it back.
  assert.equal(
    result.envelope.error.details.published_revision,
    sha256(await ledgerFile(fixture, `items/${ITEM_ID}.md`)),
  );
  assert.equal(typeof result.envelope.error.details.recovery_token, 'string');
  assert.doesNotMatch(result.stderr, /-----BEGIN|hook|pre-commit/u);
});

test('a signing failure with commit.gpgSign is git-commit-failed', async () => {
  const fixture = await twoItems();
  const signer = path.join(fixture.base, 'failing-gpg.sh');
  await writeFile(signer, '#!/bin/sh\necho "signing refused" >&2\nexit 1\n');
  await chmod(signer, 0o755);
  git(fixture.root, 'config', 'commit.gpgSign', 'true');
  git(fixture.root, 'config', 'gpg.program', signer);
  git(fixture.root, 'config', 'user.signingKey', 'fixture-key');
  const head = git(fixture.root, 'rev-parse', 'HEAD');
  const request = await requestFile(fixture, 'transition.json', transitionRequest(fixture));

  const result = run(fixture.root, 'transition', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit');

  assert.equal(result.exit, 6, result.stdout);
  assert.equal(result.envelope.error.code, 'git-commit-failed');
  assert.equal(result.envelope.error.details.failure_stage, 'commit');
  assert.equal(result.envelope.error.details.reason, 'commit-command-failed');
  assert.equal(git(fixture.root, 'rev-parse', 'HEAD'), head);
  assert.doesNotMatch(result.stdout, /signing refused/u);
});

test('a commit-msg hook that rewrites the subject is git-commit-outcome-unknown', async () => {
  const fixture = await twoItems();
  await hook(fixture, 'commit-msg', '#!/bin/sh\necho "rewritten by a hook" > "$1"\n');
  const head = git(fixture.root, 'rev-parse', 'HEAD');
  const request = await requestFile(fixture, 'transition.json', transitionRequest(fixture));

  const result = run(fixture.root, 'transition', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit');

  assert.equal(result.exit, 6, result.stdout);
  assert.equal(result.envelope.state, 'committed');
  assert.equal(result.envelope.error.code, 'git-commit-outcome-unknown');
  assert.equal(result.envelope.error.details.reason, 'commit-scope-mismatch');
  // A commit exists, but it is not the commit this invocation prepared, so the
  // module reports ambiguity and rewrites nothing.
  assert.notEqual(git(fixture.root, 'rev-parse', 'HEAD'), head);
  assert.equal(git(fixture.root, 'log', '-1', '--format=%s'), 'rewritten by a hook');
  assert.equal(typeof result.envelope.error.details.recovery_token, 'string');
});

test('a post-commit reconciliation failure names the commit it already created', async () => {
  const fixture = await twoItems();
  const request = await requestFile(fixture, 'transition.json', transitionRequest(fixture));
  const gitCommonDir = git(fixture.root, 'rev-parse', '--path-format=absolute', '--git-common-dir');
  const journal = path.join(gitCommonDir, 'wowbagger', fixture.namespace, 'journal.ndjson');

  const paused = pausedRun(fixture, 'reconcile', [
    'transition', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit',
  ]);
  await paused.published;
  // A second, unresolvable legacy attempt appears in the authoritative journal
  // after this invocation's own preflight passed. The journal lives in the Git
  // common directory, so it is not ledger dirt.
  const entries = (await readFile(journal, 'utf8')).split('\n').filter(Boolean);
  await appendFile(journal, `${JSON.stringify({
    seq: entries.length + 1,
    type: 'legacy-mutation-intent',
    attempt_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    ledger_namespace: fixture.namespace,
    item_id: SECOND_ITEM_ID,
    command: 'patch-v1',
    expected_revision: sha256('an unrelated expectation'),
    candidate_revision: sha256('an unrelated candidate'),
    observed_at: '2026-08-17T00:00:00.000Z',
  })}\n`);
  const result = await paused.release();

  assert.equal(result.exit, 6, result.stdout);
  assert.equal(result.envelope.state, 'committed');
  assert.equal(result.envelope.error.code, 'post-commit-reconciliation-failed');
  assert.equal(result.envelope.error.details.reason, 'claim-verify-refused');
  const commit = result.envelope.error.details.git_commit;
  assert.equal(commit, git(fixture.root, 'rev-parse', 'HEAD'));
  assert.deepEqual(result.envelope.error.details.commit_paths, [fixture.logPath, `items/${ITEM_ID}.md`]);
  assert.ok(result.envelope.error.details.findings.length > 0);
  // The commit stands. Reconciliation failing is not a reason to rewrite it.
  assert.equal(git(fixture.root, 'log', '-1', '--format=%s'), 'wowbagger: transition item #1');
});

test('post-commit reconciliation preserves a claim-store lock refusal', async () => {
  const fixture = await twoItems();
  const request = await requestFile(fixture, 'transition-lock.json', transitionRequest(fixture));
  const gitCommonDir = git(fixture.root, 'rev-parse', '--path-format=absolute', '--git-common-dir');
  const lockPath = path.join(
    gitCommonDir,
    'wowbagger',
    `claims-${fixture.namespace}.json.lock`,
  );
  const paused = pausedRun(fixture, 'reconcile-lock', [
    'transition', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit',
  ]);
  await paused.published;
  await mkdir(path.dirname(lockPath), { recursive: true });
  await writeFile(lockPath, '');
  let result;
  try {
    result = await paused.release();
  } finally {
    await rm(lockPath, { force: true });
  }

  assert.equal(result.exit, 6, result.stdout);
  assert.equal(result.envelope.state, 'committed');
  assert.equal(result.envelope.error.code, 'post-commit-reconciliation-failed');
  assert.equal(result.envelope.error.details.reason, 'claim-verify-refused');
  assert.equal(result.envelope.error.details.claim_verify_code, 'claim-store-unavailable');
  assert.equal(result.envelope.error.details.claim_verify_reason, 'claim-store-locked');
  assert.equal(Object.hasOwn(result.envelope.error.details, 'findings'), false);
});

test('an item that no longer holds the published bytes is git-commit-failed', async () => {
  const fixture = await twoItems();
  const request = await requestFile(fixture, 'transition.json', transitionRequest(fixture));
  const head = git(fixture.root, 'rev-parse', 'HEAD');

  const paused = pausedRun(fixture, 'bytes', [
    'transition', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit',
  ]);
  await paused.published;
  const published = await ledgerFile(fixture, `items/${ITEM_ID}.md`);
  await writeFile(
    path.join(fixture.ledger, 'items', `${ITEM_ID}.md`),
    published.replace('title: "Before"', 'title: "Overwritten after publication"'),
  );
  const result = await paused.release();

  assert.equal(result.exit, 6, result.stdout);
  assert.equal(result.envelope.state, 'committed');
  assert.equal(result.envelope.error.code, 'git-commit-failed');
  assert.equal(result.envelope.error.details.failure_stage, 'prepare-commit-set');
  assert.equal(result.envelope.error.details.reason, 'tree-changed');
  // The reported revision is the one the mutation published, not the bytes now
  // on disk.
  assert.equal(result.envelope.error.details.published_revision, sha256(published));
  assertHeadUnchanged(fixture, head);
});

test('a pre-commit hook that alters a committed path is git-commit-outcome-unknown', async () => {
  const fixture = await twoItems();
  // The hook rewrites the item inside the commit it is verifying. Whatever git
  // does with that, the module must not report the commit it prepared.
  await hook(fixture, 'pre-commit', `#!/bin/sh
printf 'appended by a hook\\n' >> ledger/items/${ITEM_ID}.md
git add ledger/items/${ITEM_ID}.md
`);
  const request = await requestFile(fixture, 'transition.json', transitionRequest(fixture));

  const result = run(fixture.root, 'transition', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit');

  assert.equal(result.exit, 6, result.stdout);
  assert.equal(result.envelope.state, 'committed');
  assert.equal(result.envelope.error.code, 'git-commit-outcome-unknown');
  assert.equal(result.envelope.error.details.reason, 'commit-scope-mismatch');
  assert.equal(typeof result.envelope.error.details.recovery_token, 'string');
});

test('a pre-commit hook that adds a foreign path is git-commit-outcome-unknown', async () => {
  const fixture = await twoItems();
  await hook(fixture, 'pre-commit', `#!/bin/sh
printf 'added by a hook\\n' >> ledger/items/${SECOND_ITEM_ID}.md
git add ledger/items/${SECOND_ITEM_ID}.md
`);
  const request = await requestFile(fixture, 'transition.json', transitionRequest(fixture));

  const result = run(fixture.root, 'transition', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit');

  assert.equal(result.exit, 6, result.stdout);
  assert.equal(result.envelope.error.code, 'git-commit-outcome-unknown');
  assert.equal(result.envelope.error.details.reason, 'commit-scope-mismatch');
});

test('an ignored but tracked ledger path still commits, and an ignored untracked one stays out', async () => {
  const fixture = await twoItems();
  // An operator ignored the tracked reconciliation log. .gitignore does not
  // untrack it, so git add stages it and exits nonzero about the directory. The
  // cached path set, not that exit status, decides.
  await writeFile(path.join(fixture.root, '.gitignore'), 'ledger/.wowbagger/\n');
  git(fixture.root, 'add', '.gitignore');
  git(fixture.root, 'commit', '-qm', 'Ignore the wowbagger metadata');
  const request = await requestFile(fixture, 'transition.json', transitionRequest(fixture));

  const result = run(fixture.root, 'transition', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit');

  assert.equal(result.exit, 0, result.stdout);
  assert.deepEqual(result.envelope.result.commit_paths, [fixture.logPath, `items/${ITEM_ID}.md`]);
  assert.equal(git(fixture.root, 'status', '--porcelain=v1', '--untracked-files=all'), '');
  // An ignored path that was never tracked is not in the commit set, so it
  // never enters the commit.
  await writeFile(path.join(fixture.ledger, '.wowbagger', 'scratch.json'), '{}\n');
  const second = await requestFile(fixture, 'second.json', {
    id: SECOND_ITEM_ID,
    expected_revision: sha256(fixture.sources.get(SECOND_ITEM_ID)),
    date: '2026-08-17',
    set: { priority: 20 },
  });
  const again = run(fixture.root, 'patch', '--ledger', fixture.ledger, '--input', second, '--json', '--auto-commit');
  assert.equal(again.exit, 0, again.stdout);
  assert.deepEqual(again.envelope.result.commit_paths, [fixture.logPath, `items/${SECOND_ITEM_ID}.md`]);
  assert.equal(
    git(fixture.root, 'diff-tree', '--no-commit-id', '--name-only', '-r', again.envelope.result.git_commit)
      .includes('scratch.json'),
    false,
  );
});

test('no failure envelope leaks hook output, signing output, or an absolute path', async () => {
  const fixture = await twoItems();
  await hook(fixture, 'pre-commit', '#!/bin/sh\necho "SECRET-HOOK-OUTPUT"\nexit 1\n');
  const request = await requestFile(fixture, 'transition.json', transitionRequest(fixture));

  const result = run(fixture.root, 'transition', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit');

  assert.equal(result.exit, 6, result.stdout);
  assert.doesNotMatch(result.stdout, /SECRET-HOOK-OUTPUT/u);
  // The root is a literal, not a pattern: regex-escape it (win32 roots carry backslashes).
  assert.doesNotMatch(result.stdout, new RegExp(fixture.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'));
  const details = result.envelope.error.details;
  assert.deepEqual(Object.keys(details).sort(), [
    'commit_set',
    'expected_path',
    'failure_stage',
    'id',
    'pre_commit_head',
    'published_revision',
    'reason',
    'recovery_token',
  ]);
});

test('a git repository the ledger is not inside refuses the flag', async () => {
  const fixture = await twoItems();
  // Removing the whole Git directory makes the checkout unverifiable.
  await rm(path.join(fixture.root, '.git'), { force: true, recursive: true });
  const request = await requestFile(fixture, 'transition.json', transitionRequest(fixture));

  const result = run(fixture.root, 'transition', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit');

  assert.equal(result.exit, 5, result.stdout);
  assert.equal(result.envelope.error.code, 'capability-unavailable');
  assert.equal(result.envelope.state, 'unchanged');
  assert.equal(tryGit(fixture.root, 'rev-parse', 'HEAD').exit === 0, false);
});
