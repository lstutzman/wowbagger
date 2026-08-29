import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { readRegularFixture } from './work-claim-fixture-loader.js';

const CLI = fileURLToPath(new URL('../bin/wowbagger.js', import.meta.url));
const fixtureRoot = fileURLToPath(new URL('../spec/fixtures/mutation-refusals/', import.meta.url));

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

function manifest(name) {
  return JSON.parse(readRegularFixture(fixtureRoot, `${name}/manifest.json`).toString('utf8'));
}

function substituteRevision(expected, revision) {
  return JSON.parse(JSON.stringify(expected).replaceAll('{{PRIOR_REVISION}}', revision));
}

async function provisionedRepository() {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-uncommitted-refusal-'));
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

test('an uncommitted prior mutation refuses the next create with the normative remediation envelope', async () => {
  const fixture = manifest('uncommitted-prior-mutation');
  const { ledger, root } = await provisionedRepository();
  const priorId = fixture.scenario.prior_item_id;

  const created = run(root, 'create', '--ledger', ledger, '--input', await requestFile(root, 'create-prior.json', {
    id: priorId,
    item: {
      title: 'Prior item',
      kind: 'task',
      provenance: { source: 'fixture/mutation-refusals', recorded_at: '2026-08-15T00:00:00Z' },
      depends_on: [],
    },
    body: 'Prior item\n',
  }), '--json');
  assert.equal(created.exit, 0, JSON.stringify(created.envelope));
  // The create is the prior mutation Git has yet to record, and nothing is
  // stacked on top of it. `git-finalization-required` is reachable only while
  // the item is absent from Git HEAD, so leaving this create uncommitted is
  // what produces the normative remediation envelope below.

  const refused = run(root, 'create', '--ledger', ledger, '--input', await requestFile(root, 'create-next.json', {
    id: fixture.scenario.next_item_id,
    item: {
      title: 'Next item',
      kind: 'task',
      provenance: { source: 'fixture/mutation-refusals', recorded_at: '2026-08-15T00:00:00Z' },
      depends_on: [],
    },
    body: 'Next item\n',
  }), '--json');

  assert.deepEqual(
    { exit: refused.exit, stdout: refused.envelope },
    substituteRevision(fixture.expected, created.envelope.result.item.revision),
  );
});

test('committing the prior mutation and running claim-verify clears the create refusal', async () => {
  const fixture = manifest('uncommitted-prior-mutation');
  const { ledger, root } = await provisionedRepository();
  const priorId = fixture.scenario.prior_item_id;

  const created = run(root, 'create', '--ledger', ledger, '--input', await requestFile(root, 'create-prior.json', {
    id: priorId,
    item: {
      title: 'Prior item',
      kind: 'task',
      provenance: { source: 'fixture/mutation-refusals', recorded_at: '2026-08-15T00:00:00Z' },
      depends_on: [],
    },
    body: 'Prior item\n',
  }), '--json');
  assert.equal(created.exit, 0, JSON.stringify(created.envelope));
  git(root, 'add', 'ledger');
  git(root, 'commit', '-qm', 'Commit the prior create');
  const transitioned = run(root, 'transition', '--ledger', ledger, '--input', await requestFile(root, 'transition-prior.json', {
    id: priorId,
    expected_revision: created.envelope.result.item.revision,
    to_status: 'backlog',
    date: '2026-08-15',
    decision: {
      summary: 'Accept the prior item.',
      rationale: 'The prior item is ready for work.',
    },
  }), '--json');
  assert.equal(transitioned.exit, 0, JSON.stringify(transitioned.envelope));

  git(root, 'add', 'ledger');
  git(root, 'commit', '-qm', 'Commit the prior mutation');
  const verified = run(root, 'claim-verify', '--ledger', ledger, '--json');
  assert.equal(verified.exit, 0, JSON.stringify(verified.envelope));

  const nextCreate = run(root, 'create', '--ledger', ledger, '--input', await requestFile(root, 'create-next.json', {
    id: fixture.scenario.next_item_id,
    item: {
      title: 'Next item',
      kind: 'task',
      provenance: { source: 'fixture/mutation-refusals', recorded_at: '2026-08-15T00:00:00Z' },
      depends_on: [],
    },
    body: 'Next item\n',
  }), '--json');

  assert.equal(nextCreate.exit, 0, JSON.stringify(nextCreate.envelope));
});
