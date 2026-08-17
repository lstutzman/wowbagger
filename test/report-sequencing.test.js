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

function sequencingById(model, id) {
  return model.items.find((entry) => entry.id === id)?.sequencing;
}

test('counts transitive unblocking leverage once per item on a diamond graph', () => {
  const base = 'wb_01KZDDDDDDDDDDDDDDDDDDDDDD';
  const left = 'wb_01KZBBBBBBBBBBBBBBBBBBBBBB';
  const right = 'wb_01KZCCCCCCCCCCCCCCCCCCCCCC';
  const apex = 'wb_01KZAAAAAAAAAAAAAAAAAAAAAA';
  const items = [
    item(base, { number: 1 }),
    item(left, { number: 2, depends_on: [base] }),
    item(right, { number: 3, depends_on: [base] }),
    item(apex, { number: 4, depends_on: [left, right] }),
  ];

  const model = buildReportModel(items, config(), '2026-08-14');

  assert.equal(sequencingById(model, base)?.leverage.count, 3);
  assert.deepEqual(sequencingById(model, base)?.leverage.numbers, [2, 3, 4]);
  assert.equal(sequencingById(model, left)?.leverage.count, 1);
  assert.equal(sequencingById(model, right)?.leverage.count, 1);
  assert.equal(sequencingById(model, apex)?.leverage.count, 0);
});

test('names the parent epic and its terminal-children ratio', () => {
  const epicId = 'wb_01KZEEEEEEEEEEEEEEEEEEEEEE';
  const openChild = 'wb_01KZAAAAAAAAAAAAAAAAAAAAAA';
  const items = [
    item(epicId, { number: 21, kind: 'epic', title: 'Migration epic' }),
    item(openChild, { number: 38, parent: epicId }),
    item('wb_01KZBBBBBBBBBBBBBBBBBBBBBB', { number: 39, parent: epicId, status: 'done', completed: '2026-08-05' }),
    item('wb_01KZCCCCCCCCCCCCCCCCCCCCCC', { number: 40, parent: epicId, status: 'done', completed: '2026-08-06' }),
    item('wb_01KZDDDDDDDDDDDDDDDDDDDDDD', { number: 41, parent: epicId, status: 'killed', killed: '2026-08-07' }),
    item('wb_01KZFFFFFFFFFFFFFFFFFFFFFF', { number: 42 }),
  ];

  const model = buildReportModel(items, config(), '2026-08-14');

  assert.deepEqual(sequencingById(model, openChild)?.epic, {
    id: epicId,
    number: 21,
    title: 'Migration epic',
    kind: 'epic',
    terminalChildren: 3,
    totalChildren: 4,
    ratio: 0.75,
  });
  assert.equal(sequencingById(model, 'wb_01KZFFFFFFFFFFFFFFFFFFFFFF')?.epic, null);
});

// The mutation contract's terminal ratio counts done or killed children only,
// and the epic complete rollup gates on that same set. An archived child can be
// restored and a deferred child undefers, so neither is progress; counting a
// terminal date instead of a terminal status would overstate every epic that
// parked a child.
test('counts only done or killed children as terminal, not archived or deferred', () => {
  const epicId = 'wb_01KZEEEEEEEEEEEEEEEEEEEEEE';
  const openChild = 'wb_01KZAAAAAAAAAAAAAAAAAAAAAA';
  const items = [
    item(epicId, { number: 21, kind: 'epic', title: 'Migration epic' }),
    item(openChild, { number: 38, parent: epicId }),
    item('wb_01KZBBBBBBBBBBBBBBBBBBBBBB', { number: 39, parent: epicId, status: 'done', completed: '2026-08-05' }),
    item('wb_01KZCCCCCCCCCCCCCCCCCCCCCC', { number: 40, parent: epicId, status: 'archived', archived: '2026-08-06' }),
    item('wb_01KZDDDDDDDDDDDDDDDDDDDDDD', { number: 41, parent: epicId, status: 'deferred', deferred: '2026-08-07' }),
  ];

  const model = buildReportModel(items, config(), '2026-08-14');

  assert.deepEqual(sequencingById(model, openChild)?.epic, {
    id: epicId,
    number: 21,
    title: 'Migration epic',
    kind: 'epic',
    terminalChildren: 1,
    totalChildren: 4,
    ratio: 0.25,
  });
});

test('projects class of service, due proximity, age, and size from mapped fields', () => {
  const items = [
    item('wb_expedite', { number: 1, class: 'expedite', complexity: 'small' }),
    item('wb_fixed', { number: 2, class: 'fixed-date', due: '2026-08-20', complexity: 'huge' }),
    item('wb_unknown', { number: 3, class: 'urgent-ish' }),
    item('wb_bare', { number: 4, created: '2026-07-15' }),
  ];
  const fields = { class: '/class', due: '/due', complexity: '/complexity' };

  const model = buildReportModel(items, config({ fields }), '2026-08-14');

  assert.deepEqual(sequencingById(model, 'wb_expedite')?.class, {
    value: 'expedite',
    raw: 'expedite',
    known: true,
  });
  assert.deepEqual(sequencingById(model, 'wb_expedite')?.size, { value: 'small', weight: 1 });
  assert.deepEqual(sequencingById(model, 'wb_fixed')?.due, { date: '2026-08-20', daysUntil: 6 });
  assert.deepEqual(sequencingById(model, 'wb_fixed')?.size, { value: 'huge', weight: null });
  assert.deepEqual(sequencingById(model, 'wb_unknown')?.class, {
    value: 'standard',
    raw: 'urgent-ish',
    known: false,
  });
  assert.deepEqual(sequencingById(model, 'wb_bare')?.class, {
    value: 'standard',
    raw: null,
    known: true,
  });
  assert.equal(sequencingById(model, 'wb_bare')?.due, null);
  assert.equal(sequencingById(model, 'wb_bare')?.size, null);
  assert.equal(sequencingById(model, 'wb_bare')?.ageDays, 30);
  assert.equal(sequencingById(model, 'wb_expedite')?.ageDays, 13);
});

test('lifts an expedite item above every other ready item', () => {
  const items = [
    item('wb_aaa_leader', { number: 10, priority: 0 }),
    item('wb_zzz_expedite', { number: 11, priority: 90, created: '2026-08-13', class: 'expedite' }),
    item('wb_mmm_blocked', { number: 12, class: 'expedite', depends_on: ['wb_aaa_leader'] }),
  ];

  const model = buildReportModel(items, config({ fields: { class: '/class' } }), '2026-08-14');

  assert.deepEqual(model.workNext.map(({ number }) => number), [11, 10]);
  assert.equal(model.workNext[0].title, 'wb_zzz_expedite');
  assert.ok(model.workNext[0].reasons.some((reason) => reason.code === 'class' && reason.label === 'expedite'));
});

test('orders fixed-date items by due proximity ahead of items without a due date', () => {
  const items = [
    item('wb_aaa_no_due', { number: 20, priority: 0 }),
    item('wb_yyy_far', { number: 21, priority: 1, class: 'fixed-date', due: '2026-12-01' }),
    item('wb_zzz_soon', { number: 22, priority: 9, class: 'fixed-date', due: '2026-08-18' }),
  ];
  const fields = { class: '/class', due: '/due' };

  const model = buildReportModel(items, config({ fields }), '2026-08-14');

  assert.deepEqual(model.workNext.map(({ number }) => number), [22, 21, 20]);
  assert.deepEqual(
    model.workNext[0].reasons.find((reason) => reason.code === 'due'),
    { code: 'due', label: 'due 2026-08-18 (in 4d)' },
  );
});

test('orders by transitive unblocking leverage ahead of priority', () => {
  const items = [
    item('wb_aaa_low', { number: 30, priority: 0 }),
    item('wb_zzz_high', { number: 31, priority: 5 }),
    item('wb_dep_one', { number: 32, depends_on: ['wb_zzz_high'] }),
    item('wb_dep_two', { number: 33, depends_on: ['wb_dep_one'] }),
  ];

  const model = buildReportModel(items, config(), '2026-08-14');

  assert.deepEqual(model.workNext.map(({ number }) => number), [31, 30]);
  assert.deepEqual(
    model.workNext[0].reasons.find((reason) => reason.code === 'leverage'),
    { code: 'leverage', label: 'unblocks 2 items (#32, #33)' },
  );
});

test('orders by epic enablement ahead of priority and names the parent epic', () => {
  const nearlyDone = 'wb_epic_near';
  const barelyStarted = 'wb_epic_early';
  const items = [
    item(nearlyDone, { number: 21, kind: 'epic', title: 'Nearly done epic' }),
    item(barelyStarted, { number: 22, kind: 'epic', title: 'Early epic' }),
    item('wb_zzz_child', { number: 38, priority: 9, parent: nearlyDone }),
    item('wb_mmm_child', { number: 39, priority: 5, parent: barelyStarted }),
    item('wb_aaa_orphan', { number: 40, priority: 0 }),
    item('wb_t1', { number: 41, parent: nearlyDone, status: 'done', completed: '2026-08-02' }),
    item('wb_t2', { number: 42, parent: nearlyDone, status: 'done', completed: '2026-08-03' }),
    item('wb_t3', { number: 43, parent: nearlyDone, status: 'done', completed: '2026-08-04' }),
    item('wb_t4', { number: 44, parent: barelyStarted, status: 'done', completed: '2026-08-05' }),
    item('wb_o1', { number: 45, parent: barelyStarted, status: 'in-progress' }),
    item('wb_o2', { number: 46, parent: barelyStarted, status: 'in-progress' }),
  ];

  const model = buildReportModel(items, config(), '2026-08-14');

  assert.deepEqual(model.workNext.map(({ number }) => number), [38, 39, 40]);
  assert.deepEqual(
    model.workNext[0].reasons.find((reason) => reason.code === 'epic'),
    { code: 'epic', label: 'advances epic #21 (75% done)' },
  );
});

// An epic that parked most of its children is not nearly done. Ranking reads
// the same done-or-killed ratio as the model, so a parked-heavy epic must not
// outrank a genuinely advanced one, and the reason line must quote the ratio it
// ranked on.
test('does not let parked children lift an epic above a genuinely advanced one', () => {
  const parked = 'wb_epic_parked';
  const advanced = 'wb_epic_advanced';
  const items = [
    item(parked, { number: 21, kind: 'epic', title: 'Parked epic' }),
    item(advanced, { number: 22, kind: 'epic', title: 'Advanced epic' }),
    item('wb_aaa_child', { number: 38, priority: 5, parent: parked }),
    item('wb_zzz_child', { number: 39, priority: 5, parent: advanced }),
    item('wb_p1', { number: 41, parent: parked, status: 'done', completed: '2026-08-02' }),
    item('wb_p2', { number: 42, parent: parked, status: 'archived', archived: '2026-08-03' }),
    item('wb_p3', { number: 43, parent: parked, status: 'archived', archived: '2026-08-04' }),
    item('wb_p4', { number: 44, parent: parked, status: 'deferred', deferred: '2026-08-05' }),
    item('wb_a1', { number: 45, parent: advanced, status: 'done', completed: '2026-08-02' }),
    item('wb_a2', { number: 46, parent: advanced, status: 'done', completed: '2026-08-03' }),
    item('wb_a3', { number: 47, parent: advanced, status: 'killed', killed: '2026-08-04' }),
  ];

  const model = buildReportModel(items, config(), '2026-08-14');

  assert.deepEqual(model.workNext.map(({ number }) => number), [39, 38]);
  assert.deepEqual(
    model.workNext[1].reasons.find((reason) => reason.code === 'epic'),
    { code: 'epic', label: 'advances epic #21 (20% done)' },
  );
});

test('orders by priority ahead of age, and priorityless items last', () => {
  const items = [
    item('wb_aaa_old_unprioritised', { number: 50, created: '2026-01-01' }),
    item('wb_zzz_prioritised', { number: 51, priority: 3, created: '2026-08-13' }),
  ];

  const model = buildReportModel(items, config(), '2026-08-14');

  assert.deepEqual(model.workNext.map(({ number }) => number), [51, 50]);
  assert.deepEqual(
    model.workNext[0].reasons.find((reason) => reason.code === 'priority'),
    { code: 'priority', label: 'priority 3' },
  );
});

test('breaks a priority tie with the older item first', () => {
  const items = [
    item('wb_zzz_older', { number: 60, priority: 2, created: '2026-07-01' }),
    item('wb_aaa_newer', { number: 61, priority: 2, created: '2026-08-10' }),
  ];

  const model = buildReportModel(items, config(), '2026-08-14');

  assert.deepEqual(model.workNext.map(({ number }) => number), [60, 61]);
  assert.deepEqual(
    model.workNext[0].reasons.find((reason) => reason.code === 'age'),
    { code: 'age', label: 'age 44d' },
  );
});

test('breaks a remaining tie with the smaller mapped complexity first', () => {
  const items = [
    item('wb_aaa_large', { number: 70, priority: 2, complexity: 'large' }),
    item('wb_zzz_small', { number: 71, priority: 2, complexity: 'small' }),
  ];

  const model = buildReportModel(items, config({ fields: { complexity: '/complexity' } }), '2026-08-14');

  assert.deepEqual(model.workNext.map(({ number }) => number), [71, 70]);
  assert.deepEqual(
    model.workNext[0].reasons.find((reason) => reason.code === 'size'),
    { code: 'size', label: 'size small' },
  );
});

test('reports an unrecognised class value instead of dropping it', () => {
  const items = [item('wb_odd', { number: 80, class: 'urgent-ish' })];

  const model = buildReportModel(items, config({ fields: { class: '/class' } }), '2026-08-14');

  assert.deepEqual(
    model.workNext[0].reasons.find((reason) => reason.code === 'class-unknown'),
    { code: 'class-unknown', label: 'unrecognised class "urgent-ish"' },
  );
  assert.deepEqual(model.unknownClasses, [{ value: 'urgent-ish', numbers: [80] }]);
});

test('ranks identically for the same ledger and as-of date', () => {
  const items = [
    item('wb_one', { number: 90, priority: 1, class: 'fixed-date', due: '2026-09-01' }),
    item('wb_two', { number: 91, priority: 1, complexity: 'medium' }),
    item('wb_three', { number: 92, parent: 'wb_epic' }),
    item('wb_epic', { number: 93, kind: 'epic' }),
  ];
  const fields = { class: '/class', due: '/due', complexity: '/complexity' };

  const first = buildReportModel(items, config({ fields }), '2026-08-14');
  const second = buildReportModel([...items].reverse(), config({ fields }), '2026-08-14');

  assert.deepEqual(first.workNext, second.workNext);
  assert.deepEqual(first.workNext.map(({ number }) => number), [90, 92, 91]);
});
