import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parseDocument } from 'yaml';
import { runCli, withLedger } from './support.js';

test('create serializes nested and non-plain extension keys without changing their data', async () => {
  await withLedger({}, async (ledger) => {
    const requestPath = path.join(path.dirname(ledger), 'request.json');
    await writeFile(requestPath, JSON.stringify({
      id: 'wb_01Q45X474N28T5CY4GNF6YY4HM',
      item: {
        title: 'Preserve a structured extension through YAML serialization',
        kind: 'task',
        provenance: {
          source: 'test/mutation-hardening',
          recorded_at: '2030-01-10T12:34:56.789Z',
        },
        depends_on: [],
        'extension\nmultiline-key': {
          nested: {
            label: 'exact value',
          },
          rows: [
            { state: 'first', values: ['a', 'b'] },
            { state: 'second', values: [] },
          ],
        },
      },
      body: '',
    }));

    const result = runCli('create', '--ledger', ledger, '--input', requestPath, '--json');
    const output = JSON.parse(result.stdout);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(output.ok, true);
    const source = await readFile(path.join(ledger, 'wb_01Q45X474N28T5CY4GNF6YY4HM.md'), 'utf8');
    const data = parseDocument(source.split('\n---\n', 1)[0].replace(/^---\n/, '')).toJS();
    assert.deepEqual(data['extension\nmultiline-key'], {
      nested: { label: 'exact value' },
      rows: [
        { state: 'first', values: ['a', 'b'] },
        { state: 'second', values: [] },
      ],
    });
  });
});

test('create retains an extension JSON number without JavaScript precision coercion', async () => {
  await withLedger({}, async (ledger) => {
    const requestPath = path.join(path.dirname(ledger), 'request.json');
    await writeFile(requestPath, `{
  "id": "wb_01Q45X474N28T5CY4GNF6YY4HM",
  "item": {
    "title": "Keep an exact extension integer",
    "kind": "task",
    "provenance": {
      "source": "test/mutation-hardening",
      "recorded_at": "2030-01-10T12:34:56.789Z"
    },
    "depends_on": [],
    "exact_integer": 90071992547409939999
  },
  "body": ""
}`);

    const result = runCli('create', '--ledger', ledger, '--input', requestPath, '--json');

    assert.equal(result.status, 0, result.stderr);
    const source = await readFile(path.join(ledger, 'wb_01Q45X474N28T5CY4GNF6YY4HM.md'), 'utf8');
    assert.match(source, /^exact_integer: 90071992547409939999$/m);
  });
});

test('transition preserves CRLF extension comments and every body byte', async () => {
  const id = 'wb_01Q4G4Q3G004HMASW9NF6YY093';
  const body = '\r\nA CRLF body stays byte-for-byte intact.\r\n';
  const extension = 'future_extension:\r\n  exact_integer: 90071992547409939999\r\n  # Keep this comment attached to the extension.\r\n';
  const source = [
    '---',
    'schema_version: 1',
    `id: ${id}`,
    'title: "Preserve source layout"',
    'kind: task',
    'status: triage',
    'created: 2030-01-14',
    'updated: 2030-01-14',
    'provenance:',
    '  source: "test/mutation-hardening"',
    '  recorded_at: "2030-01-14T12:00:00Z"',
    'depends_on: []',
    'related: []',
    extension.trimEnd(),
    '---',
    '',
  ].join('\r\n') + body;

  await withLedger({ [`${id}.md`]: source }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
    assert.equal(inspected.status, 0, inspected.stderr);
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'transition.json');
    await writeFile(requestPath, JSON.stringify({
      id,
      expected_revision: revision,
      to_status: 'backlog',
      date: '2030-01-16',
      decision: {
        summary: 'Accept the CRLF item.',
        rationale: 'Its source representation is intentionally non-default.',
      },
    }));

    const result = runCli('transition', '--ledger', ledger, '--input', requestPath, '--json');
    assert.equal(result.status, 0, result.stderr);
    const rewritten = await readFile(path.join(ledger, `${id}.md`), 'utf8');
    assert.ok(rewritten.includes(extension));
    assert.ok(rewritten.endsWith(body));
  });
});

test('lock diagnostics distinguish invalid UTF-8 from invalid metadata shape', async () => {
  const id = 'wb_01Q4G4Q3G004HMASW9NF6YY093';
  const cases = [
    ['invalid-utf8', Buffer.from([0xff, 0xfe, 0xfd])],
    ['invalid-shape', Buffer.from(JSON.stringify({
      lock_version: 1,
      item_id: id,
      operation: 'transition',
      writer_id: 'bad-timestamp',
      started_at: '2030-99-99T99:99:99Z',
    }))],
  ];

  for (const [expectedDiagnostic, lockBytes] of cases) {
    await withLedger({ [`${id}.md`]: triageSource(id) }, async (ledger) => {
      const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
      const revision = JSON.parse(inspected.stdout).result.item.revision;
      const lockDirectory = path.join(ledger, '.wowbagger-locks');
      const requestPath = path.join(path.dirname(ledger), 'transition.json');
      await mkdir(lockDirectory);
      await writeFile(path.join(lockDirectory, `${id}.lock`), lockBytes);
      await writeFile(requestPath, JSON.stringify({
        id,
        expected_revision: revision,
        to_status: 'backlog',
        date: '2030-01-16',
        decision: {
          summary: 'Accept the locked item.',
          rationale: 'Exercise diagnostic classification only.',
        },
      }));

      const result = runCli('transition', '--ledger', ledger, '--input', requestPath, '--json');
      const output = JSON.parse(result.stdout);

      assert.equal(result.status, 4, result.stderr);
      assert.equal(output.error.code, 'lock-held');
      assert.equal(output.error.details.owner, null);
      assert.equal(output.error.details.owner_diagnostic, expectedDiagnostic);
    });
  }
});

function triageSource(id) {
  return `---
schema_version: 1
id: ${id}
title: "Classify malformed lock metadata"
kind: task
status: triage
created: 2030-01-14
updated: 2030-01-14
provenance:
  source: "test/mutation-hardening"
  recorded_at: "2030-01-14T12:00:00Z"
depends_on: []
related: []
---
`;
}
