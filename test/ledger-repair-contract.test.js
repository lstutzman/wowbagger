// test/ledger-repair-contract.test.js
//
// The `ledger-repair` domain is its own contract at version 1: the core
// contract stays at version 5 and the work-claim contract at version 1. This
// file pins the strict `number-repair` request shape at the public seam every
// consumer and the claim journal already use, `validateClaimRequest`, so a
// repair request that the journal would replay is the same request the command
// accepts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import Ajv2020Module from 'ajv/dist/2020.js';

import { validateClaimRequest } from '../src/claim-request.js';
import { runCli, withLedger } from './support.js';

const Ajv2020 = Ajv2020Module.default ?? Ajv2020Module;
const projectRoot = fileURLToPath(new URL('..', import.meta.url));

// The published schemas are read from the package, never retyped here: a
// schema that disagrees with the runtime validator is the drift these
// assertions exist to catch.
function schemaValidator(file) {
  const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
  for (const name of ['common.json', 'ledger-repair-request.json', 'ledger-repair-response.json', 'ledger-repair-proposal.json']) {
    ajv.addSchema(JSON.parse(readFileSync(path.join(projectRoot, 'schemas', name), 'utf8')));
  }
  const validate = ajv.getSchema(`https://github.com/lstutzman/wowbagger/schemas/${file}`);
  assert.ok(validate, `${file} must be resolvable by its $id`);
  return validate;
}

const SNAPSHOT_REVISION = `sha256:${'a'.repeat(64)}`;
const ITEM_REVISION = `sha256:${'b'.repeat(64)}`;
const ITEM_ID = 'wb_01Q4837BM01W70T30B184GG1R6';

function validRepairRequest() {
  return {
    repair_id: 'nr_20260830_0001',
    ledger_snapshot_revision: SNAPSHOT_REVISION,
    date: '2026-08-30',
    changes: [{
      item_id: ITEM_ID,
      expected_revision: ITEM_REVISION,
      expected_number: 7,
      replacement_number: 8,
    }],
  };
}

test('number-repair request: the exact repair mapping is accepted', () => {
  assert.deepEqual(validateClaimRequest('number-repair', validRepairRequest()), []);
});

test('number-repair request: a non-object body is refused as a type', () => {
  assert.deepEqual(validateClaimRequest('number-repair', ['not', 'an', 'object']), [{
    path: '',
    code: 'invalid-type',
    message: 'The number-repair request must be a JSON object.',
  }]);
});

test('number-repair request: a missing repair_id names the absent member', () => {
  const request = validRepairRequest();
  delete request.repair_id;

  assert.deepEqual(validateClaimRequest('number-repair', request), [{
    path: '/repair_id',
    code: 'missing-member',
    message: 'Required member repair_id is missing.',
  }]);
});

test('number-repair request: an extra member is refused rather than ignored', () => {
  assert.deepEqual(validateClaimRequest('number-repair', { ...validRepairRequest(), force: true }), [{
    path: '/force',
    code: 'unknown-member',
    message: 'Member force is not allowed.',
  }]);
});

// The repair ID is the recovery key: an interrupted apply is resumed by it, so
// it is held to one bounded spelling rather than any non-empty string.
test('number-repair request: a malformed repair_id is refused', () => {
  assert.deepEqual(validateClaimRequest('number-repair', { ...validRepairRequest(), repair_id: 'repair-1' }), [{
    path: '/repair_id',
    code: 'invalid-value',
    message: 'Member repair_id must match nr_YYYYMMDD_NNNN.',
  }]);
});

test('number-repair request: a malformed ledger_snapshot_revision is refused', () => {
  const request = { ...validRepairRequest(), ledger_snapshot_revision: `sha256:${'A'.repeat(64)}` };

  assert.deepEqual(validateClaimRequest('number-repair', request), [{
    path: '/ledger_snapshot_revision',
    code: 'invalid-value',
    message: 'Member ledger_snapshot_revision must match sha256:[0-9a-f]{64}.',
  }]);
});

// A date that does not exist on the calendar is refused here rather than
// written into a repaired item's `updated` field.
test('number-repair request: an impossible date is refused', () => {
  assert.deepEqual(validateClaimRequest('number-repair', { ...validRepairRequest(), date: '2026-02-30' }), [{
    path: '/date',
    code: 'invalid-value',
    message: 'Member date must be an ISO calendar date.',
  }]);
});

// A repair that changes nothing is a confused request, not a no-op: the caller
// either read an empty proposal or means a mapping it did not send.
test('number-repair request: an empty changes list is refused', () => {
  assert.deepEqual(validateClaimRequest('number-repair', { ...validRepairRequest(), changes: [] }), [{
    path: '/changes',
    code: 'invalid-value',
    message: 'Member changes must be a non-empty array of number changes.',
  }]);
});

test('number-repair request: a non-object change entry is refused as a type', () => {
  assert.deepEqual(validateClaimRequest('number-repair', { ...validRepairRequest(), changes: ['wb_bad'] }), [{
    path: '/changes/0',
    code: 'invalid-type',
    message: 'Member changes entries must be JSON objects.',
  }]);
});

test('number-repair request: a change entry missing its old number is refused', () => {
  const request = validRepairRequest();
  delete request.changes[0].expected_number;

  assert.deepEqual(validateClaimRequest('number-repair', request), [{
    path: '/changes/0/expected_number',
    code: 'missing-member',
    message: 'Required member expected_number is missing.',
  }]);
});

test('number-repair request: an extra member on a change entry is refused', () => {
  const request = validRepairRequest();
  request.changes[0].title = 'Renumbered by hand';

  assert.deepEqual(validateClaimRequest('number-repair', request), [{
    path: '/changes/0/title',
    code: 'unknown-member',
    message: 'Member title is not allowed.',
  }]);
});

// Identity stays the ULID. A repair that cannot name the item it moves is
// refused before any number is read.
test('number-repair request: a malformed item_id is refused', () => {
  const request = validRepairRequest();
  request.changes[0].item_id = 'wb_bad';

  assert.deepEqual(validateClaimRequest('number-repair', request), [{
    path: '/changes/0/item_id',
    code: 'invalid-value',
    message: 'Member item_id must be a canonical Wowbagger item ID.',
  }]);
});

test('number-repair request: a malformed expected_revision is refused', () => {
  const request = validRepairRequest();
  request.changes[0].expected_revision = 'sha256:short';

  assert.deepEqual(validateClaimRequest('number-repair', request), [{
    path: '/changes/0/expected_revision',
    code: 'invalid-value',
    message: 'Member expected_revision must match sha256:[0-9a-f]{64}.',
  }]);
});

// The old number is a witness, not a label: a string `'7'` never compares equal
// to the integer the item carries, so the mismatch is refused as a type here.
test('number-repair request: a string expected_number is refused', () => {
  const request = validRepairRequest();
  request.changes[0].expected_number = '7';

  assert.deepEqual(validateClaimRequest('number-repair', request), [{
    path: '/changes/0/expected_number',
    code: 'invalid-value',
    message: 'Member expected_number must be a positive integer.',
  }]);
});

test('number-repair request: a non-positive replacement_number is refused', () => {
  const request = validRepairRequest();
  request.changes[0].replacement_number = 0;

  assert.deepEqual(validateClaimRequest('number-repair', request), [{
    path: '/changes/0/replacement_number',
    code: 'invalid-value',
    message: 'Member replacement_number must be a positive integer.',
  }]);
});

// One item moves once. Two changes for the same ULID would make the applied
// number depend on entry order, so the repeat is refused.
test('number-repair request: a repeated item_id is refused', () => {
  const request = validRepairRequest();
  request.changes.push({ ...request.changes[0], replacement_number: 9 });

  assert.deepEqual(validateClaimRequest('number-repair', request), [{
    path: '/changes/1/item_id',
    code: 'invalid-value',
    message: 'Member item_id must not repeat within changes.',
  }]);
});

// Two items cannot land on one number: the repair would publish the duplicate
// it exists to remove.
test('number-repair request: a repeated replacement_number is refused', () => {
  const request = validRepairRequest();
  request.changes.push({
    item_id: 'wb_01Q4837BM01W70T30B184GG1R7',
    expected_revision: `sha256:${'c'.repeat(64)}`,
    expected_number: 7,
    replacement_number: 8,
  });

  assert.deepEqual(validateClaimRequest('number-repair', request), [{
    path: '/changes/1/replacement_number',
    code: 'invalid-value',
    message: 'Member replacement_number must not repeat within changes.',
  }]);
});

// A caller reads the issues as one ordered list, so the order is part of the
// contract rather than the order the checks happen to run in.
test('number-repair request: several faults are reported in sorted order', () => {
  const request = validRepairRequest();
  request.repair_id = 'nr_1';
  request.date = 'yesterday';
  request.changes[0].item_id = 'wb_bad';

  assert.deepEqual(validateClaimRequest('number-repair', request).map((entry) => entry.path), [
    '/changes/0/item_id',
    '/date',
    '/repair_id',
  ]);
});

// The refusal is the repair domain's own envelope: a consumer dispatches on
// `namespace` before it reads any version member, so a repair refusal is never
// read as a core version 5 or work-claim version 1 response.
test('number-repair command: an invalid request is refused in the ledger-repair domain', async () => {
  await withLedger({ 'request.json': JSON.stringify({ repair_id: 'nr_20260830_0001' }) }, async (ledger) => {
    const result = runCli('number-repair', '--ledger', ledger, '--input', path.join(ledger, 'request.json'), '--json');

    assert.equal(result.status, 2, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: false,
      namespace: 'ledger-repair',
      command: 'number-repair',
      contract_version: 1,
      state: 'unchanged',
      error: {
        code: 'invalid-request',
        message: 'The number-repair request is invalid.',
        details: {
          issues: [
            { path: '/changes', code: 'missing-member', message: 'Required member changes is missing.' },
            { path: '/date', code: 'missing-member', message: 'Required member date is missing.' },
            { path: '/ledger_snapshot_revision', code: 'missing-member', message: 'Required member ledger_snapshot_revision is missing.' },
          ],
        },
      },
    });
  });
});

// The proposal reads a ledger and computes the mapping itself. It takes no
// request, so a request file is an unrecognized argument rather than an input
// it silently ignores.
test('number-repair-proposal command: a request input is not an accepted argument', async () => {
  await withLedger({}, async (ledger) => {
    const result = runCli('number-repair-proposal', '--ledger', ledger, '--input', 'request.json', '--json');

    assert.equal(result.status, 2, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.namespace, 'ledger-repair');
    assert.equal(envelope.command, 'number-repair-proposal');
    assert.equal(envelope.contract_version, 1);
    assert.equal(envelope.state, 'unchanged');
    assert.equal(envelope.error.code, 'invalid-request');
    assert.deepEqual(envelope.error.details.issues, [
      { path: '/arguments/3', code: 'unknown-argument', message: 'Argument --input is not recognized.' },
      { path: '/arguments/4', code: 'unknown-argument', message: 'Argument request.json is not recognized.' },
    ]);
  });
});

// The request contract and the empirical invalid-ledger gate are installed.
// A well-formed request against this valid fixture is refused as not
// applicable; `--auto-commit` remains accepted on the apply command.
test('number-repair command: a well-formed request refuses a valid ledger', async () => {
  await withLedger({ 'request.json': JSON.stringify(validRepairRequest()) }, async (ledger) => {
    const result = runCli(
      'number-repair', '--ledger', ledger, '--input', path.join(ledger, 'request.json'), '--json', '--auto-commit',
    );

    assert.equal(result.status, 4, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: false,
      namespace: 'ledger-repair',
      command: 'number-repair',
      contract_version: 1,
      state: 'unchanged',
      error: {
        code: 'ledger-repair-not-applicable',
        message: 'The ledger is not blocked only by duplicate numbers.',
        details: { validation_errors: [] },
      },
    });
  });
});

// A published schema that rejects bytes the core accepts tells a consumer to
// withhold a valid request, so the accepted direction is asserted against the
// same fixture the runtime accepts.
test('number-repair schema: the published request schema accepts the request the core accepts', () => {
  const validate = schemaValidator('ledger-repair-request.json');

  assert.deepEqual(validateClaimRequest('number-repair', validRepairRequest()), []);
  assert.ok(validate(validRepairRequest()), JSON.stringify(validate.errors));
});

// The structural rules are the schema's own. Calendar-date validity and the
// request-internal repeat rules are runtime checks a JSON Schema cannot state,
// so they are asserted against the validator above rather than here.
test('number-repair schema: the published request schema refuses the structural faults', () => {
  const validate = schemaValidator('ledger-repair-request.json');
  const withoutRepairId = validRepairRequest();
  delete withoutRepairId.repair_id;
  const stringNumber = validRepairRequest();
  stringNumber.changes[0].expected_number = '7';

  for (const [label, request] of [
    ['a missing member', withoutRepairId],
    ['an extra member', { ...validRepairRequest(), force: true }],
    ['a malformed repair_id', { ...validRepairRequest(), repair_id: 'repair-1' }],
    ['an uppercase snapshot digest', { ...validRepairRequest(), ledger_snapshot_revision: `sha256:${'A'.repeat(64)}` }],
    ['an empty changes list', { ...validRepairRequest(), changes: [] }],
    ['a string old number', stringNumber],
  ]) {
    assert.equal(validate(request), false, `the request schema must refuse ${label}`);
  }
});

// The envelope schema is asserted against live bytes rather than a retyped
// copy, so the shipped refusal and the published shape cannot drift apart.
test('number-repair schema: a live refusal validates against the published response schema', async () => {
  const validate = schemaValidator('ledger-repair-response.json');

  await withLedger({ 'request.json': JSON.stringify({ repair_id: 'nr_20260830_0001' }) }, async (ledger) => {
    const invalid = runCli('number-repair', '--ledger', ledger, '--input', path.join(ledger, 'request.json'), '--json');
    const unavailable = runCli('number-repair-proposal', '--ledger', ledger, '--json');

    for (const [label, result] of [['the invalid-request refusal', invalid], ['the proposal refusal', unavailable]]) {
      const envelope = JSON.parse(result.stdout);
      assert.ok(validate(envelope), `${label}: ${JSON.stringify(validate.errors)}`);
    }
  });
});
