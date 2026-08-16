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
