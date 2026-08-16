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

test('crosses open item age with status, naming only the statuses in play', () => {
  const items = [
    item('wb_fresh', { number: 1, created: '2026-08-12' }),
    item('wb_triaged', { number: 2, created: '2026-08-12', status: 'triage' }),
    item('wb_started', { number: 3, created: '2026-08-05', status: 'in-progress' }),
    item('wb_month', { number: 4, created: '2026-07-10' }),
    item('wb_gone', { number: 5, created: '2026-08-12', status: 'done', completed: '2026-08-13' }),
  ];

  const model = buildReportModel(items, config(), '2026-08-14');

  assert.deepEqual(model.evidence.agingMatrix, {
    statuses: ['triage', 'backlog', 'in-progress'],
    rows: [
      { label: 'under 7d', counts: [1, 1, 0] },
      { label: '7-30d', counts: [0, 0, 1] },
      { label: '30-90d', counts: [0, 1, 0] },
      { label: 'over 90d', counts: [0, 0, 0] },
    ],
  });

  const onlyBacklog = buildReportModel(
    [item('wb_only', { number: 9, created: '2026-08-12' })],
    config(),
    '2026-08-14',
  );

  assert.deepEqual(onlyBacklog.evidence.agingMatrix, {
    statuses: ['backlog'],
    rows: [
      { label: 'under 7d', counts: [1] },
      { label: '7-30d', counts: [0] },
      { label: '30-90d', counts: [0] },
      { label: 'over 90d', counts: [0] },
    ],
  });
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
  assert.deepEqual(weeks.at(-1), {
    weekStart: '2026-08-10', arrivals: 1, completions: 1, rolling: 0.5,
  });
  assert.deepEqual(weeks.at(-2), {
    weekStart: '2026-08-03', arrivals: 1, completions: 1, rolling: 0.25,
  });
  assert.deepEqual(throughput, { total: 2, windowWeeks: 12, perWeek: 0.17 });
});

test('carries a four-week rolling mean of completions, blank until four weeks exist', () => {
  const done = (id, completed) => item(id, {
    number: Number(id.slice(3)), created: '2026-05-01', status: 'done', completed,
  });
  const items = [
    done('wb_9', '2026-06-08'),
    done('wb_10', '2026-07-20'),
    done('wb_11', '2026-08-03'),
    done('wb_12', '2026-08-03'),
    done('wb_13', '2026-08-10'),
  ];

  const { weeks } = buildReportModel(items, config(), '2026-08-14').evidence;

  assert.deepEqual(weeks.map((week) => week.rolling), [
    null, null, null, 0.25, 0.25, 0.25, 0, 0, 0.25, 0.25, 0.75, 1,
  ]);
});

test('reconstructs a daily cumulative flow from created, accept, and terminal dates', () => {
  const accept = (date) => [{ action: 'accept', date, summary: 's', rationale: 'r' }];
  const items = [
    item('wb_untriaged', { number: 1, created: '2026-08-10' }),
    item('wb_accepted', { number: 2, created: '2026-08-10', decisions: accept('2026-08-11') }),
    item('wb_finished', {
      number: 3, created: '2026-08-10', status: 'done', completed: '2026-08-13', decisions: accept('2026-08-11'),
    }),
    item('wb_old', {
      number: 4, created: '2026-01-01', status: 'done', completed: '2026-02-01', decisions: accept('2026-01-02'),
    }),
  ];

  const { cumulativeFlow } = buildReportModel(items, config(), '2026-08-14').evidence;
  const on = (date) => cumulativeFlow.find((point) => point.date === date);

  assert.equal(cumulativeFlow.length, 82);
  assert.equal(cumulativeFlow.at(0).date, '2026-05-25');
  assert.equal(cumulativeFlow.at(-1).date, '2026-08-14');
  assert.deepEqual(on('2026-05-25'), { date: '2026-05-25', triage: 0, accepted: 0, terminal: 1 });
  assert.deepEqual(on('2026-08-09'), { date: '2026-08-09', triage: 0, accepted: 0, terminal: 1 });
  assert.deepEqual(on('2026-08-10'), { date: '2026-08-10', triage: 3, accepted: 0, terminal: 1 });
  assert.deepEqual(on('2026-08-11'), { date: '2026-08-11', triage: 1, accepted: 2, terminal: 1 });
  assert.deepEqual(on('2026-08-13'), { date: '2026-08-13', triage: 1, accepted: 1, terminal: 2 });
});

test('closes the cumulative flow on the same counts the stats block reports', () => {
  const accept = (date) => [{ action: 'accept', date, summary: 's', rationale: 'r' }];
  const items = [
    item('wb_open_a', { number: 1, created: '2026-07-01' }),
    item('wb_open_b', { number: 2, created: '2026-07-02', decisions: accept('2026-07-03') }),
    item('wb_done', { number: 3, created: '2026-07-01', status: 'done', completed: '2026-07-20', decisions: accept('2026-07-02') }),
    item('wb_killed', { number: 4, created: '2026-07-01', status: 'killed', killed: '2026-07-21' }),
  ];

  const model = buildReportModel(items, config(), '2026-08-14');
  const last = model.evidence.cumulativeFlow.at(-1);

  assert.equal(last.terminal, model.stats.terminal);
  assert.equal(last.triage + last.accepted, model.stats.open);
  assert.equal(last.triage + last.accepted + last.terminal, model.stats.total);
});

test('summarises accept-to-complete cycle time as median and 85th percentile', () => {
  const accept = (date) => [{ action: 'accept', date, summary: 's', rationale: 'r' }];
  const items = [
    item('wb_a', { number: 1, status: 'done', completed: '2026-07-11', decisions: accept('2026-07-01') }),
    item('wb_b', { number: 2, status: 'done', completed: '2026-07-05', decisions: accept('2026-07-01') }),
    item('wb_c', { number: 3, status: 'done', completed: '2026-07-21', decisions: accept('2026-07-01') }),
    item('wb_d', { number: 4, status: 'done', completed: '2026-07-26', decisions: accept('2026-07-25') }),
    item('wb_no_accept', { number: 7, status: 'done', completed: '2026-07-30' }),
    item('wb_killed', { number: 5, status: 'killed', killed: '2026-07-30', decisions: accept('2026-07-01') }),
    item('wb_open', { number: 6 }),
  ];

  const model = buildReportModel(items, config(), '2026-08-14');

  assert.deepEqual(model.evidence.cycleTime, {
    sampleCount: 4,
    medianDays: 4,
    p85Days: 20,
    samples: [
      { number: 2, completedOn: '2026-07-05', days: 4 },
      { number: 1, completedOn: '2026-07-11', days: 10 },
      { number: 3, completedOn: '2026-07-21', days: 20 },
      { number: 4, completedOn: '2026-07-26', days: 1 },
    ],
  });
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
    weeks95: 4,
    date50: '2026-09-11',
    date85: '2026-09-11',
    date95: '2026-09-11',
    distribution: [
      { weeks: 0, share: 0 },
      { weeks: 1, share: 0 },
      { weeks: 2, share: 0 },
      { weeks: 3, share: 0 },
      { weeks: 4, share: 1 },
    ],
    trials: 5000,
  });
  assert.deepEqual(repeat.evidence.forecast, model.evidence.forecast);
});

test('exposes the trial distribution as a monotone completion-probability curve', () => {
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

  const { forecast } = buildReportModel(items, config(), '2026-08-14').evidence;
  const shareAt = (weeks) => forecast.distribution.find((point) => point.weeks === weeks).share;

  assert.ok(forecast.weeks85 <= forecast.weeks95, 'p95 cannot precede p85');
  assert.equal(
    forecast.date95,
    new Date(Date.parse('2026-08-14T00:00:00Z') + forecast.weeks95 * 7 * 86400000)
      .toISOString().slice(0, 10),
  );
  assert.equal(forecast.distribution.at(0).weeks, 0);
  assert.equal(forecast.distribution.at(-1).weeks, forecast.weeks95);
  assert.ok(forecast.distribution.at(-1).share >= 0.95, 'the curve ends at the 95th percentile');
  for (let index = 1; index < forecast.distribution.length; index += 1) {
    assert.ok(
      forecast.distribution[index].share >= forecast.distribution[index - 1].share,
      'the curve must never fall',
    );
  }
  assert.ok(shareAt(forecast.weeks50) >= 0.5);
  assert.ok(shareAt(forecast.weeks85) >= 0.85);
  assert.ok(shareAt(forecast.weeks50 - 1) < 0.5, 'p50 must be the first week at or above half');
  assert.ok(shareAt(forecast.weeks85 - 1) < 0.85);
  assert.ok(shareAt(forecast.weeks95 - 1) < 0.95);
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
    weeks95: 13,
    date50: '2026-10-09',
    date85: '2026-10-30',
    date95: '2026-11-13',
    distribution: [
      { weeks: 0, share: 0 },
      { weeks: 1, share: 0 },
      { weeks: 2, share: 0 },
      { weeks: 3, share: 0 },
      { weeks: 4, share: 0.0574 },
      { weeks: 5, share: 0.1844 },
      { weeks: 6, share: 0.3482 },
      { weeks: 7, share: 0.4964 },
      { weeks: 8, share: 0.631 },
      { weeks: 9, share: 0.7402 },
      { weeks: 10, share: 0.8188 },
      { weeks: 11, share: 0.879 },
      { weeks: 12, share: 0.9178 },
      { weeks: 13, share: 0.9504 },
    ],
    trials: 5000,
  });
});
