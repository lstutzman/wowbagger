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
      contract_version: 3,
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

const completedId = 'wb_01Q45X474NBBBBBBBBBBBBBBBB';
const completedSource = [
  '---',
  'schema_version: 1',
  `id: ${completedId}`,
  'title: "Completed report item"',
  'kind: task',
  'status: done',
  'created: 2030-01-10',
  'updated: 2030-01-12',
  'completed: 2030-01-12',
  'provenance:',
  '  source: "fixture/report"',
  '  recorded_at: "2030-01-10T12:34:56.789Z"',
  'depends_on: []',
  'related: []',
  'decisions:',
  '  - action: accept',
  '    date: 2030-01-10',
  '    summary: "Accept it."',
  '    rationale: "See https://example.invalid/why for the reasoning."',
  '  - action: complete',
  '    date: 2030-01-12',
  '    summary: "Finish it."',
  '    rationale: "Verified."',
  '---',
  '',
  '# Body',
  '',
  'See <https://example.invalid/spec> for detail.',
].join('\n');

test('report renders byte-identical evidence charts for the same ledger and as-of', async () => {
  await withLedger({
    [`${itemId}.md`]: itemSource,
    [`${completedId}.md`]: completedSource,
    '.wowbagger/report.json': reportConfig(),
  }, async (ledger) => {
    const output = path.resolve(ledger, '..', 'report.html');

    assert.equal(runCli('report', '--ledger', ledger, '--as-of', '2030-01-15', '--json').status, 0);
    const first = await readFile(output, 'utf8');
    assert.equal(runCli('report', '--ledger', ledger, '--as-of', '2030-01-15', '--json').status, 0);
    const second = await readFile(output, 'utf8');

    assert.equal(first, second);
    assert.match(first, /data-testid="chart-weekly-flow"/);
    assert.match(first, /data-testid="chart-aging"/);
    assert.match(first, /data-testid="chart-forecast"/);
  });
});

test('report keeps every reference inline even when item prose carries URLs', async () => {
  await withLedger({
    [`${itemId}.md`]: itemSource,
    [`${completedId}.md`]: completedSource,
    '.wowbagger/report.json': reportConfig(),
  }, async (ledger) => {
    const output = path.resolve(ledger, '..', 'report.html');
    assert.equal(runCli('report', '--ledger', ledger, '--as-of', '2030-01-15', '--json').status, 0);
    const html = await readFile(output, 'utf8');

    assert.doesNotMatch(html, /<link\b|@import|xlink:href|<use\b|<image\b|<iframe\b|<object\b|<embed\b/);
    assert.doesNotMatch(html, /\ssrc="(?!data:)/);
    assert.doesNotMatch(html, /url\(\s*['"]?(?:https?:)?\/\//);
  });
});

test('report renders an empty ledger without charts and without errors', async () => {
  await withLedger({
    '.wowbagger/report.json': reportConfig(),
  }, async (ledger) => {
    const output = path.resolve(ledger, '..', 'report.html');

    const result = runCli('report', '--ledger', ledger, '--as-of', '2030-01-15', '--json');

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    const html = await readFile(output, 'utf8');
    assert.doesNotMatch(html, /data-testid="chart-/);
    assert.match(html, /No completions in the window, so no forecast\./);
  });
});

test('report rejects missing required arguments with one JSON envelope', () => {
  const result = runCli('report');

  assert.equal(result.status, 2);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: false,
    command: 'report',
    contract_version: 3,
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
    assert.equal(output.contract_version, 3);
    assert.equal(output.error.code, 'ledger-invalid');
    assert.equal(output.error.message, 'The configured ledger is invalid.');
    assert.ok(Array.isArray(output.error.details.errors));
    assert.ok(output.error.details.errors.length > 0);
  });
});
