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

// Entrypoint validation tests for manifest
test('refuses manifest when describe entrypoint is null', () => {
  const bad = structuredClone(BASE_MANIFEST);
  bad.entrypoints.describe = null;

  const result = validateAdapterManifest(bad);

  assert.equal(result.ok, false, 'entrypoint not an object: null');
  assert.equal(result.error_code, 'invalid-adapter-manifest');
});

test('refuses manifest when describe entrypoint is not an object', () => {
  const bad = structuredClone(BASE_MANIFEST);
  bad.entrypoints.describe = 'not an object';

  const result = validateAdapterManifest(bad);

  assert.equal(result.ok, false, 'entrypoint not an object: string');
  assert.equal(result.error_code, 'invalid-adapter-manifest');
});

test('refuses manifest when describe entrypoint is an array', () => {
  const bad = structuredClone(BASE_MANIFEST);
  bad.entrypoints.describe = [];

  const result = validateAdapterManifest(bad);

  assert.equal(result.ok, false, 'entrypoint not an object: array');
  assert.equal(result.error_code, 'invalid-adapter-manifest');
});

test('refuses manifest when host-tool has unknown member', () => {
  const bad = structuredClone(BASE_MANIFEST);
  bad.entrypoints.describe = { kind: 'host-tool', name: 'my-tool', extra: 'member' };

  const result = validateAdapterManifest(bad);

  assert.equal(result.ok, false, 'host-tool schema not exact: extra member');
  assert.equal(result.error_code, 'invalid-adapter-manifest');
});

test('refuses manifest when host-tool is missing name', () => {
  const bad = structuredClone(BASE_MANIFEST);
  bad.entrypoints.describe = { kind: 'host-tool' };

  const result = validateAdapterManifest(bad);

  assert.equal(result.ok, false, 'host-tool schema not exact: missing name');
  assert.equal(result.error_code, 'invalid-adapter-manifest');
});

test('refuses manifest when host-tool name is empty string', () => {
  const bad = structuredClone(BASE_MANIFEST);
  bad.entrypoints.describe = { kind: 'host-tool', name: '' };

  const result = validateAdapterManifest(bad);

  assert.equal(result.ok, false, 'host-tool name empty');
  assert.equal(result.error_code, 'invalid-adapter-manifest');
});

test('refuses manifest when host-tool name is not a string', () => {
  const bad = structuredClone(BASE_MANIFEST);
  bad.entrypoints.describe = { kind: 'host-tool', name: 42 };

  const result = validateAdapterManifest(bad);

  assert.equal(result.ok, false, 'host-tool name non-string');
  assert.equal(result.error_code, 'invalid-adapter-manifest');
});

test('refuses manifest when entrypoint kind is unknown', () => {
  const bad = structuredClone(BASE_MANIFEST);
  bad.entrypoints.describe = { kind: 'unknown', executable: 'bin/x', fixed_args: [] };

  const result = validateAdapterManifest(bad);

  assert.equal(result.ok, false, 'unknown entrypoint kind');
  assert.equal(result.error_code, 'invalid-adapter-manifest');
});

test('refuses manifest when command has unknown member', () => {
  const bad = structuredClone(BASE_MANIFEST);
  bad.entrypoints.describe = { kind: 'command', executable: 'bin/adapter', fixed_args: ['x'], extra: true };

  const result = validateAdapterManifest(bad);

  assert.equal(result.ok, false, 'command schema not exact: extra member');
  assert.equal(result.error_code, 'invalid-adapter-manifest');
});

test('refuses manifest when command is missing executable', () => {
  const bad = structuredClone(BASE_MANIFEST);
  bad.entrypoints.describe = { kind: 'command', fixed_args: ['x'] };

  const result = validateAdapterManifest(bad);

  assert.equal(result.ok, false, 'command schema not exact: missing executable');
  assert.equal(result.error_code, 'invalid-adapter-manifest');
});

test('refuses manifest when command executable is unsafe', () => {
  const bad = structuredClone(BASE_MANIFEST);
  bad.entrypoints.describe = { kind: 'command', executable: '/absolute/path', fixed_args: [] };

  const result = validateAdapterManifest(bad);

  assert.equal(result.ok, false, 'unsafe executable');
  assert.equal(result.error_code, 'invalid-adapter-manifest');
});

test('refuses manifest when command fixed_args is not an array', () => {
  const bad = structuredClone(BASE_MANIFEST);
  bad.entrypoints.describe = { kind: 'command', executable: 'bin/x', fixed_args: 'not-array' };

  const result = validateAdapterManifest(bad);

  assert.equal(result.ok, false, 'fixed_args not an array');
  assert.equal(result.error_code, 'invalid-adapter-manifest');
});

test('refuses manifest when command fixed_args contains non-string', () => {
  const bad = structuredClone(BASE_MANIFEST);
  bad.entrypoints.describe = { kind: 'command', executable: 'bin/x', fixed_args: ['arg', 42] };

  const result = validateAdapterManifest(bad);

  assert.equal(result.ok, false, 'fixed_args has non-string');
  assert.equal(result.error_code, 'invalid-adapter-manifest');
});

test('refuses manifest when command fixed_args contains control character', () => {
  const bad = structuredClone(BASE_MANIFEST);
  bad.entrypoints.describe = { kind: 'command', executable: 'bin/x', fixed_args: ['arg\u0000'] };

  const result = validateAdapterManifest(bad);

  assert.equal(result.ok, false, 'fixed_args has control character');
  assert.equal(result.error_code, 'invalid-adapter-manifest');
});

test('accepts valid manifest with command entrypoints', () => {
  const result = validateAdapterManifest(BASE_MANIFEST);

  assert.equal(result.ok, true);
  assert.deepEqual(result.manifest, BASE_MANIFEST);
});

test('accepts valid manifest with host-tool entrypoint', () => {
  const good = structuredClone(BASE_MANIFEST);
  good.entrypoints.describe = { kind: 'host-tool', name: 'my-describe-tool' };
  good.entrypoints.invoke = { kind: 'host-tool', name: 'my-invoke-tool' };

  const result = validateAdapterManifest(good);

  assert.equal(result.ok, true);
  assert.deepEqual(result.manifest, good);
});

test('accepts valid manifest with mixed host-tool and command entrypoints', () => {
  const good = structuredClone(BASE_MANIFEST);
  good.entrypoints.describe = { kind: 'host-tool', name: 'my-describe-tool' };
  good.entrypoints.invoke = { kind: 'command', executable: 'bin/invoke', fixed_args: ['invoke'] };

  const result = validateAdapterManifest(good);

  assert.equal(result.ok, true);
  assert.deepEqual(result.manifest, good);
});
