import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateAdapterManifest, isSafeRelativeExecutable } from '../src/adapter/manifest.js';
import { resolveEntrypointPath } from '../src/adapter/entrypoint-path.js';

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

// Entrypoint path resolution tests (no-follow walk with stable-identity recheck)

function snapshotSet({ root, bin, adapter }) {
  return {
    '.': { kind: 'directory', identity: root },
    bin: { kind: 'directory', identity: bin },
    'bin/adapter': { kind: 'regular-file', identity: adapter },
  };
}

test('refuses an entrypoint whose component identity changes before launch', () => {
  const before = snapshotSet({ root: 'package-1', bin: 'bin-1', adapter: 'adapter-1' });
  const after = snapshotSet({ root: 'package-1', bin: 'bin-1', adapter: 'adapter-2' });

  const result = resolveEntrypointPath({
    package_root: '/installed/adapter',
    executable: 'bin/adapter',
    before,
    after,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'path-replaced');
});

test('resolves an entrypoint whose components are stable between snapshots', () => {
  const before = snapshotSet({ root: 'package-1', bin: 'bin-1', adapter: 'adapter-1' });
  const after = snapshotSet({ root: 'package-1', bin: 'bin-1', adapter: 'adapter-1' });

  const result = resolveEntrypointPath({
    package_root: '/installed/adapter',
    executable: 'bin/adapter',
    before,
    after,
  });

  assert.equal(result.ok, true);
  assert.equal(result.path, '/installed/adapter/bin/adapter');
});

test('refuses an empty package_root', () => {
  const before = snapshotSet({ root: 'package-1', bin: 'bin-1', adapter: 'adapter-1' });

  const result = resolveEntrypointPath({
    package_root: '',
    executable: 'bin/adapter',
    before,
    after: before,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'path-rejected');
});

test('refuses when before or after snapshots are not an object map', () => {
  const before = snapshotSet({ root: 'package-1', bin: 'bin-1', adapter: 'adapter-1' });

  const result = resolveEntrypointPath({
    package_root: '/installed/adapter',
    executable: 'bin/adapter',
    before: null,
    after: before,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'path-rejected');
});

test('refuses an unsafe executable path even when matching snapshots exist for it', () => {
  // The snapshot keys deliberately mirror the (unsafe) executable string's
  // own component split, so the only thing that can reject this request is
  // the executable-syntax check itself, not a missing/mismatched lookup.
  const before = {
    '.': { kind: 'directory', identity: 'package-1' },
    '': { kind: 'directory', identity: 'parent-1' },
    '/adapter': { kind: 'regular-file', identity: 'adapter-1' },
  };

  const result = resolveEntrypointPath({
    package_root: '/installed/adapter',
    executable: '/adapter',
    before,
    after: before,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'path-rejected');
});

test('refuses a component whose portable kind does not match a link position', () => {
  const before = snapshotSet({ root: 'package-1', bin: 'bin-1', adapter: 'adapter-1' });
  before.bin = { kind: 'symbolic-link', identity: 'bin-link' };
  const after = structuredClone(before);

  const result = resolveEntrypointPath({
    package_root: '/installed/adapter',
    executable: 'bin/adapter',
    before,
    after,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'path-rejected');
});

test('refuses a snapshot missing an identity', () => {
  const before = snapshotSet({ root: 'package-1', bin: 'bin-1', adapter: 'adapter-1' });
  delete before['bin/adapter'].identity;
  const after = snapshotSet({ root: 'package-1', bin: 'bin-1', adapter: 'adapter-1' });

  const result = resolveEntrypointPath({
    package_root: '/installed/adapter',
    executable: 'bin/adapter',
    before,
    after,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'path-rejected');
});

test('refuses a snapshot with a malformed identity object', () => {
  const before = snapshotSet({ root: 'package-1', bin: 'bin-1', adapter: 'adapter-1' });
  before['.'].identity = { volume_id: 'volume-only' };
  const after = snapshotSet({ root: 'package-1', bin: 'bin-1', adapter: 'adapter-1' });

  const result = resolveEntrypointPath({
    package_root: '/installed/adapter',
    executable: 'bin/adapter',
    before,
    after,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'path-rejected');
});

test('refuses a snapshot with an extra member', () => {
  const before = snapshotSet({ root: 'package-1', bin: 'bin-1', adapter: 'adapter-1' });
  before['.'].extra = true;
  const after = snapshotSet({ root: 'package-1', bin: 'bin-1', adapter: 'adapter-1' });

  const result = resolveEntrypointPath({
    package_root: '/installed/adapter',
    executable: 'bin/adapter',
    before,
    after,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'path-rejected');
});

test('refuses when a required component snapshot is missing entirely', () => {
  const before = snapshotSet({ root: 'package-1', bin: 'bin-1', adapter: 'adapter-1' });
  delete before.bin;
  const after = snapshotSet({ root: 'package-1', bin: 'bin-1', adapter: 'adapter-1' });

  const result = resolveEntrypointPath({
    package_root: '/installed/adapter',
    executable: 'bin/adapter',
    before,
    after,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'path-rejected');
});

test('resolves a nested executable through every cumulative parent component', () => {
  const before = {
    '.': { kind: 'directory', identity: 'package-1' },
    a: { kind: 'directory', identity: 'a-1' },
    'a/b': { kind: 'directory', identity: 'b-1' },
    'a/b/adapter': { kind: 'regular-file', identity: 'adapter-1' },
  };
  const after = structuredClone(before);

  const result = resolveEntrypointPath({
    package_root: '/installed/adapter',
    executable: 'a/b/adapter',
    before,
    after,
  });

  assert.equal(result.ok, true);
  assert.equal(result.path, '/installed/adapter/a/b/adapter');
});

test('entrypoint resolution matches the reference oracle on every fixture case', async () => {
  const { resolveEntrypointPath: referenceResolve } = await import('../spec/adapter-reference.js');
  const scenarios = JSON.parse(
    await readFile('spec/fixtures/adapters/13-negotiation-mismatch/scenarios.json', 'utf8'),
  );

  for (const input of scenarios.entrypoint_paths) {
    const expected = input.expected;
    const mine = resolveEntrypointPath(structuredClone(input));
    const theirs = referenceResolve(structuredClone(input));
    assert.equal(mine.ok, theirs.ok, input.id);
    assert.equal(mine.ok, false, input.id);
    assert.equal(mine.error_code, expected, input.id);
    assert.equal(mine.error_code, theirs.error?.code, input.id);
  }
});
