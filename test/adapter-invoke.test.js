import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { mapProcessOutcome as referenceMapProcessOutcome } from '../spec/adapter-reference.js';
import { canonicalInvocationDigest, verifyTrustedApproval } from '../src/adapter/approval.js';
import { coreCapabilities } from '../src/adapter/core-probe.js';
import { invokeAdapter } from '../src/adapter/invoke.js';
import { mapProcessOutcome } from '../src/adapter/process-outcome.js';
import { adapterManifest, describeRequest, dynamicDescribe } from './adapter-contract-fixtures.js';

function runtime() {
  const dynamic = dynamicDescribe();
  return {
    max_request_bytes: dynamic.limits.max_request_bytes,
    describe_request: describeRequest(),
    manifest: adapterManifest(),
    dynamic,
    core_probe: coreCapabilities(),
    platform: 'darwin',
  };
}

const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

test('maps a launcher exception to a launch-failed outcome, never a fabricated success', async () => {
  const request = {
    adapter_contract_version: 2,
    request_id: 'launch-throw-0001',
    core_request: { command: 'capabilities' },
    instruction_input: { instruction_input_version: 1, required: false, sources: [] },
    handoff_carrier: null,
    limits: { context_bytes: 0, stdout_bytes: 4096, stderr_bytes: 1024, timeout_ms: 1000 },
  };
  const configured = runtime();
  configured.package_root = '/installed/adapter';
  configured.launch = async () => {
    throw new Error('core could not be spawned');
  };

  const result = await invokeAdapter(Buffer.from(`${JSON.stringify(request)}
`), configured);

  // A launcher exception must fabricate a clean non-start (started: false) that
  // maps to core-launch-failed. It must never become a started: true fabrication
  // that reads as a partial success.
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'core-launch-failed');
});

test('refuses an invocation timeout above the advertised maximum', async () => {
  const request = {
    adapter_contract_version: 2,
    request_id: 'timeout-limit-0001',
    core_request: { command: 'capabilities' },
    instruction_input: { instruction_input_version: 1, required: false, sources: [] },
    handoff_carrier: null,
    limits: { context_bytes: 0, stdout_bytes: 4096, stderr_bytes: 1024, timeout_ms: 30001 },
  };

  const result = await invokeAdapter(Buffer.from(`${JSON.stringify(request)}\n`), runtime());

  assert.equal(result.error.code, 'timeout-limit-exceeded');
  assert.equal(result.request_id, request.request_id);
});

test('uses the bounded-output refusal for a requested stream limit above the maximum', async () => {
  const request = {
    adapter_contract_version: 2,
    request_id: 'stdout-limit-0001',
    core_request: { command: 'capabilities' },
    instruction_input: { instruction_input_version: 1, required: false, sources: [] },
    handoff_carrier: null,
    limits: { context_bytes: 0, stdout_bytes: 1048577, stderr_bytes: 1024, timeout_ms: 1000 },
  };

  const result = await invokeAdapter(Buffer.from(`${JSON.stringify(request)}\n`), runtime());

  assert.equal(result.error.code, 'output-limit-exceeded');
  assert.equal(result.error.message, 'The core output exceeded the requested bound.');
});

test('checks handoff capability before parsing a non-null carrier', async () => {
  const request = {
    adapter_contract_version: 2,
    request_id: 'handoff-capability-0001',
    core_request: { command: 'capabilities' },
    instruction_input: { instruction_input_version: 1, required: false, sources: [] },
    handoff_carrier: {},
    limits: { context_bytes: 1, stdout_bytes: 4096, stderr_bytes: 1024, timeout_ms: 1000 },
  };
  const configured = runtime();
  configured.dynamic.host.handoff.supported = false;

  const result = await invokeAdapter(Buffer.from(`${JSON.stringify(request)}\n`), configured);

  assert.equal(result.error.code, 'capability-unavailable');
  assert.deepEqual(result.error.details, { missing: ['handoff'] });
});

test('preserves exact core stream bytes and exit code', async () => {
  const request = {
    adapter_contract_version: 2,
    request_id: 'capability-bytes-0001',
    core_request: { command: 'capabilities' },
    instruction_input: { instruction_input_version: 1, required: false, sources: [] },
    handoff_carrier: null,
    limits: { context_bytes: 0, stdout_bytes: 4096, stderr_bytes: 1024, timeout_ms: 1000 },
  };
  const stdout = Buffer.from(`${JSON.stringify(coreCapabilities())}\n`);
  const configured = runtime();
  configured.package_root = '/installed/adapter';
  configured.launch = async () => ({
    started: true,
    process_tree_contained: true,
    orphaned: false,
    exit_code: 0,
    signal: null,
    timed_out: false,
    stdout_complete: true,
    stderr_complete: true,
    stdout_base64: stdout.toString('base64'),
    stderr_base64: '',
  });

  const result = await invokeAdapter(Buffer.from(`${JSON.stringify(request)}\n`), configured);

  assert.equal(result.ok, true);
  assert.equal(result.result.core_exit_code, 0);
  assert.deepEqual(Buffer.from(result.result.stdout.data, 'base64'), stdout);
  assert.deepEqual(Buffer.from(result.result.stderr.data, 'base64'), Buffer.alloc(0));
});

test('forwards an approved patch with exact argv and stdin as a mutation', async () => {
  const input = Buffer.from(`${JSON.stringify({
    id: 'wb_01KDWPVNG00000000000000000',
    expected_revision: `sha256:${'1'.repeat(64)}`,
    date: '2030-01-15',
    set: { priority: 1 },
  })}\n`);
  const request = {
    adapter_contract_version: 2,
    request_id: 'approved-patch-0001',
    workspace: { workspace_id: 'patch-workspace', cwd: '.' },
    core_request: { command: 'patch', ledger: 'ledger', input_base64: input.toString('base64') },
    instruction_input: { instruction_input_version: 1, required: false, sources: [] },
    handoff_carrier: null,
    limits: { context_bytes: 0, stdout_bytes: 4096, stderr_bytes: 1024, timeout_ms: 1000 },
  };
  const configured = runtime();
  const argv = ['patch', '--ledger', '/approved/workspace/ledger', '--input', '-', '--json'];
  const binding = {
    request_id: request.request_id,
    adapter: { id: configured.dynamic.adapter_id, version: configured.dynamic.adapter_version, contract_version: 2 },
    core: {
      executable_identity: `sha256:${'a'.repeat(64)}`,
      contract_version: 4,
      argv,
      input_base64: input.toString('base64'),
    },
    workspace: {
      id: 'patch-workspace',
      root: '/approved/workspace',
      cwd: '/approved/workspace',
      ledger: '/approved/workspace/ledger',
    },
    limits: request.limits,
    instruction_set_digest: digest(Buffer.from('[]')),
    handoff_digest: null,
  };
  const snapshots = {
    '.': { kind: 'directory', identity: 'root-1' },
    ledger: { kind: 'directory', identity: 'ledger-1' },
  };
  configured.package_root = '/installed/adapter';
  configured.workspaces = {
    'patch-workspace': {
      root: '/approved/workspace',
      before: snapshots,
      after: structuredClone(snapshots),
    },
  };
  configured.core_executable_identity = `sha256:${'a'.repeat(64)}`;
  configured.approval = {
    approval_version: 1,
    source: 'consumer',
    nonce: 'approved-patch-nonce-0001',
    issued_at: '2030-01-15T12:00:00Z',
    expires_at: '2030-01-15T12:05:00Z',
    invocation_digest: canonicalInvocationDigest(binding).digest,
  };
  configured.now = '2030-01-15T12:01:00Z';
  configured.redeemed_nonces = new Set();
  let launched = null;
  configured.launch = async (launch) => {
    launched = launch;
    return {
      started: true,
      process_tree_contained: true,
      orphaned: false,
      exit_code: null,
      signal: null,
      timed_out: true,
      stdout_complete: true,
      stderr_complete: true,
      stdout_base64: '',
      stderr_base64: '',
    };
  };

  const result = await invokeAdapter(Buffer.from(`${JSON.stringify(request)}\n`), configured);

  assert.equal(result.error.code, 'mutation-outcome-unknown');
  assert.equal(result.mutation_outcome, 'unknown');
  assert.deepEqual(launched.argv, argv);
  assert.equal(launched.cwd, '/approved/workspace');
  assert.deepEqual(launched.input, input);
  assert.deepEqual(result.error.details.recovery, {
    action: 'validate-inspect-and-compare-revision',
    expected_revision: `sha256:${'1'.repeat(64)}`,
    retry: 'never-before-current-state-review',
  });
});

test('maps every process-outcome fixture to the independent oracle envelope', async () => {
  const fixture = JSON.parse(await readFile(
    new URL('../spec/fixtures/adapters/11-process-outcomes/scenarios.json', import.meta.url),
    'utf8',
  ));

  for (const scenario of fixture.scenarios) {
    assert.deepEqual(mapProcessOutcome(scenario.request), referenceMapProcessOutcome(scenario.request), scenario.id);
  }
});

test('rejects an approval whose nonce is a number, not a string', () => {
  const binding = {
    request_id: 'nonce-coercion-0001',
    adapter: { id: 'a', version: '1.0.0', contract_version: 2 },
    core: {
      executable_identity: `sha256:${'a'.repeat(64)}`,
      contract_version: 4,
      argv: ['capabilities', '--json'],
      input_base64: '',
    },
    workspace: { id: 'w', root: '/w', cwd: '.', ledger: 'ledger' },
    limits: { context_bytes: 0, stdout_bytes: 0, stderr_bytes: 0, timeout_ms: 1000 },
    instruction_set_digest: `sha256:${'b'.repeat(64)}`,
    handoff_digest: null,
  };
  const invocationDigest = canonicalInvocationDigest(binding).digest;
  const numericNonce = 1234567890123456;
  const result = verifyTrustedApproval({
    approval: {
      approval_version: 1,
      source: 'consumer',
      nonce: numericNonce,
      issued_at: '2030-01-15T00:00:00Z',
      expires_at: '2030-01-15T01:00:00Z',
      invocation_digest: invocationDigest,
    },
    binding,
    now: '2030-01-15T00:30:00Z',
    redeemedNonces: new Set(),
    trustedSources: new Set(['consumer']),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-approval');
});
