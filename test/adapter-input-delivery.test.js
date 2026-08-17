import assert from 'node:assert/strict';
import test from 'node:test';

import { mapProcessOutcome } from '../src/adapter/process-outcome.js';
import { mapProcessOutcome as referenceMapProcessOutcome } from '../spec/adapter-reference.js';

// Item 109: `launchCoreProcess` reports whether the core actually received its
// request. These cases pin what the classifier does with that fact. A run the
// timeout ended after an undelivered request is diagnosable, so it must not be
// reported as the unobservable `core-timeout`.

const READY_ENVELOPE = Buffer.from('{"as_of":"2030-01-15","valid":true,"ready":[]}\n')
  .toString('base64');

function observation(overrides = {}) {
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
    ...overrides,
  };
}

function readOutcome(process) {
  return mapProcessOutcome({
    adapter_contract_version: 2,
    request_id: 'input-delivery-0001',
    command: 'ready',
    core_request: { command: 'ready', ledger: 'ledger', as_of: '2030-01-15' },
    stdout_limit_bytes: 4096,
    stderr_limit_bytes: 4096,
    process,
  });
}

test('refuses an input delivery state outside the documented domain', () => {
  const outcome = readOutcome(observation({ input_delivery: 'maybe' }));

  assert.equal(outcome.error.code, 'core-observation-incomplete');
  assert.deepEqual(outcome.error.details, {
    reason: 'invalid-process-observation',
    member: 'input_delivery',
  });
});

// A core that never started was never written to. An observation that claims a
// delivery state anyway contradicts its own `started: false`, and a contradicted
// observation is never allowed to prove a clean non-start.
test('refuses a delivery state on an observation that proves no launch', () => {
  const outcome = readOutcome(observation({
    started: false,
    exit_code: null,
    signal: null,
    timed_out: false,
    input_delivery: 'delivered',
  }));

  assert.equal(outcome.error.code, 'core-observation-incomplete');
  assert.deepEqual(outcome.error.details, {
    reason: 'invalid-process-observation',
    member: 'not-started-state',
  });
});

test('names a read whose request the core refused rather than calling it a timeout', () => {
  const outcome = readOutcome(observation({ input_delivery: 'failed' }));

  assert.equal(outcome.error.code, 'core-observation-incomplete');
  assert.deepEqual(outcome.error.details, {
    reason: 'core-input-undelivered',
    input_delivery: 'failed',
  });
  assert.equal(outcome.process.timed_out, true);
});

test('names a read whose request the core never drained rather than calling it a timeout', () => {
  const outcome = readOutcome(observation({ input_delivery: 'unread' }));

  assert.equal(outcome.error.code, 'core-observation-incomplete');
  assert.deepEqual(outcome.error.details, {
    reason: 'core-input-undelivered',
    input_delivery: 'unread',
  });
});

test('keeps a timeout that followed a delivered request an ordinary core timeout', () => {
  const outcome = readOutcome(observation({ input_delivery: 'delivered' }));

  assert.equal(outcome.error.code, 'core-timeout');
  assert.deepEqual(outcome.error.details, {});
});

// A runner that makes no delivery claim keeps the classification it always had.
// The new outcome is reachable only through an observation that reports the
// undelivered write, so no existing observation changes meaning.
test('keeps a timeout an ordinary core timeout when the runner claims no delivery state', () => {
  const outcome = readOutcome(observation());

  assert.equal(outcome.error.code, 'core-timeout');
  assert.deepEqual(outcome.error.details, {});
});

// Item 106's case, unchanged: the write failed because the core had already
// exited. Its exit code and bytes are the whole story, so the run forwards.
test('forwards a complete core result whose input write failed after the core exited', () => {
  const outcome = readOutcome(observation({
    exit_code: 0,
    timed_out: false,
    stdout_base64: READY_ENVELOPE,
    input_delivery: 'failed',
  }));

  assert.equal(outcome, null);
});

test('keeps a signalled core signalled even when its request was undelivered', () => {
  const outcome = readOutcome(observation({
    timed_out: false,
    signal: 'runner-signal',
    input_delivery: 'failed',
  }));

  assert.equal(outcome.error.code, 'core-signaled');
});

// An undelivered request cannot prove a mutation never ran: a partial write may
// have reached the core, and the adapter cannot see what it did with it. Every
// mutation therefore keeps its fail-closed unknown outcome.
test('keeps an undelivered mutation request an unknown mutation outcome', () => {
  for (const inputDelivery of ['failed', 'unread']) {
    const outcome = mapProcessOutcome({
      adapter_contract_version: 2,
      request_id: 'input-delivery-0002',
      command: 'transition',
      core_request: { command: 'transition', ledger: 'ledger', input_base64: '' },
      mutation_request: null,
      item_id: null,
      expected_revision: null,
      stdout_limit_bytes: 4096,
      stderr_limit_bytes: 4096,
      process: observation({ input_delivery: inputDelivery }),
    });

    assert.equal(outcome.error.code, 'mutation-outcome-unknown', inputDelivery);
    assert.equal(outcome.mutation_outcome, 'unknown', inputDelivery);
  }
});

// The oracle is an independent re-implementation, so it has to reach the same
// verdict from the same observation for every delivery state and both command
// classes. Weakening either side alone breaks this case.
test('the shipped engine and the reference oracle classify input delivery identically', () => {
  const deliveryStates = [undefined, 'delivered', 'failed', 'unread', 'maybe'];
  const endings = [
    { label: 'timeout', overrides: {} },
    { label: 'signal', overrides: { timed_out: false, signal: 'runner-signal' } },
    { label: 'clean-exit', overrides: { timed_out: false, exit_code: 0, stdout_base64: READY_ENVELOPE } },
    { label: 'orphaned', overrides: { timed_out: false, exit_code: 0, orphaned: true } },
    { label: 'not-started', overrides: { started: false, timed_out: false } },
  ];
  const commands = [
    { command: 'ready', core_request: { command: 'ready', ledger: 'ledger', as_of: '2030-01-15' } },
    { command: 'transition', core_request: { command: 'transition', ledger: 'ledger', input_base64: '' } },
  ];

  for (const { command, core_request: coreRequest } of commands) {
    for (const { label, overrides } of endings) {
      for (const inputDelivery of deliveryStates) {
        const process = observation({
          ...overrides,
          ...(inputDelivery === undefined ? {} : { input_delivery: inputDelivery }),
        });
        const request = {
          adapter_contract_version: 2,
          request_id: 'input-delivery-differential',
          command,
          core_request: coreRequest,
          mutation_request: null,
          item_id: null,
          expected_revision: null,
          stdout_limit_bytes: 4096,
          stderr_limit_bytes: 4096,
          process,
        };
        assert.deepEqual(
          mapProcessOutcome(request),
          referenceMapProcessOutcome(request),
          `${command}/${label}/${inputDelivery}`,
        );
      }
    }
  }
});
