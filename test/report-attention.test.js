import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportModel } from '../src/report.js';

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
      related: [],
      decisions: [],
      ...data,
    },
    body,
    path: `${id}.md`,
  };
}

function config(overrides = {}) {
  return {
    reportVersion: 1,
    repository: { name: 'Example', logo: null },
    title: 'Example report',
    outputPath: '/tmp/report.html',
    fields: {},
    swarm: null,
    ...overrides,
  };
}

test('names every blocker of a blocked item by number', () => {
  const dependency = 'wb_dependency';
  const ancestor = 'wb_ancestor';
  const items = [
    item(dependency, { number: 5, title: 'Dependency', status: 'in-progress' }),
    item(ancestor, { number: 9, title: 'Ancestor', status: 'triage' }),
    item('wb_blocked', {
      number: 12,
      title: 'Blocked item',
      created: '2026-08-04',
      parent: ancestor,
      depends_on: [dependency],
    }),
  ];

  const model = buildReportModel(items, config(), '2026-08-14');

  assert.deepEqual(model.attention.blocked, [{
    id: 'wb_blocked',
    number: 12,
    title: 'Blocked item',
    ageDays: 10,
    blockers: [
      { code: 'dependency-unsatisfied', id: dependency, number: 5, title: 'Dependency', status: 'in-progress' },
      { code: 'ancestor-not-backlog', id: ancestor, number: 9, title: 'Ancestor', status: 'triage' },
    ],
  }]);
});

test('lists the oldest open items with their age', () => {
  const items = [
    item('wb_old', { number: 1, created: '2026-01-01' }),
    item('wb_middle', { number: 2, created: '2026-07-01' }),
    item('wb_new', { number: 3, created: '2026-08-13' }),
    item('wb_gone', { number: 4, created: '2025-01-01', status: 'done', completed: '2026-01-01' }),
  ];

  const model = buildReportModel(items, config(), '2026-08-14');

  assert.deepEqual(model.attention.aging, [
    { id: 'wb_old', number: 1, title: 'wb_old', status: 'backlog', state: 'ready', ageDays: 225 },
    { id: 'wb_middle', number: 2, title: 'wb_middle', status: 'backlog', state: 'ready', ageDays: 44 },
    { id: 'wb_new', number: 3, title: 'wb_new', status: 'backlog', state: 'ready', ageDays: 1 },
  ]);
});

test('flags started work past the historical 85th-percentile cycle time', () => {
  const accept = (date) => [{ action: 'accept', date, summary: 's', rationale: 'r' }];
  const items = [
    item('wb_h1', { number: 1, status: 'done', completed: '2026-07-05', decisions: accept('2026-07-01') }),
    item('wb_h2', { number: 2, status: 'done', completed: '2026-07-11', decisions: accept('2026-07-01') }),
    item('wb_h3', { number: 3, status: 'done', completed: '2026-07-21', decisions: accept('2026-07-01') }),
    item('wb_stuck', {
      number: 10,
      title: 'Stuck item',
      status: 'in-progress',
      created: '2026-06-01',
      decisions: accept('2026-07-01'),
    }),
    item('wb_young', { number: 11, status: 'in-progress', decisions: accept('2026-08-10') }),
    item('wb_backlog', { number: 12, created: '2026-01-01' }),
  ];

  const model = buildReportModel(items, config(), '2026-08-14');

  assert.deepEqual(model.attention.stuck, [{
    id: 'wb_stuck',
    number: 10,
    title: 'Stuck item',
    status: 'in-progress',
    startedOn: '2026-07-01',
    elapsedDays: 44,
    thresholdDays: 20,
  }]);
});

test('names a terminal blocker by number', () => {
  const deferredEpic = 'wb_deferred_epic';
  const items = [
    item(deferredEpic, { number: 21, title: 'Deferred epic', kind: 'epic', status: 'deferred', deferred: '2026-08-02' }),
    item('wb_child', { number: 38, title: 'Child', parent: deferredEpic }),
  ];

  const model = buildReportModel(items, config(), '2026-08-14');

  assert.deepEqual(model.attention.blocked[0].blockers, [
    { code: 'ancestor-not-backlog', id: deferredEpic, number: 21, title: 'Deferred epic', status: 'deferred' },
  ]);
});

test('truncates each attention list and reports what it left out', () => {
  const blocker = 'wb_blocker';
  const items = [
    item(blocker, { number: 1, status: 'triage' }),
    ...Array.from({ length: 12 }, (unused, index) => item(`wb_blocked_${index}`, {
      number: 100 + index,
      created: '2026-08-01',
      depends_on: [blocker],
    })),
  ];

  const model = buildReportModel(items, config(), '2026-08-14');

  assert.equal(model.attention.blocked.length, 10);
  assert.deepEqual(model.attention.blockedTotal, 12);
  assert.equal(model.attention.aging.length, 10);
  assert.equal(model.attention.agingTotal, 13);
});

// A named view narrows who can appear on an attention list, never why an item
// is there: the blocked row still names the blocker the complete ledger says
// holds it, and carries none of that excluded item's content.
test('view attention and work-next contain only retained items', () => {
  const excluded = 'wb_docs_blocker';
  const items = [
    item(excluded, { number: 1, title: 'Docs blocker', status: 'triage', area: 'docs' }),
    item('wb_api_ready', { number: 2, title: 'Api ready', priority: 1, area: 'api' }),
    item('wb_api_blocked', {
      number: 3,
      title: 'Api blocked',
      created: '2026-08-04',
      area: 'api',
      depends_on: [excluded],
    }),
    item('wb_docs_old', { number: 4, title: 'Docs old', created: '2026-01-01', area: 'docs' }),
  ];
  const view = {
    name: 'api-only',
    title: 'Api only',
    outputPath: '/tmp/api.html',
    filters: { fields: { area: ['api'] } },
  };

  const model = buildReportModel(items, config({ fields: { area: '/area' }, view }), '2026-08-14');

  assert.deepEqual(model.workNext.map(({ id }) => id), ['wb_api_ready']);
  assert.deepEqual(
    model.attention.aging.map(({ id }) => id),
    ['wb_api_ready', 'wb_api_blocked'],
  );
  assert.deepEqual(model.attention.blocked, [{
    id: 'wb_api_blocked',
    number: 3,
    title: 'Api blocked',
    ageDays: 10,
    blockers: [{
      code: 'dependency-unsatisfied',
      id: excluded,
      number: null,
      title: null,
      status: null,
    }],
  }]);
});
