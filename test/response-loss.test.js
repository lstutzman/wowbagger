import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { mapProcessOutcome } from '../src/adapter/process-outcome.js';
import { runCli, withLedger } from './support.js';

const fixtures = new URL('../spec/fixtures/mutations/', import.meta.url);
const CREATE_ID = 'wb_01Q45X474N28T5CY4GNF6YY4HM';

function fixtureText(relativePath) {
  return readFile(fileURLToPath(new URL(relativePath, fixtures)), 'utf8');
}

async function fixtureJson(relativePath) {
  return JSON.parse(await fixtureText(relativePath));
}

// A complete observation: the process exited, both streams are whole, and
// standard output is one envelope plus its final LF. Overrides remove exactly
// one of those guarantees so each response-loss class is isolated.
function observation(envelope, overrides = {}) {
  return {
    started: true,
    process_tree_contained: true,
    orphaned: false,
    exit_code: 6,
    signal: null,
    timed_out: false,
    stdout_complete: true,
    stderr_complete: true,
    stdout_base64: Buffer.from(`${JSON.stringify(envelope)}\n`).toString('base64'),
    stderr_base64: '',
    ...overrides,
  };
}

test('a revision conflict stays a proven non-write at exit 4', async () => {
  const source = await fixtureText('transition-success/before.md');
  const request = await fixtureJson('transition-success/request.json');

  await withLedger({ [`${request.id}.md`]: source }, async (ledger) => {
    const requestPath = path.join(path.dirname(ledger), 'transition.json');
    await writeFile(requestPath, JSON.stringify(request));

    const committed = runCli('transition', '--ledger', ledger, '--input', requestPath, '--json');
    const stale = runCli('transition', '--ledger', ledger, '--input', requestPath, '--json');

    assert.equal(committed.status, 0, committed.stderr);
    assert.equal(stale.status, 4, stale.stderr);
    const envelope = JSON.parse(stale.stdout);
    assert.equal(envelope.error.code, 'revision-conflict');
    // The state is the whole guard: a conflict proves the write did not run, so
    // it can never be read as a lost response.
    assert.equal(envelope.state, 'unchanged');
    const published = Buffer.from(JSON.parse(committed.stdout).result.item.source_base64, 'base64');
    assert.deepEqual(await readFile(path.join(ledger, `${request.id}.md`)), published);
  });
});

test('the adapter forwards a revision conflict instead of calling it response loss', () => {
  const expectedRevision = `sha256:${'a'.repeat(64)}`;
  const mutationRequest = {
    id: CREATE_ID,
    expected_revision: expectedRevision,
    to_status: 'backlog',
    date: '2030-01-13',
  };

  const result = mapProcessOutcome({
    adapter_contract_version: 2,
    request_id: 'response-loss-conflict-0001',
    command: 'transition',
    core_request: { command: 'transition', ledger: 'ledger', input_base64: '' },
    mutation_request: mutationRequest,
    item_id: CREATE_ID,
    expected_revision: expectedRevision,
    process: observation({
      ok: false,
      command: 'transition',
      contract_version: 5,
      state: 'unchanged',
      error: {
        code: 'revision-conflict',
        message: 'The item changed after it was inspected.',
        details: {
          id: CREATE_ID,
          expected_revision: expectedRevision,
          actual_revision: `sha256:${'b'.repeat(64)}`,
        },
      },
    }, { exit_code: 4 }),
  });

  assert.equal(result, null);
});

test('every unresolved observation stays unknown and instructs no retry', () => {
  const expectedRevision = `sha256:${'a'.repeat(64)}`;
  const success = {
    ok: true,
    command: 'transition',
    contract_version: 5,
    state: 'committed',
    result: {},
  };
  const classes = {
    signal: observation(success, { exit_code: null, signal: 'SIGKILL' }),
    timeout: observation(success, { exit_code: null, timed_out: true }),
    'incomplete stdout': observation(success, { stdout_complete: false }),
    'incomplete stderr': observation(success, { stderr_complete: false }),
    'no envelope': observation(success, { stdout_base64: '' }),
    'lost transport': observation(success, { exit_code: null, stdout_base64: '' }),
  };

  for (const [name, process] of Object.entries(classes)) {
    const result = mapProcessOutcome({
      adapter_contract_version: 2,
      request_id: `response-loss-${name.replace(/\s/g, '-')}-0001`,
      command: 'transition',
      item_id: CREATE_ID,
      expected_revision: expectedRevision,
      process,
    });

    assert.equal(result.ok, false, name);
    assert.equal(result.mutation_outcome, 'unknown', name);
    assert.equal(result.error.code, 'mutation-outcome-unknown', name);
    assert.deepEqual(result.error.details.recovery, {
      action: 'validate-inspect-and-compare-revision',
      expected_revision: expectedRevision,
      retry: 'never-before-current-state-review',
    }, name);
  }
});

test('the core exit-6 publication envelopes classify as the contract documents', async () => {
  const cases = [
    ['create/expected-outcome-unknown.json', 'unknown'],
    ['create/expected-post-commit-recovery.json', null],
  ];

  for (const [fixture, expectedOutcome] of cases) {
    const result = mapProcessOutcome({
      adapter_contract_version: 2,
      request_id: 'response-loss-core-envelope-0001',
      command: 'create',
      item_id: CREATE_ID,
      expected_revision: null,
      process: observation(await fixtureJson(fixture)),
    });

    if (expectedOutcome === null) {
      // Committed recovery is an observed result: the item is published and the
      // adapter forwards the core's own instruction rather than hiding it.
      assert.equal(result, null, fixture);
      continue;
    }
    assert.equal(result.mutation_outcome, expectedOutcome, fixture);
    assert.deepEqual(result.error.details.recovery, {
      action: 'inspect-caller-known-id',
      validate_ledger_first: true,
      retry: 'only-after-item-not-found-and-audited-artifact-recovery',
    }, fixture);
  }
});
