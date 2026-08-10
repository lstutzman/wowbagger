import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runCli } from './support.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));

test('the npm package is public and installable under the wowbagger name', () => {
  assert.equal(manifest.name, 'wowbagger');
  assert.notEqual(manifest.private, true, 'a public distribution must not be private');
  assert.equal(manifest.bin.wowbagger, './bin/wowbagger.js');
  assert.ok(manifest.files.includes('bin'), 'bin must ship');
  assert.ok(manifest.files.includes('src'), 'src must ship');
  assert.equal(typeof manifest.dependencies.yaml, 'string', 'yaml runtime dependency required');
});

test('the published binary prints the distribution version', () => {
  const result = runCli('--version');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `${manifest.version}\n`);
});

test('a broken package cannot ship: prepublishOnly refuses a failed validation', () => {
  assert.ok(manifest.scripts.prepublishOnly, 'prepublishOnly guard must exist');
  assert.match(manifest.scripts.prepublishOnly, /validate --ledger ledger --json/);
});

test('the package manifest does not admit unpublished or internal directories', () => {
  for (const forbidden of ['test', 'spec', 'ledger', 'docs', '.claude']) {
    assert.ok(!manifest.files.includes(forbidden), `files must not include ${forbidden}`);
  }
  assert.ok(!manifest.private, 'no private flag');
});
