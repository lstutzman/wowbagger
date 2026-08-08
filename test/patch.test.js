import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { runCli, withLedger } from './support.js';

const ID = 'wb_01Q45X474N28T5CY4GNF6YY4HM';

function itemSource(id, { priority = 5, number = 7 } = {}) {
  return [
    '---',
    'schema_version: 1',
    `id: ${id}`,
    `number: ${number}`,
    'title: "Patchable item"',
    'kind: task',
    `priority: ${priority}`,
    'status: backlog',
    'created: 2030-01-10',
    'updated: 2030-01-10',
    'provenance:',
    '  source: "fixture/mutations"',
    '  recorded_at: "2030-01-10T12:34:56.789Z"',
    'depends_on: []',
    'related: []',
    '---',
    '',
    'Body.',
    '',
  ].join('\n');
}

function inspectRevision(ledger, id) {
  const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
  assert.equal(inspected.status, 0, inspected.stderr);
  return JSON.parse(inspected.stdout).result.item.revision;
}

async function runPatch(ledger, request) {
  const requestPath = path.join(path.dirname(ledger), 'patch-request.json');
  await writeFile(requestPath, JSON.stringify(request));
  return runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');
}

test('patch with null removes the priority field', async () => {
  await withLedger({ [`${ID}.md`]: itemSource(ID) }, async (ledger) => {
    const revision = inspectRevision(ledger, ID);

    const result = await runPatch(ledger, {
      id: ID,
      expected_revision: revision,
      date: '2030-01-11',
      set: { priority: null },
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const item = JSON.parse(result.stdout).result.item;
    assert.equal(Object.hasOwn(item.core, 'priority'), false);
    const source = Buffer.from(item.source_base64, 'base64').toString('utf8');
    assert.ok(!source.includes('priority:'), source);
  });
});

test('patch refuses a field outside the patchable set', async () => {
  await withLedger({ [`${ID}.md`]: itemSource(ID) }, async (ledger) => {
    const revision = inspectRevision(ledger, ID);

    const result = await runPatch(ledger, {
      id: ID,
      expected_revision: revision,
      date: '2030-01-11',
      set: { title: 'Renamed' },
    });

    assert.equal(result.status, 2, result.stdout);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error.code, 'invalid-request');
    assert.equal(envelope.state, 'unchanged');
    const paths = envelope.error.details.issues.map((entry) => entry.path);
    assert.ok(paths.includes('/set/title'), result.stdout);
  });
});

test('patch refuses a negative priority', async () => {
  await withLedger({ [`${ID}.md`]: itemSource(ID) }, async (ledger) => {
    const revision = inspectRevision(ledger, ID);

    const result = await runPatch(ledger, {
      id: ID,
      expected_revision: revision,
      date: '2030-01-11',
      set: { priority: -1 },
    });

    assert.equal(result.status, 2, result.stdout);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error.code, 'invalid-request');
    assert.deepEqual(envelope.error.details.issues, [{
      path: '/set/priority',
      code: 'invalid-value',
      message: 'Set member priority must be a non-negative integer or null.',
    }]);
  });
});

test('patch refuses a number already held by another item without touching it', async () => {
  const otherId = 'wb_01Q45X474N28T5CY4GNF6YY4HN';
  await withLedger({
    [`${ID}.md`]: itemSource(ID),
    [`${otherId}.md`]: itemSource(otherId, { number: 9 }),
  }, async (ledger) => {
    const revision = inspectRevision(ledger, ID);
    const otherRevision = inspectRevision(ledger, otherId);

    const result = await runPatch(ledger, {
      id: ID,
      expected_revision: revision,
      date: '2030-01-11',
      set: { number: 9 },
    });

    assert.equal(result.status, 2, result.stdout);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error.code, 'candidate-invalid');
    assert.equal(envelope.state, 'unchanged');
    assert.ok(envelope.error.details.validation_errors.every((entry) => entry.code === 'duplicate-number'), result.stdout);
    assert.equal(inspectRevision(ledger, ID), revision);
    assert.equal(inspectRevision(ledger, otherId), otherRevision);
  });
});

test('patch refuses a stale revision with the actual token', async () => {
  await withLedger({ [`${ID}.md`]: itemSource(ID) }, async (ledger) => {
    const revision = inspectRevision(ledger, ID);
    const stale = `sha256:${'a'.repeat(64)}`;

    const result = await runPatch(ledger, {
      id: ID,
      expected_revision: stale,
      date: '2030-01-11',
      set: { priority: 2 },
    });

    assert.equal(result.status, 4, result.stdout);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error.code, 'revision-conflict');
    assert.equal(envelope.state, 'unchanged');
    assert.equal(envelope.error.details.actual_revision, revision);
  });
});

test('patch refuses a date earlier than the current updated date', async () => {
  await withLedger({ [`${ID}.md`]: itemSource(ID) }, async (ledger) => {
    const revision = inspectRevision(ledger, ID);

    const result = await runPatch(ledger, {
      id: ID,
      expected_revision: revision,
      date: '2030-01-09',
      set: { priority: 2 },
    });

    assert.equal(result.status, 2, result.stdout);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error.code, 'patch-precondition-failed');
    assert.equal(envelope.state, 'unchanged');
    const codes = envelope.error.details.issues.map((entry) => entry.code);
    assert.deepEqual(codes, ['date-before-created', 'date-before-updated']);
  });
});

test('patch changes priority under compare-and-swap and bumps updated', async () => {
  await withLedger({ [`${ID}.md`]: itemSource(ID) }, async (ledger) => {
    const revision = inspectRevision(ledger, ID);

    const result = await runPatch(ledger, {
      id: ID,
      expected_revision: revision,
      date: '2030-01-11',
      set: { priority: 1 },
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, 'patch');
    assert.equal(envelope.contract_version, 1);
    assert.equal(envelope.state, 'committed');
    const item = envelope.result.item;
    assert.equal(item.core.priority, 1);
    assert.equal(item.core.number, 7);
    assert.equal(item.core.updated, '2030-01-11');
    assert.equal(item.body, '\nBody.\n');
    assert.equal(Object.hasOwn(item.core, 'decisions'), false);
    assert.notEqual(item.revision, revision);
  });
});
