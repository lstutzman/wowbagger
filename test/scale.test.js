import assert from 'node:assert/strict';
import test from 'node:test';
import { validateLedger } from '../src/validate.js';

const CHAIN_LENGTH = 20_000;
const RING_LENGTH = 10_000;

test('validate handles a 20,000-item dependency chain without overflowing the stack', {
  timeout: 15_000,
}, () => {
  const items = Array.from({ length: CHAIN_LENGTH }, (_, index) => ({
    path: `ledger/${String(index).padStart(5, '0')}.md`,
    data: {
      schema_version: 1,
      id: itemId(index),
      title: `Chain item ${index}`,
      kind: 'task',
      status: 'backlog',
      created: '2026-01-01',
      updated: '2026-01-01',
      provenance: {
        source: 'scale-test',
        recorded_at: '2026-01-01T00:00:00Z',
      },
      depends_on: index + 1 < CHAIN_LENGTH ? [itemId(index + 1)] : [],
    },
  }));

  assert.deepEqual(validateLedger({ items, errors: [] }), {
    valid: true,
    errors: [],
  });
});

test('validate reports every member of a 10,000-item dependency ring', {
  timeout: 15_000,
}, () => {
  const items = Array.from({ length: RING_LENGTH }, (_, index) => ({
    path: `ledger/${String(index).padStart(5, '0')}.md`,
    data: {
      schema_version: 1,
      id: itemId(index),
      title: `Ring item ${index}`,
      kind: 'task',
      status: 'backlog',
      created: '2026-01-01',
      updated: '2026-01-01',
      provenance: {
        source: 'scale-test',
        recorded_at: '2026-01-01T00:00:00Z',
      },
      depends_on: [itemId((index + 1) % RING_LENGTH)],
    },
  }));

  const result = validateLedger({ items, errors: [] });

  assert.equal(result.valid, false);
  assert.equal(result.errors.length, RING_LENGTH);
  assert.ok(result.errors.every((error) => error.code === 'dependency-cycle'));
  assert.deepEqual(result.errors[0], {
    path: 'ledger/00000.md',
    field: 'depends_on',
    code: 'dependency-cycle',
    message: `Dependency cycle detected in a component of ${RING_LENGTH} items; member ${itemId(0)}.`,
  });
  assert.deepEqual(result.errors.at(-1), {
    path: 'ledger/09999.md',
    field: 'depends_on',
    code: 'dependency-cycle',
    message: `Dependency cycle detected in a component of ${RING_LENGTH} items; member ${itemId(RING_LENGTH - 1)}.`,
  });
});

function itemId(index) {
  return `wb_01KDWPVNG0${index.toString(16).toUpperCase().padStart(16, '0')}`;
}
