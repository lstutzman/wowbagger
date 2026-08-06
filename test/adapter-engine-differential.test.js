import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAdapterManifest, isSafeRelativeExecutable } from '../src/adapter/manifest.js';

const BASE_MANIFEST = {
  adapter_manifest_version: 1,
  adapter_id: 'example.reference',
  adapter_version: '1.0.0',
  adapter_contract_versions: [1],
  bootstrap_wire_version: 1,
  required_core_contract_version: 1,
  entrypoints: {
    describe: { kind: 'command', executable: 'bin/adapter', fixed_args: ['describe'] },
    invoke: { kind: 'command', executable: 'bin/adapter', fixed_args: ['invoke'] },
  },
  platforms: { darwin: 'unverified', linux: 'unverified', win32: 'unverified' },
};

test('refuses a manifest carrying an unknown root member', () => {
  const result = validateAdapterManifest({ ...BASE_MANIFEST, extra: true });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-adapter-manifest');
});

test('refuses a manifest missing a required root member', () => {
  const { adapter_manifest_version, ...incomplete } = BASE_MANIFEST;

  const result = validateAdapterManifest(incomplete);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-adapter-manifest');
});

test('refuses a manifest that is not an object', () => {
  const result = validateAdapterManifest(null);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-adapter-manifest');
});

test('refuses an array as manifest', () => {
  const result = validateAdapterManifest([]);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-adapter-manifest');
});

test('refuses a string as manifest', () => {
  const result = validateAdapterManifest('not an object');

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-adapter-manifest');
});

test('refuses a number as manifest', () => {
  const result = validateAdapterManifest(42);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-adapter-manifest');
});

test('refuses every unsafe executable path form on every platform', () => {
  const unsafe = [
    '/absolute/adapter', 'C:/adapter', 'C:\\adapter', 'C:adapter',
    '\\\\server\\share\\adapter', '//server/share/adapter',
    '\\\\.\\device\\adapter', '//./device/adapter', '//?/volume/adapter',
    'bin\\adapter', 'bin//adapter', './bin/adapter', '../bin/adapter',
    'bin/adapter\u0000', '',
  ];

  for (const value of unsafe) {
    assert.equal(isSafeRelativeExecutable(value), false, value);
  }
  assert.equal(isSafeRelativeExecutable('bin/adapter'), true);
});
