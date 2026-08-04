import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runCli, withLedger } from './support.js';

const capabilitiesFixture = new URL(
  '../spec/fixtures/mutations/capabilities/expected.json',
  import.meta.url,
);
const inspectFixture = new URL('../spec/fixtures/mutations/inspect/', import.meta.url);

test('capabilities reports the exact supported local mutation scope', () => {
  const result = runCli('capabilities', '--json');

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, `${JSON.stringify(JSON.parse(readFileSync(fileURLToPath(capabilitiesFixture), 'utf8')))}\n`);
});

test('inspect returns one lossless validated item from a single byte snapshot', () => {
  const result = runCli(
    'inspect',
    '--ledger',
    fileURLToPath(new URL('ledger', inspectFixture)),
    '--id',
    'wb_01Q4837BM01W70T30B184GG1R6',
    '--json',
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(
    result.stdout,
    `${JSON.stringify(JSON.parse(readFileSync(fileURLToPath(new URL('expected.json', inspectFixture)), 'utf8')))}\n`,
  );
});

test('inspect refuses an absent ID without returning a partial item', () => {
  const fixture = new URL('../spec/fixtures/mutations/inspect/', import.meta.url);
  const result = runCli(
    'inspect',
    '--ledger',
    fileURLToPath(new URL('ledger', fixture)),
    '--id',
    'wb_01Q4AZXNG0206CSK6CSK6CSK6C',
    '--json',
  );

  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(
    result.stdout,
    `${JSON.stringify(JSON.parse(readFileSync(fileURLToPath(new URL('expected-not-found.json', fixture)), 'utf8')))}\n`,
  );
});

test('inspect fails closed when another ledger item is invalid', () => {
  const fixture = new URL('../spec/fixtures/mutations/inspect-invalid-ledger/', import.meta.url);
  const result = runCli(
    'inspect',
    '--ledger',
    fileURLToPath(new URL('ledger', fixture)),
    '--id',
    'wb_01Q4AZXNG0206CSK6CSK6CSK6C',
    '--json',
  );

  assert.equal(result.status, 3, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(
    result.stdout,
    `${JSON.stringify(JSON.parse(readFileSync(fileURLToPath(new URL('expected.json', fixture)), 'utf8')))}\n`,
  );
});

test('create atomically publishes the canonical caller-identified triage item', async () => {
  const fixture = new URL('../spec/fixtures/mutations/create/', import.meta.url);
  await withLedger({}, async (ledger) => {
    const requestPath = path.join(path.dirname(ledger), 'request.json');
    await writeFile(requestPath, readFileSync(fileURLToPath(new URL('request.json', fixture))));

    const result = runCli('create', '--ledger', ledger, '--input', requestPath, '--json');

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(
      result.stdout,
      `${JSON.stringify(JSON.parse(readFileSync(fileURLToPath(new URL('expected.json', fixture)), 'utf8')))}\n`,
    );
    assert.equal(
      await readFile(path.join(ledger, 'wb_01Q45X474N28T5CY4GNF6YY4HM.md'), 'utf8'),
      readFileSync(fileURLToPath(new URL('expected-item.md', fixture)), 'utf8'),
    );
  });
});
