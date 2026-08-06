import test from 'node:test';
import assert from 'node:assert/strict';
import { runImplementationVectors } from '../spec/run-adapter-implementation.js';

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
