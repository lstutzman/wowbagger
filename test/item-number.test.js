import test from 'node:test';
import assert from 'node:assert/strict';

import { validateLedger } from '../src/validate.js';

// A short human handle. The ULID stays canonical and is what identity,
// publication, and the filename use; number is what a person says out loud.

function item(id, extra = {}) {
  return {
    path: `${id}.md`,
    data: {
      schema_version: 1,
      id,
      title: 'Numbered item',
      kind: 'task',
      status: 'backlog',
      created: '2026-08-01',
      updated: '2026-08-01',
      provenance: { source: 'test', recorded_at: '2026-08-01T00:00:00.000Z' },
      depends_on: [],
      related: [],
      ...extra,
    },
  };
}

function errorsFor(items) {
  return validateLedger({ errors: [], items }).errors
    .filter((error) => error.field === 'number');
}

test('accepts a ledger whose items carry no number', () => {
  assert.deepEqual(errorsFor([item('wb_01KZAAAAAAAAAAAAAAAAAAAAAA')]), []);
});

test('accepts distinct positive integer numbers', () => {
  assert.deepEqual(errorsFor([
    item('wb_01KZAAAAAAAAAAAAAAAAAAAAAA', { number: 1 }),
    item('wb_01KZBBBBBBBBBBBBBBBBBBBBBB', { number: 2 }),
  ]), []);
});

test('refuses a number shared by two items, flagging each', () => {
  // A collision is recoverable — unlike a ULID collision — but it must be
  // surfaced rather than silently picking one item.
  const errors = errorsFor([
    item('wb_01KZAAAAAAAAAAAAAAAAAAAAAA', { number: 7 }),
    item('wb_01KZBBBBBBBBBBBBBBBBBBBBBB', { number: 7 }),
  ]);

  assert.equal(errors.length, 2);
  assert.ok(errors.every((error) => error.code === 'duplicate-number'));
});

test('refuses a number that is not a positive integer', () => {
  for (const bad of [0, -1, 1.5, '3', null]) {
    const errors = errorsFor([item('wb_01KZAAAAAAAAAAAAAAAAAAAAAA', { number: bad })]);
    assert.equal(errors.length, 1, `expected one error for ${JSON.stringify(bad)}`);
    assert.equal(errors[0].code, 'invalid-number');
  }
});
