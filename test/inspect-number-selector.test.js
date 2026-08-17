import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  invokeAdapter as referenceInvokeAdapter,
  mapProcessOutcome as referenceMapProcessOutcome,
  referenceCoreCapabilities,
} from '../spec/adapter-reference.js';
import { coreCapabilities } from '../src/adapter/core-probe.js';
import { invokeAdapter } from '../src/adapter/invoke.js';
import { mapProcessOutcome } from '../src/adapter/process-outcome.js';
import { adapterManifest, describeRequest, dynamicDescribe } from './adapter-contract-fixtures.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const ITEM_ID = 'wb_01Q45X474N28T5CY4GNF6YY4HM';

function read(relativePath) {
  return readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

const contract = read('docs/mutation-contract.md');

// Prose wraps and carries Markdown emphasis, so a required phrase is matched
// word by word: any run of whitespace or backticks may separate the words.
function phrase(text) {
  return new RegExp(text.split(' ').map(escape).join('[\\s`*]+'));
}

function escape(word) {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function section(heading) {
  const start = contract.indexOf(heading);
  assert.notEqual(start, -1, `missing heading ${heading} in the mutation contract`);
  const next = contract.indexOf('\n## ', start + heading.length);
  return contract.slice(start, next === -1 ? contract.length : next);
}

test('the contract documents the selector the item-not-found details echo', () => {
  const reads = section('## 5. Reads, revisions, and lossless inspection');

  assert.match(
    reads,
    phrase('details containing exactly the selector the request used'),
    'section 5 must state that the details echo the selector, not a fixed member',
  );
  assert.match(
    reads,
    phrase('id when the request selected by --id'),
    'section 5 must name the id-selector detail',
  );
  assert.match(
    reads,
    phrase('number when it selected by --number'),
    'section 5 must name the number-selector detail',
  );
  assert.doesNotMatch(
    reads,
    phrase('details containing only id'),
    'section 5 must not keep the id-only claim the runtime never honoured',
  );
});

test('the contract states which commands can ever emit the number-selector detail', () => {
  const reads = section('## 5. Reads, revisions, and lossless inspection');

  assert.match(
    reads,
    phrase('Only inspect accepts --number'),
    'section 5 must confine the number selector to inspect',
  );
  assert.match(
    reads,
    phrase('so their details contain only id'),
    'section 5 must keep every other item-not-found refusal id-only',
  );
});

test('the version prose records the selector detail as documentation, not a wire change', () => {
  const versions = section('## Contract versions');

  assert.match(
    versions,
    phrase('the documented inspect selector detail'),
    'the version 3 delta list must name this entry',
  );
  assert.match(
    versions,
    phrase('release already emits'),
    'the version prose must say the published release already emits this shape',
  );
  assert.match(
    versions,
    /0\.1\.0-alpha\.5/,
    'the version prose must name the release that already emits it',
  );
});

// The contract documents the number-selector detail, and the adapter surfaces
// stay id-only on purpose: the adapter has no way to ask for a number, so it
// can never receive that detail. These guards hold both halves of that reason
// in place — remove either and the id-only adapter surfaces become a lie.

function inspectRuntime(coreProbe, launch) {
  return {
    max_request_bytes: 65536,
    describe_request: describeRequest(),
    manifest: adapterManifest(),
    dynamic: dynamicDescribe(),
    core_probe: coreProbe,
    package_root: '/installed/adapter',
    workspaces: {
      'review-workspace': {
        root: '/approved/workspace',
        before: {
          '.': { kind: 'directory', identity: 'root-1' },
          ledger: { kind: 'directory', identity: 'ledger-1' },
        },
        after: {
          '.': { kind: 'directory', identity: 'root-1' },
          ledger: { kind: 'directory', identity: 'ledger-1' },
        },
      },
    },
    launch,
  };
}

function inspectRequest(coreRequest) {
  return {
    adapter_contract_version: 2,
    request_id: 'inspect-number-selector-0001',
    core_request: coreRequest,
    workspace: { workspace_id: 'review-workspace' },
    instruction_input: { instruction_input_version: 1, required: false, sources: [] },
    handoff_carrier: null,
    limits: { context_bytes: 0, stdout_bytes: 4096, stderr_bytes: 1024, timeout_ms: 1000 },
  };
}

function processObservation(stdout, exitCode) {
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

test('neither adapter surface can select an item by number', async () => {
  const selectors = [
    { command: 'inspect', ledger: 'ledger', number: 2 },
    { command: 'inspect', ledger: 'ledger', id: ITEM_ID, number: 2 },
  ];

  for (const coreRequest of selectors) {
    const bytes = Buffer.from(`${JSON.stringify(inspectRequest(coreRequest))}\n`);
    let launches = 0;
    const launch = async () => {
      launches += 1;
      throw new Error('the adapter must refuse before it launches the core');
    };

    const engine = await invokeAdapter(bytes, inspectRuntime(coreCapabilities(), launch));
    const oracle = await referenceInvokeAdapter(
      bytes,
      inspectRuntime(referenceCoreCapabilities(), launch),
    );

    assert.equal(launches, 0, 'a number selector must never reach the core');
    for (const [name, result] of [['the engine', engine], ['the oracle', oracle]]) {
      assert.equal(result.ok, false, `${name} must refuse a number selector`);
      assert.equal(result.error.code, 'invalid-invocation', `${name} must name the invocation`);
      assert.deepEqual(result.error.details, { member: 'core_request' });
    }
  }
});

test('neither adapter surface accepts a forwarded number-selector not-found detail', () => {
  const responseContext = {
    adapter_contract_version: 2,
    request_id: 'inspect-number-forward-0001',
    command: 'inspect',
    core_request: { command: 'inspect', ledger: 'ledger', id: ITEM_ID },
    process: processObservation({
      ok: false,
      command: 'inspect',
      contract_version: 3,
      error: {
        code: 'item-not-found',
        message: 'The requested item was not found.',
        details: { number: 2 },
      },
    }, 2),
  };

  assert.equal(mapProcessOutcome(responseContext)?.error?.code, 'core-protocol-error');
  assert.equal(referenceMapProcessOutcome(responseContext)?.error?.code, 'core-protocol-error');
});

test('both adapter surfaces still forward the id-selector not-found refusal', () => {
  const responseContext = {
    adapter_contract_version: 2,
    request_id: 'inspect-id-forward-0001',
    command: 'inspect',
    core_request: { command: 'inspect', ledger: 'ledger', id: ITEM_ID },
    process: processObservation({
      ok: false,
      command: 'inspect',
      contract_version: 3,
      error: {
        code: 'item-not-found',
        message: 'The requested item was not found.',
        details: { id: ITEM_ID },
      },
    }, 2),
  };

  // null is the surfaces' verdict that nothing is wrong: forward the refusal.
  assert.equal(mapProcessOutcome(responseContext), null);
  assert.equal(referenceMapProcessOutcome(responseContext), null);
});
