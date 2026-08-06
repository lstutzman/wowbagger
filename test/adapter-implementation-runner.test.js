import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { runImplementationVectors } from '../spec/run-adapter-implementation.js';

async function writeTempFixture(manifest) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-vectors-'));
  const directory = path.join(root, '01-synthetic');
  await mkdir(directory);
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
  return root;
}

test('reports every claude-code assertion as failing when no entrypoint answers', async () => {
  const result = await runImplementationVectors({
    entrypoint: { kind: 'command', executable: 'adapters/claude-code/absent.js', fixed_args: [] },
    platform: 'darwin',
  });

  assert.equal(result.status, 'fail');
  assert.equal(result.implementations['claude-code'], 'fail');
  assert.equal(result.evidence_platform, 'darwin');
  assert.equal(result.cases.length, 15);

  const executed = result.cases.flatMap((entry) => entry.executed_assertions);
  assert.equal(executed.length, 183);
});

test('fails closed on an unknown assertion type', async () => {
  const fixtureRoot = await writeTempFixture({
    adapter_vector_version: 1,
    case: 'synthetic',
    coverage: ['capabilities'],
    targets: ['claude-code'],
    mode: 'protocol',
    assertions: [{ id: 'synthetic-1', type: 'not-a-real-type' }],
    artifacts: [],
  });

  await assert.rejects(
    () => runImplementationVectors({ fixtureRoot, entrypoint: null, platform: 'darwin' }),
    /unknown assertion type/,
  );
});
