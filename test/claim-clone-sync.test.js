import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { mkdir, writeFile } from 'node:fs/promises';
import { git, patchRequest, provisionedLedger, requestFile, run } from './auto-commit-fixture.js';
import { parseReconcileLog } from '../src/claim-journal.js';

test('claim-verify keeps a fresh clone clean', async () => {
  const fixture = await provisionedLedger();
  const patch = await requestFile(fixture, 'seed-patch.json', patchRequest(fixture));
  const patched = run(fixture.root, 'patch', '--ledger', fixture.ledger, '--input', patch, '--json');
  assert.equal(patched.exit, 0, patched.stdout);
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Seed committed reconciliation history');

  const cloneRoot = path.join(fixture.base, 'clone');
  git(fixture.root, 'clone', '-q', fixture.root, cloneRoot);
  const cloneLedger = path.join(cloneRoot, 'ledger');

  const verified = run(cloneRoot, 'claim-verify', '--ledger', cloneLedger, '--json');

  assert.equal(verified.exit, 0, verified.stdout);
  assert.deepEqual(verified.envelope.result.findings, []);
  assert.equal(git(cloneRoot, 'status', '--porcelain', '--', 'ledger'), '');
});

test('committed hydration rejects sequence beyond journal capacity', () => {
  const namespace = 'wbns_0123456789abcdef0123456789abcdef';
  const source = [
    `# Wowbagger reconciliation log \`${namespace}\``,
    '',
    '```jsonl',
    JSON.stringify({
      seq: 65537,
      type: 'clock',
      now: '2030-01-11T09:00:00.000Z',
      floor: '2030-01-11T09:00:00.000Z',
    }),
    '```',
    '',
  ].join('\n');

  assert.deepEqual(parseReconcileLog(source, namespace), {
    error: { code: 'ambiguous-journal', reason: 'sequence-out-of-range' },
  });
});

test('claim read completes partial committed hydration in a fresh clone', async () => {
  const fixture = await provisionedLedger();
  const acquire = await requestFile(fixture, 'acquire.json', {
    ledger_namespace: fixture.namespace,
    item_id: 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV',
    owner_id: 'agent-a',
    lease_duration_ms: 300000,
    expected: { last_epoch: '0', active: null },
  });
  const acquired = run(
    fixture.root,
    'claim', 'acquire', '--ledger', fixture.ledger, '--input', acquire, '--json',
  );
  assert.equal(acquired.exit, 0, acquired.stdout);
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Seed committed claim history');

  const cloneRoot = path.join(fixture.base, 'claim-clone');
  git(fixture.root, 'clone', '-q', fixture.root, cloneRoot);
  const journalPath = path.join(
    cloneRoot,
    '.git',
    'wowbagger',
    fixture.namespace,
    'journal.ndjson',
  );
  await mkdir(path.dirname(journalPath), { recursive: true });
  await writeFile(journalPath, `${JSON.stringify({
    seq: 1,
    type: 'clock',
    now: '2030-01-11T09:00:00.000Z',
    floor: '2030-01-11T09:00:00.000Z',
  })}\n`);
  const readRequest = path.join(cloneRoot, 'read.json');
  await writeFile(readRequest, JSON.stringify({
    ledger_namespace: fixture.namespace,
    item_id: 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV',
  }));

  const read = run(
    cloneRoot,
    'claim', 'read', '--ledger', path.join(cloneRoot, 'ledger'), '--input', readRequest, '--json',
  );

  assert.equal(read.exit, 0, read.stdout);
  assert.equal(read.envelope.result.read_back.last_epoch, '1');
  assert.equal(read.envelope.result.read_back.active.owner_id, 'agent-a');
});
