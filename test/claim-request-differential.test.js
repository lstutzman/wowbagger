// test/claim-request-differential.test.js
//
// src/claim-request.js deliberately re-implements the rules that
// test/work-claim-reference.js's requestSchemaError encodes, because production code
// must not import from test/ and the reference model must stay an independent oracle
// (see the comment at the top of src/claim-request.js). Nothing before this file
// checked that the duplicate copies actually agree: test/claim-conformance.test.js
// replays fixture actions through the pure operations directly, never invoking
// validateClaimRequest, and its fixtures carry only valid requests. This file feeds
// invalid requests to both implementations and asserts they agree on rejection.
//
// requestSchemaError is not exported by work-claim-reference.js (and must not be, to
// keep it independent) so it is driven indirectly through runReferenceVector: schema
// rejection is checked first in execute(), before any operation-specific logic, and
// always produces exit 2 with error.code 'invalid-request' in the 'work-claim'
// namespace. Any other outcome means the reference model accepted the request's shape.
import assert from 'node:assert/strict';
import test from 'node:test';

import { validateClaimRequest } from '../src/claim-request.js';
import { runReferenceVector } from './work-claim-reference.js';

const NS = 'wbns_11111111111111111111111111111111';
const ITEM = 'wb_01Q4837BM01W70T30B184GG1R6';
const NOW = '2026-08-06T09:00:00.000Z';

function initialState() {
  return {
    backend: {
      name: 'reference-backend',
      coordination_scope: 'shared-transactional-coordinator',
      durability: 'durable-coordinator',
      ledger_binding: { mode: 'explicit-allowlist', namespaces: [NS] },
      write_paths: {
        alternate: 'none',
        claimed_publication_v1: 'atomic-fence',
        legacy_create_v1: 'reject-claimed-id',
        legacy_transition_v1: 'reject-active-claim',
      },
    },
    faults: {},
    durable: {
      clock_floors: [],
      claims: [{ ledger_namespace: NS, item_id: ITEM, last_epoch: '1', active: {
        owner_id: 'agent-a', epoch: '1', issued_at: '2026-08-06T08:55:00.000Z', expires_at: '2026-08-06T09:05:00.000Z',
      } }],
      ledgers: [],
      publication_outcomes: [],
    },
    process: { preflights: [] },
  };
}

function referenceRejects(operation, request) {
  const { transcript } = runReferenceVector({
    initial: initialState(),
    actions: [{ operation: `work-claim.${operation}`, request, physical_now: NOW }],
  });
  const envelope = transcript[0];
  return envelope.exit === 2 && envelope.stdout?.error?.code === 'invalid-request';
}

function implementationRejects(operation, request) {
  return validateClaimRequest(operation, request).length > 0;
}

function assertBothReject(operation, label, request) {
  test(`${operation}: both reject — ${label}`, () => {
    const referenceRejected = referenceRejects(operation, request);
    const implementationRejected = implementationRejects(operation, request);
    assert.equal(referenceRejected, true, `reference model accepted an invalid ${operation} request (${label})`);
    assert.equal(implementationRejected, true, `validateClaimRequest accepted an invalid ${operation} request (${label})`);
  });
}

function assertBothAccept(operation, label, request) {
  test(`${operation}: both accept — ${label} (control)`, () => {
    const referenceRejected = referenceRejects(operation, request);
    const implementationRejected = implementationRejects(operation, request);
    assert.equal(referenceRejected, false, `reference model rejected a valid ${operation} request (${label})`);
    assert.equal(implementationRejected, false, `validateClaimRequest rejected a valid ${operation} request (${label})`);
  });
}

// ---- valid control requests, one per operation ----

const validRead = { ledger_namespace: NS, item_id: ITEM };
const validAcquire = {
  ledger_namespace: NS, item_id: ITEM, owner_id: 'agent-b', lease_duration_ms: 300000,
  expected: { last_epoch: '1', active: {
    owner_id: 'agent-a', epoch: '1', issued_at: '2026-08-06T08:55:00.000Z', expires_at: '2026-08-06T09:05:00.000Z',
  } },
};
const validRenew = {
  ledger_namespace: NS, item_id: ITEM, owner_id: 'agent-a', epoch: '1',
  expected_expires_at: '2026-08-06T09:05:00.000Z', lease_duration_ms: 300000,
};
const validRelease = {
  ledger_namespace: NS, item_id: ITEM, owner_id: 'agent-a', epoch: '1',
  expected_expires_at: '2026-08-06T09:05:00.000Z',
};

assertBothAccept('read', 'well-formed request', validRead);
assertBothAccept('acquire', 'well-formed request', validAcquire);
assertBothAccept('renew', 'well-formed request', validRenew);
assertBothAccept('release', 'well-formed request', validRelease);

// ---- invalid requests, per operation ----

// read: only ledger_namespace and item_id.
assertBothReject('read', 'non-object body', 'not an object');
assertBothReject('read', 'extra unknown member', { ...validRead, unexpected: 'x' });
assertBothReject('read', 'missing required member', { ledger_namespace: NS });
assertBothReject('read', 'malformed ledger_namespace', { ...validRead, ledger_namespace: 'not-a-namespace' });
assertBothReject('read', 'malformed item_id', { ...validRead, item_id: 'not-an-item' });

// acquire: ledger_namespace, item_id, owner_id, lease_duration_ms, expected.
assertBothReject('acquire', 'non-object body', ['not', 'an', 'object']);
assertBothReject('acquire', 'extra unknown member', { ...validAcquire, unexpected: 'x' });
assertBothReject('acquire', 'missing required member', (() => {
  const { owner_id, ...rest } = validAcquire;
  return rest;
})());
assertBothReject('acquire', 'malformed ledger_namespace', { ...validAcquire, ledger_namespace: 'wbns_bad' });
assertBothReject('acquire', 'malformed item_id', { ...validAcquire, item_id: 'wb_bad' });
assertBothReject('acquire', 'out-of-range lease_duration_ms (0)', { ...validAcquire, lease_duration_ms: 0 });
assertBothReject('acquire', 'out-of-range lease_duration_ms (86400001)', { ...validAcquire, lease_duration_ms: 86400001 });
assertBothReject('acquire', 'malformed expected.active', {
  ...validAcquire,
  expected: { ...validAcquire.expected, active: { ...validAcquire.expected.active, issued_at: 'not-an-instant' } },
});

// renew: ledger_namespace, item_id, owner_id, epoch, expected_expires_at, lease_duration_ms.
assertBothReject('renew', 'non-object body', null);
assertBothReject('renew', 'extra unknown member', { ...validRenew, unexpected: 'x' });
assertBothReject('renew', 'missing required member', (() => {
  const { lease_duration_ms, ...rest } = validRenew;
  return rest;
})());
assertBothReject('renew', 'malformed ledger_namespace', { ...validRenew, ledger_namespace: 'wbns_bad' });
assertBothReject('renew', 'malformed item_id', { ...validRenew, item_id: 'wb_bad' });
assertBothReject('renew', 'non-canonical epoch', { ...validRenew, epoch: '01' });
assertBothReject('renew', 'out-of-range lease_duration_ms (0)', { ...validRenew, lease_duration_ms: 0 });
assertBothReject('renew', 'out-of-range lease_duration_ms (86400001)', { ...validRenew, lease_duration_ms: 86400001 });
assertBothReject('renew', 'malformed instant', { ...validRenew, expected_expires_at: 'not-an-instant' });

// release: ledger_namespace, item_id, owner_id, epoch, expected_expires_at.
assertBothReject('release', 'non-object body', 42);
assertBothReject('release', 'extra unknown member', { ...validRelease, unexpected: 'x' });
assertBothReject('release', 'missing required member', (() => {
  const { epoch, ...rest } = validRelease;
  return rest;
})());
assertBothReject('release', 'malformed ledger_namespace', { ...validRelease, ledger_namespace: 'wbns_bad' });
assertBothReject('release', 'malformed item_id', { ...validRelease, item_id: 'wb_bad' });
assertBothReject('release', 'non-canonical epoch', { ...validRelease, epoch: '01' });
assertBothReject('release', 'malformed instant', { ...validRelease, expected_expires_at: 'not-an-instant' });

// adopt: ledger_namespace, item_id, from_revision, to_revision, adopted_by.
// Adoption re-baselines the authorized revision without writing an item byte,
// so its witness is a revision pair, never a claim tuple.
const validAdopt = {
  ledger_namespace: NS,
  item_id: ITEM,
  from_revision: `sha256:${'1'.repeat(64)}`,
  to_revision: `sha256:${'2'.repeat(64)}`,
  adopted_by: 'operator-lee',
};

assertBothAccept('claim-adopt', 'well-formed request', validAdopt);

assertBothReject('claim-adopt', 'non-object body', 'not an object');
assertBothReject('claim-adopt', 'extra unknown member', { ...validAdopt, unexpected: 'x' });
assertBothReject('claim-adopt', 'missing required member', (() => {
  const { to_revision, ...rest } = validAdopt;
  return rest;
})());
assertBothReject('claim-adopt', 'malformed ledger_namespace', { ...validAdopt, ledger_namespace: 'wbns_bad' });
assertBothReject('claim-adopt', 'malformed item_id', { ...validAdopt, item_id: 'wb_bad' });
assertBothReject('claim-adopt', 'malformed from_revision', { ...validAdopt, from_revision: 'sha256:short' });
assertBothReject('claim-adopt', 'malformed to_revision', { ...validAdopt, to_revision: `SHA256:${'2'.repeat(64)}` });
assertBothReject('claim-adopt', 'uppercase revision digest', { ...validAdopt, to_revision: `sha256:${'A'.repeat(64)}` });
assertBothReject('claim-adopt', 'malformed adopted_by', { ...validAdopt, adopted_by: '-leading-dash' });
assertBothReject('claim-adopt', 'from_revision equal to to_revision', {
  ...validAdopt,
  to_revision: validAdopt.from_revision,
});
