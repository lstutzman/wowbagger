import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadLedger } from '../src/ledger.js';
import { numberRepair, numberRepairProposal } from '../src/ledger-repair.js';
import { provisionNamespace } from '../src/namespace.js';
import { validateLedger } from '../src/validate.js';

function item(id, number, title) {
  return `---\nschema_version: 2\nid: ${id}\nnumber: ${number}\ntitle: "${title}"\nkind: task\nstatus: triage\ncreated: 2026-08-28\nupdated: 2026-08-28\nprovenance:\n  source: "apply-test"\n  recorded_at: "2026-08-28T00:00:00Z"\ndepends_on: []\nrelated: []\n---\n${title}\n`;
}

async function duplicateLedger() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-repair-apply-'));
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

test('number-repair refuses a stale proposal snapshot unchanged', async () => {
  const fixture = await duplicateLedger();
  try {
    const proposal = await numberRepairProposal(fixture.ledger);
    const before = await readFile(
      path.join(fixture.ledger, 'items', 'wb_01M14Y2FZKEVYKWVAJAZVXHMMG.md'),
      'utf8',
    );
    const result = await numberRepair({
      repair_id: 'nr_20260830_0001',
      ledger_snapshot_revision: `sha256:${'0'.repeat(64)}`,
      date: '2026-08-30',
      changes: proposal.stdout.result.suggested_changes,
    }, { ledgerDirectory: fixture.ledger });
    assert.equal(result.exit, 4, JSON.stringify(result.stdout));
    assert.equal(result.stdout.error.code, 'ledger-repair-revision-conflict');
    assert.equal(
      await readFile(
        path.join(fixture.ledger, 'items', 'wb_01M14Y2FZKEVYKWVAJAZVXHMMG.md'),
        'utf8',
      ),
      before,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('number-repair refuses a stale item witness unchanged', async () => {
  const fixture = await duplicateLedger();
  try {
    const proposal = await numberRepairProposal(fixture.ledger);
    const change = proposal.stdout.result.suggested_changes[0];
    const result = await numberRepair({
      repair_id: 'nr_20260830_0002',
      ledger_snapshot_revision: proposal.stdout.result.ledger_snapshot_revision,
      date: '2026-08-30',
      changes: [{ ...change, expected_revision: `sha256:${'0'.repeat(64)}` }],
    }, { ledgerDirectory: fixture.ledger });
    assert.equal(result.exit, 4, JSON.stringify(result.stdout));
    assert.equal(result.stdout.error.code, 'ledger-repair-revision-conflict');
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('number-repair refuses a stale old-number witness unchanged', async () => {
  const fixture = await duplicateLedger();
  try {
    const proposal = await numberRepairProposal(fixture.ledger);
    const change = proposal.stdout.result.suggested_changes[0];
    const result = await numberRepair({
      repair_id: 'nr_20260830_0003',
      ledger_snapshot_revision: proposal.stdout.result.ledger_snapshot_revision,
      date: '2026-08-30',
      changes: [{ ...change, expected_number: 8 }],
    }, { ledgerDirectory: fixture.ledger });
    assert.equal(result.exit, 4, JSON.stringify(result.stdout));
    assert.equal(result.stdout.error.code, 'ledger-repair-revision-conflict');
    assert.equal(result.stdout.error.details.actual_number, 7);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('number-repair refuses a replacement number collision unchanged', async () => {
  const fixture = await duplicateLedger();
  try {
    const proposal = await numberRepairProposal(fixture.ledger);
    const change = proposal.stdout.result.suggested_changes[0];
    const result = await numberRepair({
      repair_id: 'nr_20260830_0004',
      ledger_snapshot_revision: proposal.stdout.result.ledger_snapshot_revision,
      date: '2026-08-30',
      changes: [{ ...change, replacement_number: 7 }],
    }, { ledgerDirectory: fixture.ledger });
    assert.equal(result.exit, 4, JSON.stringify(result.stdout));
    assert.equal(result.stdout.error.code, 'ledger-repair-number-collision');
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('number-repair refuses an incomplete duplicate mapping unchanged', async () => {
  const fixture = await duplicateLedger();
  try {
    await writeFile(
      path.join(fixture.ledger, 'items', 'wb_01M14Y3GQ4Q7JRSQYJ2VQ2GJ9T.md'),
      item('wb_01M14Y3GQ4Q7JRSQYJ2VQ2GJ9T', 9, 'Third duplicate'),
    );
    await writeFile(
      path.join(fixture.ledger, 'items', 'wb_01M14Y4H7Z4H8WQ9G4J6B9R2K2.md'),
      item('wb_01M14Y4H7Z4H8WQ9G4J6B9R2K2', 9, 'Fourth duplicate'),
    );
    const proposal = await numberRepairProposal(fixture.ledger);
    const result = await numberRepair({
      repair_id: 'nr_20260830_0005',
      ledger_snapshot_revision: proposal.stdout.result.ledger_snapshot_revision,
      date: '2026-08-30',
      changes: proposal.stdout.result.suggested_changes.slice(0, 1),
    }, { ledgerDirectory: fixture.ledger });
    assert.equal(result.exit, 4, JSON.stringify(result.stdout));
    assert.equal(result.stdout.error.code, 'ledger-repair-mapping-incomplete');
    assert.deepEqual(result.stdout.error.details.missing_item_ids, [
      'wb_01M14Y4H7Z4H8WQ9G4J6B9R2K2',
    ]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('number-repair bypasses invalid-ledger mutation gate under the shared fence', async () => {
  const fixture = await duplicateLedger();
  try {
    execFileSync('git', ['init', '--quiet', fixture.root]);
    await provisionNamespace(fixture.ledger);
    const proposal = await numberRepairProposal(fixture.ledger);
    const result = await numberRepair({
      repair_id: 'nr_20260830_0006',
      ledger_snapshot_revision: proposal.stdout.result.ledger_snapshot_revision,
      date: '2026-08-30',
      changes: proposal.stdout.result.suggested_changes,
    }, { ledgerDirectory: fixture.ledger });
    assert.equal(result.exit, 0, JSON.stringify(result.stdout));
    assert.equal(result.stdout.state, 'committed');
    const repaired = await loadLedger(fixture.ledger);
    assert.equal(validateLedger(repaired).valid, true);
    assert.deepEqual(
      repaired.items.map((candidate) => candidate.data.number).sort((left, right) => left - right),
      [7, 8],
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
