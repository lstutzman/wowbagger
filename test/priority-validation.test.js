import test from 'node:test';
import assert from 'node:assert/strict';

import { validateLedger } from '../src/validate.js';

// SPEC section 7, restored from 73245c1:
//   priority | No | Non-negative integer supplied by a consumer policy.
//   Lower values sort first; Wowbagger core does not calculate it.

function ledgerWith(priority) {
  const data = {
    schema_version: 1,
    id: 'wb_01KZAAAAAAAAAAAAAAAAAAAAAA',
    title: 'Priority probe',
    kind: 'task',
    status: 'backlog',
    created: '2026-08-01',
    updated: '2026-08-01',
    provenance: { source: 'test', recorded_at: '2026-08-01T00:00:00.000Z' },
    depends_on: [],
    related: [],
  };
  if (priority !== undefined) {
    data.priority = priority;
  }
  return { errors: [], items: [{ path: 'probe.md', data }] };
}

function priorityErrors(priority) {
  const result = validateLedger(ledgerWith(priority));
  return result.errors.filter((error) => error.field === 'priority');
}

test('accepts a ledger with no priority at all', () => {
  assert.deepEqual(priorityErrors(undefined), []);
});

test('accepts a non-negative integer priority', () => {
  assert.deepEqual(priorityErrors(0), []);
  assert.deepEqual(priorityErrors(10), []);
});

test('refuses a non-numeric priority', () => {
  // This is the value that silently validated before priority was restored.
  assert.equal(priorityErrors('high').length, 1);
  assert.equal(priorityErrors('high')[0].code, 'invalid-priority');
});

test('refuses a negative priority', () => {
  assert.equal(priorityErrors(-1).length, 1);
  assert.equal(priorityErrors(-1)[0].code, 'invalid-priority');
});

test('refuses a fractional priority', () => {
  assert.equal(priorityErrors(1.5).length, 1);
  assert.equal(priorityErrors(1.5)[0].code, 'invalid-priority');
});
