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

test('forwards a verbatim claimed-item-write-refused fence refusal as a deterministic outcome', () => {
  assert.equal(bothEngines(createInvocation(claimedItemWriteRefused())), null);
});
