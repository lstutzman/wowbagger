import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { claimJournalPath, claimReconcileLogPath, replayClaimJournal } from '../src/claim-journal.js';
import { resolveGitCommonDir } from '../src/claim-store.js';
import { readGitHeadLedger } from '../src/git-reconciliation.js';

const CLI = fileURLToPath(new URL('../bin/wowbagger.js', import.meta.url));
const ITEM_ID = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';

function run(root, ...argumentsList) {
  const result = spawnSync(process.execPath, [CLI, ...argumentsList], {
    cwd: root,
    encoding: 'utf8',
  });
  return { envelope: JSON.parse(result.stdout), exit: result.status };
}

function git(root, ...argumentsList) {
  const result = spawnSync('git', argumentsList, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function repository() {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-git-reconcile-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Wowbagger Test');
  const ledger = path.join(root, 'ledger');
  await mkdir(ledger);
  const namespace = 'wbns_0123456789abcdef0123456789abcdef';
  await mkdir(path.join(ledger, '.wowbagger'));
  await writeFile(path.join(ledger, '.wowbagger', 'namespace'), `${namespace}\n`);
  const itemPath = path.join(ledger, 'item.md');
  const before = Buffer.from('---\nschema_version: 2\nid: wb_01KZBMBEZKPE7D15HKW9Q3GSZV\ntitle: "Before"\nkind: task\nstatus: backlog\ncreated: 2026-08-06\nupdated: 2026-08-11\nprovenance:\n  source: "repository-backlog"\n  recorded_at: "2026-08-11T00:00:00Z"\ndepends_on: []\nrelated: []\ndecisions: []\n---\nBefore\n');
  await writeFile(itemPath, before);
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'Initial item');
  return { before, itemPath, ledger, namespace, root };
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

test('claim-verify finalizes a committed publication observed in git HEAD', async () => {
  const fixture = await repository();
  const acquirePath = path.join(fixture.root, 'acquire.json');
  await writeFile(acquirePath, JSON.stringify({
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
    owner_id: 'agent-a',
    lease_duration_ms: 300000,
    expected: { last_epoch: '0', active: null },
  }));
  const acquired = run(fixture.root, 'claim', 'acquire', '--ledger', fixture.ledger, '--input', acquirePath, '--json');
  assert.equal(acquired.exit, 0, JSON.stringify(acquired.envelope));
  const candidate = Buffer.from(fixture.before.toString('utf8').replace('title: "Before"', 'title: "After"').replace('\nBefore\n', '\nAfter\n'));
  const publishPath = path.join(fixture.root, 'publish.json');
  await writeFile(publishPath, JSON.stringify({
    operation_id: 'pub_git_finalize_0001',
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
    claim_fence: {
      ledger_namespace: fixture.namespace,
      item_id: ITEM_ID,
      owner_id: 'agent-a',
      epoch: acquired.envelope.result.claim.epoch,
    },
    expected_revision: sha256(fixture.before),
    candidate_sha256: sha256(candidate),
    candidate_source_base64: candidate.toString('base64'),
  }));
  const published = run(fixture.root, 'publish-claimed', '--ledger', fixture.ledger, '--input', publishPath, '--json');
  assert.equal(published.exit, 0, JSON.stringify(published.envelope));
  git(fixture.root, 'add', 'ledger/item.md');
  git(fixture.root, 'commit', '-qm', 'Commit claimed publication');
  const commit = git(fixture.root, 'rev-parse', 'HEAD');
  const head = await readGitHeadLedger(fixture.ledger);
  assert.equal(head.commit, commit);
  assert.deepEqual([...head.items.keys()], ['item.md']);
  assert.equal(sha256(head.items.get('item.md')), sha256(candidate));

  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');

  assert.equal(verified.exit, 0, JSON.stringify(verified.envelope));
  const repeated = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');
  assert.equal(repeated.exit, 0, JSON.stringify(repeated.envelope));
  const gitCommonDir = await resolveGitCommonDir(fixture.ledger);
  const replayed = await replayClaimJournal(claimJournalPath(gitCommonDir, fixture.namespace), fixture.namespace);
  const finalizations = replayed.entries.filter((entry) => entry.type === 'publish-finalization');
  assert.equal(finalizations.length, 1);
  const finalized = finalizations[0];
  assert.equal(finalized.committed_revision, sha256(candidate));
  assert.equal(finalized.git_commit, commit);
  assert.equal(await readFile(fixture.itemPath, 'utf8'), candidate.toString('utf8'));
  const reconcileLog = await readFile(claimReconcileLogPath(fixture.root, fixture.namespace), 'utf8');
  assert.doesNotMatch(reconcileLog, /publish-finalization/);
});

test('Git HEAD reconciliation includes nested ledger items', async () => {
  const fixture = await repository();
  const nestedDirectory = path.join(fixture.ledger, 'nested');
  const nestedPath = path.join(nestedDirectory, 'item.md');
  const nestedSource = Buffer.from(fixture.before.toString('utf8')
    .replace(ITEM_ID, 'wb_01KZBMBEZKPE7D15HKW9Q3GSZW'));
  await mkdir(nestedDirectory);
  await writeFile(nestedPath, nestedSource);
  git(fixture.root, 'add', 'ledger/nested/item.md');
  git(fixture.root, 'commit', '-qm', 'Add nested item');

  const head = await readGitHeadLedger(fixture.ledger);

  assert.equal(sha256(head.items.get('nested/item.md')), sha256(nestedSource));
});

test('Git HEAD reconciliation ignores inherited repository selectors', async () => {
  const fixture = await repository();
  const other = await repository();
  const otherSource = Buffer.from(other.before.toString('utf8').replace('title: "Before"', 'title: "Other"'));
  await writeFile(other.itemPath, otherSource);
  git(other.root, 'add', 'ledger/item.md');
  git(other.root, 'commit', '-qm', 'Change other repository');
  const expectedCommit = git(fixture.root, 'rev-parse', 'HEAD');
  const priorGitDir = process.env.GIT_DIR;
  const priorGitWorkTree = process.env.GIT_WORK_TREE;
  process.env.GIT_DIR = path.join(other.root, '.git');
  process.env.GIT_WORK_TREE = fixture.root;
  try {
    const head = await readGitHeadLedger(fixture.ledger);
    assert.equal(head.commit, expectedCommit);
    assert.equal(sha256(head.items.get('item.md')), sha256(fixture.before));
  } finally {
    if (priorGitDir === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = priorGitDir;
    if (priorGitWorkTree === undefined) delete process.env.GIT_WORK_TREE;
    else process.env.GIT_WORK_TREE = priorGitWorkTree;
  }
});
test('claim-verify detects a direct git write after publication finalization', async () => {
  const fixture = await repository();
  const acquirePath = path.join(fixture.root, 'acquire-stale.json');
  await writeFile(acquirePath, JSON.stringify({
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
    owner_id: 'agent-a',
    lease_duration_ms: 300000,
    expected: { last_epoch: '0', active: null },
  }));
  const acquired = run(fixture.root, 'claim', 'acquire', '--ledger', fixture.ledger, '--input', acquirePath, '--json');
  assert.equal(acquired.exit, 0, JSON.stringify(acquired.envelope));
  const candidate = Buffer.from(fixture.before.toString('utf8').replace('title: "Before"', 'title: "After"').replace('\nBefore\n', '\nAfter\n'));
  const publishPath = path.join(fixture.root, 'publish-stale.json');
  await writeFile(publishPath, JSON.stringify({
    operation_id: 'pub_git_stale_0001',
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
    claim_fence: {
      ledger_namespace: fixture.namespace,
      item_id: ITEM_ID,
      owner_id: 'agent-a',
      epoch: acquired.envelope.result.claim.epoch,
    },
    expected_revision: sha256(fixture.before),
    candidate_sha256: sha256(candidate),
    candidate_source_base64: candidate.toString('base64'),
  }));
  const published = run(fixture.root, 'publish-claimed', '--ledger', fixture.ledger, '--input', publishPath, '--json');
  assert.equal(published.exit, 0, JSON.stringify(published.envelope));
  git(fixture.root, 'add', 'ledger/item.md');
  git(fixture.root, 'commit', '-qm', 'Commit claimed publication');
  const finalized = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');
  assert.equal(finalized.exit, 0, JSON.stringify(finalized.envelope));
  const direct = Buffer.from(candidate.toString('utf8').replace('title: "After"', 'title: "Direct"'));
  await writeFile(fixture.itemPath, direct);
  git(fixture.root, 'add', 'ledger/item.md');
  git(fixture.root, 'commit', '-qm', 'Commit direct write');

  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');

  assert.equal(verified.exit, 6, JSON.stringify(verified.envelope));
  assert.equal(verified.envelope.result.findings[0].code, 'stale-write-detected');
  assert.equal(verified.envelope.result.findings[0].expected_revision, sha256(candidate));
  assert.equal(verified.envelope.result.findings[0].actual_revision, sha256(direct));
});

test('claim-verify finalizes a publication after another worktree merges it', async () => {
  const fixture = await repository();
  const workerRoot = `${fixture.root}-worker`;
  const sourceBranch = git(fixture.root, 'branch', '--show-current');
  git(fixture.root, 'worktree', 'add', '-qb', 'worker-b', workerRoot);
  const workerLedger = path.join(workerRoot, 'ledger');
  const acquirePath = path.join(fixture.root, 'acquire-worktree.json');
  await writeFile(acquirePath, JSON.stringify({
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
    owner_id: 'agent-a',
    lease_duration_ms: 300000,
    expected: { last_epoch: '0', active: null },
  }));
  const acquired = run(fixture.root, 'claim', 'acquire', '--ledger', fixture.ledger, '--input', acquirePath, '--json');
  assert.equal(acquired.exit, 0, JSON.stringify(acquired.envelope));
  const readPath = path.join(fixture.root, 'read-worktree.json');
  await writeFile(readPath, JSON.stringify({
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
  }));
  const visible = run(workerRoot, 'claim', 'read', '--ledger', workerLedger, '--input', readPath, '--json');
  assert.equal(visible.exit, 0, JSON.stringify(visible.envelope));
  assert.equal(visible.envelope.result.read_back.active.owner_id, 'agent-a');
  const candidate = Buffer.from(fixture.before.toString('utf8').replace('title: "Before"', 'title: "Merged"'));
  const publishPath = path.join(fixture.root, 'publish-worktree.json');
  await writeFile(publishPath, JSON.stringify({
    operation_id: 'pub_git_worktree_0001',
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
    claim_fence: {
      ledger_namespace: fixture.namespace,
      item_id: ITEM_ID,
      owner_id: 'agent-a',
      epoch: acquired.envelope.result.claim.epoch,
    },
    expected_revision: sha256(fixture.before),
    candidate_sha256: sha256(candidate),
    candidate_source_base64: candidate.toString('base64'),
  }));
  const published = run(fixture.root, 'publish-claimed', '--ledger', fixture.ledger, '--input', publishPath, '--json');
  assert.equal(published.exit, 0, JSON.stringify(published.envelope));
  git(fixture.root, 'add', 'ledger/item.md');
  git(fixture.root, 'commit', '-qm', 'Commit worktree publication');
  git(workerRoot, 'merge', '--ff-only', sourceBranch);

  const verified = run(workerRoot, 'claim-verify', '--ledger', workerLedger, '--json');

  assert.equal(verified.exit, 0, JSON.stringify(verified.envelope));
  const gitCommonDir = await resolveGitCommonDir(workerLedger);
  const replayed = await replayClaimJournal(claimJournalPath(gitCommonDir, fixture.namespace), fixture.namespace);
  assert.equal(
    replayed.entries.filter((entry) => entry.type === 'publish-finalization').length,
    1,
  );
});


test('claim-verify refuses a reconciliation log symlink without changing its target', async () => {
  const fixture = await repository();
  const acquirePath = path.join(fixture.root, 'acquire.json');
  await writeFile(acquirePath, JSON.stringify({
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
    owner_id: 'agent-a',
    lease_duration_ms: 300000,
    expected: { last_epoch: '0', active: null },
  }));
  const acquired = run(fixture.root, 'claim', 'acquire', '--ledger', fixture.ledger, '--input', acquirePath, '--json');
  assert.equal(acquired.exit, 0, JSON.stringify(acquired.envelope));

  const victimPath = path.join(fixture.root, 'victim.txt');
  const victim = Buffer.from('must stay unchanged\n');
  await writeFile(victimPath, victim);
  const reconcilePath = claimReconcileLogPath(fixture.root, fixture.namespace);
  await unlink(reconcilePath);
  await symlink(victimPath, reconcilePath);

  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');

  assert.equal(verified.exit, 6, JSON.stringify(verified.envelope));
  assert.equal(verified.envelope.error.code, 'claim-store-unavailable');
  assert.deepEqual(await readFile(victimPath), victim);
});