// test/create-journal-asymmetry.test.js
//
// `create` records no claim-journal entry; `transition` and `patch` do. Item
// #99 decided to keep that asymmetry, so these vectors pin both halves of what
// the decision buys and what it costs.
//
// The cost: until an item's first journal-visible mutation the journal does
// not know the item, so an out-of-protocol overwrite of a freshly created item
// is invisible, and a commit alone does not change that. From the first
// transition the ordinary surfaces cover the item and the same overwrite
// refuses with `unauthorized-revision`.
//
// The benefit: a create in one worktree never blocks a guarded mutation in a
// sibling worktree. That is the property consumers rely on, and the reason the
// highest-volume mutation is not also the highest-volume blocker.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../bin/wowbagger.js', import.meta.url));
const CONTRACT = readFileSync(
  fileURLToPath(new URL('../docs/work-claim-contract.md', import.meta.url)),
  'utf8',
);

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
const SEED_ID = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';
const FIRST_ID = 'wb_01M01BFR000TXV22D7KZ6TQYH2';
const SECOND_ID = 'wb_01M01BFR000TXV22D7KZ6TQYH3';

// A provisioned single-item repository plus a sibling worktree branched from
// the same commit. The sibling shares the Git common directory, and therefore
// the claim journal, but not the checkout.
async function twoWorktreeRepository() {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-create-asymmetry-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Wowbagger Test');
  const ledger = path.join(root, 'ledger');
  await mkdir(path.join(ledger, '.wowbagger'), { recursive: true });
  await writeFile(path.join(ledger, '.wowbagger', 'namespace'), `${NAMESPACE}\n`);
  await writeFile(path.join(ledger, 'item.md'), `---\nschema_version: 2\nid: ${SEED_ID}\nnumber: 1\ntitle: "Seed"\nkind: task\nstatus: backlog\ncreated: 2026-08-06\nupdated: 2026-08-11\nprovenance:\n  source: "repository-backlog"\n  recorded_at: "2026-08-11T00:00:00Z"\ndepends_on: []\nrelated: []\ndecisions: []\n---\nSeed\n`);
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'Provisioned ledger');
  const siblingRoot = `${root}-sibling`;
  git(root, 'worktree', 'add', '-qb', 'sibling', siblingRoot);
  return { ledger, root, siblingLedger: path.join(siblingRoot, 'ledger'), siblingRoot };
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

// triage -> backlog is an accept and carries decision evidence.
// backlog -> in-progress is not a decision edge and must carry none.
async function transitionRequest(directory, name, id, expectedRevision, toStatus) {
  const requestPath = path.join(directory, name);
  await writeFile(requestPath, JSON.stringify({
    id,
    expected_revision: expectedRevision,
    to_status: toStatus,
    date: '2026-08-16',
    ...(toStatus === 'backlog' ? {
      decision: {
        summary: 'Accept the new item.',
        rationale: 'The new item is ready for work.',
      },
    } : {}),
  }));
  return requestPath;
}

// The hostile write: a direct filesystem overwrite of a published item, with
// no command and therefore no journal entry behind it.
async function overwriteOutsideTheProtocol(ledger, id) {
  const itemPath = path.join(ledger, `${id}.md`);
  const published = await readFile(itemPath, 'utf8');
  await writeFile(itemPath, published.replace('title: "New item"', 'title: "Hijacked"'));
}

test('the work-claim contract records the decision to keep create journal-silent', () => {
  assert.match(CONTRACT, /\*\*Decided: create stays journal-silent\.\*\*/);
});

test('the work-claim contract records all three reasons for the decision', () => {
  // 1. create's own publication already covers the creation instant.
  assert.match(CONTRACT, /refuses\s+to clobber an existing path, and it verifies the published bytes exactly/);
  // 2. journaling create would serialize worktrees on the highest-volume mutation.
  assert.match(CONTRACT, /journaled create would serialize every worktree on the highest-volume\s+mutation/);
  // 3. the exposure window closes at the first journal-visible mutation.
  assert.match(CONTRACT, /closes at the\s+item's first journal-visible mutation/);
});

test('the work-claim contract states the exposure window honestly', () => {
  assert.match(CONTRACT, /\*\*The exposure window, stated honestly\.\*\*/);
  assert.match(CONTRACT, /A commit alone does not close the window/);
  assert.match(CONTRACT, /only an actor that bypasses this tool\s+can overwrite the item/);
});

test('an overwrite of a created, committed item the journal never recorded is not detected', async () => {
  const fixture = await twoWorktreeRepository();
  const created = run(
    fixture.root, 'create', '--ledger', fixture.ledger,
    '--input', await createRequest(fixture.root, 'create-first.json', FIRST_ID), '--json',
  );
  assert.equal(created.exit, 0, JSON.stringify(created.envelope));
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Add the created item');

  await overwriteOutsideTheProtocol(fixture.ledger, FIRST_ID);

  // The commit does not close the window. Reconciliation compares only the
  // revisions the journal expects, and create recorded none.
  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');
  assert.equal(verified.exit, 0, JSON.stringify(verified.envelope));
  assert.deepEqual(verified.envelope.result.findings, []);
  assert.deepEqual(verified.envelope.result.publications, []);

  const next = run(
    fixture.root, 'create', '--ledger', fixture.ledger,
    '--input', await createRequest(fixture.root, 'create-second.json', SECOND_ID), '--json',
  );
  assert.equal(next.exit, 0, JSON.stringify(next.envelope));
  assert.equal(next.envelope.state, 'committed');
});

test('the same overwrite refuses once the item has a journal-visible transition', async () => {
  const fixture = await twoWorktreeRepository();
  const created = run(
    fixture.root, 'create', '--ledger', fixture.ledger,
    '--input', await createRequest(fixture.root, 'create-first.json', FIRST_ID), '--json',
  );
  assert.equal(created.exit, 0, JSON.stringify(created.envelope));
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Add the created item');

  // The first journal-visible mutation. From here the journal expects a
  // revision for this item, and the commit puts that revision in Git HEAD.
  const transitioned = run(
    fixture.root, 'transition', '--ledger', fixture.ledger,
    '--input', await transitionRequest(
      fixture.root, 'transition-first.json', FIRST_ID,
      created.envelope.result.item.revision, 'backlog',
    ),
    '--json',
  );
  assert.equal(transitioned.exit, 0, JSON.stringify(transitioned.envelope));
  const authorizedRevision = transitioned.envelope.result.item.revision;
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Transition the created item');
  assert.equal(run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json').exit, 0);

  await overwriteOutsideTheProtocol(fixture.ledger, FIRST_ID);

  const blocked = run(
    fixture.root, 'create', '--ledger', fixture.ledger,
    '--input', await createRequest(fixture.root, 'create-second.json', SECOND_ID), '--json',
  );

  assert.equal(blocked.exit, 6, JSON.stringify(blocked.envelope));
  assert.equal(blocked.envelope.state, 'unchanged');
  assert.equal(blocked.envelope.error.code, 'claim-store-unavailable');
  assert.equal(blocked.envelope.error.details.reason, 'publication-reconciliation-required');
  const [finding] = blocked.envelope.error.details.findings;
  assert.equal(blocked.envelope.error.details.findings.length, 1);
  assert.equal(finding.code, 'stale-write-detected');
  assert.equal(finding.item_id, FIRST_ID);
  assert.equal(finding.expected_revision, authorizedRevision);
  assert.notEqual(finding.actual_revision, authorizedRevision);
  assert.equal(finding.observed_surface, 'working-tree');
  assert.equal(finding.reason, 'unauthorized-revision');
  assert.equal(finding.expected_path, `${FIRST_ID}.md`);
  assert.equal(
    finding.remediation,
    `Restore the authorized revision at ${FIRST_ID}.md, then run claim-verify.`,
  );
});

test('a create in one worktree does not block a guarded mutation in a sibling worktree', async () => {
  const fixture = await twoWorktreeRepository();
  const created = run(
    fixture.root, 'create', '--ledger', fixture.ledger,
    '--input', await createRequest(fixture.root, 'create-first.json', FIRST_ID), '--json',
  );
  assert.equal(created.exit, 0, JSON.stringify(created.envelope));
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Add the created item');
  // The sibling checkout cannot see that commit. A journaled create would
  // refuse every mutation below with worktree-synchronization-required.

  const siblingCreate = run(
    fixture.siblingRoot, 'create', '--ledger', fixture.siblingLedger,
    '--input', await createRequest(fixture.siblingRoot, 'create-sibling.json', SECOND_ID), '--json',
  );
  assert.equal(siblingCreate.exit, 0, JSON.stringify(siblingCreate.envelope));
  assert.equal(siblingCreate.envelope.state, 'committed');
  git(fixture.siblingRoot, 'add', 'ledger');
  git(fixture.siblingRoot, 'commit', '-qm', 'Add the sibling item');

  const seedRevision = run(
    fixture.siblingRoot, 'inspect', '--ledger', fixture.siblingLedger,
    '--number', '1', '--json',
  ).envelope.result.item.revision;
  const siblingTransition = run(
    fixture.siblingRoot, 'transition', '--ledger', fixture.siblingLedger,
    '--input', await transitionRequest(
      fixture.siblingRoot, 'transition-sibling.json', SEED_ID, seedRevision, 'in-progress',
    ),
    '--json',
  );
  assert.equal(siblingTransition.exit, 0, JSON.stringify(siblingTransition.envelope));
  assert.equal(siblingTransition.envelope.state, 'committed');
});
