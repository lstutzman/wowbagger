import test from 'node:test';
import assert from 'node:assert/strict';

import * as readiness from '../src/ready.js';

function item(id, data = {}) {
  return {
    data: {
      id,
      kind: 'task',
      status: 'backlog',
      created: '2026-08-14',
      depends_on: [],
      ...data,
    },
  };
}

test('classifies an actionable backlog task as ready', () => {
  const id = 'wb_01KZAAAAAAAAAAAAAAAAAAAAAA';

  const projection = readiness.projectReadiness?.([item(id)], '2026-08-14');

  assert.deepEqual(projection?.get(id), {
    state: 'ready',
    reasons: [],
  });
});

test('classifies an epic as ineligible', () => {
  const id = 'wb_01KZBBBBBBBBBBBBBBBBBBBBBB';

  const projection = readiness.projectReadiness([item(id, { kind: 'epic' })], '2026-08-14');

  assert.deepEqual(projection.get(id), {
    state: 'ineligible',
    reasons: [{ code: 'kind-not-task' }],
  });
});

test('classifies a non-backlog task as ineligible', () => {
  const id = 'wb_01KZCCCCCCCCCCCCCCCCCCCCCC';

  const projection = readiness.projectReadiness([item(id, { status: 'triage' })], '2026-08-14');

  assert.deepEqual(projection.get(id), {
    state: 'ineligible',
    reasons: [{ code: 'status-not-backlog' }],
  });
});

test('classifies an actively snoozed backlog task as ineligible', () => {
  const id = 'wb_01KZDDDDDDDDDDDDDDDDDDDDDD';

  const projection = readiness.projectReadiness([
    item(id, { snoozed_until: '2026-08-15' }),
  ], '2026-08-14');

  assert.deepEqual(projection.get(id), {
    state: 'ineligible',
    reasons: [{ code: 'snoozed' }],
  });
});

test('lists unsatisfied dependencies in frontmatter order', () => {
  const targetId = 'wb_01KZEEEEEEEEEEEEEEEEEEEEEE';
  const firstId = 'wb_01KZFFFFFFFFFFFFFFFFFFFFFF';
  const secondId = 'wb_01KZGGGGGGGGGGGGGGGGGGGGGG';
  const projection = readiness.projectReadiness([
    item(targetId, { schema_version: 2, depends_on: [secondId, firstId] }),
    item(firstId),
    item(secondId),
  ], '2026-08-14');

  assert.deepEqual(projection.get(targetId), {
    state: 'blocked',
    reasons: [
      { code: 'dependency-unsatisfied', item_id: secondId },
      { code: 'dependency-unsatisfied', item_id: firstId },
    ],
  });
});

test('lists non-backlog ancestors from the direct parent outward', () => {
  const targetId = 'wb_01KZHHHHHHHHHHHHHHHHHHHHHH';
  const parentId = 'wb_01KZJJJJJJJJJJJJJJJJJJJJJJ';
  const grandparentId = 'wb_01KZKKKKKKKKKKKKKKKKKKKKKK';
  const projection = readiness.projectReadiness([
    item(targetId, { parent: parentId }),
    item(parentId, { kind: 'epic', status: 'triage', parent: grandparentId }),
    item(grandparentId, { kind: 'epic', status: 'done' }),
  ], '2026-08-14');

  assert.deepEqual(projection.get(targetId), {
    state: 'blocked',
    reasons: [
      { code: 'ancestor-not-backlog', item_id: parentId },
      { code: 'ancestor-not-backlog', item_id: grandparentId },
    ],
  });
});
