import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { appendClaimEntry, claimJournalPath } from '../src/claim-journal.js';
import { loadLedger } from '../src/ledger.js';
import {
  numberRepair,
  numberRepairProposal,
  stageNumberRepairCandidates,
} from '../src/ledger-repair.js';
import { provisionNamespace, readNamespace } from '../src/namespace.js';
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

test('number-repair recovers staged candidates when the final terminal is absent', async () => {
  const fixture = await duplicateLedger();
  try {
    execFileSync('git', ['init', '--quiet', fixture.root]);
    await provisionNamespace(fixture.ledger);
    const proposal = await numberRepairProposal(fixture.ledger);
    const change = proposal.stdout.result.suggested_changes[0];
    const loaded = await loadLedger(fixture.ledger);
    const sourceItem = loaded.items.find((candidate) => candidate.data.id === change.item_id);
    const candidateBytes = Buffer.from(
      sourceItem.bytes.toString('utf8').replace(/^number:[ \t]*7[ \t]*$/m, 'number: 8'),
    );
    const candidateRevision = `sha256:${createHash('sha256').update(candidateBytes).digest('hex')}`;
    const namespace = await readNamespace(fixture.ledger);
    await stageNumberRepairCandidates({
      gitCommonDir: path.join(fixture.root, '.git'),
      namespace,
      repairId: 'nr_20260830_0007',
      ledgerSnapshotRevision: proposal.stdout.result.ledger_snapshot_revision,
      candidates: [{
        item_id: change.item_id,
        path: `items/${change.item_id}.md`,
        candidate_revision: candidateRevision,
        candidate_bytes: candidateBytes,
      }],
    });
    await appendClaimEntry(claimJournalPath(path.join(fixture.root, '.git'), namespace), {
      type: 'number-repair-intent',
      repair_id: 'nr_20260830_0007',
      ledger_namespace: namespace,
      ledger_snapshot_revision: proposal.stdout.result.ledger_snapshot_revision,
      date: '2026-08-30',
      staging_id: 'nr_20260830_0007',
      items: [{
        item_id: change.item_id,
        item_path: `items/${change.item_id}.md`,
        expected_revision: change.expected_revision,
        expected_number: change.expected_number,
        replacement_number: change.replacement_number,
        candidate_revision: candidateRevision,
      }],
    });
    const result = await numberRepair({
      repair_id: 'nr_20260830_0007',
      ledger_snapshot_revision: proposal.stdout.result.ledger_snapshot_revision,
      date: '2026-08-30',
      changes: proposal.stdout.result.suggested_changes,
    }, { ledgerDirectory: fixture.ledger });
    assert.equal(result.exit, 0, JSON.stringify(result.stdout));
    assert.equal(validateLedger(await loadLedger(fixture.ledger)).valid, true);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('number-repair auto-commit records only repaired paths and reconciliation log', async () => {
  const fixture = await duplicateLedger();
  try {
    execFileSync('git', ['init', '--quiet', fixture.root]);
    execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: fixture.root });
    execFileSync('git', ['config', 'user.name', 'Wowbagger Test'], { cwd: fixture.root });
    const namespace = (await provisionNamespace(fixture.ledger)).namespace;
    execFileSync('git', ['add', '.'], { cwd: fixture.root });
    execFileSync('git', ['commit', '--quiet', '-m', 'seed duplicate ledger'], { cwd: fixture.root });
    const proposal = await numberRepairProposal(fixture.ledger);
    const result = await numberRepair({
      repair_id: 'nr_20260830_0008',
      ledger_snapshot_revision: proposal.stdout.result.ledger_snapshot_revision,
      date: '2026-08-30',
      changes: proposal.stdout.result.suggested_changes,
    }, { ledgerDirectory: fixture.ledger, autoCommit: true });
    assert.equal(result.exit, 0, JSON.stringify(result.stdout));
    assert.match(result.stdout.result.git_commit, /^[0-9a-f]{40}$/);
    const committedPaths = execFileSync(
      'git',
      ['show', '--format=', '--name-only', result.stdout.result.git_commit],
      { cwd: fixture.root, encoding: 'utf8' },
    ).split('\n').filter(Boolean).sort();
    assert.deepEqual(committedPaths, [
      `ledger/.wowbagger/reconcile-${namespace}.md`,
      `ledger/items/${proposal.stdout.result.suggested_changes[0].item_id}.md`,
    ]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
