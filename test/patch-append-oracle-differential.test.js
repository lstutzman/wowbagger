import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { mapProcessOutcome } from '../spec/adapter-reference.js';
import { validatePatchRequest } from '../src/mutation.js';

// Both directions of the body_append request rule, compared against each other.
// The core's validator and the independent oracle are separate implementations
// of one contract sentence; weakening either alone has to turn this red.
const ITEM = 'wb_01Q45X474N28T5CY4GNF6YY4HM';
const REVISION = `sha256:${'a'.repeat(64)}`;

function patchRequest(set) {
  return { id: ITEM, expected_revision: REVISION, date: '2030-01-20', set };
}

// A deterministic refusal response. The oracle's request check runs on the way
// to mapping it, so an accepted request maps cleanly and a refused one becomes
// mutation-outcome-unknown.
function refusalResponse() {
  return {
    ok: false,
    command: 'patch',
    contract_version: 5,
    state: 'unchanged',
    error: {
      code: 'patch-precondition-failed',
      message: 'The requested patch failed its preconditions.',
      details: {
        id: ITEM,
        issues: [{
          code: 'date-before-updated',
          field: 'date',
          message: 'Patch date must not be earlier than the current updated date.',
          related_ids: [],
          item_created: '2030-01-14',
          item_updated: '2030-01-16',
        }],
      },
    },
  };
}

function oracleAccepts(request, response = refusalResponse()) {
  const mutationInput = Buffer.from(`${JSON.stringify(request)}\n`);
  const outcome = mapProcessOutcome({
    adapter_contract_version: 2,
    request_id: 'reference-patch-append-0001',
    command: 'patch',
    core_request: { command: 'patch', ledger: 'ledger', input_base64: mutationInput.toString('base64') },
    mutation_input: mutationInput,
    item_id: request.id,
    expected_revision: request.expected_revision,
    process: {
      started: true,
      process_tree_contained: true,
      orphaned: false,
      exit_code: response.ok ? 0 : 2,
      signal: null,
      timed_out: false,
      stdout_complete: true,
      stderr_complete: true,
      stdout_base64: Buffer.from(`${JSON.stringify(response)}\n`).toString('base64'),
      stderr_base64: '',
    },
  });
  return outcome === null;
}

const ACCEPTED = [
  { body_append: '' },
  { body_append: '\nAn appended note.\n' },
  { body_append: 'x', priority: 2 },
  { body: '\nA replacement.\n' },
];

const REFUSED = [
  { body_append: null },
  { body_append: 5 },
  { body_append: ['line'] },
  { body: '\nA replacement.\n', body_append: '\nAn addition.\n' },
  { body: null, body_append: '\nAn addition.\n' },
];

test('the core and the oracle agree on which body_append requests are well formed', () => {
  for (const set of ACCEPTED) {
    const request = patchRequest(set);
    assert.deepEqual(validatePatchRequest(request), [], JSON.stringify(set));
    assert.equal(oracleAccepts(request), true, JSON.stringify(set));
  }
  for (const set of REFUSED) {
    const request = patchRequest(set);
    assert.notEqual(validatePatchRequest(request).length, 0, JSON.stringify(set));
    assert.equal(oracleAccepts(request), false, JSON.stringify(set));
  }
});

test('the oracle correlates an appended result body as a suffix of the item it reads back', () => {
  const request = patchRequest({ body_append: '\nAn appended note.\n' });
  const frontmatter = [
    '---',
    'schema_version: 1',
    `id: ${ITEM}`,
    'title: "Mirror of a legacy card"',
    'kind: task',
    'status: backlog',
    'created: 2030-01-10',
    'updated: 2030-01-20',
    'provenance:',
    '  source: "fixture/mutations"',
    '  recorded_at: "2030-01-10T12:00:00Z"',
    'depends_on: []',
    'related: []',
    '---',
    '',
  ].join('\n');
  const success = (body) => ({
    ok: true,
    command: 'patch',
    contract_version: 5,
    state: 'committed',
    result: {
      item: {
        id: ITEM,
        path: `${ITEM}.md`,
        revision: `sha256:${createHash('sha256').update(Buffer.from(`${frontmatter}${body}`, 'utf8')).digest('hex')}`,
        source_encoding: 'base64',
        source_media_type: 'text/markdown; charset=utf-8',
        source_base64: Buffer.from(`${frontmatter}${body}`, 'utf8').toString('base64'),
        core: {
          schema_version: 1,
          id: ITEM,
          title: 'Mirror of a legacy card',
          kind: 'task',
          status: 'backlog',
          created: '2030-01-10',
          updated: '2030-01-20',
          provenance: { source: 'fixture/mutations', recorded_at: '2030-01-10T12:00:00Z' },
          depends_on: [],
          related: [],
        },
        body,
      },
    },
  });

  assert.equal(oracleAccepts(request, success('\nThe kept body.\n\nAn appended note.\n')), true);
  assert.equal(oracleAccepts(request, success('\nThe kept body.\n')), false);
  assert.equal(oracleAccepts(request, success('\nAn appended note.\n\nThe kept body.\n')), false);
});
