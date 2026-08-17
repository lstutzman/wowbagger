import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../bin/wowbagger.js', import.meta.url));
const LAYOUT = '{"layout_version":1,"items_directory":"items"}\n';
// Item dates derive from the ULID timestamp in UTC, so a transition dated
// before the run's own creates is refused. Derive the date; never hardcode it.
const TODAY = new Date().toISOString().slice(0, 10);

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

async function provisionedRepository(prefix) {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Wowbagger Test');
  const ledger = path.join(root, 'ledger');
  await mkdir(ledger);
  const provisioned = run(root, 'provision', '--ledger', ledger, '--json');
  assert.equal(provisioned.exit, 0, JSON.stringify(provisioned.envelope));
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'Provision the ledger');
  return { ledger, root };
}

async function requestFile(root, name, request) {
  const file = path.join(root, name);
  await writeFile(file, JSON.stringify(request));
  return file;
}

function mintId(root) {
  const minted = run(root, 'mint-id', '--json');
  assert.equal(minted.exit, 0, JSON.stringify(minted.envelope));
  return minted.envelope.result.id;
}

function createRequest(id, title) {
  return {
    id,
    item: {
      title,
      kind: 'task',
      provenance: { source: 'fixture/misplaced-item', recorded_at: '2026-08-16T00:00:00Z' },
      depends_on: [],
    },
    body: `${title}\n`,
  };
}

async function createItem(root, ledger, name, title) {
  const id = mintId(root);
  const created = run(root, 'create', '--ledger', ledger, '--input', await requestFile(root, name, createRequest(id, title)), '--json');
  assert.equal(created.exit, 0, JSON.stringify(created.envelope));
  return created.envelope.result.item;
}

async function writeLayout(ledger) {
  await mkdir(path.join(ledger, 'items'));
  await writeFile(path.join(ledger, '.wowbagger', 'layout.json'), LAYOUT);
}

function misplacedError(id) {
  return {
    path: `ledger/${id}.md`,
    field: 'path',
    code: 'item-outside-layout',
    message: `Ledger item ledger/${id}.md is outside the configured items directory; the committed layout expects it at ledger/items/${id}.md.`,
    expected_path: `ledger/items/${id}.md`,
    remediation: `Move ledger/${id}.md to ledger/items/${id}.md, stage the move with git add, commit it, then run claim-verify.`,
  };
}

// PropertyCompass2 PR #2184 claimed a single root-misplaced committed item makes
// the work-claim fence report stale-write-detected with actual_revision null.
// Both configuration orders below refute the mechanism and pin what really
// happens: ledger validation refuses one layer earlier, and the claim journal
// stays consistent.

test('a committed root-misplaced item blocks every guarded mutation when layout.json was configured first', async () => {
  const { ledger, root } = await provisionedRepository('wb-misplaced-layout-first-');
  await writeLayout(ledger);
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'Bind the items directory');

  const placed = await createItem(root, ledger, 'create-placed.json', 'Correctly placed item');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'Publish the placed item');

  const misplaced = await createItem(root, ledger, 'create-misplaced.json', 'Misplaced item');
  assert.equal(misplaced.path, `items/${misplaced.id}.md`);
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'Publish the second item');
  await rename(path.join(ledger, misplaced.path), path.join(ledger, `${misplaced.id}.md`));
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'Misplace the second item at the ledger root');

  const expectedError = misplacedError(misplaced.id);

  const validated = run(root, 'validate', '--ledger', ledger, '--json');
  assert.equal(validated.exit, 1);
  assert.deepEqual(validated.envelope, { valid: false, errors: [expectedError] });

  // The claim fence is not poisoned: the journal is consistent and reports no
  // finding, so the consumer's stale-write-detected/actual_revision null
  // mechanism does not exist. The reconciliation verb still names the blocker
  // that stops every mutation instead of answering a bare green findings [].
  const verified = run(root, 'claim-verify', '--ledger', ledger, '--json');
  assert.equal(verified.exit, 0, JSON.stringify(verified.envelope));
  assert.deepEqual(verified.envelope.result.findings, []);
  assert.deepEqual(verified.envelope.result.ledger_validation, {
    valid: false,
    errors: [expectedError],
    remediation: 'The ledger is invalid and every mutation is blocked; claim state is consistent. Repair each validation error, commit the repair, then run claim-verify.',
  });

  // The refusal stays a refusal, but it no longer hides the item the operator
  // must read: a target that parses and carries no validation error of its own
  // arrives with its complete byte snapshot.
  const inspected = run(root, 'inspect', '--ledger', ledger, '--id', placed.id, '--json');
  assert.equal(inspected.exit, 3);
  assert.equal(inspected.envelope.error.code, 'ledger-invalid');
  assert.deepEqual(inspected.envelope.error.details.validation_errors, [expectedError]);
  assert.deepEqual(inspected.envelope.error.details.item, placed);

  // The faulted item itself is withheld: its own placement is what validation
  // rejects, and the refusal already names the path to repair.
  const inspectedMisplaced = run(root, 'inspect', '--ledger', ledger, '--id', misplaced.id, '--json');
  assert.equal(inspectedMisplaced.exit, 3);
  assert.deepEqual(inspectedMisplaced.envelope.error.details, { validation_errors: [expectedError] });

  // The number selector reaches the same snapshot, so an operator who speaks
  // #N never has to learn a ULID to diagnose an invalid ledger.
  const byNumber = run(root, 'inspect', '--ledger', ledger, '--number', String(placed.core.number), '--json');
  assert.equal(byNumber.exit, 3);
  assert.deepEqual(byNumber.envelope.error.details.item, placed);

  // Every guarded mutation refuses, including one that touches only the
  // correctly placed item.
  const transitioned = run(root, 'transition', '--ledger', ledger, '--input', await requestFile(root, 'transition.json', {
    id: placed.id,
    expected_revision: placed.revision,
    to_status: 'backlog',
    date: TODAY,
    decision: { summary: 'Accept the placed item.', rationale: 'Prove the block is ledger-wide.' },
  }), '--json');
  assert.equal(transitioned.exit, 3);
  assert.deepEqual(transitioned.envelope.error, {
    code: 'ledger-invalid',
    message: 'The configured ledger is invalid.',
    details: { validation_errors: [expectedError] },
  });

  const created = run(root, 'create', '--ledger', ledger, '--input', await requestFile(root, 'create-third.json', createRequest(mintId(root), 'Third item')), '--json');
  assert.equal(created.exit, 3);
  assert.deepEqual(created.envelope.error.details.validation_errors, [expectedError]);
});

test('a root-misplaced item committed before layout.json refuses the same way once the layout lands', async () => {
  const { ledger, root } = await provisionedRepository('wb-misplaced-layout-later-');

  const rooted = await createItem(root, ledger, 'create-rooted.json', 'Item published before the layout');
  assert.equal(rooted.path, `${rooted.id}.md`);
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'Publish at the ledger root');

  // A guarded mutation succeeds and records the root path in the claim journal,
  // which is what the damage claim says later poisons the fence.
  const accepted = run(root, 'transition', '--ledger', ledger, '--input', await requestFile(root, 'transition-before.json', {
    id: rooted.id,
    expected_revision: rooted.revision,
    to_status: 'backlog',
    date: TODAY,
    decision: { summary: 'Accept before the layout.', rationale: 'Record a publication at the root path.' },
  }), '--json');
  assert.equal(accepted.exit, 0, JSON.stringify(accepted.envelope));
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'Commit the accepted item');

  await writeLayout(ledger);
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'Bind the items directory after the fact');

  const expectedError = misplacedError(rooted.id);

  const validated = run(root, 'validate', '--ledger', ledger, '--json');
  assert.equal(validated.exit, 1);
  assert.deepEqual(validated.envelope, { valid: false, errors: [expectedError] });

  const verified = run(root, 'claim-verify', '--ledger', ledger, '--json');
  assert.equal(verified.exit, 0, JSON.stringify(verified.envelope));
  assert.deepEqual(verified.envelope.result.findings, []);

  const transitioned = run(root, 'transition', '--ledger', ledger, '--input', await requestFile(root, 'transition-after.json', {
    id: rooted.id,
    expected_revision: accepted.envelope.result.item.revision,
    to_status: 'in-progress',
    date: TODAY,
  }), '--json');
  assert.equal(transitioned.exit, 3);
  assert.deepEqual(transitioned.envelope.error.details.validation_errors, [expectedError]);
});

test('the remediation the refusal names repairs the ledger', async () => {
  const { ledger, root } = await provisionedRepository('wb-misplaced-remedy-');
  await writeLayout(ledger);
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'Bind the items directory');

  const misplaced = await createItem(root, ledger, 'create-misplaced.json', 'Misplaced item');
  await rename(path.join(ledger, misplaced.path), path.join(ledger, `${misplaced.id}.md`));
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'Misplace the item at the ledger root');

  const refused = run(root, 'validate', '--ledger', ledger, '--json');
  const [{ expected_path: expectedPath }] = refused.envelope.errors;

  await rename(path.join(ledger, `${misplaced.id}.md`), path.join(root, expectedPath));
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'Relocate the item into the items directory');

  const revalidated = run(root, 'validate', '--ledger', ledger, '--json');
  assert.deepEqual(revalidated.envelope, { valid: true, errors: [] });
  const verified = run(root, 'claim-verify', '--ledger', ledger, '--json');
  assert.equal(verified.exit, 0, JSON.stringify(verified.envelope));
  // A repaired ledger reports the same member with nothing to remedy.
  assert.deepEqual(verified.envelope.result.ledger_validation, { valid: true, errors: [] });
  const created = run(root, 'create', '--ledger', ledger, '--input', await requestFile(root, 'create-after.json', createRequest(mintId(root), 'Item after the repair')), '--json');
  assert.equal(created.exit, 0, JSON.stringify(created.envelope));
});
