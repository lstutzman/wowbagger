import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runCli } from './support.js';

const capabilitiesFixture = new URL(
  '../spec/fixtures/mutations/capabilities/expected.json',
  import.meta.url,
);

test('capabilities reports the exact supported local mutation scope', () => {
  const result = runCli('capabilities', '--json');

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, `${JSON.stringify(JSON.parse(readFileSync(fileURLToPath(capabilitiesFixture), 'utf8')))}\n`);
});
