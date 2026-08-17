import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { coreCapabilities } from '../src/adapter/core-probe.js';
import { invokeAdapter } from '../src/adapter/invoke.js';
import {
  canonicalInvocationDigest as referenceCanonicalInvocationDigest,
  invokeAdapter as referenceInvokeAdapter,
} from '../spec/adapter-reference.js';
import { adapterManifest, describeRequest, dynamicDescribe } from './adapter-contract-fixtures.js';

const CREATE_INPUT = Buffer.from(`${JSON.stringify({
  id: 'wb_01Q45X474N28T5CY4GNF6YY4HM',
  item: {
    title: 'Map a fictional moon route',
    kind: 'task',
    provenance: { source: 'fixture/mutations', recorded_at: '2030-01-10T12:34:56.789Z' },
    depends_on: [],
    related: [],
  },
  body: '\nPlot a fictional route from Brindle Station to Lumen Reef.\n',
})}\n`);

const REQUEST = {
  adapter_contract_version: 2,
  request_id: 'host-resolver-0001',
  workspace: { workspace_id: 'approved-workspace', cwd: '.' },
  core_request: { command: 'create', ledger: 'ledger', input_base64: CREATE_INPUT.toString('base64') },
  instruction_input: { instruction_input_version: 1, required: false, sources: [] },
  handoff_carrier: null,
  limits: { context_bytes: 0, stdout_bytes: 4096, stderr_bytes: 1024, timeout_ms: 1000 },
};

// A timeout observation makes both engines answer `mutation-outcome-unknown`
// without a valid core envelope to hand-author. Reaching that answer at all
// proves the approval passed the gate: a refused approval would have named
// itself instead, before any launch.
function timedOutObservation() {
  return {
    started: true,
    input_delivery: 'delivered',
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
}

// One runtime shape drives both engines. The resolver records the binding it
// was handed and signs it with the independent reference canonicalizer, so a
// shipped canonicalizer that drifted would refuse its own approval.
function hostRuntime(recorded) {
  const snapshots = {
    '.': { kind: 'directory', identity: 'root-1' },
    ledger: { kind: 'directory', identity: 'ledger-1' },
  };
  const dynamic = dynamicDescribe();
  return {
    max_request_bytes: dynamic.limits.max_request_bytes,
    describe_request: describeRequest(),
    manifest: adapterManifest(),
    dynamic,
    core_probe: coreCapabilities(),
    platform: 'darwin',
    package_root: '/installed/adapter',
    workspaces: {
      'approved-workspace': {
        root: '/approved/workspace',
        before: snapshots,
        after: structuredClone(snapshots),
      },
    },
    now: '2030-01-15T12:01:00Z',
    redeemed_nonces: new Set(),
    core_executable_identity: `sha256:${'a'.repeat(64)}`,
    approval: (context) => {
      recorded.push(context);
      return {
        approval_version: 1,
        source: 'consumer',
        nonce: 'host-resolver-nonce-0001',
        issued_at: '2030-01-15T12:00:00Z',
        expires_at: '2030-01-15T12:05:00Z',
        invocation_digest: referenceCanonicalInvocationDigest(context.binding).digest,
      };
    },
    launch: async () => timedOutObservation(),
  };
}

test('both engines resolve a host approval provider against the same binding', async () => {
  const bytes = Buffer.from(`${JSON.stringify(REQUEST)}\n`);
  const shippedCalls = [];
  const referenceCalls = [];

  const shipped = await invokeAdapter(bytes, hostRuntime(shippedCalls));
  const reference = await referenceInvokeAdapter(bytes, hostRuntime(referenceCalls));

  assert.equal(shippedCalls.length, 1);
  assert.equal(referenceCalls.length, 1);
  assert.equal(shippedCalls[0].command, 'create');
  assert.equal(referenceCalls[0].command, 'create');
  assert.deepEqual(shippedCalls[0].binding, referenceCalls[0].binding);
  assert.equal(shipped.error.code, 'mutation-outcome-unknown');
  assert.equal(reference.error.code, 'mutation-outcome-unknown');
  assert.deepEqual(shipped, reference);
});

// A host whose approval source fails produced no approval. Neither engine may
// treat the failure as authority, and neither may die of it: the caller is
// owed the same refusal it gets when the consumer simply declined.
test('both engines refuse the mutation when the host approval provider throws', async () => {
  const bytes = Buffer.from(`${JSON.stringify(REQUEST)}\n`);
  let launches = 0;
  const failing = () => {
    const runtime = hostRuntime([]);
    runtime.approval = () => { throw new Error('the host approval channel failed'); };
    runtime.launch = async () => { launches += 1; return timedOutObservation(); };
    return runtime;
  };

  const shipped = await invokeAdapter(bytes, failing());
  const reference = await referenceInvokeAdapter(bytes, failing());

  assert.equal(shipped.error.code, 'consumer-approval-required');
  assert.deepEqual(shipped.error.details, { command: 'create' });
  assert.deepEqual(shipped, reference);
  assert.equal(launches, 0);
});

// The binding is what the approval covers, so both engines must bind the same
// facts. A digest signed over one engine's binding must verify against the
// other's, or an approval a host minted for one is worthless to the other.
test('an approval minted for one engine verifies against the other', async () => {
  const bytes = Buffer.from(`${JSON.stringify(REQUEST)}\n`);
  const recorded = [];
  await invokeAdapter(bytes, hostRuntime(recorded));
  const binding = recorded[0].binding;
  const fixedApproval = {
    approval_version: 1,
    source: 'consumer',
    nonce: 'host-fixed-nonce-0001',
    issued_at: '2030-01-15T12:00:00Z',
    expires_at: '2030-01-15T12:05:00Z',
    invocation_digest: `sha256:${createHash('sha256')
      .update(Buffer.from(referenceCanonicalInvocationDigest(binding).canonical))
      .digest('hex')}`,
  };
  const withFixedApproval = () => {
    const runtime = hostRuntime([]);
    runtime.approval = fixedApproval;
    return runtime;
  };

  const shipped = await invokeAdapter(bytes, withFixedApproval());
  const reference = await referenceInvokeAdapter(bytes, withFixedApproval());

  assert.equal(shipped.error.code, 'mutation-outcome-unknown');
  assert.equal(reference.error.code, 'mutation-outcome-unknown');
});
