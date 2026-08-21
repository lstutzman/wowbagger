import assert from 'node:assert/strict';
import test from 'node:test';

import { mapProcessOutcome } from '../src/adapter/process-outcome.js';
import { mapProcessOutcome as referenceMapProcessOutcome } from '../spec/adapter-reference.js';

const NAMESPACE = 'wbns_1111111111111111111111111111111f';
const CREATE_ID = 'wb_01Q45X474N28T5CY4GNF6YY4HM';
const TARGET_ID = 'wb_01Q4837BM01W70T30B184GG1R6';
const REVISION = `sha256:${'1'.repeat(64)}`;

const CREATE_REQUEST = Object.freeze({
  id: CREATE_ID,
  item: {
    title: 'Map a fictional moon route',
    kind: 'task',
    provenance: {
      source: 'fixture/mutations',
      recorded_at: '2030-01-10T12:34:56.789Z',
    },
    depends_on: [],
    related: [],
  },
  body: '\nPlot a fictional route from Brindle Station to Lumen Reef.\n',
});

const TRANSITION_REQUEST = Object.freeze({
  id: TARGET_ID,
  expected_revision: REVISION,
  to_status: 'done',
  date: '2030-01-11',
  decision: {
    summary: 'Complete the fictional chart update.',
    rationale: 'The fenced publication vector commits this valid successor.',
  },
});

function readBack(itemId) {
  return {
    ledger_namespace: NAMESPACE,
    item_id: itemId,
    observed_at: '2030-01-11T09:00:01.000Z',
    last_epoch: '6',
    active: {
      owner_id: 'agent-a-run-1',
      epoch: '6',
      issued_at: '2030-01-11T09:00:00.000Z',
      expires_at: '2030-01-11T09:05:00.000Z',
    },
  };
}

function fenceRefusal({ command, code, message, details, state = 'unchanged' }) {
  return {
    ok: false,
    namespace: 'ledger-mutation',
    command: `${command}-v1`,
    contract_version: 1,
    state,
    error: { code, message, details },
  };
}

function claimedItemWriteRefused(overrides = {}) {
  return fenceRefusal({
    command: 'create',
    code: 'claimed-item-write-refused',
    message: 'Legacy create cannot write an item identity with claim history.',
    details: readBack(CREATE_ID),
    ...overrides,
  });
}

function observation(stdout, exitCode) {
  return {
    started: true,
    process_tree_contained: true,
    orphaned: false,
    exit_code: exitCode,
    signal: null,
    timed_out: false,
    stdout_complete: true,
    stderr_complete: true,
    stdout_base64: Buffer.from(`${JSON.stringify(stdout)}\n`).toString('base64'),
    stderr_base64: '',
  };
}

function createInvocation(stdout, exitCode = 4) {
  return {
    adapter_contract_version: 2,
    request_id: 'fence-create-0001',
    command: 'create',
    core_request: { command: 'create', ledger: 'ledger', input_base64: '' },
    mutation_request: CREATE_REQUEST,
    item_id: CREATE_ID,
    expected_revision: null,
    process: observation(stdout, exitCode),
  };
}

function transitionInvocation(stdout, exitCode = 4) {
  return {
    adapter_contract_version: 2,
    request_id: 'fence-transition-0001',
    command: 'transition',
    core_request: { command: 'transition', ledger: 'ledger', input_base64: '' },
    mutation_request: TRANSITION_REQUEST,
    item_id: TARGET_ID,
    expected_revision: REVISION,
    process: observation(stdout, exitCode),
  };
}

function bothEngines(invocation) {
  const shipped = mapProcessOutcome(invocation);
  const oracle = referenceMapProcessOutcome(invocation);
  assert.deepEqual(shipped, oracle, 'shipped adapter and oracle must agree');
  return shipped;
}

function activeClaimWriteRefused(command, overrides = {}) {
  return fenceRefusal({
    command,
    code: 'active-claim-write-refused',
    message: 'Legacy transition cannot write an item with an active claim.',
    details: readBack(TARGET_ID),
    ...overrides,
  });
}

function claimStoreUnavailable(command, details, state = 'unchanged') {
  return fenceRefusal({
    command,
    code: 'claim-store-unavailable',
    message: 'The durable claim store is unavailable.',
    details,
    state,
  });
}

const RECONCILIATION_DETAILS = Object.freeze({
  reason: 'publication-reconciliation-required',
  findings: [{
    code: 'stale-write-detected',
    item_id: TARGET_ID,
    actual_revision: null,
    expected_revision: REVISION,
    observed_surface: 'git-head',
    reason: 'git-finalization-required',
    expected_path: `${TARGET_ID}.md`,
    remediation: `Commit ${TARGET_ID}.md in Git, then run claim-verify.`,
  }],
});

function patchInvocation(stdout, exitCode = 4) {
  return {
    adapter_contract_version: 2,
    request_id: 'fence-patch-0001',
    command: 'patch',
    core_request: { command: 'patch', ledger: 'ledger', input_base64: '' },
    mutation_request: {
      id: TARGET_ID,
      expected_revision: REVISION,
      date: '2030-01-11',
      set: { priority: 1 },
    },
    item_id: TARGET_ID,
    expected_revision: REVISION,
    process: observation(stdout, exitCode),
  };
}

test('forwards a verbatim claimed-item-write-refused fence refusal as a deterministic outcome', () => {
  assert.equal(bothEngines(createInvocation(claimedItemWriteRefused())), null);
});

test('forwards a verbatim active-claim-write-refused transition fence refusal', () => {
  assert.equal(bothEngines(transitionInvocation(activeClaimWriteRefused('transition'))), null);
});

test('forwards a verbatim active-claim-write-refused patch fence refusal', () => {
  assert.equal(bothEngines(patchInvocation(activeClaimWriteRefused('patch'))), null);
});

test('forwards a claim-store-unavailable refusal that names findings and remediation', () => {
  assert.equal(
    bothEngines(createInvocation(
      claimStoreUnavailable('create', RECONCILIATION_DETAILS),
      6,
    )),
    null,
  );
});

test('forwards a claim-store-unavailable refusal whose reason carries no findings', () => {
  assert.equal(
    bothEngines(createInvocation(
      claimStoreUnavailable('create', { reason: 'claim-store-locked' }),
      6,
    )),
    null,
  );
});

test('keeps an unknown-state claim-store-unavailable refusal an unknown mutation outcome', () => {
  const result = bothEngines(createInvocation(
    claimStoreUnavailable('create', {
      reason: 'legacy-mutation-outcome-unknown',
      attempt_id: '5f4d2c1b-0000-4000-8000-000000000000',
      candidate_revision: REVISION,
    }, 'unknown'),
    6,
  ));

  assert.equal(result.error.code, 'mutation-outcome-unknown');
  assert.equal(result.mutation_outcome, 'unknown');
  assert.equal(result.process.core_envelope_valid, true);
});

test('refuses a fence refusal whose namespace is not the ledger-mutation domain', () => {
  const result = bothEngines(createInvocation(
    { ...claimedItemWriteRefused(), namespace: 'work-claim' },
  ));

  assert.equal(result.error.code, 'mutation-outcome-unknown');
});

test('refuses a fence refusal whose command does not name the launched command', () => {
  const result = bothEngines(createInvocation(
    { ...claimedItemWriteRefused(), command: 'transition-v1' },
  ));

  assert.equal(result.error.code, 'mutation-outcome-unknown');
});

test('refuses a fence refusal carrying the core contract version', () => {
  const result = bothEngines(createInvocation(
    { ...claimedItemWriteRefused(), contract_version: 5 },
  ));

  assert.equal(result.error.code, 'mutation-outcome-unknown');
});

test('refuses a fence refusal whose exit does not match its code', () => {
  const result = bothEngines(createInvocation(claimedItemWriteRefused(), 6));

  assert.equal(result.error.code, 'mutation-outcome-unknown');
});

test('refuses a create fence refusal that names the transition refusal code', () => {
  const result = bothEngines(createInvocation(
    activeClaimWriteRefused('create', { details: readBack(CREATE_ID) }),
  ));

  assert.equal(result.error.code, 'mutation-outcome-unknown');
});

test('refuses a fence refusal whose read-back names another item', () => {
  const result = bothEngines(createInvocation(
    claimedItemWriteRefused({ details: readBack(TARGET_ID) }),
  ));

  assert.equal(result.error.code, 'mutation-outcome-unknown');
});

test('refuses a claimed-item-write-refused refusal that reports no claim history', () => {
  const result = bothEngines(createInvocation(
    claimedItemWriteRefused({
      details: { ...readBack(CREATE_ID), last_epoch: '0', active: null },
    }),
  ));

  assert.equal(result.error.code, 'mutation-outcome-unknown');
});

test('refuses an active-claim-write-refused refusal that reports no active claim', () => {
  const result = bothEngines(transitionInvocation(
    activeClaimWriteRefused('transition', {
      details: { ...readBack(TARGET_ID), active: null },
    }),
  ));

  assert.equal(result.error.code, 'mutation-outcome-unknown');
});

test('refuses a reconciliation refusal whose findings name no remediation', () => {
  const result = bothEngines(createInvocation(
    claimStoreUnavailable('create', {
      reason: 'publication-reconciliation-required',
      findings: [{ code: 'pending-intent-resolved', item_id: TARGET_ID, outcome: 'committed' }],
    }),
    6,
  ));

  assert.equal(result.error.code, 'mutation-outcome-unknown');
});

test('refuses a reconciliation refusal that carries no findings at all', () => {
  const result = bothEngines(createInvocation(
    claimStoreUnavailable('create', { reason: 'publication-reconciliation-required' }),
    6,
  ));

  assert.equal(result.error.code, 'mutation-outcome-unknown');
});

test('refuses a fence refusal answering a request the caller never made canonically', () => {
  const invocation = createInvocation(claimedItemWriteRefused());
  invocation.mutation_request = { ...CREATE_REQUEST, unknown_member: true };

  const result = bothEngines(invocation);

  assert.equal(result.error.code, 'mutation-outcome-unknown');
});

test('refuses a legacy fence refusal that declares an unknown state', () => {
  const result = bothEngines(createInvocation(
    claimedItemWriteRefused({ state: 'unknown' }),
  ));

  assert.equal(result.error.code, 'mutation-outcome-unknown');
  assert.equal(result.process.core_envelope_valid, false);
});

test('refuses a fence refusal carrying an undocumented root member', () => {
  const result = bothEngines(createInvocation(
    { ...claimedItemWriteRefused(), operation_id: 'wbop_0000' },
  ));

  assert.equal(result.error.code, 'mutation-outcome-unknown');
});

test('refuses a fence refusal carrying an undocumented error member', () => {
  const refusal = claimedItemWriteRefused();
  refusal.error = { ...refusal.error, retry_after: 30 };

  const result = bothEngines(createInvocation(refusal));

  assert.equal(result.error.code, 'mutation-outcome-unknown');
});

test('refuses a fence envelope that claims success', () => {
  const result = bothEngines(createInvocation(
    { ...claimedItemWriteRefused(), ok: true },
  ));

  assert.equal(result.error.code, 'mutation-outcome-unknown');
});

test('refuses a fence refusal that substitutes free-form prose for its message', () => {
  const refusal = claimedItemWriteRefused();
  refusal.error = { ...refusal.error, message: 'Create refused because the item was claimed.' };

  const result = bothEngines(createInvocation(refusal));

  assert.equal(result.error.code, 'mutation-outcome-unknown');
});

test('refuses a fence refusal whose read-back namespace is not a claim namespace', () => {
  const result = bothEngines(createInvocation(
    claimedItemWriteRefused({
      details: { ...readBack(CREATE_ID), ledger_namespace: 'ledger-one' },
    }),
  ));

  assert.equal(result.error.code, 'mutation-outcome-unknown');
});

test('refuses a fence refusal whose epoch is not a canonical unsigned integer', () => {
  const result = bothEngines(createInvocation(
    claimedItemWriteRefused({
      details: { ...readBack(CREATE_ID), last_epoch: '06' },
    }),
  ));

  assert.equal(result.error.code, 'mutation-outcome-unknown');
});

test('refuses a fence refusal whose active claim names no owner', () => {
  const details = readBack(TARGET_ID);
  const result = bothEngines(transitionInvocation(
    activeClaimWriteRefused('transition', {
      details: { ...details, active: { ...details.active, owner_id: '' } },
    }),
  ));

  assert.equal(result.error.code, 'mutation-outcome-unknown');
});

test('refuses a fence refusal whose active claim is missing an expiry', () => {
  const { expires_at, ...active } = readBack(TARGET_ID).active;
  const result = bothEngines(transitionInvocation(
    activeClaimWriteRefused('transition', {
      details: { ...readBack(TARGET_ID), active },
    }),
  ));

  assert.equal(result.error.code, 'mutation-outcome-unknown');
});

test('refuses a reconciliation finding that names no item', () => {
  const result = bothEngines(createInvocation(
    claimStoreUnavailable('create', {
      reason: 'publication-reconciliation-required',
      findings: [{
        code: 'stale-write-detected',
        item_id: 'not-an-item-id',
        remediation: 'Commit the item in Git, then run claim-verify.',
      }],
    }),
    6,
  ));

  assert.equal(result.error.code, 'mutation-outcome-unknown');
});

test('refuses a claim-store-unavailable refusal that names no reason', () => {
  const result = bothEngines(createInvocation(
    claimStoreUnavailable('create', { findings: RECONCILIATION_DETAILS.findings }),
    6,
  ));

  assert.equal(result.error.code, 'mutation-outcome-unknown');
});

test('refuses a ledger-mutation envelope answering an inspect request', () => {
  const result = bothEngines({
    adapter_contract_version: 2,
    request_id: 'fence-inspect-0002',
    command: 'inspect',
    core_request: null,
    process: observation(
      claimedItemWriteRefused({ command: 'inspect' }),
      4,
    ),
  });

  assert.equal(result.error.code, 'core-protocol-error');
});

test('refuses a fence refusal whose read-back carries an undocumented member', () => {
  const result = bothEngines(createInvocation(
    claimedItemWriteRefused({
      details: { ...readBack(CREATE_ID), owner_hint: 'agent-a' },
    }),
  ));

  assert.equal(result.error.code, 'mutation-outcome-unknown');
});

test('refuses a fence refusal whose active claim carries an undocumented member', () => {
  const details = readBack(TARGET_ID);
  const result = bothEngines(transitionInvocation(
    activeClaimWriteRefused('transition', {
      details: { ...details, active: { ...details.active, fence_token: 'opaque' } },
    }),
  ));

  assert.equal(result.error.code, 'mutation-outcome-unknown');
});

test('refuses a namespaced envelope answering a read-only command', () => {
  const result = bothEngines({
    adapter_contract_version: 2,
    request_id: 'fence-inspect-0001',
    command: 'inspect',
    core_request: { command: 'inspect', ledger: 'ledger', id: CREATE_ID },
    process: observation(claimedItemWriteRefused(), 4),
  });

  assert.equal(result.error.code, 'core-protocol-error');
});
