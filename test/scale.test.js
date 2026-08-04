import assert from 'node:assert/strict';
import test from 'node:test';
import { validateLedger } from '../src/validate.js';

const CHAIN_LENGTH = 20_000;

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

function itemId(index) {
  return `wb_01KDWPVNG0${index.toString(16).toUpperCase().padStart(16, '0')}`;
}
