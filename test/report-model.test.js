import test from 'node:test';
import assert from 'node:assert/strict';

function item(id, data = {}, body = '') {
  return {
    data: {
      schema_version: 2,
      id,
      title: id,
      kind: 'task',
      status: 'backlog',
      created: '2026-08-01',
      updated: '2026-08-01',
      provenance: { source: 'test', recorded_at: '2026-08-01T00:00:00Z' },
      depends_on: [],
      decisions: [],
      ...data,
    },
    body,
    path: `${id}.md`,
  };
}

test('builds a complete report model with readiness and mapped fields', async () => {
  const readyId = 'wb_01KZAAAAAAAAAAAAAAAAAAAAAA';
  const blockedId = 'wb_01KZBBBBBBBBBBBBBBBBBBBBBB';
  const triageId = 'wb_01KZCCCCCCCCCCCCCCCCCCCCCC';
  const doneId = 'wb_01KZDDDDDDDDDDDDDDDDDDDDDD';
  const epicId = 'wb_01KZEEEEEEEEEEEEEEEEEEEEEE';
  const items = [
    item(readyId, { number: 1, priority: 2, data: { area: 'Core', complexity: 'small' } }, '# Ready body'),
    item(blockedId, { number: 2, depends_on: [readyId], data: { area: 'CLI', complexity: 'large' } }),
    item(triageId, { number: 3, status: 'triage' }),
    item(doneId, {
      number: 4,
      status: 'done',
      completed: '2026-08-10',
      decisions: [{ action: 'complete', date: '2026-08-10', summary: 'Finished', rationale: 'Verified' }],
    }),
    item(epicId, { number: 5, kind: 'epic' }),
  ];
  const config = {
    reportVersion: 1,
    repository: { name: 'Example', logo: null },
    title: 'Example report',
    outputPath: '/tmp/report.html',
    fields: { area: '/data/area', complexity: '/data/complexity' },
    swarm: { eligibleComplexities: ['small'] },
  };
  const report = await import('../src/report.js');

  const model = report.buildReportModel?.(items, config, '2026-08-14');

  assert.equal(model?.items.length, 4);
  assert.equal(model?.terminalItems.length, 1);
  assert.deepEqual(model?.stats, {
    total: 5,
    open: 4,
    terminal: 1,
    ready: 1,
    blocked: 1,
    ineligible: 2,
    triage: 1,
    inProgress: 0,
    snoozed: 0,
    done: 1,
    killed: 0,
    deferred: 0,
    archived: 0,
  });
  assert.deepEqual(model?.items.find(({ id }) => id === readyId), {
    id: readyId,
    number: 1,
    title: readyId,
    kind: 'task',
    status: 'backlog',
    created: '2026-08-01',
    updated: '2026-08-01',
    terminalDate: null,
    priority: 2,
    parent: null,
    dependsOn: [],
    related: [],
    decisions: [],
    body: '# Ready body',
    readiness: { state: 'ready', reasons: [] },
    fields: { area: 'Core', complexity: 'small' },
  });
  assert.deepEqual(
    model?.items.find(({ id }) => id === blockedId)?.readiness,
    { state: 'blocked', reasons: [{ code: 'dependency-unsatisfied', item_id: readyId }] },
  );
  assert.deepEqual(model?.items.find(({ id }) => id === triageId)?.readiness, {
    state: 'ineligible',
    reasons: [{ code: 'status-not-backlog' }],
  });
  assert.deepEqual(model?.items.find(({ id }) => id === epicId)?.readiness, {
    state: 'ineligible',
    reasons: [{ code: 'kind-not-task' }],
  });
  assert.equal(model?.terminalItems[0].terminalDate, '2026-08-10');
});

test('batches ready swarm candidates without repeating an area', async () => {
  const items = [
    item('ready-area-a-first', { priority: 1, data: { area: 'A', complexity: 'small' } }),
    item('ready-area-a-second', { priority: 2, data: { area: 'A', complexity: 'small' } }),
    item('ready-area-b', { priority: 3, data: { area: 'B', complexity: 'small' } }),
    item('wrong-complexity', { priority: 0, data: { area: 'C', complexity: 'large' } }),
    item('missing-area', { priority: 0, data: { complexity: 'small' } }),
  ];
  const config = {
    reportVersion: 1,
    repository: { name: 'Example', logo: null },
    title: 'Example report',
    outputPath: '/tmp/report.html',
    fields: { area: '/data/area', complexity: '/data/complexity' },
    swarm: { eligibleComplexities: ['small'] },
  };
  const { buildReportModel } = await import('../src/report.js');

  const model = buildReportModel(items, config, '2026-08-14');

  assert.deepEqual(
    model.swarmBatches.map((batch) => batch.map(({ id }) => id)),
    [
      ['ready-area-a-first', 'ready-area-b'],
      ['ready-area-a-second'],
    ],
  );
});

test('orders ranked items before priority-only and unranked items', async () => {
  const items = [
    item('unranked'),
    item('priority-only', { priority: 0 }),
    item('rank-two-no-priority', { data: { rank: 2 } }),
    item('rank-two-priority', { priority: 4, data: { rank: 2 } }),
    item('rank-one', { data: { rank: 1 } }),
  ];
  const config = {
    reportVersion: 1,
    repository: { name: 'Example', logo: null },
    title: 'Example report',
    outputPath: '/tmp/report.html',
    fields: { rank: '/data/rank' },
    swarm: null,
  };
  const { buildReportModel } = await import('../src/report.js');

  const model = buildReportModel(items, config, '2026-08-14');

  assert.deepEqual(
    model.items.map(({ id }) => id),
    ['rank-one', 'rank-two-priority', 'rank-two-no-priority', 'priority-only', 'unranked'],
  );
});
