import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { runCli, withLedger } from './support.js';

const itemId = 'wb_01Q45X474NAAAAAAAAAAAAAAAA';
const itemSource = [
  '---',
  'schema_version: 1',
  `id: ${itemId}`,
  'title: "Ready report item"',
  'kind: task',
  'status: backlog',
  'created: 2030-01-10',
  'updated: 2030-01-10',
  'provenance:',
  '  source: "fixture/report"',
  '  recorded_at: "2030-01-10T12:34:56.789Z"',
  'depends_on: []',
  'related: []',
  '---',
  '',
  '# Body',
].join('\n');

function reportConfig(output = '../../report.html') {
  return JSON.stringify({
    report_version: 1,
    repository: { name: 'Example repository' },
    title: 'Ledger report',
    output,
  });
}

test('report writes the configured HTML and one success envelope', async () => {
  await withLedger({
    [`${itemId}.md`]: itemSource,
    '.wowbagger/report.json': reportConfig(),
  }, async (ledger) => {
    const output = path.resolve(ledger, '..', 'report.html');

    const result = runCli('report', '--ledger', ledger, '--as-of', '2030-01-15', '--json');

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      command: 'report',
      contract_version: 2,
      result: {
        report_version: 1,
        as_of: '2030-01-15',
        output,
        item_count: 1,
        ready_count: 1,
      },
    });
    assert.match(await readFile(output, 'utf8'), /Ready report item/);
  });
});

test('report rejects missing required arguments with one JSON envelope', () => {
  const result = runCli('report');

  assert.equal(result.status, 2);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: false,
    command: 'report',
    contract_version: 2,
    error: {
      code: 'invalid-request',
      message: 'The report request is invalid.',
      details: {
        issues: [
          {
            path: '/arguments',
            code: 'missing-argument',
            message: 'Argument --as-of is required.',
          },
          {
            path: '/arguments',
            code: 'missing-argument',
            message: 'Argument --json is required.',
          },
          {
            path: '/arguments',
            code: 'missing-argument',
            message: 'Argument --ledger is required.',
          },
        ],
      },
    },
  });
});

test('report validates the ledger before reading report configuration', async () => {
  await withLedger({
    'invalid.md': 'not frontmatter',
  }, async (ledger) => {
    const result = runCli('report', '--ledger', ledger, '--as-of', '2030-01-15', '--json');
    const output = JSON.parse(result.stdout);

    assert.equal(result.status, 1);
    assert.equal(result.stderr, '');
    assert.deepEqual(Object.keys(output), ['ok', 'command', 'contract_version', 'error']);
    assert.equal(output.ok, false);
    assert.equal(output.command, 'report');
    assert.equal(output.contract_version, 2);
    assert.equal(output.error.code, 'ledger-invalid');
    assert.equal(output.error.message, 'The configured ledger is invalid.');
    assert.ok(Array.isArray(output.error.details.errors));
    assert.ok(output.error.details.errors.length > 0);
  });
});
