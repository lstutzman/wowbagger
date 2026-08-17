// test/patch-title-consumer-trap.test.js
//
// The field trap item #114 exists to kill. Correcting an item's title used to
// require an out-of-protocol edit, because no verb carried title. On a
// provisioned ledger that edit is a stale write: the next guarded mutation
// refuses exit 6 with an `unauthorized-revision` finding, and every later
// mutation stays blocked until the operator reconciles by hand.
//
// Both halves are pinned here. The first proves the trap is real, so the second
// is not a tautology: the same correction through `patch` lands in band and
// leaves nothing behind.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../bin/wowbagger.js', import.meta.url));
const ITEM_ID = 'wb_01M01BFR000TXV22D7KZ6TQYH2';
const NEXT_ID = 'wb_01M01BFR000TXV22D7KZ6TQYH3';
const WRONG_TITLE = 'Mirrror of PC-1475';
const RIGHT_TITLE = 'Mirror of PC-1475';

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

async function requestFile(root, name, request) {
  const file = path.join(root, name);
  await writeFile(file, JSON.stringify(request));
  return file;
}

async function provisionedRepository() {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-title-trap-'));
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

// A mirrored item carrying the consumer's typo, accepted into the backlog so
// the claim journal knows its authorized revision. Returns that revision.
async function mirroredItem(fixture) {
  const created = run(fixture.root, 'create', '--ledger', fixture.ledger, '--input',
    await requestFile(fixture.root, 'create.json', {
      id: ITEM_ID,
      item: {
        title: WRONG_TITLE,
        kind: 'task',
        provenance: { source: 'consumer-mirror', recorded_at: '2026-08-17T00:00:00Z' },
        depends_on: [],
      },
      body: 'Mirrored from the external card.\n',
    }), '--json');
  assert.equal(created.exit, 0, JSON.stringify(created.envelope));
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Mirror the external card');

  const accepted = run(fixture.root, 'transition', '--ledger', fixture.ledger, '--input',
    await requestFile(fixture.root, 'accept.json', {
      id: ITEM_ID,
      expected_revision: created.envelope.result.item.revision,
      to_status: 'backlog',
      date: '2026-08-17',
      decision: {
        summary: 'Accept the mirrored card.',
        rationale: 'The external card is ready for work.',
      },
    }), '--json');
  assert.equal(accepted.exit, 0, JSON.stringify(accepted.envelope));
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Accept the mirrored card');
  assert.equal(run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json').exit, 0);
  return accepted.envelope.result.item.revision;
}

function itemPath(ledger) {
  return path.join(ledger, `${ITEM_ID}.md`);
}

test('the out-of-protocol title correction is the trap: it blocks every later mutation', async () => {
  const fixture = await provisionedRepository();
  const authorized = await mirroredItem(fixture);

  // The only route a consumer had before title was patchable.
  const published = await readFile(itemPath(fixture.ledger), 'utf8');
  await writeFile(
    itemPath(fixture.ledger),
    published.replace(`title: ${JSON.stringify(WRONG_TITLE)}`, `title: ${JSON.stringify(RIGHT_TITLE)}`),
  );
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Correct the mirrored title by hand');

  const blocked = run(fixture.root, 'create', '--ledger', fixture.ledger, '--input',
    await requestFile(fixture.root, 'create-next.json', {
      id: NEXT_ID,
      item: {
        title: 'A later item',
        kind: 'task',
        provenance: { source: 'consumer-mirror', recorded_at: '2026-08-17T00:00:00Z' },
        depends_on: [],
      },
      body: 'A later item.\n',
    }), '--json');

  assert.equal(blocked.exit, 6, JSON.stringify(blocked.envelope));
  assert.equal(blocked.envelope.state, 'unchanged');
  assert.equal(blocked.envelope.error.details.reason, 'publication-reconciliation-required');
  const [finding] = blocked.envelope.error.details.findings;
  assert.equal(finding.reason, 'unauthorized-revision');
  assert.equal(finding.item_id, ITEM_ID);
  assert.equal(finding.expected_revision, authorized);
});

test('the same title correction through patch lands in band with no unauthorized-revision aftermath', async () => {
  const fixture = await provisionedRepository();
  const authorized = await mirroredItem(fixture);

  const patched = run(fixture.root, 'patch', '--ledger', fixture.ledger, '--input',
    await requestFile(fixture.root, 'patch-title.json', {
      id: ITEM_ID,
      expected_revision: authorized,
      date: '2026-08-17',
      set: { title: RIGHT_TITLE },
    }), '--json');

  assert.equal(patched.exit, 0, JSON.stringify(patched.envelope));
  assert.equal(patched.envelope.state, 'committed');
  assert.equal(patched.envelope.result.item.core.title, RIGHT_TITLE);
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Correct the mirrored title through patch');

  // No aftermath: reconciliation finds nothing, and the ledger is still valid.
  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');
  assert.equal(verified.exit, 0, JSON.stringify(verified.envelope));
  assert.deepEqual(verified.envelope.result.findings, []);
  assert.equal(verified.envelope.result.ledger_validation.valid, true);

  // And the next mutation proceeds, which is the property the trap destroyed.
  const next = run(fixture.root, 'create', '--ledger', fixture.ledger, '--input',
    await requestFile(fixture.root, 'create-next.json', {
      id: NEXT_ID,
      item: {
        title: 'A later item',
        kind: 'task',
        provenance: { source: 'consumer-mirror', recorded_at: '2026-08-17T00:00:00Z' },
        depends_on: [],
      },
      body: 'A later item.\n',
    }), '--json');
  assert.equal(next.exit, 0, JSON.stringify(next.envelope));
  assert.equal(next.envelope.state, 'committed');
});
