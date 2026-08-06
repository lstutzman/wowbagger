import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateAdapterManifest, isSafeRelativeExecutable } from '../src/adapter/manifest.js';
import { resolveEntrypointPath } from '../src/adapter/entrypoint-path.js';
import { describeAdapter } from '../src/adapter/describe.js';
import { coreCapabilities, verifyCoreProbe } from '../src/adapter/core-probe.js';
import { sameJson } from '../src/adapter/schema-helpers.js';
import {
  describeAdapter as referenceDescribe,
  referenceCoreCapabilities,
  verifyCoreProbe as referenceVerifyCoreProbe,
} from '../spec/adapter-reference.js';

const SCENARIOS = JSON.parse(
  await readFile('spec/fixtures/adapters/13-negotiation-mismatch/scenarios.json', 'utf8'),
);

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

test('refuses a manifest whose entrypoints map carries an unknown member', () => {
  const bad = structuredClone(BASE_MANIFEST);
  bad.entrypoints.extra = { kind: 'host-tool', name: 'extra-tool' };

  const result = validateAdapterManifest(bad);

  assert.equal(result.ok, false, 'entrypoints has an unknown member');
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

// An opaque identity token must be a nonempty control-free string. The
// accepted range is U+0020 through U+007E inclusive; U+001F and U+007F are
// both outside it. Both edges are pinned so the boundary cannot drift: this
// is the same predicate src/adapter/manifest.js applies to `executable` and
// `fixed_args`, so a boundary shift there would surface here too.
for (const { name, identity, accepted } of [
  { name: 'U+001F', identity: 'adapter\u001f1', accepted: false },
  { name: 'U+0020', identity: 'adapter 1', accepted: true },
  { name: 'U+007E', identity: 'adapter~1', accepted: true },
  { name: 'U+007F', identity: 'adapter\u007f1', accepted: false },
]) {
  test(`${accepted ? 'accepts' : 'refuses'} an identity token containing ${name}`, () => {
    const snapshots = snapshotSet({ root: 'package-1', bin: 'bin-1', adapter: identity });

    const result = resolveEntrypointPath({
      package_root: '/installed/adapter',
      executable: 'bin/adapter',
      before: snapshots,
      after: snapshots,
    });

    assert.equal(result.ok, accepted);
    if (!accepted) {
      assert.equal(result.error_code, 'path-rejected');
    }
  });
}

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

test('refuses a non-string package_root', () => {
  const before = snapshotSet({ root: 'package-1', bin: 'bin-1', adapter: 'adapter-1' });

  const result = resolveEntrypointPath({
    package_root: 42,
    executable: 'bin/adapter',
    before,
    after: before,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'path-rejected');
});

test('refuses when after snapshots are not an object map', () => {
  const before = snapshotSet({ root: 'package-1', bin: 'bin-1', adapter: 'adapter-1' });

  const result = resolveEntrypointPath({
    package_root: '/installed/adapter',
    executable: 'bin/adapter',
    before,
    after: null,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'path-rejected');
});

test('refuses a snapshot with a null identity', () => {
  const before = snapshotSet({ root: 'package-1', bin: 'bin-1', adapter: 'adapter-1' });
  before['bin/adapter'].identity = null;
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

test('refuses a snapshot with an array identity', () => {
  const before = snapshotSet({ root: 'package-1', bin: 'bin-1', adapter: 'adapter-1' });
  before['bin/adapter'].identity = ['adapter-1'];
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

test('resolves an entrypoint whose final identity is a matching {dev, ino} object', () => {
  const before = snapshotSet({ root: 'package-1', bin: 'bin-1', adapter: { dev: 1, ino: 12 } });
  const after = snapshotSet({ root: 'package-1', bin: 'bin-1', adapter: { dev: 1, ino: 12 } });

  const result = resolveEntrypointPath({
    package_root: '/installed/adapter',
    executable: 'bin/adapter',
    before,
    after,
  });

  assert.equal(result.ok, true);
  assert.equal(result.path, '/installed/adapter/bin/adapter');
});

test('refuses a {dev, ino} identity that differs between snapshots', () => {
  const before = snapshotSet({ root: 'package-1', bin: 'bin-1', adapter: { dev: 1, ino: 12 } });
  const after = snapshotSet({ root: 'package-1', bin: 'bin-1', adapter: { dev: 1, ino: 99 } });

  const result = resolveEntrypointPath({
    package_root: '/installed/adapter',
    executable: 'bin/adapter',
    before,
    after,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'path-replaced');
});

test('refuses a malformed {dev, ino} identity', () => {
  const before = snapshotSet({ root: 'package-1', bin: 'bin-1', adapter: { dev: 1, ino: -1 } });
  const after = snapshotSet({ root: 'package-1', bin: 'bin-1', adapter: { dev: 1, ino: -1 } });

  const result = resolveEntrypointPath({
    package_root: '/installed/adapter',
    executable: 'bin/adapter',
    before,
    after,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'path-rejected');
});

test('refuses a {volume_id, file_id} identity that differs between snapshots', () => {
  const before = snapshotSet({
    root: 'package-1', bin: 'bin-1', adapter: { volume_id: 'vol-1', file_id: 'file-1' },
  });
  const after = snapshotSet({
    root: 'package-1', bin: 'bin-1', adapter: { volume_id: 'vol-1', file_id: 'file-2' },
  });

  const result = resolveEntrypointPath({
    package_root: '/installed/adapter',
    executable: 'bin/adapter',
    before,
    after,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'path-replaced');
});

test('refuses a malformed {volume_id, file_id} identity', () => {
  const before = snapshotSet({
    root: 'package-1', bin: 'bin-1', adapter: { volume_id: 'vol-1', file_id: '' },
  });
  const after = snapshotSet({
    root: 'package-1', bin: 'bin-1', adapter: { volume_id: 'vol-1', file_id: '' },
  });

  const result = resolveEntrypointPath({
    package_root: '/installed/adapter',
    executable: 'bin/adapter',
    before,
    after,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'path-rejected');
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

// ---- Task 6: describeAdapter and verifyCoreProbe ----

test('describeAdapter accepts a fully valid describe request', () => {
  const result = describeAdapter(
    structuredClone(SCENARIOS.base_request),
    structuredClone(SCENARIOS.base_manifest),
    structuredClone(SCENARIOS.base_dynamic),
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.result, SCENARIOS.base_dynamic);
});

test('verifyCoreProbe accepts the engine\'s own core capability snapshot against the base describe result', () => {
  const result = verifyCoreProbe(structuredClone(SCENARIOS.base_dynamic), coreCapabilities());

  assert.equal(result.ok, true);
});

test('refuses a describe result advertising command execution with a shell', () => {
  const dynamic = structuredClone(SCENARIOS.base_dynamic);
  dynamic.host.command_execution.shell = true;

  const result = describeAdapter(SCENARIOS.base_request, SCENARIOS.base_manifest, dynamic);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-describe-result');
});

// These field-level schema checks are shadowed by later cross-field
// invariant and identity/version checks under every scenario in
// SCENARIOS.cases and SCENARIOS.core_probe_cases (e.g. a describe result
// otherwise valid but for one wrong-typed field is rare in that fixture
// set). Each covers exactly one `describeAdapter`/`verifyCoreProbe`
// condition the negotiation-scenario sweep never isolates on its own.

test('refuses a describe request whose bootstrap_wire_version is not a positive integer', () => {
  const request = { ...structuredClone(SCENARIOS.base_request), bootstrap_wire_version: 0 };

  const result = describeAdapter(request, SCENARIOS.base_manifest, SCENARIOS.base_dynamic);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-describe-request');
});

test('refuses a describe request whose request_id fails the safe opaque-ID syntax', () => {
  const request = { ...structuredClone(SCENARIOS.base_request), request_id: 'has a space' };

  const result = describeAdapter(request, SCENARIOS.base_manifest, SCENARIOS.base_dynamic);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-describe-request');
});

test('refuses a manifest whose adapter_manifest_version is not exactly 1', () => {
  const manifest = { ...structuredClone(SCENARIOS.base_manifest), adapter_manifest_version: 2 };

  const result = describeAdapter(SCENARIOS.base_request, manifest, SCENARIOS.base_dynamic);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-adapter-manifest');
});

test('refuses a manifest with a non-string adapter_id', () => {
  const manifest = { ...structuredClone(SCENARIOS.base_manifest), adapter_id: '' };

  const result = describeAdapter(SCENARIOS.base_request, manifest, SCENARIOS.base_dynamic);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-adapter-manifest');
});

test('refuses a manifest with an empty adapter_version', () => {
  const manifest = { ...structuredClone(SCENARIOS.base_manifest), adapter_version: '' };

  const result = describeAdapter(SCENARIOS.base_request, manifest, SCENARIOS.base_dynamic);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-adapter-manifest');
});

test('refuses a manifest whose bootstrap_wire_version is not exactly 1', () => {
  const manifest = { ...structuredClone(SCENARIOS.base_manifest), bootstrap_wire_version: 2 };

  const result = describeAdapter(SCENARIOS.base_request, manifest, SCENARIOS.base_dynamic);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-adapter-manifest');
});

test('refuses a manifest whose required_core_contract_version is not a positive integer', () => {
  const manifest = { ...structuredClone(SCENARIOS.base_manifest), required_core_contract_version: 0 };

  const result = describeAdapter(SCENARIOS.base_request, manifest, SCENARIOS.base_dynamic);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-adapter-manifest');
});

test('refuses a manifest with an incomplete platform map', () => {
  const manifest = structuredClone(SCENARIOS.base_manifest);
  delete manifest.platforms.win32;

  const result = describeAdapter(SCENARIOS.base_request, manifest, SCENARIOS.base_dynamic);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-adapter-manifest');
});

test('refuses a describe result whose ok member is not true', () => {
  const dynamic = { ...structuredClone(SCENARIOS.base_dynamic), ok: false };

  const result = describeAdapter(SCENARIOS.base_request, SCENARIOS.base_manifest, dynamic);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-describe-result');
});

test('refuses a describe result whose bootstrap_wire_version is not exactly 1', () => {
  const dynamic = { ...structuredClone(SCENARIOS.base_dynamic), bootstrap_wire_version: 2 };

  const result = describeAdapter(SCENARIOS.base_request, SCENARIOS.base_manifest, dynamic);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-describe-result');
});

test('refuses a describe result with an empty adapter_id', () => {
  const dynamic = { ...structuredClone(SCENARIOS.base_dynamic), adapter_id: '' };

  const result = describeAdapter(SCENARIOS.base_request, SCENARIOS.base_manifest, dynamic);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-describe-result');
});

test('refuses a describe result with an empty adapter_version', () => {
  const dynamic = { ...structuredClone(SCENARIOS.base_dynamic), adapter_version: '' };

  const result = describeAdapter(SCENARIOS.base_request, SCENARIOS.base_manifest, dynamic);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-describe-result');
});

test('refuses a describe result whose core section carries an unknown member', () => {
  const dynamic = structuredClone(SCENARIOS.base_dynamic);
  dynamic.core.extra = true;

  const result = describeAdapter(SCENARIOS.base_request, SCENARIOS.base_manifest, dynamic);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-describe-result');
});

// A malformed required_core_contract_version is a schema issue, not a
// mismatch: it must be rejected before it ever reaches the
// required-core-contract-version-mismatch cross-check.
test('refuses a describe result whose required_core_contract_version is not a positive integer', () => {
  const dynamic = structuredClone(SCENARIOS.base_dynamic);
  dynamic.core.required_core_contract_version = 0;

  const result = describeAdapter(SCENARIOS.base_request, SCENARIOS.base_manifest, dynamic);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-describe-result');
});

test('refuses a describe result whose core.commands contains an unknown command', () => {
  const dynamic = structuredClone(SCENARIOS.base_dynamic);
  dynamic.core.commands = ['unknown-command'];

  const result = describeAdapter(SCENARIOS.base_request, SCENARIOS.base_manifest, dynamic);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-describe-result');
});

test('refuses a describe result whose command_execution carries an unknown member', () => {
  const dynamic = structuredClone(SCENARIOS.base_dynamic);
  dynamic.host.command_execution.extra = true;

  const result = describeAdapter(SCENARIOS.base_request, SCENARIOS.base_manifest, dynamic);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-describe-result');
});

test('refuses a describe result whose command_execution.supported is not a boolean', () => {
  const dynamic = structuredClone(SCENARIOS.base_dynamic);
  dynamic.host.command_execution.supported = 'yes';

  const result = describeAdapter(SCENARIOS.base_request, SCENARIOS.base_manifest, dynamic);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-describe-result');
});

// The three filesystem proof flags are set to `false`, matching what the
// §3.2 invariant would already require for any non-"guarded-relative"
// value, so only the plain enum-membership schema check can catch this.
test('refuses a describe result whose filesystem.workspace_selection is an unknown enum value', () => {
  const dynamic = structuredClone(SCENARIOS.base_dynamic);
  dynamic.host.filesystem.workspace_selection = 'weird';
  dynamic.host.filesystem.no_follow_resolution = false;
  dynamic.host.filesystem.stable_identity = false;
  dynamic.host.filesystem.component_walk = false;

  const result = describeAdapter(SCENARIOS.base_request, SCENARIOS.base_manifest, dynamic);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-describe-result');
});

test('refuses a describe result with an empty model_transport.protocol', () => {
  const dynamic = structuredClone(SCENARIOS.base_dynamic);
  dynamic.host.model_transport.protocol = '';

  const result = describeAdapter(SCENARIOS.base_request, SCENARIOS.base_manifest, dynamic);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-describe-result');
});

test('refuses a describe result whose instruction_input.mode is an unknown enum value', () => {
  const dynamic = structuredClone(SCENARIOS.base_dynamic);
  dynamic.host.instruction_input.mode = 'weird';

  const result = describeAdapter(SCENARIOS.base_request, SCENARIOS.base_manifest, dynamic);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-describe-result');
});

test('refuses a describe result whose handoff.persistence is not exactly explicit-only', () => {
  const dynamic = structuredClone(SCENARIOS.base_dynamic);
  dynamic.host.handoff.persistence = 'weird';

  const result = describeAdapter(SCENARIOS.base_request, SCENARIOS.base_manifest, dynamic);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-describe-result');
});

test('refuses a describe result whose integration_mechanisms member is not a boolean', () => {
  const dynamic = structuredClone(SCENARIOS.base_dynamic);
  dynamic.host.integration_mechanisms.hooks = 'no';

  const result = describeAdapter(SCENARIOS.base_request, SCENARIOS.base_manifest, dynamic);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-describe-result');
});

test('refuses a describe result whose optional_features member is not a boolean', () => {
  const dynamic = structuredClone(SCENARIOS.base_dynamic);
  dynamic.optional_features.claims = 'no';

  const result = describeAdapter(SCENARIOS.base_request, SCENARIOS.base_manifest, dynamic);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-describe-result');
});

// Builds a dynamic describe result whose command-execution capabilities are
// self-consistently "unsupported", so the §3.2 execution-invariant check
// (which only inspects limits when `supported: true`) cannot itself catch a
// malformed limit — isolating the plain schema check on `limits`.
function unsupportedExecutionDynamic() {
  const dynamic = structuredClone(SCENARIOS.base_dynamic);
  const execution = dynamic.host.command_execution;
  execution.supported = false;
  execution.shell = false;
  for (const flag of [
    'arguments_array', 'stdio', 'process_tree_containment', 'orphan_detection',
    'timeout_enforcement', 'stdout_limit', 'stderr_limit',
  ]) {
    execution[flag] = false;
  }
  dynamic.core.commands = [];
  return dynamic;
}

test('refuses a describe result with a non-positive max_timeout_ms even when execution is unsupported', () => {
  const dynamic = unsupportedExecutionDynamic();
  dynamic.limits.max_timeout_ms = 0;

  const result = describeAdapter(SCENARIOS.base_request, SCENARIOS.base_manifest, dynamic);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-describe-result');
});

test('refuses a describe result with a negative byte limit even when execution is unsupported', () => {
  const dynamic = unsupportedExecutionDynamic();
  dynamic.limits.max_request_bytes = -1;

  const result = describeAdapter(SCENARIOS.base_request, SCENARIOS.base_manifest, dynamic);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-describe-result');
});

test('verifyCoreProbe refuses a probe whose ok member is not true', () => {
  const probe = { ...coreCapabilities(), ok: false };

  const result = verifyCoreProbe(structuredClone(SCENARIOS.base_dynamic), probe);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'core-protocol-error');
});

// A protocol-version-2 probe is a schema issue (this engine only speaks
// core contract version 1) even when its number happens to equal the
// describe result's required core contract version.
test('verifyCoreProbe refuses a probe with a contract_version other than 1', () => {
  const describe = structuredClone(SCENARIOS.base_dynamic);
  describe.core.required_core_contract_version = 2;
  const probe = { ...coreCapabilities(), contract_version: 2 };

  const result = verifyCoreProbe(describe, probe);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'core-protocol-error');
});

test('verifyCoreProbe refuses a probe result with an unknown member', () => {
  const probe = coreCapabilities();
  probe.result.extra = true;

  const result = verifyCoreProbe(structuredClone(SCENARIOS.base_dynamic), probe);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'core-protocol-error');
});

// verifyCoreProbe accepts an arbitrary already-validated describe object
// (e.g. the hand-built one in the required-core-version scenario, or a
// caller's own partial describe result); a malformed core.commands member
// must be a clean refusal, not an uncaught TypeError from indexing into it.
test('verifyCoreProbe refuses (does not throw) when describe.core.commands is null', () => {
  const describe = structuredClone(SCENARIOS.base_dynamic);
  describe.core.commands = null;

  const result = verifyCoreProbe(describe, coreCapabilities());

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'core-contract-version-mismatch');
});

test('verifyCoreProbe refuses (does not throw) when describe.core.commands is absent', () => {
  const describe = structuredClone(SCENARIOS.base_dynamic);
  delete describe.core.commands;

  const result = verifyCoreProbe(describe, coreCapabilities());

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'core-contract-version-mismatch');
});

test('refuses a describe request whose supported_adapter_contract_versions is not sorted ascending', () => {
  const request = { ...structuredClone(SCENARIOS.base_request), supported_adapter_contract_versions: [2, 1] };

  const result = describeAdapter(request, SCENARIOS.base_manifest, SCENARIOS.base_dynamic);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-describe-request');
});

test('refuses a describe result whose core.commands is out of the required order', () => {
  const dynamic = structuredClone(SCENARIOS.base_dynamic);
  dynamic.core.commands = ['create', 'capabilities', 'inspect', 'ready', 'transition', 'validate'];

  const result = describeAdapter(SCENARIOS.base_request, SCENARIOS.base_manifest, dynamic);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-describe-result');
});

// Contract section 3.2: "Command arrays are unique, ordered subsets". The
// refusal below is pinned as behaviour, not as a route to one line of
// isCommandArray. That function's explicit uniqueness check
// (`new Set(value).size === value.length`) is unreachable today: the same
// loop already requires each command's position in CORE_COMMAND_ORDER to
// strictly increase between adjacent elements, and a strictly increasing
// index sequence cannot repeat a value, so no input distinguishes that
// return from an unconditional `true`. Relaxing the ordering comparison from
// `>=` to `>` would silently make it load-bearing — which is exactly why the
// refusal itself needs a test, and why the check stays.
test('refuses a describe result whose core.commands repeats a command', () => {
  const dynamic = structuredClone(SCENARIOS.base_dynamic);
  dynamic.core.commands = ['capabilities', 'capabilities', 'create', 'inspect', 'ready', 'transition', 'validate'];

  const result = describeAdapter(SCENARIOS.base_request, SCENARIOS.base_manifest, dynamic);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-describe-result');
});

// A required object member's absence is caught by the corresponding
// downstream value check whenever that check would reject `undefined` — but
// `isAllBoolean` (`Object.values(value).every(...)`) only iterates over
// whatever keys are actually present, so deleting one member of an
// all-boolean object entirely is invisible to it. Only `hasExactMembers`'s
// required-key-presence check catches this.
test('refuses a describe result whose integration_mechanisms is missing a required member', () => {
  const dynamic = structuredClone(SCENARIOS.base_dynamic);
  delete dynamic.host.integration_mechanisms.daemon;

  const result = describeAdapter(SCENARIOS.base_request, SCENARIOS.base_manifest, dynamic);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-describe-result');
});

// `command_execution.supported` is only ever compared with `=== true` (to
// pick a branch) by the §3.2 invariant, which otherwise only re-inspects the
// seven dependent flags and `core.commands` — never `supported` itself. A
// non-boolean `supported` value that is otherwise consistent with the
// "unsupported" invariant (all dependent flags false, no advertised
// commands) is therefore only caught by the schema-level `isAllBoolean`
// check on `command_execution`.
test(
  'refuses a describe result whose command_execution.supported is a non-boolean satisfying the unsupported invariant',
  () => {
    const dynamic = unsupportedExecutionDynamic();
    dynamic.host.command_execution.supported = 'false';

    const result = describeAdapter(SCENARIOS.base_request, SCENARIOS.base_manifest, dynamic);

    assert.equal(result.ok, false);
    assert.equal(result.error_code, 'invalid-describe-result');
  },
);

// The three git-coordination-dependent probe members
// (`backend.coordination_scope`, `operations.work_claim.supported`,
// `limits.cross_worktree_coordination`) must all agree; a probe can
// contradict via either of the latter two independently.
test('verifyCoreProbe refuses a probe whose cross_worktree_coordination contradicts the coordination scope', () => {
  const probe = coreCapabilities();
  probe.result.limits.cross_worktree_coordination = true;

  const result = verifyCoreProbe(structuredClone(SCENARIOS.base_dynamic), probe);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'core-protocol-error');
});

// Applies a `{ delete }` and/or `{ set: { path, value } }` fixture mutation
// to a scenario target object, following the same dotted-path convention as
// `spec/run-adapter-vectors.js`'s negotiation and core-probe cases.
function applyMutation(target, scenario) {
  if (scenario.delete) {
    const segments = scenario.delete.split('.');
    const parent = segments.slice(0, -1).reduce((value, key) => value[key], target);
    delete parent[segments.at(-1)];
  }
  if (scenario.set) {
    const segments = scenario.set.path.split('.');
    const parent = segments.slice(0, -1).reduce((value, key) => value[key], target);
    parent[segments.at(-1)] = scenario.set.value;
  }
}

// Applies a `capability_invariant` fixture directive: each mode flips one
// §3.2 cross-field invariant (command-execution, filesystem, or
// instruction-input) while keeping the rest of `dynamic` self-consistent.
function applyCapabilityInvariant(dynamic, invariant) {
  const command = dynamic.host.command_execution;
  const filesystem = dynamic.host.filesystem;
  const instruction = dynamic.host.instruction_input;
  const dependentCommandMembers = [
    'arguments_array', 'stdio', 'process_tree_containment', 'orphan_detection',
    'timeout_enforcement', 'stdout_limit', 'stderr_limit',
  ];
  switch (invariant.mode) {
    case 'supported':
      command[invariant.member] = invariant.value;
      return;
    case 'limit':
      dynamic.limits[invariant.member] = 0;
      return;
    case 'guarded':
      filesystem[invariant.member] = false;
      return;
    case 'unsupported':
    case 'unsupported-invoke':
      command.supported = false;
      command.shell = false;
      for (const member of dependentCommandMembers) command[member] = false;
      dynamic.core.commands = [];
      if (invariant.mode === 'unsupported') command[invariant.member] = true;
      else dynamic.core.commands = ['capabilities'];
      return;
    case 'filesystem-none':
      filesystem.workspace_selection = 'none';
      filesystem.no_follow_resolution = false;
      filesystem.stable_identity = false;
      filesystem.component_walk = false;
      filesystem[invariant.member] = true;
      return;
    case 'instruction-none':
      instruction.mode = 'none';
      instruction.max_sources = 0;
      instruction.max_bytes = 0;
      instruction[invariant.member] = 1;
      return;
    case 'instruction-configured':
      instruction[invariant.member] = 0;
      return;
    default:
      throw new Error(`unknown capability invariant mode: ${invariant.mode}`);
  }
}

// Builds the (request, manifest, dynamic) triple for one `SCENARIOS.cases`
// entry, starting from independent deep clones of the fixture's base
// objects so mutating one scenario can never leak into the next.
function buildNegotiationInputs(scenario) {
  const request = { ...structuredClone(SCENARIOS.base_request), ...structuredClone(scenario.request ?? {}) };
  const manifest = { ...structuredClone(SCENARIOS.base_manifest), ...structuredClone(scenario.manifest ?? {}) };
  const baseDynamic = structuredClone(SCENARIOS.base_dynamic);
  const dynamicOverride = structuredClone(scenario.dynamic ?? {});
  const dynamic = {
    ...baseDynamic,
    ...dynamicOverride,
    core: { ...baseDynamic.core, ...dynamicOverride.core },
    platforms: dynamicOverride.platforms ?? baseDynamic.platforms,
  };
  if (scenario.target) {
    const targets = { request, manifest, dynamic };
    applyMutation(targets[scenario.target], scenario);
  }
  if (scenario.capability_invariant) {
    applyCapabilityInvariant(dynamic, scenario.capability_invariant);
  }
  return { request, manifest, dynamic };
}

test('describeAdapter and verifyCoreProbe match the reference oracle on every negotiation scenario', async (t) => {
  for (const scenario of SCENARIOS.cases) {
    await t.test(scenario.id, () => {
      if (scenario.id === 'required-core-version') {
        // This fixture entry exercises verifyCoreProbe's required-core-version
        // cross-check rather than describeAdapter: it supplies an
        // already-negotiated describe result and a probed contract version
        // directly, with no request/manifest/dynamic to build.
        const describe = {
          core: {
            required_core_contract_version: scenario.required_core_contract_version,
            commands: ['capabilities', 'create', 'inspect', 'ready', 'transition', 'validate'],
          },
          optional_features: { claims: false, policy: false },
        };
        const mine = verifyCoreProbe(structuredClone(describe), coreCapabilities());
        const theirs = referenceVerifyCoreProbe(structuredClone(describe), referenceCoreCapabilities());
        assert.equal(mine.ok, theirs.ok, scenario.id);
        assert.equal(mine.ok, false, scenario.id);
        assert.equal(mine.error_code, scenario.expected, scenario.id);
        assert.equal(mine.error_code, theirs.error?.code, scenario.id);
        return;
      }

      const { request, manifest, dynamic } = buildNegotiationInputs(scenario);
      const mine = describeAdapter(structuredClone(request), structuredClone(manifest), structuredClone(dynamic));
      const theirs = referenceDescribe(structuredClone(request), structuredClone(manifest), structuredClone(dynamic));
      assert.equal(mine.ok, theirs.ok, scenario.id);
      assert.equal(mine.ok, false, scenario.id);
      assert.equal(mine.error_code, scenario.expected, scenario.id);
      assert.equal(mine.error_code, theirs.error?.code, scenario.id);
    });
  }
});

// JSON member order is not semantically significant (RFC 8259) and
// JSON.parse preserves the source order, so a manifest and a describe result
// can list the same platform map under different key orders over the wire.
// The oracle compares them canonically; the engine must not refuse them.
test('accepts a describe whose platform map is key-reordered against the manifest, as the oracle does', () => {
  const request = structuredClone(SCENARIOS.base_request);
  const manifest = structuredClone(SCENARIOS.base_manifest);
  const dynamic = structuredClone(SCENARIOS.base_dynamic);
  manifest.platforms = { darwin: 'unverified', linux: 'unverified', win32: 'unverified' };
  dynamic.platforms = { win32: 'unverified', linux: 'unverified', darwin: 'unverified' };
  assert.notEqual(
    JSON.stringify(manifest.platforms),
    JSON.stringify(dynamic.platforms),
    'the two maps must differ only in key order for this case to measure anything',
  );

  const mine = describeAdapter(structuredClone(request), structuredClone(manifest), structuredClone(dynamic));
  const theirs = referenceDescribe(structuredClone(request), structuredClone(manifest), structuredClone(dynamic));

  assert.equal(theirs.ok, true);
  assert.equal(mine.ok, true, mine.error_code);
  assert.equal(mine.ok, theirs.ok);
});

// sameJson's other two call sites compare arrays, where order IS
// significant: `[1, 2]` is not the same supported-version list as `[2, 1]`,
// and a reordered `trusted_approval.sources` is a different declaration.
// Canonicalising member order must not canonicalise element order too.
//
// Both of those comparands hold a single element today, so no describe input
// can distinguish an order-sensitive array comparison from an order-blind
// one. The property is pinned at the helper's own seam instead, where it
// stays pinned as soon as either list grows a second element.
test('sameJson treats array element order as significant', () => {
  assert.equal(sameJson([1, 2], [2, 1]), false);
  assert.equal(sameJson([1, 2], [1, 2]), true);
  assert.equal(sameJson(['consumer', 'host'], ['host', 'consumer']), false);
});

test('sameJson treats object member order as insignificant, at every depth', () => {
  assert.equal(sameJson({ a: 1, b: 2 }, { b: 2, a: 1 }), true);
  assert.equal(sameJson({ a: 1, b: 2 }, { a: 1, b: 3 }), false);
  assert.equal(sameJson({ a: 1 }, { a: 1, b: 2 }), false);
  // Reordered members nested inside an array element: only a comparison that
  // recurses through arrays as well as objects sees these as equal.
  assert.equal(sameJson([{ a: 1, b: 2 }], [{ b: 2, a: 1 }]), true);
  assert.equal(sameJson([{ a: 1, b: 2 }], [{ b: 2, a: 9 }]), false);
});

test('verifyCoreProbe matches the reference oracle on every core-probe scenario', async (t) => {
  for (const scenario of SCENARIOS.core_probe_cases) {
    await t.test(scenario.id, () => {
      const targetsProbe = scenario.target === 'probe';

      const mineDescribe = structuredClone(SCENARIOS.base_dynamic);
      const mineProbe = coreCapabilities();
      applyMutation(targetsProbe ? mineProbe : mineDescribe, scenario);

      const theirsDescribe = structuredClone(SCENARIOS.base_dynamic);
      const theirsProbe = referenceCoreCapabilities();
      applyMutation(targetsProbe ? theirsProbe : theirsDescribe, scenario);

      const mine = verifyCoreProbe(mineDescribe, mineProbe);
      const theirs = referenceVerifyCoreProbe(theirsDescribe, theirsProbe);
      assert.equal(mine.ok, theirs.ok, scenario.id);
      assert.equal(mine.ok, false, scenario.id);
      assert.equal(mine.error_code, scenario.expected, scenario.id);
      assert.equal(mine.error_code, theirs.error?.code, scenario.id);
    });
  }
});
