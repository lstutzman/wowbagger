// test/cross-worktree-coordination.test.js
//
// A provisioned ledger keeps its claim journal in the shared Git common
// directory, so one journal spans every worktree of one repository. An
// unresolved publication blocks only mutations that target its own item; a
// mutation on any other item proceeds, and verification still reports the
// finding. These vectors pin that scoping and pin the two refusals apart: the
// writer's own uncommitted work asks for a commit, a sibling worktree's work
// asks for synchronization and names the owner holding the revision.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../bin/wowbagger.js', import.meta.url));

function run(cwd, ...argumentsList) {
  const result = spawnSync(process.execPath, [CLI, ...argumentsList], {
    cwd,
    encoding: 'utf8',
  });
  return { envelope: JSON.parse(result.stdout), exit: result.status };
}

function git(root, ...argumentsList) {
  const result = spawnSync('git', argumentsList, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

const NAMESPACE = 'wbns_0123456789abcdef0123456789abcdef';

// A provisioned single-item repository plus a sibling worktree branched from
// the same commit. The sibling shares the Git common directory, and therefore
// the claim journal, but not the checkout.
async function twoWorktreeRepository() {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-cross-worktree-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Wowbagger Test');
  const ledger = path.join(root, 'ledger');
  await mkdir(path.join(ledger, '.wowbagger'), { recursive: true });
  await writeFile(path.join(ledger, '.wowbagger', 'namespace'), `${NAMESPACE}\n`);
  await writeFile(path.join(ledger, 'item.md'), '---\nschema_version: 2\nid: wb_01KZBMBEZKPE7D15HKW9Q3GSZV\nnumber: 1\ntitle: "Seed"\nkind: task\nstatus: backlog\ncreated: 2026-08-06\nupdated: 2026-08-11\nprovenance:\n  source: "repository-backlog"\n  recorded_at: "2026-08-11T00:00:00Z"\ndepends_on: []\nrelated: []\ndecisions: []\n---\nSeed\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'Provisioned ledger');
  const branch = git(root, 'rev-parse', '--abbrev-ref', 'HEAD');
  const siblingRoot = `${root}-sibling`;
  git(root, 'worktree', 'add', '-qb', 'sibling', siblingRoot);
  return { branch, ledger, root, siblingLedger: path.join(siblingRoot, 'ledger'), siblingRoot };
}

async function createRequest(directory, name, id) {
  const requestPath = path.join(directory, name);
  await writeFile(requestPath, JSON.stringify({
    id,
    item: {
      title: 'New item',
      kind: 'task',
      provenance: { source: 'test', recorded_at: '2026-08-16T00:00:00Z' },
      depends_on: [],
    },
    body: 'New item\n',
  }));
  return requestPath;
}

// Only transition and patch record a journal entry, so a transition is what
// makes the journal expect an item revision the next worktree cannot see.
async function transitionRequest(directory, name, id, expectedRevision) {
  const requestPath = path.join(directory, name);
  await writeFile(requestPath, JSON.stringify({
    id,
    expected_revision: expectedRevision,
    to_status: 'backlog',
    date: '2026-08-16',
    decision: {
      summary: 'Accept the new item.',
      rationale: 'The new item is ready for work.',
    },
  }));
  return requestPath;
}

async function patchRequest(directory, name, id, expectedRevision) {
  const requestPath = path.join(directory, name);
  await writeFile(requestPath, JSON.stringify({
    id,
    expected_revision: expectedRevision,
    date: '2026-08-16',
    set: { title: 'Sibling edit' },
  }));
  return requestPath;
}

// Write an item in the given worktree and record it in the shared journal.
async function writeItem(root, ledger, label, id) {
  const created = run(
    root, 'create', '--ledger', ledger,
    '--input', await createRequest(root, `create-${label}.json`, id), '--json',
  );
  assert.equal(created.exit, 0, JSON.stringify(created.envelope));
  const transitioned = run(
    root, 'transition', '--ledger', ledger,
    '--input', await transitionRequest(
      root, `transition-${label}.json`, id, created.envelope.result.item.revision,
    ),
    '--json',
  );
  assert.equal(transitioned.exit, 0, JSON.stringify(transitioned.envelope));
  return transitioned.envelope.result.item.revision;
}

test('a visible sibling worktree write does not block create elsewhere', async () => {
  const fixture = await twoWorktreeRepository();
  const writtenId = 'wb_01M01BFR000TXV22D7KZ6TQYH2';
  await writeItem(fixture.root, fixture.ledger, 'main', writtenId);
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Add the new item');
  git(fixture.siblingRoot, 'merge', '-q', fixture.branch);

  const created = run(
    fixture.siblingRoot,
    'create', '--ledger', fixture.siblingLedger,
    '--input', await createRequest(
      fixture.siblingRoot,
      'create-sibling.json',
      'wb_01M01BFR000TXV22D7KZ6TQYH3',
    ),
    '--json',
  );

  assert.equal(created.exit, 0, JSON.stringify(created.envelope));
});

test('an unrelated private branch publication does not block another item mutation', async () => {
  const fixture = await twoWorktreeRepository();
  const writtenId = 'wb_01M01BFR000TXV22D7KZ6TQYH2';
  await writeItem(fixture.root, fixture.ledger, 'main', writtenId);
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Add private branch item');

  const unrelated = run(
    fixture.siblingRoot,
    'create', '--ledger', fixture.siblingLedger,
    '--input', await createRequest(
      fixture.siblingRoot,
      'create-unrelated.json',
      'wb_01M01BFR000TXV22D7KZ6TQYH3',
    ),
    '--json',
  );

  assert.equal(unrelated.exit, 0, JSON.stringify(unrelated.envelope));
  const verified = run(fixture.siblingRoot, 'claim-verify', '--ledger', fixture.siblingLedger, '--json');
  assert.equal(verified.exit, 6, JSON.stringify(verified.envelope));
  const [finding] = verified.envelope.result.findings;
  assert.equal(finding.item_id, writtenId);
  assert.equal(finding.owner_ref, `refs/heads/${fixture.branch}`);
  assert.match(finding.owner_commit, /^[0-9a-f]{40}$/);
});

test('an abandoned private publication reports unavailable ownership', async () => {
  const fixture = await twoWorktreeRepository();
  const writtenId = 'wb_01M01BFR000TXV22D7KZ6TQYH2';
  await writeItem(fixture.root, fixture.ledger, 'main', writtenId);
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Add abandoned branch item');
  git(fixture.root, 'branch', 'abandoned-owner');
  git(fixture.root, 'reset', '--hard', 'HEAD^');
  git(fixture.root, 'branch', '-D', 'abandoned-owner');

  const verified = run(fixture.siblingRoot, 'claim-verify', '--ledger', fixture.siblingLedger, '--json');
  assert.equal(verified.exit, 6, JSON.stringify(verified.envelope));
  const finding = verified.envelope.result.findings.find((entry) => entry.item_id === writtenId);
  assert.equal(finding.owner_unavailable, true);
  assert.match(finding.remediation, /cannot be established from reachable refs/);
});

test('a private publication still blocks a same-item mutation', async () => {
  const fixture = await twoWorktreeRepository();
  const targetId = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';
  const inspected = run(fixture.root, 'inspect', '--ledger', fixture.ledger, '--id', targetId, '--json');
  assert.equal(inspected.exit, 0, JSON.stringify(inspected.envelope));
  const expectedRevision = inspected.envelope.result.item.revision;
  const patched = run(
    fixture.root,
    'patch', '--ledger', fixture.ledger,
    '--input', await patchRequest(fixture.root, 'patch-main.json', targetId, expectedRevision),
    '--json',
  );
  assert.equal(patched.exit, 0, JSON.stringify(patched.envelope));
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Patch private branch item');

  const siblingInspected = run(
    fixture.siblingRoot,
    'inspect', '--ledger', fixture.siblingLedger, '--id', targetId, '--json',
  );
  const blocked = run(
    fixture.siblingRoot,
    'patch', '--ledger', fixture.siblingLedger,
    '--input', await patchRequest(
      fixture.siblingRoot,
      'patch-sibling.json',
      targetId,
      siblingInspected.envelope.result.item.revision,
    ),
    '--json',
  );

  assert.equal(blocked.exit, 6, JSON.stringify(blocked.envelope));
  assert.equal(blocked.envelope.error.details.findings[0].item_id, targetId);
});

test('claim verify reports a private foreign publication until synchronization', async () => {
  const fixture = await twoWorktreeRepository();
  const writtenId = 'wb_01M01BFR000TXV22D7KZ6TQYH2';
  await writeItem(fixture.root, fixture.ledger, 'main', writtenId);
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Add the new item');
  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');
  assert.equal(verified.exit, 0, JSON.stringify(verified.envelope));

  const created = run(
    fixture.siblingRoot,
    'create', '--ledger', fixture.siblingLedger,
    '--input', await createRequest(
      fixture.siblingRoot,
      'create-early.json',
      'wb_01M01BFR000TXV22D7KZ6TQYH3',
    ),
    '--json',
  );
  assert.equal(created.exit, 0, JSON.stringify(created.envelope));

  const stillUnresolved = run(fixture.siblingRoot, 'claim-verify', '--ledger', fixture.siblingLedger, '--json');
  assert.equal(stillUnresolved.exit, 6, JSON.stringify(stillUnresolved.envelope));
  const [finding] = stillUnresolved.envelope.result.findings;
  assert.equal(finding.item_id, writtenId);
  assert.equal(finding.reason, 'worktree-synchronization-required');

  // Verification wrote the per-namespace reconcile log into the untracked
  // ledger. Git refuses to merge over that file, so synchronization has to
  // clear it first.
  await rm(path.join(fixture.siblingLedger, '.wowbagger', `reconcile-${NAMESPACE}.md`));
  git(fixture.siblingRoot, 'merge', '-q', fixture.branch);
  const resolved = run(fixture.siblingRoot, 'claim-verify', '--ledger', fixture.siblingLedger, '--json');
  assert.equal(resolved.exit, 0, JSON.stringify(resolved.envelope));
});

test('an uncommitted write blocks create in its own worktree with the commit remedy', async () => {
  const fixture = await twoWorktreeRepository();
  const writtenId = 'wb_01M01BFR000TXV22D7KZ6TQYH2';
  const revision = await writeItem(fixture.root, fixture.ledger, 'first', writtenId);

  const blocked = run(
    fixture.root,
    'create', '--ledger', fixture.ledger,
    '--input', await createRequest(fixture.root, 'create-second.json', 'wb_01M01BFR000TXV22D7KZ6TQYH3'),
    '--json',
  );

  assert.equal(blocked.exit, 6, JSON.stringify(blocked.envelope));
  assert.equal(blocked.envelope.state, 'unchanged');
  assert.equal(blocked.envelope.error.code, 'claim-store-unavailable');
  assert.equal(blocked.envelope.error.details.reason, 'publication-reconciliation-required');
  assert.deepEqual(blocked.envelope.error.details.findings, [{
    code: 'stale-write-detected',
    item_id: writtenId,
    actual_revision: null,
    expected_revision: revision,
    observed_surface: 'git-head',
    reason: 'git-finalization-required',
    expected_path: `${writtenId}.md`,
    remediation: `Commit ${writtenId}.md in Git, then run claim-verify.`,
  }]);
});

test('copying the sibling item in does not restore the write path', async () => {
  const fixture = await twoWorktreeRepository();
  const writtenId = 'wb_01M01BFR000TXV22D7KZ6TQYH2';
  const revision = await writeItem(fixture.root, fixture.ledger, 'main', writtenId);
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Add the new item');

  // The field report's failed workaround: copy the byte-identical item into
  // the blocked checkout instead of synchronizing it.
  await copyFile(
    path.join(fixture.ledger, `${writtenId}.md`),
    path.join(fixture.siblingLedger, `${writtenId}.md`),
  );

  const blocked = run(
    fixture.siblingRoot,
    'create', '--ledger', fixture.siblingLedger,
    '--input', await createRequest(fixture.siblingRoot, 'create-after-copy.json', 'wb_01M01BFR000TXV22D7KZ6TQYH3'),
    '--json',
  );

  assert.equal(blocked.exit, 6, JSON.stringify(blocked.envelope));
  assert.deepEqual(blocked.envelope.error.details.findings, [{
    code: 'stale-write-detected',
    item_id: writtenId,
    actual_revision: null,
    expected_revision: revision,
    observed_surface: 'git-head',
    reason: 'git-finalization-required',
    expected_path: `${writtenId}.md`,
    remediation: `Commit ${writtenId}.md in Git, then run claim-verify.`,
  }]);
});
