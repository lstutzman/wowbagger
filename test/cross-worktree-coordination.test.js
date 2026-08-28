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
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { withClaimLock } from '../src/claim-store.js';
import { listWorktrees } from '../src/git-worktrees.js';
import { ensureWorktreeIdentity } from '../src/worktree-identity.js';

const CLI = fileURLToPath(new URL('../bin/wowbagger.js', import.meta.url));

function runEnv(cwd, env, ...argumentsList) {
  const result = spawnSync(process.execPath, [CLI, ...argumentsList], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { envelope: JSON.parse(result.stdout), exit: result.status };
}

function run(cwd, ...argumentsList) {
  return runEnv(cwd, {}, ...argumentsList);
}

function git(root, ...argumentsList) {
  const result = spawnSync('git', argumentsList, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

const NAMESPACE = 'wbns_0123456789abcdef0123456789abcdef';
const SECOND_NAMESPACE = 'wbns_fedcba9876543210fedcba9876543210';

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

// Every byte a refusal must leave alone: the ledger files an operator reads,
// including the derived reconciliation log, and the Git status of the
// working tree holding them.
async function ledgerSnapshot(root, ledger) {
  const files = [];
  for (const name of (await readdir(ledger, { recursive: true })).sort()) {
    const file = path.join(ledger, name);
    if ((await stat(file)).isFile()) files.push([name, await readFile(file, 'utf8')]);
  }
  return { files, status: git(root, 'status', '--porcelain') };
}

// The latest journal entry that authorizes an item revision, read from the
// shared claim journal in the Git common directory.
async function latestAuthorization(root, itemId) {
  const file = path.join(
    git(root, 'rev-parse', '--path-format=absolute', '--git-common-dir'),
    'wowbagger', NAMESPACE, 'journal.ndjson',
  );
  const lines = (await readFile(file, 'utf8')).trimEnd().split('\n');
  const index = lines.findLastIndex((line) => {
    const entry = JSON.parse(line);
    return entry.type === 'legacy-mutation' && entry.item_id === itemId;
  });
  assert.notEqual(index, -1);
  return { entry: JSON.parse(lines[index]), file, index, lines };
}

// The identity of one worktree, as that worktree's own private Git directory
// records it.
async function worktreeIdentity(root) {
  const identityPath = path.join(
    git(root, 'rev-parse', '--absolute-git-dir'), 'wowbagger-worktree-id',
  );
  return (await readFile(identityPath, 'utf8')).trimEnd();
}

// Age one authorization back to alpha.12: the latest entry that authorizes the
// item loses its writer identity and nothing else. Every other line stays byte
// for byte, the aged line keeps every other field it carried, including the
// committed revision hash the classifier compares against, and the returned ID
// is the one the journal used to name.
async function stripLatestWriterIdentity(root, itemId) {
  const { entry, file, index, lines } = await latestAuthorization(root, itemId);
  const { writer_worktree_id: writer, ...aged } = entry;
  assert.equal(typeof writer, 'string');
  await writeFile(file, `${lines.with(index, JSON.stringify(aged)).join('\n')}\n`);

  const after = (await readFile(file, 'utf8')).trimEnd().split('\n');
  assert.deepEqual(
    after.filter((_, at) => at !== index),
    lines.filter((_, at) => at !== index),
  );
  assert.deepEqual(
    Object.keys(JSON.parse(after[index])),
    Object.keys(entry).filter((key) => key !== 'writer_worktree_id'),
  );
  assert.equal(JSON.parse(after[index]).committed_revision, entry.committed_revision);
  return writer;
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
  assert.equal(siblingInspected.exit, 0, JSON.stringify(siblingInspected.envelope));
  const initialVerification = run(
    fixture.siblingRoot,
    'claim-verify',
    '--ledger',
    fixture.siblingLedger,
    '--json',
  );
  assert.equal(initialVerification.exit, 6, JSON.stringify(initialVerification.envelope));
  const reconcileLog = path.join(fixture.siblingLedger, '.wowbagger', `reconcile-${NAMESPACE}.md`);
  const beforeLog = await readFile(reconcileLog, 'utf8');
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

  assert.equal(await readFile(reconcileLog, 'utf8'), beforeLog);
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

test('an existing stale sibling revision does not block an unrelated patch', async () => {
  const fixture = await twoWorktreeRepository();
  const seedId = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';
  const secondId = 'wb_01M01BFR000TXV22D7KZ6TQYH2';
  await writeItem(fixture.root, fixture.ledger, 'second', secondId);
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Add the unrelated item');
  git(fixture.siblingRoot, 'merge', '-q', fixture.branch);

  const inspected = run(fixture.root, 'inspect', '--ledger', fixture.ledger, '--id', seedId, '--json');
  assert.equal(inspected.exit, 0, JSON.stringify(inspected.envelope));
  const privatePatch = run(
    fixture.root,
    'patch', '--ledger', fixture.ledger,
    '--input', await patchRequest(fixture.root, 'patch-private.json', seedId, inspected.envelope.result.item.revision),
    '--json',
  );
  assert.equal(privatePatch.exit, 0, JSON.stringify(privatePatch.envelope));
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Patch the private item');

  const second = run(fixture.siblingRoot, 'inspect', '--ledger', fixture.siblingLedger, '--id', secondId, '--json');
  assert.equal(second.exit, 0, JSON.stringify(second.envelope));
  const unrelated = run(
    fixture.siblingRoot,
    'patch', '--ledger', fixture.siblingLedger,
    '--input', await patchRequest(
      fixture.siblingRoot,
      'patch-unrelated.json',
      secondId,
      second.envelope.result.item.revision,
    ),
    '--json',
  );

  assert.equal(unrelated.exit, 0, JSON.stringify(unrelated.envelope));
  const verified = run(fixture.siblingRoot, 'claim-verify', '--ledger', fixture.siblingLedger, '--json');
  assert.equal(verified.exit, 6, JSON.stringify(verified.envelope));
  const finding = verified.envelope.result.findings.find((entry) => entry.item_id === seedId);
  assert.equal(finding.reason, 'worktree-synchronization-required');
  assert.equal(finding.owner_ref, `refs/heads/${fixture.branch}`);
  assert.match(finding.owner_commit, /^[0-9a-f]{40}$/);
});

test('a restored predecessor keeps known sibling owner evidence', async () => {
  const fixture = await twoWorktreeRepository();
  const seedId = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';
  const secondId = 'wb_01M01BFR000TXV22D7KZ6TQYH2';
  await writeItem(fixture.root, fixture.ledger, 'second', secondId);
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Add the unrelated item');
  git(fixture.siblingRoot, 'merge', '-q', fixture.branch);

  const original = run(fixture.root, 'inspect', '--ledger', fixture.ledger, '--id', seedId, '--json');
  const predecessor = run(
    fixture.root,
    'patch', '--ledger', fixture.ledger,
    '--input', await patchRequest(
      fixture.root,
      'patch-known-owner-predecessor.json',
      seedId,
      original.envelope.result.item.revision,
    ),
    '--json',
  );
  assert.equal(predecessor.exit, 0, JSON.stringify(predecessor.envelope));
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Commit the authorized predecessor');
  git(fixture.siblingRoot, 'merge', '-q', fixture.branch);

  const sibling = run(
    fixture.siblingRoot,
    'inspect', '--ledger', fixture.siblingLedger, '--id', seedId, '--json',
  );
  const requestPath = path.join(fixture.siblingRoot, 'patch-known-owner-latest.json');
  await writeFile(requestPath, JSON.stringify({
    id: seedId,
    expected_revision: sibling.envelope.result.item.revision,
    date: '2026-08-16',
    set: { title: 'Sibling latest' },
  }));
  const latest = run(
    fixture.siblingRoot,
    'patch', '--ledger', fixture.siblingLedger, '--input', requestPath, '--json',
  );
  assert.equal(latest.exit, 0, JSON.stringify(latest.envelope));
  git(fixture.siblingRoot, 'add', 'ledger');
  git(fixture.siblingRoot, 'commit', '-qm', 'Commit the expected sibling revision');
  const siblingBranch = git(fixture.siblingRoot, 'rev-parse', '--abbrev-ref', 'HEAD');
  const siblingCommit = git(fixture.siblingRoot, 'rev-parse', 'HEAD');

  git(fixture.root, 'restore', '--source=HEAD^', '--', 'ledger/item.md');
  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');

  assert.equal(verified.exit, 6, JSON.stringify(verified.envelope));
  const finding = verified.envelope.result.findings.find((entry) => entry.item_id === seedId);
  assert.equal(finding.reason, 'worktree-synchronization-required');
  assert.equal(finding.owner_ref, `refs/heads/${siblingBranch}`);
  assert.equal(finding.owner_commit, siblingCommit);
  assert.equal(Object.hasOwn(finding, 'owner_unavailable'), false);
  assert.match(finding.remediation, new RegExp(siblingCommit));
});

test('a committed unknown revision remains unauthorized when a sibling owns the expected revision', async () => {
  const fixture = await twoWorktreeRepository();
  const seedId = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';
  const secondId = 'wb_01M01BFR000TXV22D7KZ6TQYH2';
  await writeItem(fixture.root, fixture.ledger, 'second', secondId);
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Add the unrelated item');
  git(fixture.siblingRoot, 'merge', '-q', fixture.branch);

  const sibling = run(
    fixture.siblingRoot,
    'inspect', '--ledger', fixture.siblingLedger, '--id', seedId, '--json',
  );
  const requestPath = path.join(fixture.siblingRoot, 'patch-expected-sibling.json');
  await writeFile(requestPath, JSON.stringify({
    id: seedId,
    expected_revision: sibling.envelope.result.item.revision,
    date: '2026-08-28',
    set: { title: 'Expected sibling' },
  }));
  const expected = run(
    fixture.siblingRoot,
    'patch', '--ledger', fixture.siblingLedger, '--input', requestPath, '--json',
  );
  assert.equal(expected.exit, 0, JSON.stringify(expected.envelope));
  git(fixture.siblingRoot, 'add', 'ledger');
  git(fixture.siblingRoot, 'commit', '-qm', 'Commit the expected sibling revision');

  const seedPath = path.join(fixture.ledger, 'item.md');
  const source = await readFile(seedPath, 'utf8');
  await writeFile(seedPath, source.replace('title: "Seed"', 'title: "Unknown committed"'));
  git(fixture.root, 'add', 'ledger/item.md');
  git(fixture.root, 'commit', '-qm', 'Commit an unknown local revision');

  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');
  assert.equal(verified.exit, 6, JSON.stringify(verified.envelope));
  const finding = verified.envelope.result.findings.find((entry) => entry.item_id === seedId);
  assert.equal(finding.reason, 'unauthorized-revision');
  assert.equal(Object.hasOwn(finding, 'owner_ref'), false);

  const second = run(fixture.root, 'inspect', '--ledger', fixture.ledger, '--id', secondId, '--json');
  const unrelated = run(
    fixture.root,
    'patch', '--ledger', fixture.ledger,
    '--input', await patchRequest(
      fixture.root,
      'patch-past-unknown-committed-revision.json',
      secondId,
      second.envelope.result.item.revision,
    ),
    '--json',
  );
  assert.equal(unrelated.exit, 6, JSON.stringify(unrelated.envelope));
  assert.equal(unrelated.envelope.error.details.findings[0].reason, 'unauthorized-revision');
});

test('an unknown HEAD remains unauthorized after restoring an authorized working-tree predecessor', async () => {
  const fixture = await twoWorktreeRepository();
  const seedId = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';
  const secondId = 'wb_01M01BFR000TXV22D7KZ6TQYH2';
  await writeItem(fixture.root, fixture.ledger, 'second', secondId);
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Add the unrelated item');
  git(fixture.siblingRoot, 'merge', '-q', fixture.branch);

  const sibling = run(
    fixture.siblingRoot,
    'inspect', '--ledger', fixture.siblingLedger, '--id', seedId, '--json',
  );
  const requestPath = path.join(fixture.siblingRoot, 'patch-expected-sibling-over-unknown-head.json');
  await writeFile(requestPath, JSON.stringify({
    id: seedId,
    expected_revision: sibling.envelope.result.item.revision,
    date: '2026-08-28',
    set: { title: 'Expected sibling' },
  }));
  const expected = run(
    fixture.siblingRoot,
    'patch', '--ledger', fixture.siblingLedger, '--input', requestPath, '--json',
  );
  assert.equal(expected.exit, 0, JSON.stringify(expected.envelope));
  git(fixture.siblingRoot, 'add', 'ledger');
  git(fixture.siblingRoot, 'commit', '-qm', 'Commit the expected sibling revision');

  const seedPath = path.join(fixture.ledger, 'item.md');
  const source = await readFile(seedPath, 'utf8');
  await writeFile(seedPath, source.replace('title: "Seed"', 'title: "Unknown committed"'));
  git(fixture.root, 'add', 'ledger/item.md');
  git(fixture.root, 'commit', '-qm', 'Commit an unknown local revision');
  git(fixture.root, 'restore', '--source=HEAD^', '--', 'ledger/item.md');

  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');
  assert.equal(verified.exit, 6, JSON.stringify(verified.envelope));
  const finding = verified.envelope.result.findings.find((entry) => entry.item_id === seedId);
  assert.equal(finding.reason, 'unauthorized-revision');

  const second = run(fixture.root, 'inspect', '--ledger', fixture.ledger, '--id', secondId, '--json');
  const unrelated = run(
    fixture.root,
    'patch', '--ledger', fixture.ledger,
    '--input', await patchRequest(
      fixture.root,
      'patch-past-unknown-head.json',
      secondId,
      second.envelope.result.item.revision,
    ),
    '--json',
  );
  assert.equal(unrelated.exit, 6, JSON.stringify(unrelated.envelope));
  assert.equal(unrelated.envelope.error.details.findings[0].reason, 'unauthorized-revision');
});

test('a working-tree deletion remains unauthorized when HEAD is an authorized predecessor', async () => {
  const fixture = await twoWorktreeRepository();
  const seedId = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';
  const secondId = 'wb_01M01BFR000TXV22D7KZ6TQYH2';
  await writeItem(fixture.root, fixture.ledger, 'second', secondId);
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Add the unrelated item');
  git(fixture.siblingRoot, 'merge', '-q', fixture.branch);

  const sibling = run(
    fixture.siblingRoot,
    'inspect', '--ledger', fixture.siblingLedger, '--id', seedId, '--json',
  );
  const requestPath = path.join(fixture.siblingRoot, 'patch-expected-sibling-before-deletion.json');
  await writeFile(requestPath, JSON.stringify({
    id: seedId,
    expected_revision: sibling.envelope.result.item.revision,
    date: '2026-08-28',
    set: { title: 'Expected sibling' },
  }));
  const expected = run(
    fixture.siblingRoot,
    'patch', '--ledger', fixture.siblingLedger, '--input', requestPath, '--json',
  );
  assert.equal(expected.exit, 0, JSON.stringify(expected.envelope));
  git(fixture.siblingRoot, 'add', 'ledger');
  git(fixture.siblingRoot, 'commit', '-qm', 'Commit the expected sibling revision');

  await rm(path.join(fixture.ledger, 'item.md'));

  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');
  assert.equal(verified.exit, 6, JSON.stringify(verified.envelope));
  const finding = verified.envelope.result.findings.find((entry) => entry.item_id === seedId);
  assert.equal(finding.reason, 'unauthorized-revision');

  const second = run(fixture.root, 'inspect', '--ledger', fixture.ledger, '--id', secondId, '--json');
  const unrelated = run(
    fixture.root,
    'patch', '--ledger', fixture.ledger,
    '--input', await patchRequest(
      fixture.root,
      'patch-past-deleted-item.json',
      secondId,
      second.envelope.result.item.revision,
    ),
    '--json',
  );
  assert.equal(unrelated.exit, 6, JSON.stringify(unrelated.envelope));
  assert.equal(unrelated.envelope.error.details.findings[0].reason, 'unauthorized-revision');
});

test('an uncommitted in-protocol sibling revision does not block an unrelated patch', async () => {
  const fixture = await twoWorktreeRepository();
  const seedId = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';
  const secondId = 'wb_01M01BFR000TXV22D7KZ6TQYH2';
  await writeItem(fixture.root, fixture.ledger, 'second', secondId);
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Add the unrelated item');
  git(fixture.siblingRoot, 'merge', '-q', fixture.branch);

  const inspected = run(fixture.root, 'inspect', '--ledger', fixture.ledger, '--id', seedId, '--json');
  const privatePatch = run(
    fixture.root,
    'patch', '--ledger', fixture.ledger,
    '--input', await patchRequest(
      fixture.root,
      'patch-uncommitted-private.json',
      seedId,
      inspected.envelope.result.item.revision,
    ),
    '--json',
  );
  assert.equal(privatePatch.exit, 0, JSON.stringify(privatePatch.envelope));

  const second = run(fixture.siblingRoot, 'inspect', '--ledger', fixture.siblingLedger, '--id', secondId, '--json');
  const unrelated = run(
    fixture.siblingRoot,
    'patch', '--ledger', fixture.siblingLedger,
    '--input', await patchRequest(
      fixture.siblingRoot,
      'patch-past-uncommitted-sibling.json',
      secondId,
      second.envelope.result.item.revision,
    ),
    '--json',
  );

  assert.equal(unrelated.exit, 0, JSON.stringify(unrelated.envelope));
  const verified = run(fixture.siblingRoot, 'claim-verify', '--ledger', fixture.siblingLedger, '--json');
  const finding = verified.envelope.result.findings.find((entry) => entry.item_id === seedId);
  assert.equal(finding.reason, 'worktree-synchronization-required');
  assert.equal(finding.owner_unavailable, true);
});

// The mirror of the vector above: this worktree wrote the successor itself and
// never committed it, so no sibling holds the expected revision and no
// synchronization can produce it. Restoring the predecessor is therefore an
// unauthorized local edit, and it blocks every mutation, not just its own item.
test('an unreachable own successor restored to its predecessor blocks unrelated work', async () => {
  const fixture = await twoWorktreeRepository();
  const seedId = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';
  const secondId = 'wb_01M01BFR000TXV22D7KZ6TQYH2';
  await writeItem(fixture.root, fixture.ledger, 'second', secondId);
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Add the unrelated item');

  const inspected = run(fixture.root, 'inspect', '--ledger', fixture.ledger, '--id', seedId, '--json');
  const patched = run(
    fixture.root,
    'patch', '--ledger', fixture.ledger,
    '--input', await patchRequest(
      fixture.root,
      'patch-unreachable-own-successor.json',
      seedId,
      inspected.envelope.result.item.revision,
    ),
    '--json',
  );
  assert.equal(patched.exit, 0, JSON.stringify(patched.envelope));
  git(fixture.root, 'restore', '--source=HEAD', '--', 'ledger/item.md');

  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');
  assert.equal(verified.exit, 6, JSON.stringify(verified.envelope));
  const finding = verified.envelope.result.findings.find((entry) => entry.item_id === seedId);
  assert.equal(finding.reason, 'unauthorized-revision');

  const second = run(fixture.root, 'inspect', '--ledger', fixture.ledger, '--id', secondId, '--json');
  const unrelatedRequest = await patchRequest(
    fixture.root,
    'patch-past-unreachable-own-successor.json',
    secondId,
    second.envelope.result.item.revision,
  );
  const before = await ledgerSnapshot(fixture.root, fixture.ledger);
  const unrelated = run(
    fixture.root,
    'patch', '--ledger', fixture.ledger, '--input', unrelatedRequest, '--json',
  );
  assert.equal(unrelated.exit, 6, JSON.stringify(unrelated.envelope));
  assert.equal(unrelated.envelope.error.details.findings[0].reason, 'unauthorized-revision');
  assert.deepEqual(await ledgerSnapshot(fixture.root, fixture.ledger), before);
});

// The same state written by an alpha.12 worktree, which recorded no writer.
// An entry that names nobody attributes nothing, so the diagnosis falls back
// to the ownership evidence Git can produce and the advisory scoping that
// evidence earns: the finding stays advisory and an unrelated item proceeds.
test('a legacy successor without a recorded writer keeps advisory synchronization', async () => {
  const fixture = await twoWorktreeRepository();
  const seedId = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';
  const secondId = 'wb_01M01BFR000TXV22D7KZ6TQYH2';
  await writeItem(fixture.root, fixture.ledger, 'second', secondId);
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Add the unrelated item');

  const inspected = run(fixture.root, 'inspect', '--ledger', fixture.ledger, '--id', seedId, '--json');
  const patched = run(
    fixture.root,
    'patch', '--ledger', fixture.ledger,
    '--input', await patchRequest(
      fixture.root,
      'patch-legacy-successor.json',
      seedId,
      inspected.envelope.result.item.revision,
    ),
    '--json',
  );
  assert.equal(patched.exit, 0, JSON.stringify(patched.envelope));
  git(fixture.root, 'restore', '--source=HEAD', '--', 'ledger/item.md');

  // Age the journal back to alpha.12 by removing every writer identity it
  // recorded. Every remaining entry must still replay.
  const journalPath = path.join(
    git(fixture.root, 'rev-parse', '--absolute-git-dir'),
    'wowbagger', NAMESPACE, 'journal.ndjson',
  );
  const aged = (await readFile(journalPath, 'utf8')).trimEnd().split('\n')
    .map((line) => {
      const { writer_worktree_id: writer, ...entry } = JSON.parse(line);
      return JSON.stringify(entry);
    });
  await writeFile(journalPath, `${aged.join('\n')}\n`);

  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');
  assert.equal(verified.exit, 6, JSON.stringify(verified.envelope));
  const finding = verified.envelope.result.findings.find((entry) => entry.item_id === seedId);
  assert.equal(finding.reason, 'worktree-synchronization-required');
  assert.equal(finding.owner_unavailable, true);

  const second = run(fixture.root, 'inspect', '--ledger', fixture.ledger, '--id', secondId, '--json');
  const unrelated = run(
    fixture.root,
    'patch', '--ledger', fixture.ledger,
    '--input', await patchRequest(
      fixture.root,
      'patch-past-legacy-successor.json',
      secondId,
      second.envelope.result.item.revision,
    ),
    '--json',
  );
  assert.equal(unrelated.exit, 0, JSON.stringify(unrelated.envelope));
});

// Row 6b: the writer is a real sibling worktree, and the journal names it. The
// observer earned its own identity first, with a mutation it committed, so the
// comparison is between two live worktrees rather than between a worktree and
// nobody. The successor is reachable from no ref yet, but the sibling holding
// it can still commit, so the advice stays "wait for the owner" and the finding
// stays scoped to its own item.
test('an unreachable named sibling successor keeps advisory synchronization', async () => {
  const fixture = await twoWorktreeRepository();
  const seedId = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';
  const secondId = 'wb_01M01BFR000TXV22D7KZ6TQYH2';
  await writeItem(fixture.root, fixture.ledger, 'second', secondId);
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Add the unrelated item');
  git(fixture.siblingRoot, 'merge', '-q', fixture.branch);

  const inspected = run(
    fixture.siblingRoot, 'inspect', '--ledger', fixture.siblingLedger, '--id', seedId, '--json',
  );
  const siblingPatch = run(
    fixture.siblingRoot,
    'patch', '--ledger', fixture.siblingLedger,
    '--input', await patchRequest(
      fixture.siblingRoot,
      'patch-named-sibling-successor.json',
      seedId,
      inspected.envelope.result.item.revision,
    ),
    '--json',
  );
  assert.equal(siblingPatch.exit, 0, JSON.stringify(siblingPatch.envelope));

  // Both worktrees answer to an identity, the two differ, and the journal
  // names the writer's. The observer still holds the predecessor in its
  // working tree and at HEAD; it never touched the item.
  const observer = await worktreeIdentity(fixture.root);
  const writer = await worktreeIdentity(fixture.siblingRoot);
  assert.notEqual(observer, writer);
  assert.equal((await latestAuthorization(fixture.root, seedId)).entry.writer_worktree_id, writer);

  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');
  assert.equal(verified.exit, 6, JSON.stringify(verified.envelope));
  const finding = verified.envelope.result.findings.find((entry) => entry.item_id === seedId);
  assert.equal(finding.reason, 'worktree-synchronization-required');
  assert.equal(finding.owner_unavailable, true);
  assert.match(finding.remediation, /not yet reachable/);

  const second = run(fixture.root, 'inspect', '--ledger', fixture.ledger, '--id', secondId, '--json');
  const unrelated = run(
    fixture.root,
    'patch', '--ledger', fixture.ledger,
    '--input', await patchRequest(
      fixture.root,
      'patch-past-named-sibling.json',
      secondId,
      second.envelope.result.item.revision,
    ),
    '--json',
  );
  assert.equal(unrelated.exit, 0, JSON.stringify(unrelated.envelope));
});

// Row 6c: the same unreachable topology, written by a worktree from before the
// journal recorded writers. Only the writer identity leaves the authorizing
// entry, so the evidence Git can produce is unchanged and only the attribution
// is gone. An entry that names nobody must not be read as naming the reader:
// without that fallback every journal written before alpha.13 would turn a
// waiting worktree into a globally blocked one.
test('an unreachable successor from a pre-identity writer keeps advisory synchronization', async () => {
  const fixture = await twoWorktreeRepository();
  const seedId = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';
  const secondId = 'wb_01M01BFR000TXV22D7KZ6TQYH2';
  await writeItem(fixture.root, fixture.ledger, 'second', secondId);
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Add the unrelated item');
  git(fixture.siblingRoot, 'merge', '-q', fixture.branch);

  const inspected = run(
    fixture.siblingRoot, 'inspect', '--ledger', fixture.siblingLedger, '--id', seedId, '--json',
  );
  const siblingPatch = run(
    fixture.siblingRoot,
    'patch', '--ledger', fixture.siblingLedger,
    '--input', await patchRequest(
      fixture.siblingRoot,
      'patch-pre-identity-successor.json',
      seedId,
      inspected.envelope.result.item.revision,
    ),
    '--json',
  );
  assert.equal(siblingPatch.exit, 0, JSON.stringify(siblingPatch.envelope));

  // The topology was row 6b until this line: the identity the journal loses is
  // the sibling's, and the observer keeps its own.
  const stripped = await stripLatestWriterIdentity(fixture.root, seedId);
  assert.equal(stripped, await worktreeIdentity(fixture.siblingRoot));
  assert.notEqual(stripped, await worktreeIdentity(fixture.root));

  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');
  assert.equal(verified.exit, 6, JSON.stringify(verified.envelope));
  const finding = verified.envelope.result.findings.find((entry) => entry.item_id === seedId);
  assert.equal(finding.reason, 'worktree-synchronization-required');
  assert.equal(finding.owner_unavailable, true);
  assert.match(finding.remediation, /not yet reachable/);

  const second = run(fixture.root, 'inspect', '--ledger', fixture.ledger, '--id', secondId, '--json');
  const unrelated = run(
    fixture.root,
    'patch', '--ledger', fixture.ledger,
    '--input', await patchRequest(
      fixture.root,
      'patch-past-pre-identity-successor.json',
      secondId,
      second.envelope.result.item.revision,
    ),
    '--json',
  );
  assert.equal(unrelated.exit, 0, JSON.stringify(unrelated.envelope));
});

test('an authorized predecessor at HEAD does not block the next mutation', async () => {
  const fixture = await twoWorktreeRepository();
  const seedId = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';
  const secondId = 'wb_01M01BFR000TXV22D7KZ6TQYH2';
  const inspected = run(fixture.root, 'inspect', '--ledger', fixture.ledger, '--id', seedId, '--json');
  const requestPath = path.join(fixture.root, 'transition-before-commit.json');
  await writeFile(requestPath, JSON.stringify({
    id: seedId,
    expected_revision: inspected.envelope.result.item.revision,
    to_status: 'in-progress',
    date: '2026-08-16',
  }));
  const transitioned = run(
    fixture.root,
    'transition', '--ledger', fixture.ledger, '--input', requestPath, '--json',
  );
  assert.equal(transitioned.exit, 0, JSON.stringify(transitioned.envelope));

  const created = run(
    fixture.root,
    'create', '--ledger', fixture.ledger,
    '--input', await createRequest(
      fixture.root,
      'create-after-authorized-predecessor.json',
      secondId,
    ),
    '--json',
  );
  assert.equal(created.exit, 0, JSON.stringify(created.envelope));

  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');
  assert.equal(verified.exit, 0, JSON.stringify(verified.envelope));
  assert.deepEqual(verified.envelope.result.findings, []);
});

test('an uncommitted same-branch regression remains unauthorized and blocks unrelated work', async () => {
  const fixture = await twoWorktreeRepository();
  const seedId = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';
  const secondId = 'wb_01M01BFR000TXV22D7KZ6TQYH2';
  await writeItem(fixture.root, fixture.ledger, 'second', secondId);
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Add the unrelated item');

  const inspected = run(fixture.root, 'inspect', '--ledger', fixture.ledger, '--id', seedId, '--json');
  const patched = run(
    fixture.root,
    'patch', '--ledger', fixture.ledger,
    '--input', await patchRequest(
      fixture.root,
      'patch-same-branch-latest.json',
      seedId,
      inspected.envelope.result.item.revision,
    ),
    '--json',
  );
  assert.equal(patched.exit, 0, JSON.stringify(patched.envelope));
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Commit the latest authorized revision');
  git(fixture.root, 'restore', '--source=HEAD^', '--', 'ledger/item.md');

  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');
  assert.equal(verified.exit, 6, JSON.stringify(verified.envelope));
  const finding = verified.envelope.result.findings.find((entry) => entry.item_id === seedId);
  assert.equal(finding.reason, 'unauthorized-revision');

  const second = run(fixture.root, 'inspect', '--ledger', fixture.ledger, '--id', secondId, '--json');
  const unrelated = run(
    fixture.root,
    'patch', '--ledger', fixture.ledger,
    '--input', await patchRequest(
      fixture.root,
      'patch-past-same-branch-regression.json',
      secondId,
      second.envelope.result.item.revision,
    ),
    '--json',
  );
  assert.equal(unrelated.exit, 6, JSON.stringify(unrelated.envelope));
  assert.equal(unrelated.envelope.error.details.findings[0].reason, 'unauthorized-revision');
});

test('a detached HEAD regression remains unauthorized and blocks unrelated work', async () => {
  const fixture = await twoWorktreeRepository();
  const seedId = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';
  const secondId = 'wb_01M01BFR000TXV22D7KZ6TQYH2';
  await writeItem(fixture.root, fixture.ledger, 'second', secondId);
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Add the unrelated item');

  const inspected = run(fixture.root, 'inspect', '--ledger', fixture.ledger, '--id', seedId, '--json');
  const patched = run(
    fixture.root,
    'patch', '--ledger', fixture.ledger,
    '--input', await patchRequest(
      fixture.root,
      'patch-detached-head-latest.json',
      seedId,
      inspected.envelope.result.item.revision,
    ),
    '--json',
  );
  assert.equal(patched.exit, 0, JSON.stringify(patched.envelope));
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Commit the detached authorized revision');
  git(fixture.root, 'switch', '--detach', '-q');
  git(fixture.root, 'restore', '--source=HEAD^', '--', 'ledger/item.md');

  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');
  assert.equal(verified.exit, 6, JSON.stringify(verified.envelope));
  const finding = verified.envelope.result.findings.find((entry) => entry.item_id === seedId);
  assert.equal(finding.reason, 'unauthorized-revision');

  const second = run(fixture.root, 'inspect', '--ledger', fixture.ledger, '--id', secondId, '--json');
  const unrelated = run(
    fixture.root,
    'patch', '--ledger', fixture.ledger,
    '--input', await patchRequest(
      fixture.root,
      'patch-past-detached-head-regression.json',
      secondId,
      second.envelope.result.item.revision,
    ),
    '--json',
  );
  assert.equal(unrelated.exit, 6, JSON.stringify(unrelated.envelope));
  assert.equal(unrelated.envelope.error.details.findings[0].reason, 'unauthorized-revision');
});

test('an unknown sibling revision remains unauthorized and blocks unrelated work', async () => {
  const fixture = await twoWorktreeRepository();
  const seedId = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';
  const secondId = 'wb_01M01BFR000TXV22D7KZ6TQYH2';
  await writeItem(fixture.root, fixture.ledger, 'second', secondId);
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Add the unrelated item');
  git(fixture.siblingRoot, 'merge', '-q', fixture.branch);

  const inspected = run(fixture.root, 'inspect', '--ledger', fixture.ledger, '--id', seedId, '--json');
  const privatePatch = run(
    fixture.root,
    'patch', '--ledger', fixture.ledger,
    '--input', await patchRequest(
      fixture.root,
      'patch-authorized-private.json',
      seedId,
      inspected.envelope.result.item.revision,
    ),
    '--json',
  );
  assert.equal(privatePatch.exit, 0, JSON.stringify(privatePatch.envelope));
  const siblingSeed = path.join(fixture.siblingLedger, 'item.md');
  await writeFile(
    siblingSeed,
    (await readFile(siblingSeed, 'utf8')).replace('title: "Seed"', 'title: "Unauthorized"'),
  );

  const second = run(fixture.siblingRoot, 'inspect', '--ledger', fixture.siblingLedger, '--id', secondId, '--json');
  assert.equal(second.exit, 0, JSON.stringify(second.envelope));
  const unrelated = run(
    fixture.siblingRoot,
    'patch', '--ledger', fixture.siblingLedger,
    '--input', await patchRequest(
      fixture.siblingRoot,
      'patch-past-unauthorized-sibling.json',
      secondId,
      second.envelope.result.item.revision,
    ),
    '--json',
  );

  assert.equal(unrelated.exit, 6, JSON.stringify(unrelated.envelope));
  assert.equal(unrelated.envelope.error.details.findings[0].reason, 'unauthorized-revision');
});

test('post-commit verification ignores an unrelated synchronization finding', async () => {
  const fixture = await twoWorktreeRepository();
  const seedId = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';
  const secondId = 'wb_01M01BFR000TXV22D7KZ6TQYH2';
  await writeItem(fixture.root, fixture.ledger, 'second', secondId);
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Add the unrelated item');
  git(fixture.siblingRoot, 'merge', '-q', fixture.branch);

  const inspected = run(fixture.root, 'inspect', '--ledger', fixture.ledger, '--id', seedId, '--json');
  const privatePatch = run(
    fixture.root,
    'patch', '--ledger', fixture.ledger,
    '--input', await patchRequest(
      fixture.root,
      'patch-private-before-auto-commit.json',
      seedId,
      inspected.envelope.result.item.revision,
    ),
    '--json',
  );
  assert.equal(privatePatch.exit, 0, JSON.stringify(privatePatch.envelope));
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Commit the private item');

  const second = run(fixture.siblingRoot, 'inspect', '--ledger', fixture.siblingLedger, '--id', secondId, '--json');
  const unrelated = run(
    fixture.siblingRoot,
    'patch', '--ledger', fixture.siblingLedger,
    '--input', await patchRequest(
      fixture.siblingRoot,
      'auto-commit-unrelated.json',
      secondId,
      second.envelope.result.item.revision,
    ),
    '--json',
    '--auto-commit',
  );

  assert.equal(unrelated.exit, 0, JSON.stringify(unrelated.envelope));
  assert.equal(unrelated.envelope.result.claim_verified, true);
  assert.deepEqual(unrelated.envelope.result.commit_paths, [
    `.wowbagger/reconcile-${NAMESPACE}.md`,
    `${secondId}.md`,
  ]);
  const verified = run(fixture.siblingRoot, 'claim-verify', '--ledger', fixture.siblingLedger, '--json');
  assert.equal(verified.exit, 6, JSON.stringify(verified.envelope));
  const finding = verified.envelope.result.findings.find((entry) => entry.item_id === seedId);
  assert.equal(finding.reason, 'worktree-synchronization-required');
  assert.equal(finding.owner_ref, `refs/heads/${fixture.branch}`);
});

test('auto-commit still blocks a synchronization finding on its own target', async () => {
  const fixture = await twoWorktreeRepository();
  const seedId = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';
  const inspected = run(fixture.root, 'inspect', '--ledger', fixture.ledger, '--id', seedId, '--json');
  const privatePatch = run(
    fixture.root,
    'patch', '--ledger', fixture.ledger,
    '--input', await patchRequest(
      fixture.root,
      'patch-private-target.json',
      seedId,
      inspected.envelope.result.item.revision,
    ),
    '--json',
  );
  assert.equal(privatePatch.exit, 0, JSON.stringify(privatePatch.envelope));
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Commit the private target item');

  const sibling = run(
    fixture.siblingRoot,
    'inspect', '--ledger', fixture.siblingLedger, '--id', seedId, '--json',
  );
  const head = git(fixture.siblingRoot, 'rev-parse', 'HEAD');
  const blocked = run(
    fixture.siblingRoot,
    'patch', '--ledger', fixture.siblingLedger,
    '--input', await patchRequest(
      fixture.siblingRoot,
      'auto-commit-target.json',
      seedId,
      sibling.envelope.result.item.revision,
    ),
    '--json',
    '--auto-commit',
  );

  assert.equal(blocked.exit, 4, JSON.stringify(blocked.envelope));
  assert.equal(blocked.envelope.error.code, 'auto-commit-preflight-failed');
  assert.equal(blocked.envelope.error.details.reason, 'claim-state-unreconciled');
  assert.equal(blocked.envelope.error.details.findings[0].reason, 'worktree-synchronization-required');
  assert.equal(git(fixture.siblingRoot, 'rev-parse', 'HEAD'), head);
});

// A worktree's identity belongs to that worktree alone, so it lives in the
// private Git directory rather than the shared common directory or the
// tracked working tree. Writing it is a side effect of the first fenced
// mutation, and it must leave `git status` exactly as it found it.
test('a fenced patch creates a private worktree identity outside the working tree', async () => {
  const fixture = await twoWorktreeRepository();
  const seedId = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';
  const inspected = run(fixture.root, 'inspect', '--ledger', fixture.ledger, '--id', seedId, '--json');
  const patched = run(
    fixture.root,
    'patch', '--ledger', fixture.ledger,
    '--input', await patchRequest(
      fixture.root,
      'patch-identity.json',
      seedId,
      inspected.envelope.result.item.revision,
    ),
    '--json',
  );
  assert.equal(patched.exit, 0, JSON.stringify(patched.envelope));

  const gitDir = git(fixture.root, 'rev-parse', '--absolute-git-dir');
  const identityPath = path.join(gitDir, 'wowbagger-worktree-id');
  const beforeStatus = git(fixture.root, 'status', '--porcelain');
  const identity = await readFile(identityPath, 'utf8');
  assert.match(identity, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\n$/);
  assert.equal((await stat(identityPath)).mode & 0o777, 0o600);
  assert.equal(path.dirname(identityPath), gitDir);
  assert.equal(git(fixture.root, 'status', '--porcelain'), beforeStatus);
});

// Worktree identity is scoped to the worktree; the namespace write lock is
// scoped to one ledger namespace. Two namespaces can share one worktree, and
// therefore one private Git directory, so the namespace lock cannot serialize
// them against each other. Read and create need their own worktree-keyed
// exclusion: without it both writers observe no identity, both create one, and
// the later rename leaves the earlier writer holding an ID the file no longer
// contains. A writer that loses the race must be refused, not silently handed
// a stale ID.
test('two namespaces in one worktree cannot diverge the worktree identity', async () => {
  const fixture = await twoWorktreeRepository();
  const secondLedger = path.join(fixture.root, 'ledger-b');
  await mkdir(path.join(secondLedger, '.wowbagger'), { recursive: true });
  await writeFile(path.join(secondLedger, '.wowbagger', 'namespace'), `${SECOND_NAMESPACE}\n`);
  const gitCommonDir = git(fixture.root, 'rev-parse', '--path-format=absolute', '--git-common-dir');
  const gitDir = git(fixture.root, 'rev-parse', '--absolute-git-dir');
  const identityPath = path.join(gitDir, 'wowbagger-worktree-id');
  const beforeStatus = git(fixture.root, 'status', '--porcelain');

  // While one worktree writer holds the identity lock, a writer in the other
  // namespace cannot create a competing identity. It is refused with the
  // retryable lock outcome and publishes nothing.
  await withClaimLock(identityPath, async () => {
    await assert.rejects(
      ensureWorktreeIdentity({ ledgerDirectory: secondLedger, gitCommonDir }),
      (error) => error.code === 'CLAIM_LOCK_HELD',
    );
    await assert.rejects(stat(identityPath), (error) => error.code === 'ENOENT');
  });

  const settled = await Promise.allSettled([
    ensureWorktreeIdentity({ ledgerDirectory: fixture.ledger, gitCommonDir }),
    ensureWorktreeIdentity({ ledgerDirectory: secondLedger, gitCommonDir }),
  ]);
  const stored = await readFile(identityPath, 'utf8');
  assert.match(stored, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\n$/);
  const canonical = stored.slice(0, -1);
  assert.ok(settled.some((outcome) => outcome.status === 'fulfilled'));
  for (const outcome of settled) {
    if (outcome.status === 'fulfilled') assert.equal(outcome.value, canonical);
    else assert.equal(outcome.reason?.code, 'CLAIM_LOCK_HELD');
  }

  // Either namespace reuses the published identity rather than rewriting it.
  assert.equal(
    await ensureWorktreeIdentity({ ledgerDirectory: fixture.ledger, gitCommonDir }),
    canonical,
  );
  assert.equal(await readFile(identityPath, 'utf8'), stored);
  assert.equal((await stat(identityPath)).mode & 0o777, 0o600);

  const debris = (await readdir(gitDir)).filter(
    (entry) => entry.includes('wowbagger-worktree-id') && entry !== 'wowbagger-worktree-id',
  );
  assert.deepEqual(debris, []);
  assert.equal(git(fixture.root, 'status', '--porcelain'), beforeStatus);
});

// The private Git directory of one worktree, whose bytes belong to that
// worktree alone.
function identityPathOf(root) {
  return path.join(git(root, 'rev-parse', '--absolute-git-dir'), 'wowbagger-worktree-id');
}

// A file that a refusal must not create, read as its absence rather than as an
// error, so "never written" and "written and unchanged" are both provable.
async function readIfPresent(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

// Everything a refusal on ambiguous identity must leave exactly as it found
// it: the item bytes an operator reads, the durable journal, the derived
// reconciliation log, every worktree identity file, and the commit and index
// of the worktree running the command.
async function identitySnapshot(root, ledger, roots) {
  const journalPath = path.join(
    git(root, 'rev-parse', '--path-format=absolute', '--git-common-dir'),
    'wowbagger', NAMESPACE, 'journal.ndjson',
  );
  const identities = [];
  for (const at of roots) identities.push(await readIfPresent(identityPathOf(at)));
  return {
    head: git(root, 'rev-parse', 'HEAD'),
    identities,
    index: git(root, 'ls-files', '-s'),
    item: await readFile(path.join(ledger, 'item.md'), 'utf8'),
    journal: await readIfPresent(journalPath),
    log: await readIfPresent(path.join(ledger, '.wowbagger', `reconcile-${NAMESPACE}.md`)),
    status: git(root, 'status', '--porcelain'),
  };
}

// A UUID names one worktree. Two live worktrees answering to one UUID make
// every writer attribution in the shared journal ambiguous, so nothing may be
// classified or published from that evidence: both the report and the mutation
// refuse before touching a byte, and both name the collision explicitly.
test('two live worktrees sharing one identity refuse verification and mutation', async () => {
  const fixture = await twoWorktreeRepository();
  const seedId = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';

  // One completed fenced mutation first, so the journal, the reconciliation
  // log, and an identity file all exist to be left alone.
  const seeded = run(fixture.root, 'inspect', '--ledger', fixture.ledger, '--id', seedId, '--json');
  const seedPatch = run(
    fixture.root,
    'patch', '--ledger', fixture.ledger,
    '--input', await patchRequest(
      fixture.root,
      'patch-before-duplicate.json',
      seedId,
      seeded.envelope.result.item.revision,
    ),
    '--json',
  );
  assert.equal(seedPatch.exit, 0, JSON.stringify(seedPatch.envelope));
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Record the first mutation');

  const duplicateId = '00000000-0000-4000-8000-000000000000';
  const roots = [fixture.root, fixture.siblingRoot];
  for (const at of roots) {
    await writeFile(identityPathOf(at), `${duplicateId}\n`, { mode: 0o600 });
  }
  const identityDiagnostic = {
    code: 'duplicate-worktree-identity',
    worktree_id: duplicateId,
    live_worktree_count: 2,
  };
  // The request file is untracked working-tree noise the refusal is not
  // responsible for, so it exists before the snapshot is taken.
  const inspected = run(
    fixture.root, 'inspect', '--ledger', fixture.ledger, '--id', seedId, '--json',
  );
  const blockedRequest = await patchRequest(
    fixture.root,
    'patch-duplicate-identity.json',
    seedId,
    inspected.envelope.result.item.revision,
  );
  const before = await identitySnapshot(fixture.root, fixture.ledger, roots);

  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');
  const blocked = run(
    fixture.root,
    'patch', '--ledger', fixture.ledger,
    '--input', blockedRequest,
    '--json',
  );

  assert.equal(verified.exit, 6, JSON.stringify(verified.envelope));
  assert.equal(verified.envelope.state, 'unchanged');
  assert.equal(verified.envelope.error.code, 'claim-store-unavailable');
  assert.equal(verified.envelope.error.details.reason, 'claim-store-unreadable');
  assert.deepEqual(verified.envelope.error.details.identity_diagnostic, identityDiagnostic);

  assert.equal(blocked.exit, 6, JSON.stringify(blocked.envelope));
  assert.equal(blocked.envelope.state, 'unchanged');
  assert.equal(blocked.envelope.error.code, 'claim-store-unavailable');
  assert.equal(blocked.envelope.error.details.reason, 'claim-store-unreadable');
  assert.deepEqual(blocked.envelope.error.details.identity_diagnostic, identityDiagnostic);

  assert.deepEqual(await identitySnapshot(fixture.root, fixture.ledger, roots), before);
});

// Two live worktrees, one canonical UUID, and both identity files already
// written: the collision the whole roster check exists to catch.
async function duplicateIdentityFixture() {
  const fixture = await twoWorktreeRepository();
  const duplicateId = '00000000-0000-4000-8000-000000000000';
  const roots = [fixture.root, fixture.siblingRoot];
  for (const at of roots) {
    await writeFile(identityPathOf(at), `${duplicateId}\n`, { mode: 0o600 });
  }
  return { ...fixture, duplicateId, roots };
}

// Auto-commit gates on claim verification, so the collision reaches it as a
// preflight refusal. The nested claim-verification fields are the whole
// diagnosis an operator gets, so they must carry the collision itself and must
// not invite a retry: no wait clears two worktrees answering to one UUID.
test('auto-commit refuses in preflight when two live worktrees share one identity', async () => {
  const fixture = await duplicateIdentityFixture();
  const seedId = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';
  const inspected = run(fixture.root, 'inspect', '--ledger', fixture.ledger, '--id', seedId, '--json');
  const request = await patchRequest(
    fixture.root,
    'patch-duplicate-auto-commit.json',
    seedId,
    inspected.envelope.result.item.revision,
  );
  const head = git(fixture.root, 'rev-parse', 'HEAD');

  const blocked = run(
    fixture.root,
    'patch', '--ledger', fixture.ledger,
    '--input', request,
    '--json',
    '--auto-commit',
  );

  assert.equal(blocked.exit, 4, JSON.stringify(blocked.envelope));
  assert.equal(blocked.envelope.state, 'unchanged');
  assert.equal(blocked.envelope.error.code, 'auto-commit-preflight-failed');
  assert.deepEqual(blocked.envelope.error.details, {
    reason: 'claim-state-unreconciled',
    claim_verify_code: 'claim-store-unavailable',
    claim_verify_reason: 'claim-store-unreadable',
    identity_diagnostic: {
      code: 'duplicate-worktree-identity',
      worktree_id: fixture.duplicateId,
      live_worktree_count: 2,
    },
    retryable: false,
  });
  assert.equal(git(fixture.root, 'rev-parse', 'HEAD'), head);
  for (const at of fixture.roots) {
    assert.equal(await readFile(identityPathOf(at), 'utf8'), `${fixture.duplicateId}\n`);
  }
});

// A claimed publication is a mutation, so an ambiguous domain must refuse it
// on the claim-store surface rather than report a mutation whose outcome
// nobody can name. An operator who reads `unknown` starts recovering a write
// that never happened.
test('publish-claimed refuses when two live worktrees share one identity', async () => {
  const fixture = await duplicateIdentityFixture();
  const seedId = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';
  const itemPath = path.join(fixture.ledger, 'item.md');
  const before = await readFile(itemPath);
  const candidate = Buffer.from(
    before.toString('utf8').replace('title: "Seed"', 'title: "Published"'), 'utf8',
  );

  const acquirePath = path.join(fixture.root, 'acquire-duplicate.json');
  await writeFile(acquirePath, JSON.stringify({
    ledger_namespace: NAMESPACE,
    item_id: seedId,
    owner_id: 'agent-a',
    lease_duration_ms: 300_000,
    expected: { last_epoch: '0', active: null },
  }));
  const acquired = run(
    fixture.root, 'claim', 'acquire', '--ledger', fixture.ledger,
    '--input', acquirePath, '--json',
  );
  assert.equal(acquired.exit, 0, JSON.stringify(acquired.envelope));

  const requestPath = path.join(fixture.root, 'publish-duplicate.json');
  await writeFile(requestPath, JSON.stringify({
    operation_id: 'pub_agent-a_0001',
    ledger_namespace: NAMESPACE,
    item_id: seedId,
    expected_revision: `sha256:${createHash('sha256').update(before).digest('hex')}`,
    candidate_source_base64: candidate.toString('base64'),
    candidate_sha256: `sha256:${createHash('sha256').update(candidate).digest('hex')}`,
    claim_fence: {
      ledger_namespace: NAMESPACE,
      item_id: seedId,
      owner_id: 'agent-a',
      epoch: acquired.envelope.result.claim.epoch,
    },
  }));
  const snapshot = await identitySnapshot(fixture.root, fixture.ledger, fixture.roots);

  const published = run(
    fixture.root, 'publish-claimed', '--ledger', fixture.ledger,
    '--input', requestPath, '--json',
  );

  assert.equal(published.exit, 6, JSON.stringify(published.envelope));
  assert.equal(published.envelope.state, 'unchanged');
  assert.equal(published.envelope.error.code, 'claim-store-unavailable');
  assert.deepEqual(published.envelope.error.details, {
    reason: 'claim-store-unreadable',
    identity_diagnostic: {
      code: 'duplicate-worktree-identity',
      worktree_id: fixture.duplicateId,
      live_worktree_count: 2,
    },
  });
  assert.deepEqual(await readFile(itemPath), before);
  assert.deepEqual(
    await identitySnapshot(fixture.root, fixture.ledger, fixture.roots),
    snapshot,
  );
});

// Adoption re-baselines an authorized revision, so it reasons from the same
// ambiguous writer evidence and refuses on the same surface. It refuses before
// it judges the request against state: an ambiguous domain cannot rule on what
// is legitimate.
test('claim-adopt refuses when two live worktrees share one identity', async () => {
  const fixture = await duplicateIdentityFixture();
  const seedId = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';
  const before = await readFile(path.join(fixture.ledger, 'item.md'));

  const requestPath = path.join(fixture.root, 'adopt-duplicate.json');
  await writeFile(requestPath, JSON.stringify({
    ledger_namespace: NAMESPACE,
    item_id: seedId,
    from_revision: `sha256:${createHash('sha256').update(before).digest('hex')}`,
    to_revision: `sha256:${'a'.repeat(64)}`,
    adopted_by: 'operator-lee',
  }));
  const snapshot = await identitySnapshot(fixture.root, fixture.ledger, fixture.roots);

  const adopted = run(
    fixture.root, 'claim-adopt', '--ledger', fixture.ledger,
    '--input', requestPath, '--json',
  );

  assert.equal(adopted.exit, 6, JSON.stringify(adopted.envelope));
  assert.equal(adopted.envelope.state, 'unchanged');
  assert.equal(adopted.envelope.error.code, 'claim-store-unavailable');
  assert.deepEqual(adopted.envelope.error.details, {
    reason: 'claim-store-unreadable',
    identity_diagnostic: {
      code: 'duplicate-worktree-identity',
      worktree_id: fixture.duplicateId,
      live_worktree_count: 2,
    },
  });
  assert.deepEqual(
    await identitySnapshot(fixture.root, fixture.ledger, fixture.roots),
    snapshot,
  );
});

// A roster the coordinator could not finish reading is not a roster without
// duplicates. Git still reports this sibling as a live worktree, so it is
// ownership evidence that must be gathered; its private Git directory no
// longer resolves, so it cannot be. Shrinking the evidence to what happened to
// read would hide exactly the collision the roster exists to find, so every
// surface refuses instead, and says the roster is what failed.
async function unreadableRosterFixture() {
  const fixture = await twoWorktreeRepository();
  const seedId = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';
  const seeded = run(fixture.root, 'inspect', '--ledger', fixture.ledger, '--id', seedId, '--json');
  const seedPatch = run(
    fixture.root,
    'patch', '--ledger', fixture.ledger,
    '--input', await patchRequest(
      fixture.root,
      'patch-before-unreadable-roster.json',
      seedId,
      seeded.envelope.result.item.revision,
    ),
    '--json',
  );
  assert.equal(seedPatch.exit, 0, JSON.stringify(seedPatch.envelope));
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Record the first mutation');

  // Git keeps listing the sibling as live: its administrative gitdir file is
  // intact, so nothing marks it prunable. Only the worktree's own `.git` link
  // is unusable, which is precisely a live record that will not resolve.
  await writeFile(path.join(fixture.siblingRoot, '.git'), 'not a gitfile\n');
  const listed = git(fixture.root, 'worktree', 'list', '--porcelain');
  assert.ok(listed.includes(fixture.siblingRoot), listed);
  assert.ok(!listed.includes('prunable'), listed);
  return { ...fixture, roots: [fixture.root], seedId };
}

test('an unreadable worktree roster refuses verification, mutation, and auto-commit', async () => {
  const fixture = await unreadableRosterFixture();
  const identityDiagnostic = { code: 'worktree-enumeration-failed' };
  const inspected = run(
    fixture.root, 'inspect', '--ledger', fixture.ledger, '--id', fixture.seedId, '--json',
  );
  const request = await patchRequest(
    fixture.root,
    'patch-unreadable-roster.json',
    fixture.seedId,
    inspected.envelope.result.item.revision,
  );
  const before = await identitySnapshot(fixture.root, fixture.ledger, fixture.roots);

  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');
  const blocked = run(
    fixture.root, 'patch', '--ledger', fixture.ledger, '--input', request, '--json',
  );
  const autoCommitted = run(
    fixture.root, 'patch', '--ledger', fixture.ledger, '--input', request, '--json',
    '--auto-commit',
  );

  assert.equal(verified.exit, 6, JSON.stringify(verified.envelope));
  assert.equal(verified.envelope.state, 'unchanged');
  assert.equal(verified.envelope.error.code, 'claim-store-unavailable');
  assert.deepEqual(verified.envelope.error.details, {
    reason: 'claim-store-unreadable',
    identity_diagnostic: identityDiagnostic,
  });

  assert.equal(blocked.exit, 6, JSON.stringify(blocked.envelope));
  assert.equal(blocked.envelope.state, 'unchanged');
  assert.equal(blocked.envelope.error.code, 'claim-store-unavailable');
  assert.deepEqual(blocked.envelope.error.details, {
    reason: 'claim-store-unreadable',
    identity_diagnostic: identityDiagnostic,
  });

  assert.equal(autoCommitted.exit, 4, JSON.stringify(autoCommitted.envelope));
  assert.equal(autoCommitted.envelope.state, 'unchanged');
  assert.equal(autoCommitted.envelope.error.code, 'auto-commit-preflight-failed');
  assert.deepEqual(autoCommitted.envelope.error.details, {
    reason: 'claim-state-unreconciled',
    claim_verify_code: 'claim-store-unavailable',
    claim_verify_reason: 'claim-store-unreadable',
    identity_diagnostic: identityDiagnostic,
    retryable: false,
  });

  assert.deepEqual(
    await identitySnapshot(fixture.root, fixture.ledger, fixture.roots),
    before,
  );
});

test('an unreadable worktree roster refuses publish-claimed and claim-adopt', async () => {
  const fixture = await unreadableRosterFixture();
  const identityDiagnostic = { code: 'worktree-enumeration-failed' };
  const itemPath = path.join(fixture.ledger, 'item.md');
  const before = await readFile(itemPath);
  const candidate = Buffer.from(
    before.toString('utf8').replace('title: "Sibling edit"', 'title: "Published"'), 'utf8',
  );
  assert.notDeepEqual(candidate, before);

  const acquirePath = path.join(fixture.root, 'acquire-unreadable-roster.json');
  await writeFile(acquirePath, JSON.stringify({
    ledger_namespace: NAMESPACE,
    item_id: fixture.seedId,
    owner_id: 'agent-a',
    lease_duration_ms: 300_000,
    expected: { last_epoch: '0', active: null },
  }));
  const acquired = run(
    fixture.root, 'claim', 'acquire', '--ledger', fixture.ledger,
    '--input', acquirePath, '--json',
  );
  assert.equal(acquired.exit, 0, JSON.stringify(acquired.envelope));

  const publishPath = path.join(fixture.root, 'publish-unreadable-roster.json');
  await writeFile(publishPath, JSON.stringify({
    operation_id: 'pub_agent-a_0001',
    ledger_namespace: NAMESPACE,
    item_id: fixture.seedId,
    expected_revision: `sha256:${createHash('sha256').update(before).digest('hex')}`,
    candidate_source_base64: candidate.toString('base64'),
    candidate_sha256: `sha256:${createHash('sha256').update(candidate).digest('hex')}`,
    claim_fence: {
      ledger_namespace: NAMESPACE,
      item_id: fixture.seedId,
      owner_id: 'agent-a',
      epoch: acquired.envelope.result.claim.epoch,
    },
  }));
  const adoptPath = path.join(fixture.root, 'adopt-unreadable-roster.json');
  await writeFile(adoptPath, JSON.stringify({
    ledger_namespace: NAMESPACE,
    item_id: fixture.seedId,
    from_revision: `sha256:${createHash('sha256').update(before).digest('hex')}`,
    to_revision: `sha256:${'a'.repeat(64)}`,
    adopted_by: 'operator-lee',
  }));
  const snapshot = await identitySnapshot(fixture.root, fixture.ledger, fixture.roots);

  const published = run(
    fixture.root, 'publish-claimed', '--ledger', fixture.ledger,
    '--input', publishPath, '--json',
  );
  const adopted = run(
    fixture.root, 'claim-adopt', '--ledger', fixture.ledger,
    '--input', adoptPath, '--json',
  );

  assert.equal(published.exit, 6, JSON.stringify(published.envelope));
  assert.equal(published.envelope.state, 'unchanged');
  assert.equal(published.envelope.error.code, 'claim-store-unavailable');
  assert.deepEqual(published.envelope.error.details, {
    reason: 'claim-store-unreadable',
    identity_diagnostic: identityDiagnostic,
  });

  assert.equal(adopted.exit, 6, JSON.stringify(adopted.envelope));
  assert.equal(adopted.envelope.state, 'unchanged');
  assert.equal(adopted.envelope.error.code, 'claim-store-unavailable');
  assert.deepEqual(adopted.envelope.error.details, {
    reason: 'claim-store-unreadable',
    identity_diagnostic: identityDiagnostic,
  });

  assert.deepEqual(await readFile(itemPath), before);
  assert.deepEqual(
    await identitySnapshot(fixture.root, fixture.ledger, fixture.roots),
    snapshot,
  );
});

// Removing a worktree removes the private Git directory that held its
// identity, and nothing copies or restores it. A worktree recreated at the
// same path is a different worktree, so it must earn a fresh UUID: if it
// inherited the removed one, the journal entry the departed worktree wrote
// would read as this worktree's own work, and the advice would flip from "wait
// for the owner" to "your local bytes are unauthorized, discard them".
test('a recreated worktree earns a new identity instead of inheriting the removed one', async () => {
  const fixture = await twoWorktreeRepository();
  const seedId = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';
  const secondId = 'wb_01M01BFR000TXV22D7KZ6TQYH2';
  await writeItem(fixture.root, fixture.ledger, 'second', secondId);
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Add the unrelated item');
  git(fixture.siblingRoot, 'merge', '-q', fixture.branch);

  const inspected = run(
    fixture.siblingRoot, 'inspect', '--ledger', fixture.siblingLedger, '--id', seedId, '--json',
  );
  const siblingPatch = run(
    fixture.siblingRoot,
    'patch', '--ledger', fixture.siblingLedger,
    '--input', await patchRequest(
      fixture.siblingRoot,
      'patch-before-recreation.json',
      seedId,
      inspected.envelope.result.item.revision,
    ),
    '--json',
  );
  assert.equal(siblingPatch.exit, 0, JSON.stringify(siblingPatch.envelope));
  const writer = await worktreeIdentity(fixture.siblingRoot);
  assert.equal((await latestAuthorization(fixture.root, seedId)).entry.writer_worktree_id, writer);

  git(fixture.root, 'worktree', 'remove', '--force', fixture.siblingRoot);
  git(fixture.root, 'worktree', 'add', '-q', fixture.siblingRoot, 'sibling');
  await assert.rejects(
    stat(identityPathOf(fixture.siblingRoot)),
    (error) => error.code === 'ENOENT',
  );

  // The recreated worktree cannot name itself yet, so the writer the journal
  // still records normalizes to unknown. The finding stays the advisory
  // synchronization one, never the destructive unauthorized-revision.
  const verified = run(
    fixture.siblingRoot, 'claim-verify', '--ledger', fixture.siblingLedger, '--json',
  );
  assert.equal(verified.exit, 6, JSON.stringify(verified.envelope));
  const finding = verified.envelope.result.findings.find((entry) => entry.item_id === seedId);
  assert.equal(finding.reason, 'worktree-synchronization-required', JSON.stringify(finding));
  assert.equal(finding.owner_unavailable, true, JSON.stringify(finding));

  // The first fenced mutation in the recreated worktree earns a fresh UUID,
  // and the journal keeps naming the removed one for the entry it authorized.
  const second = run(
    fixture.siblingRoot, 'inspect', '--ledger', fixture.siblingLedger, '--id', secondId, '--json',
  );
  const unrelated = run(
    fixture.siblingRoot,
    'patch', '--ledger', fixture.siblingLedger,
    '--input', await patchRequest(
      fixture.siblingRoot,
      'patch-after-recreation.json',
      secondId,
      second.envelope.result.item.revision,
    ),
    '--json',
  );
  assert.equal(unrelated.exit, 0, JSON.stringify(unrelated.envelope));
  const recreated = await worktreeIdentity(fixture.siblingRoot);
  assert.notEqual(recreated, writer);
  assert.equal((await latestAuthorization(fixture.root, seedId)).entry.writer_worktree_id, writer);

  // What the fresh UUID buys, demonstrated rather than asserted in the
  // abstract: hand the recreated worktree the removed UUID and the same
  // journal, the same refs, and the same bytes stop advising a wait and start
  // advising the operator to discard work. That flip is the aliasing this test
  // exists to prevent, so the identity above is load-bearing, not decorative.
  await writeFile(identityPathOf(fixture.siblingRoot), `${writer}\n`, { mode: 0o600 });
  const aliased = run(
    fixture.siblingRoot, 'claim-verify', '--ledger', fixture.siblingLedger, '--json',
  );
  assert.equal(aliased.exit, 6, JSON.stringify(aliased.envelope));
  assert.equal(
    aliased.envelope.result.findings.find((entry) => entry.item_id === seedId).reason,
    'unauthorized-revision',
  );
});

// A `git` that answers the roster question as the caller dictates, and answers
// every other question exactly as Git does. `records: null` makes the listing
// refuse outright; otherwise each entry is the exact attribute list Git would
// emit for one worktree, NUL-terminated with the extra NUL between records.
// These are the rosters Git itself cannot be talked into on demand: a listing
// that fails, a record Git calls live whose path is already gone, and a
// prunable record that still holds a real colliding identity.
async function gitRosterShim(records) {
  const directory = await mkdtemp(path.join(tmpdir(), 'wb-git-shim-'));
  const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  assert.ok(realGit, 'the real git must be resolvable');
  const roster = records === null
    ? "  process.stderr.write('fatal: injected worktree listing failure\\n');\n  process.exit(3);"
    : `  process.stdout.write(${JSON.stringify(
      records.map((fields) => `${fields.join('\0')}\0\0`).join(''),
    )});\n  process.exit(0);`;
  const shim = path.join(directory, 'git');
  await writeFile(shim, [
    `#!${process.execPath}`,
    "const { spawnSync } = require('node:child_process');",
    'const args = process.argv.slice(2);',
    "if (args[0] === 'worktree' && args[1] === 'list') {",
    roster,
    '}',
    `const result = spawnSync(${JSON.stringify(realGit)}, args, { stdio: 'inherit' });`,
    'process.exit(result.status ?? 1);',
    '',
  ].join('\n'), { mode: 0o755 });
  return { PATH: `${directory}${path.delimiter}${process.env.PATH}` };
}

// The same fixture the unreadable-roster vectors use, minus the sabotage: one
// completed fenced mutation committed to Git, so journal, reconciliation log,
// and identity file all exist and can be proven untouched.
async function seededWorktreeRepository(label) {
  const fixture = await twoWorktreeRepository();
  const seedId = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';
  const seeded = run(fixture.root, 'inspect', '--ledger', fixture.ledger, '--id', seedId, '--json');
  const seedPatch = run(
    fixture.root,
    'patch', '--ledger', fixture.ledger,
    '--input', await patchRequest(fixture.root, `patch-before-${label}.json`, seedId, seeded.envelope.result.item.revision),
    '--json',
  );
  assert.equal(seedPatch.exit, 0, JSON.stringify(seedPatch.envelope));
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Record the first mutation');
  return { ...fixture, roots: [fixture.root], seedId };
}

// Assert the two core surfaces refuse with the enumeration diagnostic and leave
// every byte alone. `env` carries an optional roster shim.
async function assertRosterRefusal(fixture, label, env) {
  const inspected = run(
    fixture.root, 'inspect', '--ledger', fixture.ledger, '--id', fixture.seedId, '--json',
  );
  const request = await patchRequest(
    fixture.root, `patch-${label}.json`, fixture.seedId, inspected.envelope.result.item.revision,
  );
  const before = await identitySnapshot(fixture.root, fixture.ledger, fixture.roots);

  const verified = runEnv(fixture.root, env, 'claim-verify', '--ledger', fixture.ledger, '--json');
  const blocked = runEnv(
    fixture.root, env, 'patch', '--ledger', fixture.ledger, '--input', request, '--json',
  );

  for (const refused of [verified, blocked]) {
    assert.equal(refused.exit, 6, JSON.stringify(refused.envelope));
    assert.equal(refused.envelope.state, 'unchanged');
    assert.equal(refused.envelope.error.code, 'claim-store-unavailable');
    assert.deepEqual(refused.envelope.error.details, {
      reason: 'claim-store-unreadable',
      identity_diagnostic: { code: 'worktree-enumeration-failed' },
    });
  }
  assert.deepEqual(
    await identitySnapshot(fixture.root, fixture.ledger, fixture.roots),
    before,
  );
}

// Git cannot answer the roster question at all. Evidence is unavailable, which
// is not the same as evidence of no duplicate, so nothing classifies or writes.
test('a failed worktree roster listing refuses verification and mutation', async () => {
  const fixture = await seededWorktreeRepository('listing-failed');
  await assertRosterRefusal(fixture, 'listing-failed', await gitRosterShim(null));
});

// Git reports a worktree live and its path is already gone: the race between
// listing a roster and reading it. A vanished path is not an absent identity.
test('a live worktree record with a vanished path refuses verification and mutation', async () => {
  const fixture = await seededWorktreeRepository('vanished-path');
  const ghost = path.join(await mkdtemp(path.join(tmpdir(), 'wb-ghost-')), 'gone');
  await assertRosterRefusal(fixture, 'vanished-path', await gitRosterShim([[
    `worktree ${ghost}`, `HEAD ${'0'.repeat(40)}`, 'branch refs/heads/ghost',
  ]]));
});

// A live sibling's identity file is present and unreadable as a UUID. Skipping
// it would shrink the roster to what happened to parse, which could hide the
// very duplicate the check exists to find, so the roster counts as incomplete.
test('malformed identity bytes in a live sibling refuse verification and mutation', async () => {
  const fixture = await seededWorktreeRepository('malformed-sibling');
  await writeFile(identityPathOf(fixture.siblingRoot), 'not-a-uuid\n', { mode: 0o600 });
  await assertRosterRefusal(fixture, 'malformed-sibling', {});
});

// The exclusion the spec grants and nothing else: a record Git itself marks
// prunable is not ownership evidence, even when its identity file really does
// hold the colliding UUID. Git cannot be made to mark a worktree prunable while
// its bytes are still readable — deleting the checkout takes the identity file
// with it, leaving nothing to collide and nothing to exclude — so the marker
// comes from the roster while both identity files stay real. Production parses
// that roster, resolves both private Git directories, and must still proceed.
test('a prunable worktree carrying the same identity does not refuse anything', async () => {
  const fixture = await seededWorktreeRepository('prunable-duplicate');
  const duplicateId = '00000000-0000-4000-8000-000000000000';
  for (const at of [fixture.root, fixture.siblingRoot]) {
    await writeFile(identityPathOf(at), `${duplicateId}\n`, { mode: 0o600 });
  }
  const head = git(fixture.root, 'rev-parse', 'HEAD');
  const env = await gitRosterShim([
    [`worktree ${fixture.root}`, `HEAD ${head}`, `branch refs/heads/${fixture.branch}`],
    [
      `worktree ${fixture.siblingRoot}`, `HEAD ${head}`, 'branch refs/heads/sibling',
      'prunable gitdir file points to non-existent location',
    ],
  ]);

  const inspected = run(
    fixture.root, 'inspect', '--ledger', fixture.ledger, '--id', fixture.seedId, '--json',
  );
  const verified = runEnv(fixture.root, env, 'claim-verify', '--ledger', fixture.ledger, '--json');
  const patched = runEnv(
    fixture.root, env, 'patch', '--ledger', fixture.ledger,
    '--input', await patchRequest(
      fixture.root, 'patch-prunable-duplicate.json', fixture.seedId,
      inspected.envelope.result.item.revision,
    ),
    '--json',
  );

  assert.equal(verified.exit, 0, JSON.stringify(verified.envelope));
  assert.equal(verified.envelope.ok, true);
  assert.deepEqual(verified.envelope.result.findings, []);
  assert.equal(patched.exit, 0, JSON.stringify(patched.envelope));
  assert.equal(patched.envelope.state, 'committed');
  // The live worktree keeps the identity it already answered to, and the
  // excluded one is neither read as a writer nor rewritten.
  assert.equal(await readFile(identityPathOf(fixture.root), 'utf8'), `${duplicateId}\n`);
  assert.equal(await readFile(identityPathOf(fixture.siblingRoot), 'utf8'), `${duplicateId}\n`);
});

// The parser answers with records, not text, so these vectors assert records.
// NUL termination is not a style preference: a worktree path may contain a
// newline, and the newline-delimited spelling cannot report one. Both awkward
// paths here are real checkouts Git created and reports, and every marker Git
// can attach to a record appears exactly once.
test('the worktree roster parses every marker and survives awkward paths', async () => {
  const home = await realpath(await mkdtemp(path.join(tmpdir(), 'wb-roster-')));
  const root = path.join(home, 'main');
  await mkdir(root);
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Wowbagger Test');
  await writeFile(path.join(root, 'file'), 'seed\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'Seed');
  const branch = git(root, 'rev-parse', '--abbrev-ref', 'HEAD');
  const head = git(root, 'rev-parse', 'HEAD');

  const spaced = path.join(home, 'with space');
  const newlined = path.join(home, 'with\nnewline');
  const detached = path.join(home, 'detached');
  const locked = path.join(home, 'locked');
  const pruned = path.join(home, 'pruned');
  git(root, 'worktree', 'add', '-q', '-b', 'spaced', spaced);
  git(root, 'worktree', 'add', '-q', '-b', 'newlined', newlined);
  git(root, 'worktree', 'add', '-q', '--detach', detached);
  git(root, 'worktree', 'add', '-q', '-b', 'locked', locked);
  git(root, 'worktree', 'lock', locked);
  git(root, 'worktree', 'add', '-q', '-b', 'pruned', pruned);
  // Git calls a worktree prunable once its checkout is gone. It still reports
  // the record, which is why the record carries the flag rather than vanishing.
  await rm(pruned, { force: true, recursive: true });

  const byPath = (left, right) => (left.path < right.path ? -1 : 1);
  const live = {
    head, branch: null, detached: false, bare: false, locked: false, prunable: false,
  };
  assert.deepEqual((await listWorktrees(root)).sort(byPath), [
    { ...live, path: root, branch: `refs/heads/${branch}` },
    { ...live, path: spaced, branch: 'refs/heads/spaced' },
    { ...live, path: newlined, branch: 'refs/heads/newlined' },
    { ...live, path: detached, detached: true },
    { ...live, path: locked, branch: 'refs/heads/locked', locked: true },
    { ...live, path: pruned, branch: 'refs/heads/pruned', prunable: true },
  ].sort(byPath));
});

// A bare repository is the one record Git reports with no `HEAD` and no branch,
// so the parser must leave both null rather than inherit the previous record's.
test('the worktree roster reports a bare repository beside its linked worktree', async () => {
  const home = await realpath(await mkdtemp(path.join(tmpdir(), 'wb-roster-bare-')));
  const source = path.join(home, 'source');
  await mkdir(source);
  git(source, 'init', '-q');
  git(source, 'config', 'user.email', 'test@example.com');
  git(source, 'config', 'user.name', 'Wowbagger Test');
  await writeFile(path.join(source, 'file'), 'seed\n');
  git(source, 'add', '.');
  git(source, 'commit', '-qm', 'Seed');

  const bare = path.join(home, 'bare.git');
  const linked = path.join(home, 'linked');
  git(home, 'clone', '-q', '--bare', source, bare);
  git(bare, 'worktree', 'add', '-q', '-b', 'linked', linked);

  assert.deepEqual(await listWorktrees(bare), [
    {
      path: bare,
      head: null,
      branch: null,
      detached: false,
      bare: true,
      locked: false,
      prunable: false,
    },
    {
      path: linked,
      head: git(source, 'rev-parse', 'HEAD'),
      branch: 'refs/heads/linked',
      detached: false,
      bare: false,
      locked: false,
      prunable: false,
    },
  ]);
});
