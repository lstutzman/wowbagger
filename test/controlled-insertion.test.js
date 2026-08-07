import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const loader = fileURLToPath(new URL('./private-mutation-loader.js', import.meta.url));
const runner = fileURLToPath(new URL('./controlled-insertion-runner.js', import.meta.url));

test('controlled insertion does not rescan or slice a suffix for each root pair', () => {
  const result = spawnSync(process.execPath, [
    '--no-warnings',
    '--experimental-loader',
    loader,
    runner,
  ], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).sliced_items, 0);
});
