import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { mapProcessOutcome } from '../spec/adapter-reference.js';
import { validatePatchRequest } from '../src/mutation.js';

// Both directions of the set.extensions rules, compared against each other.
// The core's validator and the independent oracle are separate implementations
// of one contract section; weakening either alone has to turn this red.
const ITEM = 'wb_01Q45X474N28T5CY4GNF6YY4HM';
const REVISION = `sha256:${'a'.repeat(64)}`;

function patchRequest(set) {
  return { id: ITEM, expected_revision: REVISION, date: '2030-01-20', set };
}

function refusalResponse(issues) {
  return {
    ok: false,
    command: 'patch',
    contract_version: 5,
    state: 'unchanged',
    error: {
      code: 'patch-precondition-failed',
      message: 'The requested patch failed its preconditions.',
      details: { id: ITEM, issues },
    },
  };
}

const DATE_ISSUE = {
  code: 'date-before-updated',
  field: 'date',
  message: 'Patch date must not be earlier than the current updated date.',
  related_ids: [],
  item_created: '2030-01-14',
  item_updated: '2030-01-16',
};

function oracleAccepts(request, response) {
  const mutationInput = Buffer.from(`${JSON.stringify(request)}\n`);
  const outcome = mapProcessOutcome({
    adapter_contract_version: 2,
    request_id: 'reference-patch-extensions-0001',
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

// The request shape stops at the container: which members it may name and what
// each value must be is the ledger's declaration, so an unreadable value here
// is still a well-formed request that the core refuses one stage later.
const ACCEPTED = [
  { extensions: { external_id: 'PC-1475' } },
  { extensions: { external_id: null } },
  { extensions: { sequence: 4, verified: true, tags: ['mirror'] } },
  { extensions: { external_id: { card: 'PC-1475' } } },
  { extensions: { external_id: 7 } },
  { extensions: { external_id: 'PC-1475' }, title: 'Mirror of PC-1475' },
];

const REFUSED = [
  { extensions: {} },
  { extensions: null },
  { extensions: 'external_id' },
  { extensions: ['external_id'] },
];

test('the core and the oracle agree on which set.extensions requests are well formed', () => {
  for (const set of ACCEPTED) {
    const request = patchRequest(set);
    assert.deepEqual(validatePatchRequest(request), [], JSON.stringify(set));
    assert.equal(oracleAccepts(request, refusalResponse([DATE_ISSUE])), true, JSON.stringify(set));
  }
  for (const set of REFUSED) {
    const request = patchRequest(set);
    assert.notEqual(validatePatchRequest(request).length, 0, JSON.stringify(set));
    assert.equal(oracleAccepts(request, refusalResponse([DATE_ISSUE])), false, JSON.stringify(set));
  }
});

// The issue shape stays at four members, so the member at fault is named in
// `field`. The oracle checks that name against the request rather than
// accepting any string, which is what makes the refusal correlate.
test('the oracle accepts an extension refusal only when it names a requested member', () => {
  const request = patchRequest({ extensions: { external_id: 'PC-1475' } });
  const issue = (overrides) => refusalResponse([{
    code: 'extension-not-declared',
    field: 'external_id',
    message: 'The ledger extension declaration does not declare this member.',
    related_ids: [],
    ...overrides,
  }]);

  assert.equal(oracleAccepts(request, issue({})), true);
  assert.equal(oracleAccepts(request, issue({ field: 'tier' })), false);
  assert.equal(oracleAccepts(request, issue({ field: 'date' })), false);
  assert.equal(oracleAccepts(request, issue({ field: 'extensions' })), false);
  assert.equal(oracleAccepts(request, issue({ message: 'The member is not declared.' })), false);
  assert.equal(oracleAccepts(request, issue({ code: 'extension-unknown' })), false);
  // The two refusals that fault the declaration itself carry the container's
  // own name, never a member's.
  assert.equal(oracleAccepts(request, refusalResponse([{
    code: 'extension-declaration-missing',
    field: 'extensions',
    message: 'The ledger declares no patchable extension members; .wowbagger/extensions.json is absent.',
    related_ids: [],
  }])), true);
  assert.equal(oracleAccepts(request, refusalResponse([{
    code: 'extension-declaration-missing',
    field: 'external_id',
    message: 'The ledger declares no patchable extension members; .wowbagger/extensions.json is absent.',
    related_ids: [],
  }])), false);
});

// The correlation obstacle, answered: an extension member never reaches the
// lossless core view, so the oracle reads it back out of the item source the
// response carries.
test('the oracle correlates an extension result through the item source it reads back', () => {
  const item = (extensionLines) => [
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
    ...extensionLines,
    '---',
    '',
    'The mirrored card.',
    '',
  ].join('\n');

  const success = (source) => ({
    ok: true,
    command: 'patch',
    contract_version: 5,
    state: 'committed',
    result: {
      item: {
        id: ITEM,
        path: `${ITEM}.md`,
        revision: `sha256:${createHash('sha256').update(Buffer.from(source, 'utf8')).digest('hex')}`,
        source_encoding: 'base64',
        source_media_type: 'text/markdown; charset=utf-8',
        source_base64: Buffer.from(source, 'utf8').toString('base64'),
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
        body: '\nThe mirrored card.\n',
      },
    },
  });

  const request = patchRequest({ extensions: { external_id: 'PC-1475', sequence: 4, tags: ['mirror'] } });
  assert.equal(oracleAccepts(request, success(item([
    'external_id: "PC-1475"', 'sequence: 4', 'tags: [mirror]',
  ]))), true);
  // Every requested member has to be observable in the source, with the
  // requested value and the requested type.
  assert.equal(oracleAccepts(request, success(item([
    'external_id: "PC-1470"', 'sequence: 4', 'tags: [mirror]',
  ]))), false);
  assert.equal(oracleAccepts(request, success(item([
    'external_id: "PC-1475"', 'sequence: "4"', 'tags: [mirror]',
  ]))), false);
  assert.equal(oracleAccepts(request, success(item([
    'external_id: "PC-1475"', 'sequence: 4', 'tags: [mirror, legacy]',
  ]))), false);
  assert.equal(oracleAccepts(request, success(item([
    'external_id: "PC-1475"', 'sequence: 4',
  ]))), false);

  // A removal correlates with the member being gone from the source.
  const removal = patchRequest({ extensions: { external_id: null } });
  assert.equal(oracleAccepts(removal, success(item([]))), true);
  assert.equal(oracleAccepts(removal, success(item(['external_id: "PC-1475"']))), false);
});
