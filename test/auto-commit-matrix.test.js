// The two matrices the design stands on.
//
// Dirty state: only unstaged and untracked paths OUTSIDE the ledger are allowed,
// and they stay byte-identical. Refusals: no refused or unknown mutation ever
// creates a commit or moves HEAD or the index, log side effects included.
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  ITEM_ID,
  SECOND_ITEM_ID,
  createRequest,
  git,
  itemSource,
  ledgerFile,
  pausedRun,
  patchRequest,
  provisionedLedger,
  requestFile,
  run,
  sha256,
  transitionRequest,
} from './auto-commit-fixture.js';

// The state a refusal must leave untouched.
function snapshot(fixture) {
  return {
    head: git(fixture.root, 'rev-parse', 'HEAD'),
    staged: git(fixture.root, 'diff', '--cached', '--name-only'),
    log: git(fixture.root, 'log', '--format=%H'),
  };
}

function assertNoCommit(fixture, before) {
  const after = snapshot(fixture);
  assert.equal(after.head, before.head, 'HEAD must not move');
  assert.equal(after.staged, before.staged, 'the index must not change');
  assert.equal(after.log, before.log, 'no commit may be created');
}

async function twoItems() {
  return provisionedLedger({ items: [[ITEM_ID, 1], [SECOND_ITEM_ID, 2]] });
}

// --- dirty-state matrix ---------------------------------------------------

test('a staged path outside the ledger refuses before the mutation', async () => {
  const fixture = await twoItems();
  await writeFile(path.join(fixture.root, 'outside.txt'), 'staged\n');
  git(fixture.root, 'add', 'outside.txt');
  const before = snapshot(fixture);
  const request = await requestFile(fixture, 'transition.json', transitionRequest(fixture));

  const result = run(fixture.root, 'transition', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit');

  assert.equal(result.exit, 4, result.stdout);
  assert.equal(result.envelope.state, 'unchanged');
  assert.equal(result.envelope.error.code, 'auto-commit-preflight-failed');
  assert.equal(result.envelope.error.details.reason, 'staged-paths-present');
  assert.deepEqual(result.envelope.error.details.staged_paths, ['outside.txt']);
  assert.equal(await ledgerFile(fixture, `items/${ITEM_ID}.md`), fixture.sources.get(ITEM_ID));
  assertNoCommit(fixture, before);
});

test('a staged path inside the ledger refuses before the mutation', async () => {
  const fixture = await twoItems();
  await writeFile(
    path.join(fixture.ledger, 'items', `${SECOND_ITEM_ID}.md`),
    itemSource(SECOND_ITEM_ID, { number: 2, title: 'Foreign staged' }),
  );
  git(fixture.root, 'add', `ledger/items/${SECOND_ITEM_ID}.md`);
  const before = snapshot(fixture);
  const request = await requestFile(fixture, 'transition.json', transitionRequest(fixture));

  const result = run(fixture.root, 'transition', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit');

  assert.equal(result.exit, 4, result.stdout);
  assert.equal(result.envelope.error.details.reason, 'staged-paths-present');
  assert.equal(await ledgerFile(fixture, `items/${ITEM_ID}.md`), fixture.sources.get(ITEM_ID));
  assertNoCommit(fixture, before);
});

test('an unstaged change inside the ledger refuses before the mutation', async () => {
  const fixture = await twoItems();
  await writeFile(
    path.join(fixture.ledger, 'items', `${SECOND_ITEM_ID}.md`),
    itemSource(SECOND_ITEM_ID, { number: 2, title: 'Foreign unstaged' }),
  );
  const before = snapshot(fixture);
  const request = await requestFile(fixture, 'transition.json', transitionRequest(fixture));

  const result = run(fixture.root, 'transition', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit');

  assert.equal(result.exit, 4, result.stdout);
  assert.equal(result.envelope.error.details.reason, 'ledger-not-clean');
  assert.deepEqual(result.envelope.error.details.dirty_paths, [`items/${SECOND_ITEM_ID}.md`]);
  assertNoCommit(fixture, before);
});

test('an untracked path inside the ledger refuses before the mutation', async () => {
  const fixture = await twoItems();
  await writeFile(path.join(fixture.ledger, 'notes.txt'), 'untracked\n');
  const before = snapshot(fixture);
  const request = await requestFile(fixture, 'transition.json', transitionRequest(fixture));

  const result = run(fixture.root, 'transition', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit');

  assert.equal(result.exit, 4, result.stdout);
  assert.equal(result.envelope.error.details.reason, 'ledger-not-clean');
  assert.deepEqual(result.envelope.error.details.dirty_paths, ['notes.txt']);
  assertNoCommit(fixture, before);
});

test('journal-owning auto-commit rebuilds prior claim-generated log dirt', async () => {
  const fixture = await twoItems();
  const acquire = await requestFile(fixture, 'acquire-dirty-log.json', {
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
    owner_id: 'agent-a',
    lease_duration_ms: 300000,
    expected: { last_epoch: '0', active: null },
  });
  const acquired = run(fixture.root, 'claim', 'acquire', '--ledger', fixture.ledger, '--input', acquire, '--json');
  assert.equal(acquired.exit, 0, acquired.stdout);
  assert.equal(
    git(fixture.root, 'status', '--porcelain', '--', `ledger/${fixture.logPath}`),
    `M ledger/${fixture.logPath}`,
  );
  const request = await requestFile(fixture, 'patch-after-claim.json', patchRequest(fixture, SECOND_ITEM_ID));

  const result = run(fixture.root, 'patch', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit');

  assert.equal(result.exit, 0, result.stdout);
  assert.deepEqual(result.envelope.result.commit_paths, [fixture.logPath, `items/${SECOND_ITEM_ID}.md`]);
  assert.equal(git(fixture.root, 'status', '--porcelain', '--', 'ledger'), '');
});

test('journal-owning auto-commit rebuilds a tampered derived log', async () => {
  const fixture = await twoItems();
  await writeFile(path.join(fixture.ledger, fixture.logPath), 'tampered\n');
  const request = await requestFile(fixture, 'patch-after-tampered-log.json', patchRequest(fixture, SECOND_ITEM_ID));

  const result = run(fixture.root, 'patch', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit');

  assert.equal(result.exit, 0, result.stdout);
  assert.deepEqual(result.envelope.result.commit_paths, [fixture.logPath, `items/${SECOND_ITEM_ID}.md`]);
  assert.doesNotMatch(await ledgerFile(fixture, fixture.logPath), /tampered/u);
  assert.equal(git(fixture.root, 'status', '--porcelain', '--', 'ledger'), '');
});

test('create auto-commit still refuses a dirty derived log', async () => {
  const fixture = await twoItems();
  await writeFile(path.join(fixture.ledger, fixture.logPath), 'tampered\n');
  const createdId = 'wb_01KZBMBEZKPE7D15HKW9Q3GT02';
  const request = await requestFile(fixture, 'create-with-dirty-log.json', createRequest(createdId));

  const result = run(fixture.root, 'create', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit');

  assert.equal(result.exit, 4, result.stdout);
  assert.equal(result.envelope.error.details.reason, 'ledger-not-clean');
  assert.deepEqual(result.envelope.error.details.dirty_paths, [fixture.logPath]);
});

test('unstaged and untracked paths outside the ledger are allowed and stay uncommitted', async () => {
  const fixture = await twoItems();
  await writeFile(path.join(fixture.root, 'README.md'), 'tracked outside\n');
  git(fixture.root, 'add', 'README.md');
  git(fixture.root, 'commit', '-qm', 'Add an outside file');
  await writeFile(path.join(fixture.root, 'README.md'), 'edited outside\n');
  await writeFile(path.join(fixture.root, 'scratch.txt'), 'untracked outside\n');
  const request = await requestFile(fixture, 'transition.json', transitionRequest(fixture));

  const result = run(fixture.root, 'transition', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit');

  assert.equal(result.exit, 0, result.stdout);
  assert.deepEqual(result.envelope.result.commit_paths, [fixture.logPath, `items/${ITEM_ID}.md`]);
  const commit = git(fixture.root, 'rev-parse', 'HEAD');
  assert.equal(
    git(fixture.root, 'diff-tree', '--no-commit-id', '--name-only', '-r', commit).split('\n').sort().join(','),
    [`ledger/${fixture.logPath}`, `ledger/items/${ITEM_ID}.md`].sort().join(','),
  );
  assert.equal(await readFile(path.join(fixture.root, 'README.md'), 'utf8'), 'edited outside\n');
  assert.equal(await readFile(path.join(fixture.root, 'scratch.txt'), 'utf8'), 'untracked outside\n');
  assert.equal(
    git(fixture.root, 'status', '--porcelain=v1', '--untracked-files=all'),
    'M README.md\n?? scratch.txt',
  );
});

test('a late foreign ledger change after publication is a named git-commit-failed', async () => {
  const fixture = await twoItems();
  const request = await requestFile(fixture, 'transition.json', transitionRequest(fixture));
  const before = snapshot(fixture);

  const paused = pausedRun(fixture, 'late', [
    'transition', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit',
  ]);
  await paused.published;
  await writeFile(
    path.join(fixture.ledger, 'items', `${SECOND_ITEM_ID}.md`),
    itemSource(SECOND_ITEM_ID, { number: 2, title: 'Late foreign' }),
  );
  const result = await paused.release();

  assert.equal(result.exit, 6, result.stdout);
  assert.equal(result.envelope.state, 'committed');
  assert.equal(result.envelope.error.code, 'git-commit-failed');
  assert.equal(result.envelope.error.details.failure_stage, 'prepare-commit-set');
  assert.equal(result.envelope.error.details.reason, 'tree-changed');
  assert.equal(
    result.envelope.error.details.published_revision,
    sha256(await ledgerFile(fixture, `items/${ITEM_ID}.md`)),
  );
  assert.equal(typeof result.envelope.error.details.recovery_token, 'string');
  assertNoCommit(fixture, before);
});

// --- refusal matrix -------------------------------------------------------

test('an invalid request refuses before any preflight and creates no commit', async () => {
  const fixture = await twoItems();
  const before = snapshot(fixture);
  const request = await requestFile(fixture, 'bad.json', { id: ITEM_ID, expected_revision: 'nope', to_status: 'in-progress', date: '2026-08-17' });

  const result = run(fixture.root, 'transition', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit');

  assert.equal(result.exit, 2, result.stdout);
  assert.equal(result.envelope.error.code, 'invalid-request');
  assert.equal(result.envelope.state, 'unchanged');
  assertNoCommit(fixture, before);
});

test('an invalid ledger refuses in the preflight with ledger-invalid and creates no commit', async () => {
  const fixture = await twoItems();
  // A duplicate number makes the complete ledger invalid without touching the
  // target item.
  await writeFile(
    path.join(fixture.ledger, 'items', `${SECOND_ITEM_ID}.md`),
    itemSource(SECOND_ITEM_ID, { number: 1, title: 'Duplicate number' }),
  );
  git(fixture.root, 'add', '.');
  git(fixture.root, 'commit', '-qm', 'Break the ledger');
  const before = snapshot(fixture);
  const request = await requestFile(fixture, 'transition.json', transitionRequest(fixture));

  const result = run(fixture.root, 'transition', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit');

  assert.equal(result.exit, 3, result.stdout);
  assert.equal(result.envelope.error.code, 'ledger-invalid');
  assert.equal(result.envelope.state, 'unchanged');
  assert.ok(result.envelope.error.details.validation_errors.length > 0);
  assertNoCommit(fixture, before);
});

test('a revision conflict returns unchanged, keeps ledger bytes identical, and creates no commit', async () => {
  const fixture = await twoItems();
  const before = snapshot(fixture);
  const logBefore = await ledgerFile(fixture, fixture.logPath);
  const request = await requestFile(fixture, 'transition.json', transitionRequest(fixture, ITEM_ID, {
    expected_revision: sha256('a different revision'),
  }));

  const result = run(fixture.root, 'transition', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit');

  assert.equal(result.exit, 4, result.stdout);
  assert.equal(result.envelope.error.code, 'revision-conflict');
  assert.equal(result.envelope.state, 'unchanged');
  assert.equal(await ledgerFile(fixture, `items/${ITEM_ID}.md`), fixture.sources.get(ITEM_ID));
  assert.equal(await ledgerFile(fixture, fixture.logPath), logBefore);
  assertNoCommit(fixture, before);
});

test('an active-claim refusal answers in the ledger-mutation domain and creates no commit', async () => {
  const fixture = await twoItems();
  const acquire = await requestFile(fixture, 'acquire.json', {
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
    owner_id: 'agent-a',
    lease_duration_ms: 300000,
    expected: { last_epoch: '0', active: null },
  });
  const acquired = run(fixture.root, 'claim', 'acquire', '--ledger', fixture.ledger, '--input', acquire, '--json');
  assert.equal(acquired.exit, 0, acquired.stdout);
  // Acquiring projects into the tracked log, so the documented loop commits it
  // before the next mutation.
  git(fixture.root, 'add', '.');
  git(fixture.root, 'commit', '-qm', 'Commit the claim');
  const before = snapshot(fixture);
  const logBefore = await ledgerFile(fixture, fixture.logPath);
  const request = await requestFile(fixture, 'transition.json', transitionRequest(fixture));

  const result = run(fixture.root, 'transition', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit');

  assert.equal(result.exit, 4, result.stdout);
  assert.equal(result.envelope.namespace, 'ledger-mutation');
  assert.equal(result.envelope.error.code, 'active-claim-write-refused');
  assert.equal(result.envelope.state, 'unchanged');
  assert.equal(await ledgerFile(fixture, `items/${ITEM_ID}.md`), fixture.sources.get(ITEM_ID));
  assert.equal(await ledgerFile(fixture, fixture.logPath), logBefore);
  assertNoCommit(fixture, before);
});

test('parent-migrate fence refusals identify the parent-migrate command', async () => {
  const fixture = await twoItems();
  const acquire = await requestFile(fixture, 'parent-acquire.json', {
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
    owner_id: 'agent-a',
    lease_duration_ms: 300000,
    expected: { last_epoch: '0', active: null },
  });
  const acquired = run(fixture.root, 'claim', 'acquire', '--ledger', fixture.ledger, '--input', acquire, '--json');
  assert.equal(acquired.exit, 0, acquired.stdout);
  git(fixture.root, 'add', '.');
  git(fixture.root, 'commit', '-qm', 'Commit parent claim');

  const request = await requestFile(fixture, 'parent-migrate.json', {
    id: ITEM_ID,
    expected_revision: sha256(fixture.sources.get(ITEM_ID)),
    expected_parent: null,
    parent: null,
    date: '2026-08-17',
  });
  const result = run(
    fixture.root,
    'parent-migrate', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit',
  );

  assert.equal(result.exit, 4, result.stdout);
  assert.equal(result.envelope.namespace, 'ledger-mutation');
  assert.equal(result.envelope.command, 'parent-migrate-v1');
  assert.equal(result.envelope.contract_version, 1);
  assert.equal(result.envelope.error.code, 'active-claim-write-refused');
});

test('an unreconciled prior mutation refuses in the preflight and creates no commit', async () => {
  const fixture = await twoItems();
  const first = await requestFile(fixture, 'first.json', transitionRequest(fixture));
  const transitioned = run(fixture.root, 'transition', '--ledger', fixture.ledger, '--input', first, '--json');
  assert.equal(transitioned.exit, 0, transitioned.stdout);
  git(fixture.root, 'add', '.');
  git(fixture.root, 'commit', '-qm', 'Commit the first mutation');
  // Someone reverts the recorded mutation. The journal still authorizes it, so
  // reconciliation is no longer clean while the working tree is clean.
  git(fixture.root, 'revert', '--no-edit', 'HEAD');
  const before = snapshot(fixture);
  const second = await requestFile(fixture, 'second.json', patchRequest(fixture, SECOND_ITEM_ID));

  const result = run(fixture.root, 'patch', '--ledger', fixture.ledger, '--input', second, '--json', '--auto-commit');

  assert.equal(result.exit, 4, result.stdout);
  assert.equal(result.envelope.error.code, 'auto-commit-preflight-failed');
  assert.equal(result.envelope.error.details.reason, 'claim-state-unreconciled');
  assert.equal(result.envelope.error.details.retryable, false);
  assert.ok(result.envelope.error.details.findings.length > 0);
  assert.equal(await ledgerFile(fixture, `items/${SECOND_ITEM_ID}.md`), fixture.sources.get(SECOND_ITEM_ID));
  assertNoCommit(fixture, before);
});

test('an unreconciled preflight refusal leaves the reconciliation log unchanged', async () => {
  const fixture = await twoItems();
  const first = await requestFile(fixture, 'residue-first.json', transitionRequest(fixture));
  const transitioned = run(fixture.root, 'transition', '--ledger', fixture.ledger, '--input', first, '--json');
  assert.equal(transitioned.exit, 0, transitioned.stdout);
  git(fixture.root, 'add', '.');
  git(fixture.root, 'commit', '-qm', 'Commit residue setup');
  git(fixture.root, 'revert', '--no-edit', 'HEAD');
  const before = await ledgerFile(fixture, fixture.logPath);
  const second = await requestFile(fixture, 'residue-second.json', patchRequest(fixture, SECOND_ITEM_ID));

  const result = run(fixture.root, 'patch', '--ledger', fixture.ledger, '--input', second, '--json', '--auto-commit');

  assert.equal(result.exit, 4, result.stdout);
  assert.equal(result.envelope.error.details.reason, 'claim-state-unreconciled');
  assert.equal(await ledgerFile(fixture, fixture.logPath), before);
  assert.equal(git(fixture.root, 'status', '--porcelain', '--', 'ledger'), '');
});

test('a refused publish-claimed leaves its documented log residue uncommitted', async () => {
  const fixture = await twoItems();
  const acquire = await requestFile(fixture, 'acquire.json', {
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
    owner_id: 'agent-a',
    lease_duration_ms: 300000,
    expected: { last_epoch: '0', active: null },
  });
  const acquired = run(fixture.root, 'claim', 'acquire', '--ledger', fixture.ledger, '--input', acquire, '--json');
  assert.equal(acquired.exit, 0, acquired.stdout);
  git(fixture.root, 'add', '.');
  git(fixture.root, 'commit', '-qm', 'Commit the claim');
  const before = snapshot(fixture);
  const candidate = Buffer.from(itemSource(ITEM_ID, { number: 1, title: 'Published' }), 'utf8');
  const publish = await requestFile(fixture, 'publish.json', {
    operation_id: 'pub_refused_0001',
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
    claim_fence: {
      ledger_namespace: fixture.namespace,
      item_id: ITEM_ID,
      owner_id: 'agent-a',
      // A stale epoch: the fence is not the active owner generation.
      epoch: '99',
    },
    expected_revision: sha256(fixture.sources.get(ITEM_ID)),
    candidate_sha256: sha256(candidate),
    candidate_source_base64: candidate.toString('base64'),
  });

  const result = run(fixture.root, 'publish-claimed', '--ledger', fixture.ledger, '--input', publish, '--json', '--auto-commit');

  assert.equal(result.exit, 4, result.stdout);
  assert.equal(result.envelope.namespace, 'ledger-publication');
  assert.equal(result.envelope.error.code, 'claim-fence-rejected');
  assert.equal(result.envelope.state, 'unchanged');
  assert.equal(await ledgerFile(fixture, `items/${ITEM_ID}.md`), fixture.sources.get(ITEM_ID));
  // The refusal terminal is durable, so the tracked log legitimately changes.
  // It must remain uncommitted and unstaged all the same.
  assertNoCommit(fixture, before);
  assert.equal(
    git(fixture.root, 'status', '--porcelain=v1', '--untracked-files=all'),
    `M ledger/${fixture.logPath}`,
  );
});

test('a held auto-commit mutex refuses before the mutation', async () => {
  const fixture = await twoItems();
  const gitDir = git(fixture.root, 'rev-parse', '--absolute-git-dir');
  await mkdir(path.join(gitDir, 'wowbagger'), { recursive: true });
  const lock = path.join(gitDir, 'wowbagger', 'auto-commit.lock');
  await writeFile(lock, `${JSON.stringify({ version: 1, pid: process.pid, token: 'held-by-the-fixture' })}\n`);
  const before = snapshot(fixture);
  const request = await requestFile(fixture, 'transition.json', transitionRequest(fixture));

  const result = run(fixture.root, 'transition', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit');

  assert.equal(result.exit, 4, result.stdout);
  assert.equal(result.envelope.error.details.retryable, true);
  assert.equal(await ledgerFile(fixture, `items/${ITEM_ID}.md`), fixture.sources.get(ITEM_ID));
  assertNoCommit(fixture, before);
});

test('a held claim-store lock makes auto-commit preflight retryable', async () => {
  const fixture = await twoItems();
  const gitCommonDir = git(fixture.root, 'rev-parse', '--path-format=absolute', '--git-common-dir');
  const lockPath = path.join(
    gitCommonDir,
    'wowbagger',
    `claims-${fixture.namespace}.json.lock`,
  );
  await mkdir(path.dirname(lockPath), { recursive: true });
  await writeFile(lockPath, '');
  const before = snapshot(fixture);
  const request = await requestFile(fixture, 'patch-claim-lock.json', patchRequest(fixture, SECOND_ITEM_ID));
  let result;
  try {
    result = run(fixture.root, 'patch', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit');
  } finally {
    await rm(lockPath, { force: true });
  }

  assert.equal(result.exit, 4, result.stdout);
  assert.equal(result.envelope.error.details.reason, 'claim-state-unreconciled');
  assert.equal(result.envelope.error.details.claim_verify_code, 'claim-store-unavailable');
  assert.equal(result.envelope.error.details.claim_verify_reason, 'claim-store-locked');
  assert.equal(result.envelope.error.details.retryable, true);
  assertNoCommit(fixture, before);
});
