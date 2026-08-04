import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runCli } from './support.js';

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
