import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { runCli, withLedger } from './support.js';

const readyId = 'wb_01Q45X474NAAAAAAAAAAAAAAAA';
const blockedId = 'wb_01Q45X474NBBBBBBBBBBBBBBBB';

function itemSource(id, extra = []) {
  return [
    '---',
    'schema_version: 2',
    `id: ${id}`,
    `number: ${id === readyId ? 1 : 2}`,
    `title: "Item ${id === readyId ? 1 : 2}"`,
    'kind: task',
    'status: backlog',
    'created: 2030-01-10',
    'updated: 2030-01-10',
    'provenance:',
    '  source: "fixture/graph"',
    '  recorded_at: "2030-01-10T12:34:56.789Z"',
    ...extra,
    'related: []',
    '---',
    '',
    '# Body',
  ].join('\n');
}

const ledgerFiles = {
  [`${readyId}.md`]: itemSource(readyId, ['depends_on: []']),
  [`${blockedId}.md`]: itemSource(blockedId, [`depends_on: [ ${readyId} ]`]),
  '.wowbagger/report.json': JSON.stringify({
    report_version: 1,
    repository: { name: 'Example repository' },
    title: 'Ledger report',
    output: '../../report.html',
  }),
};

test('the ordinary report carries the dependency graph in its single file', async () => {
  await withLedger(ledgerFiles, async (ledger) => {
    const output = path.resolve(ledger, '..', 'report.html');

    const result = runCli('report', '--ledger', ledger, '--as-of', '2030-01-15', '--json');

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      command: 'report',
      contract_version: 4,
      result: {
        report_version: 1,
        as_of: '2030-01-15',
        output,
        item_count: 2,
        ready_count: 1,
      },
    });
    const published = (await readdir(path.dirname(output))).filter((entry) => entry.endsWith('.html'));
    assert.deepEqual(published, ['report.html'], 'the graph rides in the report, not beside it');

    const html = await readFile(output, 'utf8');
    assert.match(html, /ForceGraph3D/, 'the vendored bundle must be inlined');
    assert.match(html, /id="graph-stage"/);
  });
});

test('two renders of the same ledger produce the same bytes', async () => {
  await withLedger(ledgerFiles, async (ledger) => {
    const output = path.resolve(ledger, '..', 'report.html');

    assert.equal(runCli('report', '--ledger', ledger, '--as-of', '2030-01-15', '--json').status, 0);
    const first = await readFile(output);
    assert.equal(runCli('report', '--ledger', ledger, '--as-of', '2030-01-15', '--json').status, 0);
    const second = await readFile(output);

    assert.ok(first.equals(second), 'the report with its graph must be byte-deterministic');
  });
});

test('there is no showpiece flag to opt into', async () => {
  await withLedger(ledgerFiles, async (ledger) => {
    const result = runCli('report', '--ledger', ledger, '--as-of', '2030-01-15', '--showpiece', '--json');

    assert.equal(result.status, 2);
    assert.deepEqual(
      JSON.parse(result.stdout).error.details.issues.map((entry) => entry.code),
      ['unknown-argument'],
    );
  });
});
