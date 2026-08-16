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

test('buckets open items by age', () => {
  const items = [
    item('wb_fresh', { number: 1, created: '2026-08-12' }),
    item('wb_recent', { number: 2, created: '2026-08-05' }),
    item('wb_month', { number: 3, created: '2026-07-10' }),
    item('wb_quarter', { number: 4, created: '2026-06-01' }),
    item('wb_ancient', { number: 5, created: '2026-01-01' }),
    item('wb_gone', { number: 6, created: '2026-01-01', status: 'done', completed: '2026-02-01' }),
  ];

  const model = buildReportModel(items, config(), '2026-08-14');

  assert.deepEqual(model.evidence.agingBuckets, [
    { label: 'under 7d', count: 1 },
    { label: '7-30d', count: 1 },
    { label: '30-90d', count: 2 },
    { label: 'over 90d', count: 1 },
  ]);
});

test('reconstructs weekly arrivals and completions from item dates', () => {
  const items = [
    item('wb_new', { number: 1, created: '2026-08-11' }),
    item('wb_cycle', { number: 2, created: '2026-08-03', status: 'done', completed: '2026-08-12' }),
    item('wb_early', { number: 3, created: '2026-01-01', status: 'done', completed: '2026-08-05' }),
    item('wb_ancient', { number: 4, created: '2026-01-01', status: 'killed', killed: '2026-02-02' }),
  ];

  const model = buildReportModel(items, config(), '2026-08-14');
  const { weeks, throughput } = model.evidence;

  assert.equal(weeks.length, 12);
  assert.equal(weeks[0].weekStart, '2026-05-25');
  assert.equal(weeks.at(-1).weekStart, '2026-08-10');
  assert.deepEqual(weeks.at(-1), { weekStart: '2026-08-10', arrivals: 1, completions: 1 });
  assert.deepEqual(weeks.at(-2), { weekStart: '2026-08-03', arrivals: 1, completions: 1 });
  assert.deepEqual(throughput, { total: 2, windowWeeks: 12, perWeek: 0.17 });
});

test('summarises accept-to-complete cycle time as median and 85th percentile', () => {
  const accept = (date) => [{ action: 'accept', date, summary: 's', rationale: 'r' }];
  const items = [
    item('wb_a', { number: 1, status: 'done', completed: '2026-07-11', decisions: accept('2026-07-01') }),
    item('wb_b', { number: 2, status: 'done', completed: '2026-07-05', decisions: accept('2026-07-01') }),
    item('wb_c', { number: 3, status: 'done', completed: '2026-07-21', decisions: accept('2026-07-01') }),
    item('wb_no_accept', { number: 4, status: 'done', completed: '2026-07-30' }),
    item('wb_killed', { number: 5, status: 'killed', killed: '2026-07-30', decisions: accept('2026-07-01') }),
    item('wb_open', { number: 6 }),
  ];

  const model = buildReportModel(items, config(), '2026-08-14');

  assert.deepEqual(model.evidence.cycleTime, { sampleCount: 3, medianDays: 10, p85Days: 20 });
});

test('forecasts remaining open work as 50 and 85 percent bands', () => {
  const weekStarts = [
    '2026-05-25', '2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29',
    '2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27', '2026-08-03', '2026-08-10',
  ];
  const items = [
    ...weekStarts.map((date, index) => item(`wb_done_${index}`, {
      number: index + 1,
      created: '2026-05-01',
      status: 'done',
      completed: date,
    })),
    ...[0, 1, 2, 3].map((index) => item(`wb_open_${index}`, { number: 100 + index })),
  ];

  const model = buildReportModel(items, config(), '2026-08-14');
  const repeat = buildReportModel([...items].reverse(), config(), '2026-08-14');

  assert.deepEqual(model.evidence.forecast, {
    remaining: 4,
    weeks50: 4,
    weeks85: 4,
    date50: '2026-09-11',
    date85: '2026-09-11',
    trials: 5000,
  });
  assert.deepEqual(repeat.evidence.forecast, model.evidence.forecast);
});

test('reports no forecast when the window records no completions', () => {
  const items = [item('wb_open', { number: 1 })];

  const model = buildReportModel(items, config(), '2026-08-14');

  assert.equal(model.evidence.forecast, null);
});

test('widens the forecast band when weekly throughput is uneven', () => {
  const busyWeeks = ['2026-06-01', '2026-06-15', '2026-06-29', '2026-07-13', '2026-07-27', '2026-08-10'];
  const items = [
    ...busyWeeks.flatMap((date, week) => [0, 1, 2].map((slot) => item(`wb_done_${week}_${slot}`, {
      number: week * 10 + slot,
      created: '2026-05-01',
      status: 'done',
      completed: date,
    }))),
    ...Array.from({ length: 12 }, (unused, index) => item(`wb_open_${index}`, { number: 200 + index })),
  ];

  const model = buildReportModel(items, config(), '2026-08-14');
  const repeat = buildReportModel([...items].reverse(), config(), '2026-08-14');

  assert.ok(model.evidence.forecast.weeks50 < model.evidence.forecast.weeks85);
  assert.deepEqual(repeat.evidence.forecast, model.evidence.forecast);
  assert.deepEqual(model.evidence.forecast, {
    remaining: 12,
    weeks50: 8,
    weeks85: 11,
    date50: '2026-10-09',
    date85: '2026-10-30',
    trials: 5000,
  });
});
