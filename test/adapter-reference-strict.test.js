import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  canonicalInvocationDigest,
  describeAdapter,
  invokeAdapter,
  mapProcessOutcome,
  referenceCoreCapabilities,
  resolveEntrypointPath,
  resolveInvocationPaths,
  validateHandoffCarrier,
  validateInstructionInput,
  validateInvocationLimits,
  validateInvokeContext,
  verifyCoreProbe,
  verifyTrustedApproval,
} from '../spec/adapter-reference.js';
import {
  adapterManifest,
  describeRequest,
  dynamicDescribe,
} from './adapter-contract-fixtures.js';

const revision = (character) => `sha256:${character.repeat(64)}`;

function invokeRequest(overrides = {}) {
  return {
    adapter_contract_version: 2,
    request_id: 'invoke-ready-0001',
    workspace: { workspace_id: 'fixture-workspace', cwd: '.' },
    core_request: { command: 'ready', ledger: 'ledger', as_of: '2030-01-15' },
    instruction_input: { instruction_input_version: 1, required: false, sources: [] },
    handoff_carrier: null,
    limits: { context_bytes: 1024, stdout_bytes: 4096, stderr_bytes: 1024, timeout_ms: 1000 },
    ...overrides,
  };
}

function invokeRuntime(overrides = {}) {
  const dynamic = dynamicDescribe();
  const snapshots = {
    '.': { kind: 'directory', identity: 'root-1' },
    ledger: { kind: 'directory', identity: 'ledger-1' },
  };
  return {
    max_request_bytes: dynamic.limits.max_request_bytes,
    describe_request: describeRequest(),
    manifest: adapterManifest(),
    dynamic,
    core_probe: referenceCoreCapabilities(),
    package_root: '/installed/adapter',
    workspaces: {
      'fixture-workspace': {
        root: '/approved/workspace', before: snapshots, after: structuredClone(snapshots),
      },
    },
    launch: async () => completeProcess(),
    ...overrides,
  };
}

function completeProcess(overrides = {}) {
  return {
    started: true,
    process_tree_contained: true,
    orphaned: false,
    exit_code: 0,
    signal: null,
    timed_out: false,
    stdout_complete: true,
    stderr_complete: true,
    stdout_base64: 'eyJhc19vZiI6IjIwMzAtMDEtMTUiLCJ2YWxpZCI6dHJ1ZSwicmVhZHkiOltdfQo=',
    stderr_base64: '',
    ...overrides,
  };
}

function binding() {
  return {
    request_id: 'mutation-approval-0002',
    adapter: { id: 'example.reference', version: '1.0.0', contract_version: 2 },
    core: {
      executable_identity: revision('a'),
      contract_version: 2,
      argv: ['transition', '--ledger', '/approved/workspace/ledger', '--input', '-', '--json'],
      input_base64: 'e30K',
    },
    workspace: {
      id: 'fixture-workspace',
      root: '/approved/workspace',
      cwd: '/approved/workspace/nested',
      ledger: '/approved/workspace/ledger',
    },
    limits: {
      context_bytes: 1024,
      stdout_bytes: 4096,
      stderr_bytes: 4096,
      timeout_ms: 30000,
    },
    instruction_set_digest: revision('b'),
    handoff_digest: null,
  };
}

function approvalFor(invocation = binding()) {
  return {
    approval_version: 1,
    source: 'consumer',
    nonce: 'single-use-approval-0001',
    issued_at: '2030-01-15T12:00:00Z',
    expires_at: '2030-01-15T12:05:00Z',
    invocation_digest: canonicalInvocationDigest(invocation).digest,
  };
}

test('mutation process precedence treats timeout and signal as unknown despite complete buffers', () => {
  for (const process of [
    completeProcess({ timed_out: true }),
    completeProcess({ signal: 'runner-terminated' }),
  ]) {
    const result = mapProcessOutcome({
      adapter_contract_version: 2,
      request_id: 'transition-ambiguous-0001',
      command: 'transition',
      item_id: 'wb_01KDWPVNG00000000000000000',
      expected_revision: revision('1'),
      process,
    });
    assert.equal(result.error.code, 'mutation-outcome-unknown');
  }
});

test('read-only process failures have deterministic precedence', () => {
  const cases = [
    [completeProcess({ started: false, exit_code: null, stdout_base64: '' }), 'core-launch-failed'],
    [completeProcess({ timed_out: true, signal: 'runner-timeout', exit_code: null }), 'core-timeout'],
    [completeProcess({ signal: 'runner-terminated', exit_code: null }), 'core-signaled'],
    [completeProcess({ stdout_complete: false, stderr_complete: false }), 'output-limit-exceeded'],
    [completeProcess({ stdout_base64: '' }), 'core-protocol-error'],
    [completeProcess({ stdout_base64: 'ew==' }), 'core-protocol-error'],
  ];
  for (const [process, code] of cases) {
    assert.equal(mapProcessOutcome({
      adapter_contract_version: 2,
      request_id: `ready-${code}`,
      command: 'ready',
      process,
    }).error.code, code);
  }
  const malformedValidation = mapProcessOutcome({
    adapter_contract_version: 2,
    request_id: 'validate-core-refusal',
    command: 'validate',
    process: completeProcess({
      exit_code: 1,
      stdout_base64: 'eyJ2YWxpZCI6ZmFsc2UsImVycm9ycyI6W119Cg==',
    }),
  });
  assert.equal(malformedValidation.error.code, 'core-protocol-error');
  assert.equal(malformedValidation.process.core_envelope_valid, false);
});

test('invocation timeout and byte limits are exact, finite, and bounded', () => {
  assert.deepEqual(validateInvocationLimits({
    context_bytes: 1024,
    stdout_bytes: 4096,
    stderr_bytes: 2048,
    timeout_ms: 30000,
  }, {
    max_context_bytes: 1024,
    max_stdout_bytes: 4096,
    max_stderr_bytes: 2048,
    max_timeout_ms: 30000,
  }), { ok: true });
  assert.equal(validateInvocationLimits({
    context_bytes: 1024,
    stdout_bytes: 4096,
    stderr_bytes: 2048,
    timeout_ms: 30001,
  }, {
    max_context_bytes: 1024,
    max_stdout_bytes: 4096,
    max_stderr_bytes: 2048,
    max_timeout_ms: 30000,
  }).error.code, 'timeout-limit-exceeded');
});

test('invoke wire is strict, bounded before parse, and emits exact outer envelopes', async () => {
  let launches = 0;
  const launch = async () => {
    launches += 1;
    return completeProcess();
  };
  const request = invokeRequest();
  const success = await invokeAdapter(
    Buffer.from(`${JSON.stringify(request)}\n`), invokeRuntime({ launch }),
  );
  assert.equal(success.ok, true);
  assert.deepEqual(Object.keys(success).sort(), [
    'adapter_contract_version', 'ok', 'request_id', 'result',
  ]);
  assert.equal(success.result.core_command, 'ready');
  assert.equal(launches, 1);

  const oversized = await invokeAdapter(Buffer.from('{'.repeat(65)), invokeRuntime({
    max_request_bytes: 64,
    launch,
  }));
  assert.equal(oversized.error.code, 'invalid-invocation');
  assert.equal(oversized.request_id, null);
  assert.equal(launches, 1, 'oversized request must be refused before parse or launch');

  const duplicate = Buffer.from(`${JSON.stringify(request).replace(
    '"request_id":"invoke-ready-0001"',
    '"request_id":"invoke-ready-0001","request_id":"other"',
  )}\n`);
  assert.equal((await invokeAdapter(duplicate, invokeRuntime({ launch }))).error.code,
    'invalid-invocation');
  const extra = invokeRequest({ extra: true });
  assert.equal((await invokeAdapter(
    Buffer.from(`${JSON.stringify(extra)}\n`), invokeRuntime({ launch }),
  )).error.code, 'invalid-invocation');
  const future = invokeRequest({ adapter_contract_version: 3 });
  assert.equal((await invokeAdapter(
    Buffer.from(`${JSON.stringify(future)}\n`), invokeRuntime({ launch }),
  )).error.code, 'adapter-contract-selection-mismatch');
  assert.equal(launches, 1);
});

test('negotiation compares every static and dynamic field at normative paths', () => {
  const manifest = adapterManifest();
  const dynamic = dynamicDescribe();
  const request = describeRequest();
  assert.equal(describeAdapter(request, manifest, dynamic).ok, true);

  const mismatches = [
    [{ ...dynamic, adapter_id: 'example.other' }, 'adapter-identity-mismatch'],
    [{ ...dynamic, adapter_version: '2.0.0' }, 'adapter-version-mismatch'],
    [{ ...dynamic, selected_adapter_contract_version: 3 }, 'invalid-describe-result'],
    [{ ...dynamic, core: { ...dynamic.core, required_core_contract_version: 1 } }, 'required-core-contract-version-mismatch'],
    [{ ...dynamic, platforms: { ...dynamic.platforms, linux: 'unverified' } }, 'adapter-platform-mismatch'],
    [{ ...dynamic, platforms: { darwin: 'unverified', linux: 'unverified' } }, 'invalid-describe-result'],
  ];
  for (const [candidate, code] of mismatches) {
    assert.equal(describeAdapter(request, manifest, candidate).error.code, code);
  }
});

test('negotiation schemas reject missing, extra, and malformed objects without throwing', () => {
  const valid = {
    request: describeRequest(),
    manifest: adapterManifest(),
    dynamic: dynamicDescribe(),
  };
  const cases = [
    ['request missing', 'request', (value) => { delete value.request_id; }, 'invalid-describe-request'],
    ['request extra', 'request', (value) => { value.extra = true; }, 'invalid-describe-request'],
    ['request malformed', 'request', (value) => { value.supported_adapter_contract_versions = null; }, 'invalid-describe-request'],
    ['request empty versions', 'request', (value) => { value.supported_adapter_contract_versions = []; }, 'invalid-describe-request'],
    ['manifest missing', 'manifest', (value) => { delete value.entrypoints; }, 'invalid-adapter-manifest'],
    ['manifest extra', 'manifest', (value) => { value.extra = true; }, 'invalid-adapter-manifest'],
    ['manifest malformed', 'manifest', (value) => { value.adapter_contract_versions = [2, 1]; }, 'invalid-adapter-manifest'],
    ['dynamic malformed trusted approval', 'dynamic', (value) => { value.host.trusted_approval = { supported: true }; }, 'invalid-describe-result'],
    ['dynamic extra', 'dynamic', (value) => { value.host.extra = true; }, 'invalid-describe-result'],
    ['dynamic malformed', 'dynamic', (value) => { value.limits.max_timeout_ms = Infinity; }, 'invalid-describe-result'],
  ];
  for (const [label, target, mutate, expected] of cases) {
    const candidate = structuredClone(valid);
    mutate(candidate[target]);
    let result;
    assert.doesNotThrow(() => {
      result = describeAdapter(candidate.request, candidate.manifest, candidate.dynamic);
    }, label);
    assert.equal(result.error.code, expected, label);
  }
});

test('version 2 negotiation accepts only the singleton consumer approval source', () => {
  for (const sources of [
    ['model'], ['agent'], ['system'], ['tool'], ['consumer', 'model'], [],
  ]) {
    const dynamic = dynamicDescribe();
    dynamic.host.trusted_approval.sources = sources;
    assert.equal(describeAdapter(
      describeRequest(), adapterManifest(), dynamic,
    ).error.code, 'invalid-describe-result', JSON.stringify(sources));
  }
  assert.equal(describeAdapter(
    describeRequest(), adapterManifest(), dynamicDescribe(),
  ).ok, true);
});

test('version 2 negotiation refuses a future version even when both peers advertise it', () => {
  const manifest = adapterManifest({ adapter_contract_versions: [3] });
  const dynamic = dynamicDescribe({ selected_adapter_contract_version: 3 });
  assert.equal(describeAdapter(
    describeRequest({ supported_adapter_contract_versions: [3] }), manifest, dynamic,
  ).error.code, 'invalid-adapter-manifest');
});

test('dynamic capability cross-field invariants reject every contradictory mode', () => {
  const refuse = (dynamic, label) => assert.equal(describeAdapter(
    describeRequest(), adapterManifest(), dynamic,
  ).error.code, 'invalid-describe-result', label);
  const executionRequired = [
    'arguments_array', 'stdio', 'process_tree_containment', 'orphan_detection',
    'timeout_enforcement', 'stdout_limit', 'stderr_limit',
  ];
  for (const member of executionRequired) {
    const dynamic = dynamicDescribe();
    dynamic.host.command_execution[member] = false;
    refuse(dynamic, `supported.${member}`);
  }
  const shell = dynamicDescribe();
  shell.host.command_execution.shell = true;
  refuse(shell, 'supported.shell');
  for (const member of Object.keys(dynamicDescribe().limits)) {
    const dynamic = dynamicDescribe();
    dynamic.limits[member] = 0;
    refuse(dynamic, `supported.${member}`);
  }

  const unsupported = () => {
    const dynamic = dynamicDescribe();
    dynamic.host.command_execution.supported = false;
    for (const member of executionRequired) dynamic.host.command_execution[member] = false;
    dynamic.core.commands = [];
    return dynamic;
  };
  for (const member of executionRequired) {
    const dynamic = unsupported();
    dynamic.host.command_execution[member] = true;
    refuse(dynamic, `unsupported.${member}`);
  }
  const unsupportedShell = unsupported();
  unsupportedShell.host.command_execution.shell = true;
  refuse(unsupportedShell, 'unsupported.shell');
  const advertised = unsupported();
  advertised.core.commands = ['capabilities'];
  refuse(advertised, 'unsupported.core.commands');

  for (const member of ['no_follow_resolution', 'stable_identity', 'component_walk']) {
    const guarded = dynamicDescribe();
    guarded.host.filesystem[member] = false;
    refuse(guarded, `guarded.${member}`);

    const none = dynamicDescribe();
    none.host.filesystem.workspace_selection = 'none';
    none.host.filesystem.no_follow_resolution = false;
    none.host.filesystem.stable_identity = false;
    none.host.filesystem.component_walk = false;
    none.host.filesystem[member] = true;
    refuse(none, `none.${member}`);
  }

  for (const member of ['max_sources', 'max_bytes']) {
    const none = dynamicDescribe();
    none.host.instruction_input.mode = 'none';
    none.host.instruction_input.max_sources = 0;
    none.host.instruction_input.max_bytes = 0;
    none.host.instruction_input[member] = 1;
    refuse(none, `instruction.none.${member}`);
    const configured = dynamicDescribe();
    configured.host.instruction_input[member] = 0;
    refuse(configured, `instruction.configured.${member}`);
  }
});

test('core capabilities probe is exact and cannot elevate adapter features', () => {
  assert.equal(verifyCoreProbe(dynamicDescribe(), referenceCoreCapabilities()).ok, true);
  const malformed = [
    null,
    {},
    { ...referenceCoreCapabilities(), extra: true },
    { ...referenceCoreCapabilities(), command: 'ready' },
    { ...referenceCoreCapabilities(), contract_version: 1 },
    {
      ...referenceCoreCapabilities(),
      result: { ...referenceCoreCapabilities().result, extra: true },
    },
  ];
  for (const probe of malformed) {
    assert.equal(verifyCoreProbe(dynamicDescribe(), probe).error.code, 'core-protocol-error');
  }
  const claims = dynamicDescribe();
  claims.optional_features.claims = true;
  assert.equal(verifyCoreProbe(claims, referenceCoreCapabilities()).error.code,
    'core-contract-version-mismatch');
  const policy = dynamicDescribe();
  policy.optional_features.policy = true;
  assert.equal(verifyCoreProbe(policy, referenceCoreCapabilities()).error.code,
    'core-contract-version-mismatch');
  const commands = dynamicDescribe();
  commands.core.commands = ['capabilities'];
  assert.equal(verifyCoreProbe(commands, referenceCoreCapabilities()).error.code,
    'core-contract-version-mismatch');
});

test('command entrypoint manifest paths and fixed args use safe package-relative syntax', () => {
  for (const executable of [
    '../bin/adapter', '/bin/adapter', 'C:/bin/adapter', '\\\\server\\adapter',
    '//?/C:/bin/adapter', 'Volume{fixture}/adapter', 'bin\\adapter', 'bin//adapter',
  ]) {
    const manifest = adapterManifest();
    manifest.entrypoints.invoke.executable = executable;
    assert.equal(describeAdapter(
      describeRequest(), manifest, dynamicDescribe(),
    ).error.code, 'invalid-adapter-manifest', executable);
  }
  const controlArgument = adapterManifest();
  controlArgument.entrypoints.invoke.fixed_args = ['invoke\u0000hidden'];
  assert.equal(describeAdapter(
    describeRequest(), controlArgument, dynamicDescribe(),
  ).error.code, 'invalid-adapter-manifest');
});

test('canonical approval binding rejects every missing or extra documented member', () => {
  assert.match(canonicalInvocationDigest(binding()).digest, /^sha256:[a-f0-9]{64}$/);
  const requiredPaths = [
    'request_id', 'adapter', 'core', 'workspace', 'limits', 'instruction_set_digest', 'handoff_digest',
    'adapter.id', 'adapter.version', 'adapter.contract_version',
    'core.executable_identity', 'core.contract_version', 'core.argv', 'core.input_base64',
    'workspace.id', 'workspace.root', 'workspace.cwd', 'workspace.ledger',
    'limits.context_bytes', 'limits.stdout_bytes', 'limits.stderr_bytes', 'limits.timeout_ms',
  ];
  for (const memberPath of requiredPaths) {
    const missing = binding();
    const segments = memberPath.split('.');
    const parent = segments.slice(0, -1).reduce((value, key) => value[key], missing);
    delete parent[segments.at(-1)];
    assert.throws(() => canonicalInvocationDigest(missing), /invalid invocation binding/, memberPath);
  }
  for (const memberPath of ['', 'adapter', 'core', 'workspace', 'limits']) {
    const extra = binding();
    const target = memberPath
      ? memberPath.split('.').reduce((value, key) => value[key], extra)
      : extra;
    target.extra = true;
    assert.throws(() => canonicalInvocationDigest(extra), /invalid invocation binding/, memberPath);
  }
});

test('trusted approval exact schema and time rules fail closed', () => {
  const invocation = binding();
  const valid = approvalFor(invocation);
  const common = {
    binding: invocation,
    now: '2030-01-15T12:01:00Z',
    trustedSources: new Set(['consumer']),
    redeemedNonces: new Set(),
  };
  assert.equal(verifyTrustedApproval({ approval: valid, ...common }).ok, true);
  const malformed = [
    { ...valid, approval_version: 2 },
    { ...valid, nonce: 'short' },
    { ...valid, invocation_digest: 'sha256:bad' },
    { ...valid, issued_at: 'not-a-time' },
    { ...valid, expires_at: valid.issued_at },
    { ...valid, extra: true },
  ];
  for (const approval of malformed) {
    assert.equal(verifyTrustedApproval({ approval, ...common, redeemedNonces: new Set() }).ok, false);
  }
  for (const member of Object.keys(valid)) {
    const approval = { ...valid };
    delete approval[member];
    assert.equal(verifyTrustedApproval({
      approval, ...common, redeemedNonces: new Set(),
    }).error.code, 'invalid-approval', member);
  }
  for (const trustedSources of [
    new Set(['model']),
    new Set(['agent']),
    new Set(['system']),
    new Set(['tool']),
    new Set(['consumer', 'model']),
  ]) {
    assert.equal(verifyTrustedApproval({
      approval: valid, ...common, trustedSources, redeemedNonces: new Set(),
    }).error.code, 'approval-source-untrusted');
  }
});

test('path resolver snapshots every cwd and ledger component', () => {
  const before = {
    '.': { kind: 'directory', identity: 'root-1' },
    nested: { kind: 'directory', identity: 'nested-1' },
    'nested/deep': { kind: 'directory', identity: 'deep-1' },
    ledger: { kind: 'directory', identity: 'ledger-1' },
    'ledger/items': { kind: 'directory', identity: 'items-1' },
  };
  const after = structuredClone(before);
  after.nested.identity = 'nested-2';
  const result = resolveInvocationPaths({
    workspace_root: '/approved/workspace',
    cwd: 'nested/deep',
    ledger: 'ledger/items',
    before,
    after,
  });
  assert.deepEqual(result.error, {
    code: 'path-replaced',
    details: { path_role: 'cwd', component: 'nested' },
  });
  const linked = structuredClone(before);
  linked.ledger.kind = 'symbolic-link';
  assert.deepEqual(resolveInvocationPaths({
    workspace_root: '/approved/workspace',
    cwd: 'nested/deep',
    ledger: 'ledger/items',
    before: linked,
    after: linked,
  }).error, {
    code: 'path-rejected',
    details: { path_role: 'ledger', component: 'ledger', kind: 'symbolic-link' },
  });
});

test('snapshot identities are mandatory and exact on both sides of every component', () => {
  const base = {
    '.': { kind: 'directory', identity: { dev: 1, ino: 10 } },
    nested: { kind: 'directory', identity: { dev: 1, ino: 11 } },
    ledger: { kind: 'directory', identity: { volume_id: 'vol-1', file_id: 'ledger-1' } },
  };
  const resolve = (before, after = structuredClone(before)) => resolveInvocationPaths({
    workspace_root: '/approved/workspace', cwd: 'nested', ledger: 'ledger', before, after,
  });
  assert.equal(resolve(base).ok, true);

  const rootMissing = structuredClone(base);
  delete rootMissing['.'].identity;
  assert.deepEqual(resolve(rootMissing).error.details, {
    path_role: 'workspace', component: '.', kind: 'invalid-identity', snapshot: 'initial',
  });

  const parentFinalMissing = structuredClone(base);
  delete parentFinalMissing.nested.identity;
  assert.deepEqual(resolve(base, parentFinalMissing).error.details, {
    path_role: 'cwd', component: 'nested', kind: 'invalid-identity', snapshot: 'final',
  });

  const malformed = structuredClone(base);
  malformed.ledger.identity = { dev: 1 };
  assert.equal(resolve(malformed).error.code, 'path-rejected');

  const replaced = structuredClone(base);
  replaced.nested.identity.ino = 12;
  assert.equal(resolve(base, replaced).error.code, 'path-replaced');

  const executable = {
    '.': { kind: 'directory', identity: 'package-1' },
    bin: { kind: 'directory', identity: 'bin-1' },
    'bin/adapter': { kind: 'regular-file' },
  };
  assert.deepEqual(resolveEntrypointPath({
    package_root: '/installed/adapter', executable: 'bin/adapter',
    before: executable, after: executable,
  }).error.details, {
    path_role: 'entrypoint', component: 'bin/adapter',
    kind: 'invalid-identity', snapshot: 'initial',
  });
});

test('logical paths reject Windows drive, UNC, device, and volume forms on every host', () => {
  const invalidPaths = [
    'C:/repo', 'C:\\repo', 'C:repo', '\\\\server\\share', '//server/share',
    '\\\\?\\C:\\repo', '//?/C:/repo', '\\\\.\\COM1',
    'Volume{fixture}/repo', 'volume{fixture}',
  ];
  const snapshot = { '.': { kind: 'directory', identity: 'root-1' } };
  for (const cwd of invalidPaths) {
    const result = resolveInvocationPaths({
      workspace_root: '/approved/workspace',
      cwd,
      ledger: '.',
      before: snapshot,
      after: snapshot,
    });
    assert.equal(result.error.code, 'path-rejected', cwd);
  }
});

test('entrypoint resolution stays under the package root and rechecks no-follow identities', () => {
  const stable = {
    '.': { kind: 'directory', identity: 'package-1' },
    bin: { kind: 'directory', identity: 'bin-1' },
    'bin/adapter': { kind: 'regular-file', identity: 'adapter-1' },
  };
  assert.deepEqual(resolveEntrypointPath({
    package_root: '/installed/adapter',
    executable: 'bin/adapter',
    before: stable,
    after: structuredClone(stable),
  }), { ok: true, executable: '/installed/adapter/bin/adapter' });

  const linked = structuredClone(stable);
  linked.bin.kind = 'symbolic-link';
  assert.equal(resolveEntrypointPath({
    package_root: '/installed/adapter', executable: 'bin/adapter', before: linked, after: linked,
  }).error.code, 'path-rejected');

  const replaced = structuredClone(stable);
  replaced['bin/adapter'].identity = 'adapter-2';
  assert.equal(resolveEntrypointPath({
    package_root: '/installed/adapter', executable: 'bin/adapter', before: stable, after: replaced,
  }).error.code, 'path-replaced');
});

function instructionSource(overrides = {}) {
  const bytes = Buffer.from('rules\n');
  return {
    source_id: 'repository-rules',
    origin: 'repository',
    content_encoding: 'base64',
    content_base64: bytes.toString('base64'),
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    byte_length: bytes.length,
    logical_path: 'config/rules.txt',
    ...overrides,
  };
}

test('instruction carrier enforces schema, source uniqueness, and diagnostics', () => {
  const result = validateInstructionInput({
    instruction_input_version: 1,
    required: true,
    sources: [instructionSource()],
  }, { max_sources: 2, max_bytes: 64 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.diagnostics, [{
    ordinal: 0,
    source_id: 'repository-rules',
    origin: 'repository',
    precedence: 1,
    logical_path: 'config/rules.txt',
    byte_length: 6,
    sha256: instructionSource().sha256,
  }]);
  assert.equal(validateInstructionInput({
    instruction_input_version: 1,
    required: true,
    sources: [instructionSource(), instructionSource()],
  }, { max_sources: 2, max_bytes: 64 }).error.code, 'duplicate-instruction-source-id');
  assert.equal(validateInstructionInput({
    instruction_input_version: 1,
    required: true,
    sources: [instructionSource({ origin: 'unknown' })],
  }, { max_sources: 2, max_bytes: 64 }).error.code, 'invalid-instruction-source');
  assert.equal(validateInstructionInput({
    instruction_input_version: 1,
    required: true,
    sources: [instructionSource({ extra: true })],
  }, { max_sources: 2, max_bytes: 64 }).error.code, 'invalid-instruction-source');
  for (const source of [null, 1, 'source', [], {}, { source_id: 'missing-members' }]) {
    assert.doesNotThrow(() => validateInstructionInput({
      instruction_input_version: 1,
      required: true,
      sources: [source],
    }, { max_sources: 2, max_bytes: 64 }));
    assert.equal(validateInstructionInput({
      instruction_input_version: 1,
      required: true,
      sources: [source],
    }, { max_sources: 2, max_bytes: 64 }).error.code, 'invalid-instruction-source');
  }
  assert.equal(validateInstructionInput({
    instruction_input_version: 1,
    required: true,
    sources: [instructionSource()],
    extra: true,
  }, { max_sources: 2, max_bytes: 64 }).error.code, 'invalid-instruction-input');
});

function handoffCarrier(instructionSetDigest = revision('b')) {
  const handoff = {
    handoff_version: 1,
    workspace_id: 'fixture-workspace',
    instruction_set_digest: instructionSetDigest,
    item: { id: 'wb_01KDWPVNG00000000000000000', revision: revision('1') },
  };
  const bytes = Buffer.from(`${JSON.stringify(handoff)}\n`);
  return {
    handoff_carrier_version: 1,
    workspace_id: 'fixture-workspace',
    content_encoding: 'base64',
    content_base64: bytes.toString('base64'),
    byte_length: bytes.length,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    resume_request: {
      item_id: handoff.item.id,
      expected_revision: handoff.item.revision,
      instruction_set_digest: handoff.instruction_set_digest,
    },
  };
}

test('handoff carrier enforces bytes, strict JSON, workspace, revision, and instruction binding', () => {
  const carrier = handoffCarrier();
  assert.equal(validateHandoffCarrier(carrier, {
    workspace_id: 'fixture-workspace',
    max_bytes: 1024,
    current: {
      item_id: carrier.resume_request.item_id,
      revision: carrier.resume_request.expected_revision,
      instruction_set_digest: carrier.resume_request.instruction_set_digest,
    },
  }).ok, true);
  assert.equal(validateHandoffCarrier({ ...carrier, workspace_id: 'other' }, {
    workspace_id: 'fixture-workspace', max_bytes: 1024, current: {},
  }).error.code, 'handoff-workspace-mismatch');
  assert.equal(validateHandoffCarrier({ ...carrier, extra: true }, {
    workspace_id: 'fixture-workspace', max_bytes: 1024, current: {},
  }).error.code, 'invalid-handoff-carrier');

  const duplicateBytes = Buffer.from('{"handoff_version":1,"handoff_version":1}\n');
  const duplicate = {
    ...carrier,
    content_base64: duplicateBytes.toString('base64'),
    byte_length: duplicateBytes.length,
    sha256: `sha256:${createHash('sha256').update(duplicateBytes).digest('hex')}`,
  };
  assert.equal(validateHandoffCarrier(duplicate, {
    workspace_id: 'fixture-workspace', max_bytes: 1024, current: {},
  }).error.code, 'invalid-handoff-json');

  const genericResumeId = structuredClone(carrier);
  genericResumeId.resume_request.item_id = 'generic-safe-id';
  assert.equal(validateHandoffCarrier(genericResumeId, {
    workspace_id: 'fixture-workspace', max_bytes: 1024, current: {},
  }).error.code, 'invalid-handoff-resume-request');

  const invalidHandoff = JSON.parse(Buffer.from(carrier.content_base64, 'base64').toString('utf8'));
  invalidHandoff.item.id = 'wb_81KDWPVNG00000000000000000';
  const invalidBytes = Buffer.from(`${JSON.stringify(invalidHandoff)}\n`);
  const invalidItemId = {
    ...carrier,
    content_base64: invalidBytes.toString('base64'),
    byte_length: invalidBytes.length,
    sha256: `sha256:${createHash('sha256').update(invalidBytes).digest('hex')}`,
  };
  assert.equal(validateHandoffCarrier(invalidItemId, {
    workspace_id: 'fixture-workspace', max_bytes: 1024, current: {},
  }).error.code, 'invalid-handoff-object');
});

test('combined instruction and handoff bytes share context_bytes', () => {
  const instructions = {
    instruction_input_version: 1,
    required: true,
    sources: [instructionSource()],
  };
  const instructionSetDigest = validateInstructionInput(
    instructions, { max_sources: 2, max_bytes: 64 },
  ).instruction_set_digest;
  const carrier = handoffCarrier(instructionSetDigest);
  assert.equal(validateInvokeContext({
    instruction_input: instructions,
    handoff_carrier: carrier,
    context_bytes: 10,
    instruction_limits: { max_sources: 2, max_bytes: 64 },
    handoff_options: {
      workspace_id: 'fixture-workspace',
      max_bytes: 1024,
      current: {
        item_id: carrier.resume_request.item_id,
        revision: carrier.resume_request.expected_revision,
        instruction_set_digest: carrier.resume_request.instruction_set_digest,
      },
    },
  }).error.code, 'context-limit-exceeded');
});
