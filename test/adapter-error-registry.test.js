import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ADAPTER_ERROR_CODES,
  ADAPTER_ERROR_CODES_BY_OPERATION,
} from '../spec/adapter-reference.js';
import { runReferenceVectors } from '../spec/run-adapter-vectors.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const fixtureRoot = path.join(projectRoot, 'spec/fixtures/adapters');

test('public adapter error registry matches documentation and every model/vector error', async () => {
  assert.equal(Object.isFrozen(ADAPTER_ERROR_CODES), true);
  assert.equal(Object.isFrozen(ADAPTER_ERROR_CODES_BY_OPERATION), true);
  assert.deepEqual(ADAPTER_ERROR_CODES, [...ADAPTER_ERROR_CODES].sort());
  assert.equal(new Set(ADAPTER_ERROR_CODES).size, ADAPTER_ERROR_CODES.length);

  const documentation = await readFile(path.join(projectRoot, 'docs/adapter-contract.md'), 'utf8');
  const registrySection = documentation.match(
    /<!-- adapter-error-codes:start -->\n```text\n([\s\S]*?)```\n<!-- adapter-error-codes:end -->/,
  );
  assert.ok(registrySection, 'documented adapter error-code registry');
  const documented = registrySection[1].trim().split('\n');
  assert.deepEqual(documented, ADAPTER_ERROR_CODES);

  const classSection = documentation.match(
    /<!-- adapter-error-code-classes:start -->\n```json\n([\s\S]*?)```\n<!-- adapter-error-code-classes:end -->/,
  );
  assert.ok(classSection, 'documented operation-specific error-code classes');
  assert.deepEqual(JSON.parse(classSection[1]), ADAPTER_ERROR_CODES_BY_OPERATION);
  assert.deepEqual(
    Object.values(ADAPTER_ERROR_CODES_BY_OPERATION).flat().sort(),
    ADAPTER_ERROR_CODES,
  );

  const emittedByVectors = new Set();
  for (const directory of await readdir(fixtureRoot, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    for (const entry of await readdir(path.join(fixtureRoot, directory.name), { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const value = JSON.parse(await readFile(path.join(fixtureRoot, directory.name, entry.name), 'utf8'));
      collectVectorErrors(value, emittedByVectors);
    }
  }
  assert.deepEqual([...emittedByVectors].sort(), ADAPTER_ERROR_CODES,
    'vector expected codes must exactly equal the public registry');

  const executed = await runReferenceVectors(fixtureRoot);
  assert.deepEqual(executed.observed_error_codes, ADAPTER_ERROR_CODES,
    'executed reference-model emissions must exactly equal the public registry');
});

function collectVectorErrors(value, result) {
  if (Array.isArray(value)) {
    for (const member of value) collectVectorErrors(member, result);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  if (typeof value.expected_code === 'string') result.add(value.expected_code);
  if (typeof value.expected === 'string' && value.expected !== 'ok') result.add(value.expected);
  if (typeof value.refusal === 'string') result.add(value.refusal);
  if (typeof value.error?.code === 'string') result.add(value.error.code);
  for (const member of Object.values(value)) collectVectorErrors(member, result);
}
