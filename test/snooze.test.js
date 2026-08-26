import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { runCli, withLedger } from './support.js';

const ITEM = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';
const SOURCE = `---\nschema_version: 1\nid: ${ITEM}\ntitle: "Snoozable"\nkind: task\nstatus: backlog\ncreated: 2026-08-06\nupdated: 2026-08-06\nprovenance:\n  source: "test/snooze"\n  recorded_at: "2026-08-06T12:00:00Z"\ndepends_on: []\nrelated: []\n---\nbody\n`;

test('snooze sets and clears a migrated item snooze date with CAS', async () => {
  await withLedger({ [`${ITEM}.md`]: SOURCE }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', ITEM, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'snooze.json');
    await writeFile(requestPath, JSON.stringify({
      id: ITEM,
      expected_revision: revision,
      snoozed_until: '2099-12-31',
      date: '2026-08-07',
    }));
    const snoozed = runCli('snooze', '--ledger', ledger, '--input', requestPath, '--json');
    assert.equal(snoozed.status, 0, snoozed.stderr);
    assert.equal(JSON.parse(snoozed.stdout).result.item.core.snoozed_until, '2099-12-31');
  });
});

test('snooze invalid requests report missing members once with unchanged state', async () => {
  await withLedger({}, async (ledger) => {
    const requestPath = path.join(path.dirname(ledger), 'invalid-snooze.json');
    await writeFile(requestPath, '{}');

    const result = runCli('snooze', '--ledger', ledger, '--input', requestPath, '--json');
    assert.equal(result.status, 2, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.state, 'unchanged');
    assert.deepEqual(
      envelope.error.details.issues.map((issue) => [issue.path, issue.code]),
      [
        ['/date', 'missing-member'],
        ['/expected_revision', 'missing-member'],
        ['/id', 'missing-member'],
        ['/snoozed_until', 'missing-member'],
      ],
    );
  });
});
