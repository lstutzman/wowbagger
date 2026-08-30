import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLI = path.join(ROOT, 'bin', 'wowbagger.js');

function run(cwd, ...args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
  return { exit: result.status, envelope: JSON.parse(result.stdout) };
}

function item(id, number, title) {
  return `---\nschema_version: 2\nid: ${id}\nnumber: ${number}\ntitle: "${title}"\nkind: task\nstatus: triage\ncreated: 2026-08-28\nupdated: 2026-08-28\nprovenance:\n  source: "proposal-test"\n  recorded_at: "2026-08-28T00:00:00Z"\ndepends_on: []\nrelated: []\n---\n${title}\n`;
}

async function duplicateLedger() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-repair-proposal-'));
  const ledger = path.join(root, 'ledger');
  await mkdir(path.join(ledger, 'items'), { recursive: true });
  await writeFile(path.join(ledger, 'items', 'wb_01M14Y1YEZXNNF39P7DZ7X3WAD.md'), item(
    'wb_01M14Y1YEZXNNF39P7DZ7X3WAD', 7, 'First duplicate',
  ));
  await writeFile(path.join(ledger, 'items', 'wb_01M14Y2FZKEVYKWVAJAZVXHMMG.md'), item(
    'wb_01M14Y2FZKEVYKWVAJAZVXHMMG', 7, 'Second duplicate',
  ));
  return { root, ledger };
}

test('number-repair-proposal lists duplicate groups without writing', async () => {
  const fixture = await duplicateLedger();
  try {
    const before = await readFile(path.join(fixture.ledger, 'items', 'wb_01M14Y2FZKEVYKWVAJAZVXHMMG.md'), 'utf8');
    const result = run(fixture.root, 'number-repair-proposal', '--ledger', fixture.ledger, '--json');
    assert.equal(result.exit, 0, JSON.stringify(result.envelope));
    assert.equal(result.envelope.ok, true, JSON.stringify(result.envelope));
    assert.equal(result.envelope.namespace, 'ledger-repair');
    assert.equal(result.envelope.command, 'number-repair-proposal');
    assert.equal(result.envelope.contract_version, 1);
    assert.equal(result.envelope.state, 'unchanged');
    assert.equal(result.envelope.result.duplicate_groups.length, 1);
    assert.deepEqual(result.envelope.result.duplicate_groups[0], {
      number: 7,
      item_ids: [
        'wb_01M14Y1YEZXNNF39P7DZ7X3WAD',
        'wb_01M14Y2FZKEVYKWVAJAZVXHMMG',
      ],
    });
    assert.equal(result.envelope.result.items.length, 2);
    assert.equal(result.envelope.result.suggested_changes.length, 1);
    assert.equal(result.envelope.result.suggested_changes[0].replacement_number, 8);
    assert.ok(/^sha256:[0-9a-f]{64}$/.test(result.envelope.result.ledger_snapshot_revision));
    assert.deepEqual(result.envelope.result.suggested_changes[0].replacement_number, 8);
    assert.deepEqual(result.envelope.result.preserved_items, [
      'wb_01M14Y1YEZXNNF39P7DZ7X3WAD',
    ]);
    assert.equal(await readFile(path.join(fixture.ledger, 'items', 'wb_01M14Y2FZKEVYKWVAJAZVXHMMG.md'), 'utf8'), before);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('number-repair-proposal refuses duplicate ledgers with unrelated errors', async () => {
  const fixture = await duplicateLedger();
  try {
    await writeFile(path.join(fixture.ledger, 'items', 'broken.md'), 'not a ledger item\n');
    const result = run(fixture.root, 'number-repair-proposal', '--ledger', fixture.ledger, '--json');
    assert.equal(result.exit, 4, JSON.stringify(result.envelope));
    assert.equal(result.envelope.error.code, 'ledger-repair-not-applicable');
    assert.ok(result.envelope.error.details.validation_errors.some(({ code }) => code === 'duplicate-number'));
    assert.ok(result.envelope.error.details.validation_errors.some(({ code }) => code !== 'duplicate-number'));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('number-repair-proposal refuses a valid ledger', async () => {
  const fixture = await duplicateLedger();
  try {
    const secondPath = path.join(fixture.ledger, 'items', 'wb_01M14Y2FZKEVYKWVAJAZVXHMMG.md');
    const source = await readFile(secondPath, 'utf8');
    await writeFile(secondPath, source.replace('number: 7', 'number: 8'));
    const result = run(fixture.root, 'number-repair-proposal', '--ledger', fixture.ledger, '--json');
    assert.equal(result.exit, 4, JSON.stringify(result.envelope));
    assert.equal(result.envelope.error.code, 'ledger-repair-not-applicable');
    assert.deepEqual(result.envelope.error.details.validation_errors, []);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
