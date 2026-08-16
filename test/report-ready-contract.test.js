import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { runCli, withLedger } from './support.js';

// The report ranks; the core does not. These items carry every extension field
// the report layer sequences on - an expedite class, an imminent due date, a
// dependent that gives one item unblocking leverage - arranged so that report
// order and `ready` order disagree. `ready --json` must still emit the core's
// four-step queue, byte for byte.
const expedited = 'wb_01Q45X474NAAAAAAAAAAAAAAA1';
const leveraged = 'wb_01Q45X474NAAAAAAAAAAAAAAA2';
const plain = 'wb_01Q45X474NAAAAAAAAAAAAAAA3';
const dependent = 'wb_01Q45X474NAAAAAAAAAAAAAAA4';

function source(id, number, priority, created, extra = []) {
  return [
    '---',
    'schema_version: 2',
    `id: ${id}`,
    `number: ${number}`,
    `title: "Item ${number}"`,
    'kind: task',
    'status: backlog',
    `created: ${created}`,
    `updated: ${created}`,
    `priority: ${priority}`,
    'provenance:',
    '  source: "fixture/report"',
    `  recorded_at: "${created}T12:34:56.789Z"`,
    'depends_on: []',
    'related: []',
    'decisions: []',
    ...extra,
    '---',
    '',
    '# Body',
  ].join('\n');
}

const files = {
  [`${expedited}.md`]: source(expedited, 1, 9, '2030-01-10', ['class: expedite', 'due: "2030-01-16"']),
  [`${leveraged}.md`]: source(leveraged, 2, 5, '2030-01-10'),
  [`${plain}.md`]: source(plain, 3, 0, '2030-01-10'),
  [`${dependent}.md`]: source(dependent, 4, 7, '2030-01-10')
    .replace('depends_on: []', `depends_on: ["${leveraged}"]`),
  '.wowbagger/report.json': JSON.stringify({
    report_version: 1,
    repository: { name: 'Example repository' },
    title: 'Ledger report',
    output: '../../report.html',
    fields: { class: '/class', due: '/due' },
  }),
};

test('ready --json keeps its byte-for-byte contract while the report reorders', async () => {
  await withLedger(files, async (ledger) => {
    const result = runCli('ready', '--ledger', ledger, '--as-of', '2030-01-15', '--json');

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(
      result.stdout,
      `{"as_of":"2030-01-15","valid":true,"ready":["${plain}","${leveraged}","${expedited}"]}\n`,
    );
  });
});

test('the report ranks the same ledger differently from ready', async () => {
  await withLedger(files, async (ledger) => {
    const output = path.resolve(ledger, '..', 'report.html');

    const result = runCli('report', '--ledger', ledger, '--as-of', '2030-01-15', '--json');

    assert.equal(result.status, 0, result.stderr);
    const html = await readFile(output, 'utf8');
    const ranked = [...html.slice(html.indexOf('class="ranked"'), html.indexOf('id="attention"'))
      .matchAll(/<span class="handle">#(\d+)<\/span>/g)]
      .map(([, number]) => Number(number));

    assert.deepEqual(ranked, [1, 2, 3]);
  });
});
