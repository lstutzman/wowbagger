import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { MINIMUM_NODE_MAJOR } from '../src/launch.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const packageManifest = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));

test('the published runtime floor is Node 24', () => {
  assert.equal(packageManifest.engines.node, '>=24');
  assert.equal(MINIMUM_NODE_MAJOR, 24);
});

test('every native CI platform runs Node 24', async () => {
  const { parse } = await import('yaml');
  const workflow = parse(readFileSync(path.join(projectRoot, '.github', 'workflows', 'ci.yml'), 'utf8'));
  assert.deepEqual(
    workflow.jobs.gate.strategy.matrix.include.map((entry) => entry.node),
    ['24', '24', '24'],
  );
});

test('the release gate names and invokes Node 24 explicitly', async () => {
  const { releaseGateSteps } = await import('../scripts/cut-release.js');
  const steps = releaseGateSteps(projectRoot);
  assert.equal(steps[0].name, 'tests (Node 24)');
  assert.match(steps[0].command, /node@24/u);
  assert.equal(steps[1].name, 'tests (Node 24 strict deprecations)');
  assert.match(steps[1].command, /node@24/u);
  assert.deepEqual(steps[1].args.slice(0, 3), [
    '--pending-deprecation',
    '--throw-deprecation',
    '--test',
  ]);
  assert.doesNotMatch(steps.map((step) => step.name).join('\n'), /current Node|Node 20/u);
});

test('developer shells pin Node 24 without admitting Node 26', () => {
  assert.equal(readFileSync(path.join(projectRoot, '.nvmrc'), 'utf8').trim(), '24');
  const workflow = readFileSync(path.join(projectRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.doesNotMatch(workflow, /node:\s*['"]?(?:20|26)\b/u);
});
