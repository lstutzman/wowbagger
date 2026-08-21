import assert from 'node:assert/strict';
import test from 'node:test';

import { mapProcessOutcome as referenceMapProcessOutcome } from '../spec/adapter-reference.js';
import { mapProcessOutcome } from '../src/adapter/process-outcome.js';

const LIMIT = 8388608;
const ITEM_ID = 'wb_01Q45X474N28T5CY4GNF6YY4HM';
const REVISION = `sha256:${'a'.repeat(64)}`;

const MUTATION_REQUESTS = {
  create: {
    id: ITEM_ID,
    item: {
      title: 'Bound the item source',
      kind: 'task',
      provenance: { source: 'fixture/adapter', recorded_at: '2030-01-10T12:34:56.789Z' },
      depends_on: [],
      related: [],
    },
    body: '\nbody\n',
  },
  transition: {
    id: ITEM_ID,
    expected_revision: REVISION,
    to_status: 'backlog',
    date: '2030-01-13',
    decision: { summary: 'Accept.', rationale: 'Because.' },
  },
  patch: {
    id: ITEM_ID,
    expected_revision: REVISION,
    date: '2030-01-13',
    set: { body: '\nbody\n' },
  },
};

function refusalEnvelope(command, details) {
  return Buffer.from(`${JSON.stringify({
    ok: false,
    command,
    contract_version: 5,
    state: 'unchanged',
    error: {
      code: 'item-source-too-large',
      message: 'The proposed item source exceeds the supported byte limit.',
      details,
    },
  })}\n`);
}

function contextFor(command, stdout) {
  const input = Buffer.from(JSON.stringify(MUTATION_REQUESTS[command]));
  return {
    adapter_contract_version: 2,
    request_id: 'item-source-limit-0001',
    command,
    core_request: { command, ledger: 'ledger', input_base64: input.toString('base64') },
    mutation_input: input,
    item_id: ITEM_ID,
    expected_revision: command === 'create' ? null : REVISION,
    stdout_limit_bytes: 65536,
    stderr_limit_bytes: 4096,
    process: {
      started: true,
      input_delivery: 'delivered',
      process_tree_contained: true,
      orphaned: false,
      exit_code: 2,
      signal: null,
      timed_out: false,
      stdout_complete: true,
      stderr_complete: true,
      stdout_base64: stdout.toString('base64'),
      stderr_base64: '',
    },
  };
}

const ENGINES = [
  ['engine', mapProcessOutcome],
  ['oracle', referenceMapProcessOutcome],
];

for (const command of ['create', 'transition', 'patch']) {
  const details = { id: ITEM_ID, size_bytes: LIMIT + 1, limit_bytes: LIMIT };

  for (const [name, map] of ENGINES) {
    test(`${name}: forwards a ${command} item-source-too-large refusal verbatim`, () => {
      const outcome = map(contextFor(command, refusalEnvelope(command, details)));

      assert.equal(outcome, null, JSON.stringify(outcome));
    });

    test(`${name}: refuses a ${command} item-source-too-large refusal at the wrong exit code`, () => {
      const context = contextFor(command, refusalEnvelope(command, details));
      context.process.exit_code = 4;

      assert.equal(map(context)?.error.code, 'mutation-outcome-unknown');
    });

    test(`${name}: refuses a ${command} item-source-too-large refusal with drifted details`, () => {
      const context = contextFor(command, refusalEnvelope(command, {
        ...details, field: 'body',
      }));

      assert.equal(map(context)?.error.code, 'mutation-outcome-unknown');
    });

    test(`${name}: refuses a ${command} refusal advertising a different limit`, () => {
      const context = contextFor(command, refusalEnvelope(command, {
        ...details, limit_bytes: LIMIT * 2,
      }));

      assert.equal(map(context)?.error.code, 'mutation-outcome-unknown');
    });

    // A refusal that names a size at or under the limit contradicts itself.
    test(`${name}: refuses a ${command} refusal whose size is not over the limit`, () => {
      const context = contextFor(command, refusalEnvelope(command, {
        ...details, size_bytes: LIMIT,
      }));

      assert.equal(map(context)?.error.code, 'mutation-outcome-unknown');
    });

    test(`${name}: refuses a ${command} item-source-too-large refusal with a drifted message`, () => {
      const stdout = Buffer.from(`${JSON.stringify({
        ok: false,
        command,
        contract_version: 5,
        state: 'unchanged',
        error: {
          code: 'item-source-too-large',
          message: 'The item is too big.',
          details,
        },
      })}\n`);

      assert.equal(map(contextFor(command, stdout))?.error.code, 'mutation-outcome-unknown');
    });
  }
}

// inspect never proposes a successor, so it can never answer this refusal.
for (const [name, map] of ENGINES) {
  test(`${name}: refuses an inspect item-source-too-large refusal`, () => {
    const context = {
      adapter_contract_version: 2,
      request_id: 'item-source-limit-0002',
      command: 'inspect',
      core_request: { command: 'inspect', ledger: 'ledger', id: ITEM_ID },
      item_id: ITEM_ID,
      expected_revision: null,
      stdout_limit_bytes: 65536,
      stderr_limit_bytes: 4096,
      process: {
        started: true,
        input_delivery: 'delivered',
        process_tree_contained: true,
        orphaned: false,
        exit_code: 2,
        signal: null,
        timed_out: false,
        stdout_complete: true,
        stderr_complete: true,
        stdout_base64: refusalEnvelope('inspect', {
          id: ITEM_ID, size_bytes: LIMIT + 1, limit_bytes: LIMIT,
        }).toString('base64'),
        stderr_base64: '',
      },
    };

    assert.equal(map(context)?.error.code, 'core-protocol-error');
  });
}
