import test from 'node:test';
import assert from 'node:assert/strict';

test('exposes the buildReportImpact seam', async () => {
  let module;
  try {
    module = await import('../src/report-impact.js');
  } catch {
    assert.fail('missing buildReportImpact seam');
  }
  assert.equal(typeof module.buildReportImpact, 'function');
});

function item(id, data = {}) {
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
    body: '',
    path: `${id}.md`,
  };
}

test('completing A readies B but not D or E on a diamond graph', async () => {
  const { buildReportImpact } = await import('../src/report-impact.js');
  const a = 'wb_01KZAAAAAAAAAAAAAAAAAAAAAA';
  const b = 'wb_01KZBBBBBBBBBBBBBBBBBBBBBB';
  const c = 'wb_01KZCCCCCCCCCCCCCCCCCCCCCC';
  const d = 'wb_01KZDDDDDDDDDDDDDDDDDDDDDD';
  const e = 'wb_01KZEEEEEEEEEEEEEEEEEEEEEE';
  const items = [
    item(a),
    item(b, { depends_on: [a] }),
    item(c),
    item(d, { depends_on: [a, c] }),
    item(e, { depends_on: [b] }),
  ];

  const impact = buildReportImpact(items, new Set([a, b, c, d, e]), '2026-08-14');

  assert.deepEqual(impact[a].readyIfDoneIds, [b]);
  assert.deepEqual(new Set(impact[a].downstreamIds), new Set([b, d, e]));
});

test('a second blocker keeps the dependent unready', async () => {
  const { buildReportImpact } = await import('../src/report-impact.js');
  const a = 'wb_01KZAAAAAAAAAAAAAAAAAAAAAA';
  const b = 'wb_01KZBBBBBBBBBBBBBBBBBBBBBB';
  const f = 'wb_01KZFFFFFFFFFFFFFFFFFFFFFF';
  const items = [
    item(a),
    item(b),
    item(f, { depends_on: [a, b] }),
  ];

  const impact = buildReportImpact(items, new Set([a, b, f]), '2026-08-14');

  assert.deepEqual(impact[a].readyIfDoneIds, []);
  assert.deepEqual(impact[a].downstreamIds, [f]);
});

test('a snoozed dependent stays unready', async () => {
  const { buildReportImpact } = await import('../src/report-impact.js');
  const a = 'wb_01KZAAAAAAAAAAAAAAAAAAAAAA';
  const s = 'wb_01KZSSSSSSSSSSSSSSSSSSSSSS';
  const items = [
    item(a),
    item(s, { depends_on: [a], snoozed_until: '2026-09-01' }),
  ];

  const impact = buildReportImpact(items, new Set([a, s]), '2026-08-14');

  assert.deepEqual(impact[a].readyIfDoneIds, []);
  assert.deepEqual(impact[a].downstreamIds, [s]);
});

test('a done ancestor keeps its dependent child unready', async () => {
  const { buildReportImpact } = await import('../src/report-impact.js');
  const x = 'wb_01KZAAAAAAAAAAAAAAAAAAAAAA';
  const k = 'wb_01KZKKKKKKKKKKKKKKKKKKKKKK';
  const items = [
    item(x),
    item(k, { parent: x, depends_on: [x] }),
  ];

  const impact = buildReportImpact(items, new Set([x, k]), '2026-08-14');

  assert.deepEqual(impact[x].readyIfDoneIds, []);
  assert.deepEqual(impact[x].downstreamIds, [k]);
});

test('a killed prerequisite keeps the dependent unready', async () => {
  const { buildReportImpact } = await import('../src/report-impact.js');
  const a = 'wb_01KZAAAAAAAAAAAAAAAAAAAAAA';
  const dead = 'wb_01KZDDDDDDDDDDDDDDDDDDDDDD';
  const f = 'wb_01KZFFFFFFFFFFFFFFFFFFFFFF';
  const items = [
    item(a),
    item(dead, { status: 'killed' }),
    item(f, { depends_on: [a, dead] }),
  ];

  const impact = buildReportImpact(items, new Set([a, f]), '2026-08-14');

  assert.deepEqual(impact[a].readyIfDoneIds, []);
  assert.deepEqual(impact[a].downstreamIds, [f]);
});

test('a schema-1 dependent stays unready', async () => {
  const { buildReportImpact } = await import('../src/report-impact.js');
  const a = 'wb_01KZAAAAAAAAAAAAAAAAAAAAAA';
  const g = 'wb_01KZGGGGGGGGGGGGGGGGGGGGGG';
  const items = [
    item(a),
    item(g, { schema_version: 1, depends_on: [a] }),
  ];

  const impact = buildReportImpact(items, new Set([a, g]), '2026-08-14');

  assert.deepEqual(impact[a].readyIfDoneIds, []);
  assert.deepEqual(impact[a].downstreamIds, [g]);
});

test('a dependency cycle terminates without listing the candidate', async () => {
  const { buildReportImpact } = await import('../src/report-impact.js');
  const a = 'wb_01KZAAAAAAAAAAAAAAAAAAAAAA';
  const b = 'wb_01KZBBBBBBBBBBBBBBBBBBBBBB';
  const c = 'wb_01KZCCCCCCCCCCCCCCCCCCCCCC';
  const items = [
    item(a, { depends_on: [b] }),
    item(b, { depends_on: [a] }),
    item(c, { depends_on: [b] }),
  ];

  const impact = buildReportImpact(items, new Set([a, b, c]), '2026-08-14');

  assert.deepEqual(impact[a].readyIfDoneIds, [b]);
  assert.deepEqual(new Set(impact[a].downstreamIds), new Set([b, c]));
});

test('a named subset hides the excluded blocker', async () => {
  const { buildReportImpact } = await import('../src/report-impact.js');
  const a = 'wb_01KZAAAAAAAAAAAAAAAAAAAAAA';
  const b = 'wb_01KZBBBBBBBBBBBBBBBBBBBBBB';
  const f = 'wb_01KZFFFFFFFFFFFFFFFFFFFFFF';
  const items = [
    item(a),
    item(b),
    item(f, { depends_on: [a, b] }),
  ];

  const impact = buildReportImpact(items, new Set([a, f]), '2026-08-14');

  assert.deepEqual(Object.keys(impact), [a, f]);
  assert.deepEqual(impact[a].readyIfDoneIds, []);
  assert.deepEqual(impact[a].downstreamIds, [f]);
});

test('derivation leaves the input ledger untouched', async () => {
  const { buildReportImpact } = await import('../src/report-impact.js');
  const a = 'wb_01KZAAAAAAAAAAAAAAAAAAAAAA';
  const b = 'wb_01KZBBBBBBBBBBBBBBBBBBBBBB';
  const items = [item(a), item(b, { depends_on: [a] })];
  const before = structuredClone(items);

  buildReportImpact(items, new Set([a, b]), '2026-08-14');

  assert.deepEqual(items, before);
});
