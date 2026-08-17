import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { readRegularFixture } from './work-claim-fixture-loader.js';
import { posixSpecialFilesOnly } from './support.js';

test('fixture loader reads only regular files beneath a real root', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'wowbagger-claim-fixture-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'case'));
  writeFileSync(join(root, 'case', 'manifest.json'), '{"case":"safe"}\n');

  assert.equal(readRegularFixture(root, 'case/manifest.json').toString('utf8'), '{"case":"safe"}\n');
});

test('fixture loader rejects traversal, symlinks, directories, and special files', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'wowbagger-claim-fixture-'));
  const outside = join(root, '..', `outside-${process.pid}.json`);
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { force: true });
  });
  mkdirSync(join(root, 'case'));
  writeFileSync(outside, '{}\n');
  symlinkSync(outside, join(root, 'case', 'link.json'));

  assert.throws(() => readRegularFixture(root, '../outside.json'), /safe relative path/);
  assert.throws(() => readRegularFixture(root, 'case/link.json'), /symlink/);
  assert.throws(() => readRegularFixture(root, 'case'), /regular file/);

  // The traversal, symlink and directory refusals above are platform-neutral;
  // only the FIFO is not, so only the FIFO is conditional.
  if (posixSpecialFilesOnly.skip === undefined) {
    const fifo = join(root, 'case', 'fifo');
    const madeFifo = spawnSync('mkfifo', [fifo], { encoding: 'utf8' });
    assert.equal(madeFifo.status, 0, madeFifo.stderr);
    assert.throws(() => readRegularFixture(root, 'case/fifo'), /regular file/);
  }
});
