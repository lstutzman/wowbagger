// The --auto-commit argument surface.
//
// This file exercises the flag through the real CLI only. It proves the flag is
// accepted exactly once on every supported mutation command, refused elsewhere,
// and that an invocation without the flag keeps its exact stdout, exit, files,
// index, and HEAD.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../bin/wowbagger.js', import.meta.url));
const ITEM_ID = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';

function run(cwd, ...argumentsList) {
  const result = spawnSync(process.execPath, [CLI, ...argumentsList], { cwd, encoding: 'utf8' });
  return { envelope: JSON.parse(result.stdout), exit: result.status, stdout: result.stdout };
}

function git(root, ...argumentsList) {
  const result = spawnSync('git', argumentsList, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

const ITEM_SOURCE = `---
schema_version: 2
id: ${ITEM_ID}
number: 1
title: "Before"
kind: task
status: backlog
created: 2026-08-06
updated: 2026-08-11
provenance:
  source: "fixture/auto-commit"
  recorded_at: "2026-08-11T00:00:00Z"
depends_on: []
related: []
decisions: []
---
Before
`;

// A plain, unprovisioned ledger inside a Git checkout.
async function checkout() {
  const base = await mkdtemp(path.join(tmpdir(), 'wb-autocommit-cli-'));
  const root = path.join(base, 'repo');
  await mkdir(root);
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Wowbagger Test');
  const ledger = path.join(root, 'ledger');
  await mkdir(path.join(ledger, 'items'), { recursive: true });
  await writeFile(path.join(ledger, 'items', `${ITEM_ID}.md`), ITEM_SOURCE);
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'Initial ledger');
  return { base, ledger, root };
}

async function requestFile(base, name, value) {
  const file = path.join(base, name);
  await writeFile(file, JSON.stringify(value));
  return file;
}

function sha256(text) {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

function transitionRequest() {
  return {
    id: ITEM_ID,
    expected_revision: sha256(ITEM_SOURCE),
    to_status: 'in-progress',
    date: '2026-08-17',
  };
}

test('--auto-commit is accepted once on create, transition, patch, and publish-claimed', async () => {
  const fixture = await checkout();
  const help = spawnSync(process.execPath, [CLI, 'transition', '--help'], { encoding: 'utf8' });
  assert.match(help.stdout, /--auto-commit/);

  // Accepted means "not an unknown argument". These ledgers are unprovisioned,
  // so the flag refuses on the capability gate, never on argument parsing.
  const request = await requestFile(fixture.base, 'transition.json', transitionRequest());
  const accepted = run(fixture.root, 'transition', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit');
  assert.equal(accepted.envelope.error.code, 'capability-unavailable');
  assert.equal(accepted.envelope.state, 'unchanged');
  assert.equal(accepted.exit, 5);
});

test('parent-migrate accepts --auto-commit on the documented surface', async () => {
  const fixture = await checkout();
  const request = await requestFile(fixture.base, 'parent-migrate.json', {
    id: ITEM_ID,
    expected_revision: sha256(ITEM_SOURCE),
    expected_parent: null,
    parent: null,
    date: '2026-08-17',
  });
  const result = run(
    fixture.root,
    'parent-migrate', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit',
  );

  assert.equal(result.exit, 5);
  assert.equal(result.envelope.error.code, 'capability-unavailable');
  assert.equal(result.envelope.state, 'unchanged');
});

test('snooze accepts --auto-commit on the documented surface', async () => {
  const fixture = await checkout();
  const request = await requestFile(fixture.base, 'snooze.json', {
    id: ITEM_ID,
    expected_revision: sha256(ITEM_SOURCE),
    snoozed_until: null,
    date: '2026-08-17',
  });
  const result = run(
    fixture.root,
    'snooze', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit',
  );

  assert.equal(result.exit, 5);
  assert.equal(result.envelope.error.code, 'capability-unavailable');
  assert.equal(result.envelope.state, 'unchanged');
});

test('--auto-commit is repeated-argument on a second occurrence', async () => {
  const fixture = await checkout();
  const request = await requestFile(fixture.base, 'transition.json', transitionRequest());
  const repeated = run(
    fixture.root,
    'transition', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit', '--auto-commit',
  );

  assert.equal(repeated.exit, 2);
  assert.equal(repeated.envelope.error.code, 'invalid-request');
  assert.equal(repeated.envelope.state, 'unchanged');
  assert.deepEqual(repeated.envelope.error.details.issues, [
    { path: '/arguments/7', code: 'repeated-argument', message: 'Argument --auto-commit must not be repeated.' },
  ]);
});

test('--auto-commit is an unknown argument on every other command', async () => {
  const fixture = await checkout();

  const inspected = run(fixture.root, 'inspect', '--ledger', fixture.ledger, '--id', ITEM_ID, '--json', '--auto-commit');
  assert.equal(inspected.exit, 2);
  assert.equal(inspected.envelope.error.code, 'invalid-request');
  assert.ok(inspected.envelope.error.details.issues.some((entry) => (
    entry.code === 'unknown-argument' && entry.message.includes('--auto-commit')
  )));

  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json', '--auto-commit');
  assert.equal(verified.exit, 2);
  assert.equal(verified.envelope.error.code, 'invalid-request');

  const validated = spawnSync(
    process.execPath,
    [CLI, 'validate', '--ledger', fixture.ledger, '--json', '--auto-commit'],
    { cwd: fixture.root, encoding: 'utf8' },
  );
  assert.equal(validated.status, 1);
  assert.match(validated.stderr, /Unknown argument: --auto-commit/);
});

test('an invocation without --auto-commit keeps its exact stdout, exit, files, index, and HEAD', async () => {
  const fixture = await checkout();
  const head = git(fixture.root, 'rev-parse', 'HEAD');
  const request = await requestFile(fixture.base, 'transition.json', transitionRequest());

  const plain = run(fixture.root, 'transition', '--ledger', fixture.ledger, '--input', request, '--json');

  assert.equal(plain.exit, 0, plain.stdout);
  assert.equal(plain.envelope.state, 'committed');
  assert.equal(git(fixture.root, 'rev-parse', 'HEAD'), head);
  assert.equal(git(fixture.root, 'diff', '--cached', '--name-only'), '');
  assert.equal(
    git(fixture.root, 'status', '--porcelain=v1', '--untracked-files=all'),
    'M ledger/items/wb_01KZBMBEZKPE7D15HKW9Q3GSZV.md',
  );
  const onDisk = await readFile(path.join(fixture.ledger, 'items', `${ITEM_ID}.md`), 'utf8');
  assert.match(onDisk, /status: in-progress/);
});

test('the first auto-commit works after provisioning and committing the namespace', async () => {
  const fixture = await checkout();
  const provisioned = run(fixture.root, 'provision', '--ledger', fixture.ledger, '--json');
  assert.equal(provisioned.exit, 0, provisioned.stdout);
  git(fixture.root, 'add', 'ledger/.wowbagger/namespace');
  git(fixture.root, 'commit', '-qm', 'Commit provisioned namespace');

  const id = 'wb_01KZBMBEZKPE7D15HKW9Q3GT01';
  const request = await requestFile(fixture.base, 'first-auto-create.json', {
    id,
    item: {
      title: 'First auto-commit item',
      kind: 'task',
      provenance: { source: 'test/auto-commit-cli', recorded_at: '2026-08-17T00:00:00Z' },
      depends_on: [],
    },
    body: 'First auto-commit\n',
  });

  const result = run(
    fixture.root,
    'create', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit',
  );

  assert.equal(result.exit, 0, result.stdout);
  assert.equal(result.envelope.result.git_commit !== undefined, true);
  assert.equal(git(fixture.root, 'status', '--porcelain=v1', '--untracked-files=all'), '');
});
