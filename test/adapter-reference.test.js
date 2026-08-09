import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adapterManifest,
  describeRequest,
  dynamicDescribe,
} from './adapter-contract-fixtures.js';

function strictBinding() {
  return {
    request_id: 'mutation-approval-0002',
    adapter: { id: 'example.reference', version: '1.0.0', contract_version: 2 },
    core: {
      executable_identity: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      contract_version: 2,
      argv: ['transition', '--ledger', '/approved/workspace/ledger', '--input', '-', '--json'],
      input_base64: 'e30K',
    },
    workspace: {
      id: 'fixture-workspace', root: '/approved/workspace',
      cwd: '/approved/workspace/nested', ledger: '/approved/workspace/ledger',
    },
    limits: { context_bytes: 1024, stdout_bytes: 4096, stderr_bytes: 4096, timeout_ms: 30000 },
    instruction_set_digest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    handoff_digest: null,
  };
}

test('bootstrap describe selects the only implemented adapter contract version', async () => {
  const { describeAdapter } = await import('../spec/adapter-reference.js');

  const dynamic = dynamicDescribe();
  const result = describeAdapter(describeRequest(), adapterManifest(), dynamic);

  assert.deepEqual(result, dynamic);
});

test('bootstrap describe refuses when no adapter contract version is shared', async () => {
  const { describeAdapter } = await import('../spec/adapter-reference.js');

  const result = describeAdapter(
    describeRequest({ supported_adapter_contract_versions: [3] }),
    adapterManifest(),
  );

  assert.deepEqual(result, {
    ok: false,
    bootstrap_wire_version: 1,
    error: {
      code: 'unsupported-adapter-contract-version',
      details: {
        client: [3],
        adapter: [2],
      },
    },
  });
});

test('canonical invocation digest binds the complete approved invocation', async () => {
  const { canonicalInvocationDigest } = await import('../spec/adapter-reference.js');
  const result = canonicalInvocationDigest(strictBinding());
  assert.match(result.digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(JSON.parse(result.canonical).core.executable_identity,
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
});

test('trusted consumer approval is redeemed only once for its exact invocation digest', async () => {
  const { canonicalInvocationDigest, verifyTrustedApproval } = await import('../spec/adapter-reference.js');
  const binding = strictBinding();
  const approval = {
    approval_version: 1,
    source: 'consumer',
    nonce: 'single-use-approval-0001',
    issued_at: '2030-01-15T12:00:00Z',
    expires_at: '2030-01-15T12:05:00Z',
    invocation_digest: canonicalInvocationDigest(binding).digest,
  };
  const redeemedNonces = new Set();

  assert.deepEqual(verifyTrustedApproval({
    approval,
    binding,
    now: '2030-01-15T12:01:00Z',
    redeemedNonces,
  }), {
    ok: true,
    nonce: 'single-use-approval-0001',
  });
  assert.deepEqual(verifyTrustedApproval({
    approval,
    binding,
    now: '2030-01-15T12:01:01Z',
    redeemedNonces,
  }), {
    ok: false,
    error: {
      code: 'approval-replayed',
      details: {
        nonce: 'single-use-approval-0001',
      },
    },
  });
});

test('trusted approval refuses an expired consumer token before redemption', async () => {
  const { canonicalInvocationDigest, verifyTrustedApproval } = await import('../spec/adapter-reference.js');
  const binding = strictBinding();
  const approval = {
    approval_version: 1,
    source: 'consumer',
    nonce: 'expired-approval-0001',
    issued_at: '2030-01-15T12:00:00Z',
    expires_at: '2030-01-15T12:05:00Z',
    invocation_digest: canonicalInvocationDigest(binding).digest,
  };

  assert.deepEqual(verifyTrustedApproval({
    approval,
    binding,
    now: '2030-01-15T12:05:00Z',
    redeemedNonces: new Set(),
  }), {
    ok: false,
    error: {
      code: 'approval-expired',
      details: {
        expires_at: '2030-01-15T12:05:00Z',
      },
    },
  });
});

test('path resolution anchors ledger at workspace root instead of nested cwd', async () => {
  const { resolveInvocationPaths } = await import('../spec/adapter-reference.js');

  assert.deepEqual(resolveInvocationPaths({
    workspace_root: '/approved/workspace',
    cwd: 'nested',
    ledger: 'ledger',
    before: {
      '.': { kind: 'directory', identity: 'root-1' },
      nested: { kind: 'directory', identity: 'cwd-1' },
      ledger: { kind: 'directory', identity: 'ledger-1' },
      'nested/ledger': { kind: 'directory', identity: 'decoy-1' },
    },
    after: {
      '.': { kind: 'directory', identity: 'root-1' },
      nested: { kind: 'directory', identity: 'cwd-1' },
      ledger: { kind: 'directory', identity: 'ledger-1' },
      'nested/ledger': { kind: 'directory', identity: 'decoy-1' },
    },
  }), {
    ok: true,
    workspace_root: '/approved/workspace',
    cwd: '/approved/workspace/nested',
    ledger: '/approved/workspace/ledger',
  });
});

test('path resolution refuses a ledger component replaced before process launch', async () => {
  const { resolveInvocationPaths } = await import('../spec/adapter-reference.js');

  assert.deepEqual(resolveInvocationPaths({
    workspace_root: '/approved/workspace',
    cwd: 'nested',
    ledger: 'ledger',
    before: {
      '.': { kind: 'directory', identity: 'root-1' },
      nested: { kind: 'directory', identity: 'cwd-1' },
      ledger: { kind: 'directory', identity: 'ledger-1' },
    },
    after: {
      '.': { kind: 'directory', identity: 'root-1' },
      nested: { kind: 'directory', identity: 'cwd-1' },
      ledger: { kind: 'directory', identity: 'ledger-2' },
    },
  }), {
    ok: false,
    error: {
      code: 'path-replaced',
      details: {
        path_role: 'ledger',
        component: 'ledger',
      },
    },
  });
});

test('truncated create output reports unknown mutation outcome with caller-known recovery', async () => {
  const { mapProcessOutcome } = await import('../spec/adapter-reference.js');

  assert.deepEqual(mapProcessOutcome({
    adapter_contract_version: 2,
    request_id: 'create-zero-output-0001',
    command: 'create',
    item_id: 'wb_01KDWPVNG00000000000000000',
    expected_revision: null,
    process: {
      started: true,
      process_tree_contained: true,
      orphaned: false,
      exit_code: 0,
      signal: null,
      timed_out: false,
      stdout_complete: false,
      stderr_complete: true,
      stdout_base64: 'ew==',
      stderr_base64: '',
    },
  }), {
    ok: false,
    adapter_contract_version: 2,
    request_id: 'create-zero-output-0001',
    mutation_outcome: 'unknown',
    error: {
      code: 'mutation-outcome-unknown',
      message: 'The mutation may have been applied; inspect current state before retrying.',
      details: {
        command: 'create',
        item_id: 'wb_01KDWPVNG00000000000000000',
        recovery: {
          action: 'inspect-caller-known-id',
          validate_ledger_first: true,
          retry: 'only-after-item-not-found-and-audited-artifact-recovery',
        },
      },
    },
    process: {
      started: true,
      process_tree_contained: true,
      orphaned: false,
      exit_code: 0,
      signal: null,
      timed_out: false,
      stdout_complete: false,
      stderr_complete: true,
      core_envelope_present: true,
      core_envelope_valid: false,
    },
  });
});

test('timed-out transition reports unknown mutation outcome and revision recovery', async () => {
  const { mapProcessOutcome } = await import('../spec/adapter-reference.js');

  assert.deepEqual(mapProcessOutcome({
    adapter_contract_version: 2,
    request_id: 'transition-timeout-0001',
    command: 'transition',
    item_id: 'wb_01KDWPVNG00000000000000000',
    expected_revision: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    process: {
      started: true,
      process_tree_contained: true,
      orphaned: false,
      exit_code: null,
      signal: 'SIGKILL',
      timed_out: true,
      stdout_complete: false,
      stderr_complete: true,
      stdout_base64: 'ew==',
      stderr_base64: '',
    },
  }), {
    ok: false,
    adapter_contract_version: 2,
    request_id: 'transition-timeout-0001',
    mutation_outcome: 'unknown',
    error: {
      code: 'mutation-outcome-unknown',
      message: 'The mutation may have been applied; inspect current state before retrying.',
      details: {
        command: 'transition',
        item_id: 'wb_01KDWPVNG00000000000000000',
        recovery: {
          action: 'validate-inspect-and-compare-revision',
          expected_revision: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
          retry: 'never-before-current-state-review',
        },
      },
    },
    process: {
      started: true,
      process_tree_contained: true,
      orphaned: false,
      exit_code: null,
      signal: 'SIGKILL',
      timed_out: true,
      stdout_complete: false,
      stderr_complete: true,
      core_envelope_present: true,
      core_envelope_valid: false,
    },
  });
});

test('read-only truncation is an output error, never a mutation result', async () => {
  const { mapProcessOutcome } = await import('../spec/adapter-reference.js');

  assert.deepEqual(mapProcessOutcome({
    adapter_contract_version: 2,
    request_id: 'ready-truncated-0001',
    command: 'ready',
    process: {
      started: true,
      process_tree_contained: true,
      orphaned: false,
      exit_code: 0,
      signal: null,
      timed_out: false,
      stdout_complete: false,
      stderr_complete: true,
      stdout_base64: 'ew==',
      stderr_base64: '',
    },
  }), {
    ok: false,
    adapter_contract_version: 2,
    request_id: 'ready-truncated-0001',
    error: {
      code: 'output-limit-exceeded',
      message: 'The core output exceeded the requested bound.',
      details: { streams: ['stdout'] },
    },
    process: {
      started: true,
      process_tree_contained: true,
      orphaned: false,
      exit_code: 0,
      signal: null,
      timed_out: false,
      stdout_complete: false,
      stderr_complete: true,
      core_envelope_present: true,
      core_envelope_valid: false,
    },
  });
});

test('approval source must be a configured trusted consumer authority', async () => {
  const { verifyTrustedApproval } = await import('../spec/adapter-reference.js');

  assert.deepEqual(verifyTrustedApproval({
    approval: {
      approval_version: 1,
      source: 'model',
      nonce: 'untrusted-approval-0001',
      issued_at: '2030-01-15T12:00:00Z',
      expires_at: '2030-01-15T12:05:00Z',
      invocation_digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    binding: {},
    now: '2030-01-15T12:00:00Z',
    trustedSources: new Set(['consumer']),
    redeemedNonces: new Set(),
  }), {
    ok: false,
    error: {
      code: 'approval-source-untrusted',
      details: { source: 'model' },
    },
  });
});

test('path resolution refuses a reparse point before process launch', async () => {
  const { resolveInvocationPaths } = await import('../spec/adapter-reference.js');
  const snapshot = {
    '.': { kind: 'directory', identity: 'root-1' },
    nested: { kind: 'reparse-point', identity: 'cwd-1' },
    ledger: { kind: 'directory', identity: 'ledger-1' },
  };

  assert.deepEqual(resolveInvocationPaths({
    workspace_root: '/approved/workspace',
    cwd: 'nested',
    ledger: 'ledger',
    before: snapshot,
    after: snapshot,
  }), {
    ok: false,
    error: {
      code: 'path-rejected',
      details: { path_role: 'cwd', component: 'nested', kind: 'reparse-point' },
    },
  });
});

test('bootstrap describe refuses unsupported fixed bootstrap wire', async () => {
  const { describeAdapter } = await import('../spec/adapter-reference.js');

  assert.deepEqual(describeAdapter(
    describeRequest({ bootstrap_wire_version: 2, supported_adapter_contract_versions: [2] }),
    adapterManifest({ adapter_contract_versions: [2] }),
  ), {
    ok: false,
    bootstrap_wire_version: 1,
    error: { code: 'unsupported-bootstrap-wire-version', details: { received: 2 } },
  });
});

test('bootstrap describe refuses static and dynamic identity mismatch', async () => {
  const { describeAdapter } = await import('../spec/adapter-reference.js');

  const result = describeAdapter(
    describeRequest({ supported_adapter_contract_versions: [2] }),
    adapterManifest({ adapter_id: 'example.static', adapter_contract_versions: [2] }),
    dynamicDescribe({
      adapter_id: 'example.dynamic',
      selected_adapter_contract_version: 2,
    }),
  );

  assert.deepEqual(result, {
    ok: false,
    bootstrap_wire_version: 1,
    error: {
      code: 'adapter-identity-mismatch',
      details: { manifest: 'example.static', describe: 'example.dynamic' },
    },
  });
});

test('core capability probe must match the exact core schema and advertised profile', async () => {
  const { referenceCoreCapabilities, verifyCoreProbe } = await import('../spec/adapter-reference.js');
  const describe = dynamicDescribe();
  describe.core.required_core_contract_version = 1;
  assert.deepEqual(verifyCoreProbe(describe, referenceCoreCapabilities()), {
    ok: false,
    error: {
      code: 'core-contract-version-mismatch',
      details: { required: 1, probed: 2 },
    },
  });
});

test('instruction inputs validate ordered bytes and produce an instruction-set digest', async () => {
  const { validateInstructionInput } = await import('../spec/adapter-reference.js');
  const first = Buffer.from('first\n').toString('base64');
  const second = Buffer.from('second\n').toString('base64');

  const result = validateInstructionInput({
    instruction_input_version: 1,
    required: true,
    sources: [
      { source_id: 'one', origin: 'consumer', content_encoding: 'base64', content_base64: first,
        byte_length: 6, sha256: 'sha256:b640e840b19d378660b32fb51ae18d67dccb4a8596a29e7bd72c1b2ae5928f41' },
      { source_id: 'two', origin: 'repository', content_encoding: 'base64', content_base64: second,
        byte_length: 7, sha256: 'sha256:480c2336b410f1ad5f8bf1b28944490255804b65350c527787e74ebdd511e3a4' },
    ],
  }, { max_sources: 2, max_bytes: 13 });

  assert.deepEqual(result, {
    ok: true,
    ordered_sources: ['one', 'two'],
    total_bytes: 13,
    instruction_set_digest: 'sha256:8ee1af3973597b11fd6130e84586b6b7ba382323e96161e83f05c8c1a67c146d',
    diagnostics: [
      {
        ordinal: 0,
        source_id: 'one',
        origin: 'consumer',
        precedence: 0,
        logical_path: null,
        byte_length: 6,
        sha256: 'sha256:b640e840b19d378660b32fb51ae18d67dccb4a8596a29e7bd72c1b2ae5928f41',
      },
      {
        ordinal: 1,
        source_id: 'two',
        origin: 'repository',
        precedence: 1,
        logical_path: null,
        byte_length: 7,
        sha256: 'sha256:480c2336b410f1ad5f8bf1b28944490255804b65350c527787e74ebdd511e3a4',
      },
    ],
  });
});

test('required instruction input cannot silently disappear', async () => {
  const { validateInstructionInput } = await import('../spec/adapter-reference.js');
  assert.deepEqual(validateInstructionInput({
    instruction_input_version: 1,
    required: true,
    sources: [],
  }, { max_sources: 8, max_bytes: 65536 }), {
    ok: false,
    error: { code: 'required-instruction-input-missing', details: {} },
  });
});

test('handoff resume binds bytes, item revision, and instruction set', async () => {
  const { validateHandoffResume } = await import('../spec/adapter-reference.js');
  const handoffBytes = Buffer.from('{"handoff_version":1}\n');
  const digest = `sha256:${(await import('node:crypto')).createHash('sha256').update(handoffBytes).digest('hex')}`;

  assert.deepEqual(validateHandoffResume({
    handoff_bytes: handoffBytes,
    handoff_digest: digest,
    resume_request: {
      item_id: 'wb_01KDWPVNG00000000000000000',
      expected_revision: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      instruction_set_digest: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    },
    current: {
      item_id: 'wb_01KDWPVNG00000000000000000',
      revision: 'sha256:3333333333333333333333333333333333333333333333333333333333333333',
      instruction_set_digest: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    },
    max_bytes: 1024,
  }), {
    ok: false,
    error: {
      code: 'handoff-stale-item-revision',
      details: {
        expected: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
        current: 'sha256:3333333333333333333333333333333333333333333333333333333333333333',
      },
    },
  });

  assert.equal(validateHandoffResume({
    handoff_bytes: handoffBytes,
    handoff_digest: digest,
    resume_request: {
      item_id: 'generic-safe-id',
      expected_revision: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      instruction_set_digest: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    },
    current: {
      item_id: 'generic-safe-id',
      revision: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      instruction_set_digest: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    },
    max_bytes: 1024,
  }).error.code, 'invalid-handoff-resume-request');
});
