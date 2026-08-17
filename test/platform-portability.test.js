// Portability guards for the platforms this repository intends to claim.
//
// Fixtures here are byte-exact: the conformance vectors compare exact core
// bytes, and several goldens are pinned by SHA-256. A checkout that rewrote
// line endings would change those bytes before any test ran, so the checkout
// itself is a gate concern, not a developer preference.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

function git(...argumentsList) {
  const result = spawnSync('git', argumentsList, {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('checkout rewrites no tracked byte: every tracked path has text unset', () => {
  const tracked = git('ls-files', '-z').split('\0').filter(Boolean);
  assert.ok(tracked.length > 100, `expected a tracked file list, saw ${tracked.length}`);

  const checked = spawnSync('git', ['check-attr', '--stdin', '-z', 'text'], {
    cwd: projectRoot,
    encoding: 'utf8',
    input: tracked.join('\0'),
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(checked.status, 0, checked.stderr);

  // `check-attr -z` emits path, attribute, value as three NUL-terminated
  // fields per input path.
  const fields = checked.stdout.split('\0');
  const converted = [];
  for (let index = 0; index + 2 < fields.length; index += 3) {
    if (fields[index + 2] !== 'unset') converted.push(`${fields[index]}: ${fields[index + 2]}`);
  }

  assert.deepEqual(converted, [], 'these paths would be end-of-line converted on checkout');
});
