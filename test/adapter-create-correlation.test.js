import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { mapProcessOutcome } from '../src/adapter/process-outcome.js';
import { mapProcessOutcome as referenceMapProcessOutcome } from '../spec/adapter-reference.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const createRequestPath = path.join(projectRoot, 'spec', 'fixtures', 'mutations', 'create', 'request.json');

// Runs the real core against an isolated ledger and returns what the adapter
// would observe. The envelope is an observation, never an expectation: the
// expectation asserted below is hand-authored — a committed create is
// forwarded, not reported as an unknown outcome.
async function observedCreate(t, schemaVersion) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-create-correlation-'));
  t.after(() => rm(temporary, { force: true, recursive: true }));
  const ledger = path.join(temporary, 'ledger');
  await mkdir(ledger);
  const input = await readFile(createRequestPath);
  if (schemaVersion === 1) {
    // A ledger's schema version is declared by the items already in it, so one
    // seeded schema 1 item makes the core create a schema 1, number-less item.
    await cp(
      path.join(projectRoot, 'spec', 'fixtures', 'mutations', 'patch-body', 'ledger'),
      ledger,
      { recursive: true },
    );
  }
  const core = spawnSync(process.execPath, [
    path.join(projectRoot, 'bin', 'wowbagger.js'),
    'create', '--ledger', ledger, '--input', '-', '--json',
  ], { cwd: projectRoot, input, encoding: null });
  assert.equal(core.status, 0, core.stderr?.toString('utf8'));
  return {
    input,
    process: {
      started: true,
      input_delivery: 'delivered',
      process_tree_contained: true,
      orphaned: false,
      exit_code: 0,
      signal: null,
      timed_out: false,
      stdout_complete: true,
      stderr_complete: true,
      stdout_base64: core.stdout.toString('base64'),
      stderr_base64: core.stderr.toString('base64'),
    },
  };
}

function outcomeContext(observed) {
  return {
    adapter_contract_version: 2,
    request_id: 'create-correlation-0001',
    command: 'create',
    core_request: {
      command: 'create',
      ledger: 'ledger',
      input_base64: observed.input.toString('base64'),
    },
    mutation_input: observed.input,
    item_id: 'wb_01Q45X474N28T5CY4GNF6YY4HM',
    expected_revision: null,
    stdout_limit_bytes: 65536,
    stderr_limit_bytes: 4096,
    process: observed.process,
  };
}

for (const schemaVersion of [1, 2]) {
  test(`forwards a committed schema ${schemaVersion} create instead of reporting an unknown outcome`, async (t) => {
    const observed = await observedCreate(t, schemaVersion);
    const context = outcomeContext(observed);

    const shipped = mapProcessOutcome(context);
    const reference = referenceMapProcessOutcome(context);

    assert.equal(shipped, null, JSON.stringify(shipped));
    assert.equal(reference, null, JSON.stringify(reference));
  });
}

// The number and schema version are the two members only the core can decide;
// everything else in the candidate stays pinned to the request bytes. A core
// that answers with a number it did not assign must still be refused.
test('refuses a committed create whose reported number contradicts its own source bytes', async (t) => {
  const observed = await observedCreate(t, 2);
  const envelope = JSON.parse(Buffer.from(observed.process.stdout_base64, 'base64').toString('utf8'));
  envelope.result.item.core.number += 1;
  const tampered = Buffer.from(`${JSON.stringify(envelope)}\n`);
  const context = outcomeContext(observed);
  context.process = { ...observed.process, stdout_base64: tampered.toString('base64') };

  assert.equal(mapProcessOutcome(context)?.error.code, 'mutation-outcome-unknown');
  assert.equal(referenceMapProcessOutcome(context)?.error.code, 'mutation-outcome-unknown');
});
