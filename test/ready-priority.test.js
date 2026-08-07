import test from 'node:test';
import assert from 'node:assert/strict';

import { selectReady } from '../src/ready.js';

// SPEC section 8 ready ordering, restored from 73245c1:
//   1. items with priority before items without priority;
//   2. ascending priority;
//   3. ascending created date;
//   4. ascending immutable ID.

function task(id, created, extra = {}) {
  return {
    data: {
      id,
      kind: 'task',
      status: 'backlog',
      created,
      depends_on: [],
      ...extra,
    },
  };
}

test('sorts items carrying a priority before items without one', () => {
  // The unprioritised item is older, so creation order alone would put it first.
  const items = [
    task('wb_01KZAAAAAAAAAAAAAAAAAAAAAA', '2026-08-01'),
    task('wb_01KZBBBBBBBBBBBBBBBBBBBBBB', '2026-08-05', { priority: 10 }),
  ];

  assert.deepEqual(selectReady(items, '2026-08-07'), [
    'wb_01KZBBBBBBBBBBBBBBBBBBBBBB',
    'wb_01KZAAAAAAAAAAAAAAAAAAAAAA',
  ]);
});

test('sorts prioritised items by ascending priority, lowest value first', () => {
  // Creation order is the inverse of priority order, so only priority can
  // produce the expected result.
  const items = [
    task('wb_01KZAAAAAAAAAAAAAAAAAAAAAA', '2026-08-01', { priority: 20 }),
    task('wb_01KZBBBBBBBBBBBBBBBBBBBBBB', '2026-08-02', { priority: 1 }),
    task('wb_01KZCCCCCCCCCCCCCCCCCCCCCC', '2026-08-03', { priority: 10 }),
  ];

  assert.deepEqual(selectReady(items, '2026-08-07'), [
    'wb_01KZBBBBBBBBBBBBBBBBBBBBBB',
    'wb_01KZCCCCCCCCCCCCCCCCCCCCCC',
    'wb_01KZAAAAAAAAAAAAAAAAAAAAAA',
  ]);
});

test('falls back to created date then id when priorities are equal', () => {
  const items = [
    task('wb_01KZBBBBBBBBBBBBBBBBBBBBBB', '2026-08-05', { priority: 5 }),
    task('wb_01KZAAAAAAAAAAAAAAAAAAAAAA', '2026-08-05', { priority: 5 }),
    task('wb_01KZCCCCCCCCCCCCCCCCCCCCCC', '2026-08-01', { priority: 5 }),
  ];

  assert.deepEqual(selectReady(items, '2026-08-07'), [
    'wb_01KZCCCCCCCCCCCCCCCCCCCCCC',
    'wb_01KZAAAAAAAAAAAAAAAAAAAAAA',
    'wb_01KZBBBBBBBBBBBBBBBBBBBBBB',
  ]);
});

test('treats priority zero as a real priority, not as absent', () => {
  const items = [
    task('wb_01KZAAAAAAAAAAAAAAAAAAAAAA', '2026-08-01'),
    task('wb_01KZBBBBBBBBBBBBBBBBBBBBBB', '2026-08-05', { priority: 0 }),
  ];

  assert.deepEqual(selectReady(items, '2026-08-07'), [
    'wb_01KZBBBBBBBBBBBBBBBBBBBBBB',
    'wb_01KZAAAAAAAAAAAAAAAAAAAAAA',
  ]);
});
