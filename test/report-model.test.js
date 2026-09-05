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
    sequencing: {
      class: { value: 'standard', raw: null, known: true },
      due: null,
      ageDays: 13,
      size: { value: 'small', weight: 1 },
      leverage: { count: 1, numbers: [2] },
      epic: null,
    },
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

// A named view is one grouped filter applied to the complete-ledger
// projection: values inside a group are alternatives, and every named group
// has to match. Whatever the filter drops is absent from every section the
// report derives, not merely hidden inside one of them.
function viewConfig(filters, overrides = {}) {
  return {
    reportVersion: 2,
    repository: { name: 'Example', logo: null },
    title: 'Example report',
    outputPath: '/tmp/security.html',
    fields: { area: '/area', class: '/class' },
    swarm: null,
    view: {
      name: 'security-blockers',
      title: 'Security blockers',
      outputPath: '/tmp/security.html',
      filters,
    },
    ...overrides,
  };
}

const groupedFilters = {
  readiness: ['ready', 'blocked'],
  status: ['backlog'],
  kind: ['task'],
  fields: { area: ['api', 'auth'], class: ['bug'] },
};

function groupedLedger() {
  return [
    item('wb_api_bug', { number: 1, priority: 1, area: 'api', class: 'bug' }),
    item('wb_auth_bug', {
      number: 2,
      priority: 2,
      area: 'auth',
      class: 'bug',
      depends_on: ['wb_api_bug'],
    }),
    item('wb_docs_bug', { number: 3, priority: 3, area: 'docs', class: 'bug' }),
    item('wb_api_chore', { number: 4, priority: 4, area: 'api', class: 'chore' }),
    item('wb_api_started', { number: 5, status: 'in-progress', area: 'api', class: 'bug' }),
    item('wb_api_triage', { number: 6, status: 'triage', area: 'api', class: 'bug' }),
    item('wb_api_epic', { number: 7, kind: 'epic', area: 'api', class: 'bug' }),
  ];
}

test('filters every report section through one grouped view', async () => {
  const { buildReportModel } = await import('../src/report.js');

  const model = buildReportModel(groupedLedger(), viewConfig(groupedFilters), '2026-08-14');

  assert.deepEqual(model.items.map(({ id }) => id), ['wb_api_bug', 'wb_auth_bug']);
  assert.deepEqual(model.terminalItems, []);
  assert.deepEqual(model.workNext.map(({ id }) => id), ['wb_api_bug']);
  assert.deepEqual(model.attention.blocked.map(({ id }) => id), ['wb_auth_bug']);
  assert.deepEqual(model.attention.aging.map(({ id }) => id), ['wb_api_bug', 'wb_auth_bug']);
  assert.deepEqual(model.stats, {
    total: 2,
    open: 2,
    terminal: 0,
    ready: 1,
    blocked: 1,
    ineligible: 0,
    triage: 0,
    inProgress: 0,
    snoozed: 0,
    done: 0,
    killed: 0,
    deferred: 0,
    archived: 0,
  });
  assert.deepEqual(model.view, {
    name: 'security-blockers',
    title: 'Security blockers',
    criteria: [
      { key: 'readiness', values: ['ready', 'blocked'] },
      { key: 'status', values: ['backlog'] },
      { key: 'kind', values: ['task'] },
      { key: 'field:area', values: ['api', 'auth'] },
      { key: 'field:class', values: ['bug'] },
    ],
  });
});

// The artifact is titled by whatever produced it: a named view titles its own
// report, and the base report keeps the configured ledger title.
test('a named view titles the report it generates', async () => {
  const { buildReportModel } = await import('../src/report.js');
  const config = viewConfig(groupedFilters);

  const named = buildReportModel(groupedLedger(), config, '2026-08-14');
  const base = buildReportModel(groupedLedger(), { ...config, view: null }, '2026-08-14');

  assert.equal(named.title, 'Security blockers');
  assert.equal(base.title, 'Example report');
});

test('an empty view succeeds with explicit empty sections', async () => {
  const { buildReportModel } = await import('../src/report.js');

  const model = buildReportModel(
    groupedLedger(),
    viewConfig({ fields: { area: ['nothing-matches-this'] } }),
    '2026-08-14',
  );

  assert.deepEqual(model.items, []);
  assert.deepEqual(model.terminalItems, []);
  assert.deepEqual(model.workNext, []);
  assert.deepEqual(model.swarmBatches, []);
  assert.deepEqual(model.unknownClasses, []);
  assert.deepEqual(model.attention.blocked, []);
  assert.deepEqual(model.attention.aging, []);
  assert.deepEqual(model.attention.stuck, []);
  assert.equal(model.attention.blockedTotal, 0);
  assert.equal(model.stats.total, 0);
  assert.equal(model.stats.open, 0);
  assert.equal(model.stats.terminal, 0);
  assert.equal(model.evidence.throughput.total, 0);
  assert.equal(model.evidence.cycleTime.sampleCount, 0);
  assert.equal(model.evidence.forecast, null);
  // The report still says which view produced nothing, and every ledger item
  // keeps its number for any label that names it.
  assert.equal(model.view.name, 'security-blockers');
  assert.equal(Object.keys(model.itemNumbers).length, 7);
});

// Terminal work is filtered the same way open work is, so the flow and
// forecast evidence describes the retained population rather than the ledger
// the view was cut from.
function historyLedger() {
  const accept = (date) => [{ action: 'accept', date, summary: 'Accepted', rationale: 'Queued' }];
  return [
    item('wb_api_open', { number: 10, area: 'api', created: '2026-08-12' }),
    item('wb_api_done_early', {
      number: 11,
      area: 'api',
      status: 'done',
      completed: '2026-08-10',
      decisions: accept('2026-08-01'),
    }),
    item('wb_api_done_late', {
      number: 12,
      area: 'api',
      status: 'done',
      completed: '2026-08-12',
      decisions: accept('2026-08-02'),
    }),
    item('wb_docs_done', {
      number: 13,
      area: 'docs',
      status: 'done',
      completed: '2026-08-11',
      decisions: accept('2026-08-03'),
    }),
    item('wb_docs_open', { number: 14, area: 'docs', created: '2026-01-01' }),
  ];
}

test('view statistics and evidence count only retained items', async () => {
  const { buildReportModel } = await import('../src/report.js');

  const model = buildReportModel(
    historyLedger(),
    viewConfig({ fields: { area: ['api'] } }),
    '2026-08-14',
  );

  assert.equal(model.stats.total, 3);
  assert.equal(model.stats.open, 1);
  assert.equal(model.stats.terminal, 2);
  assert.equal(model.stats.done, 2);
  assert.equal(model.evidence.throughput.total, 2);
  assert.deepEqual(model.evidence.cycleTime.samples.map(({ number }) => number), [11, 12]);
  assert.equal(
    model.evidence.agingBuckets.reduce((total, bucket) => total + bucket.count, 0),
    1,
  );
  assert.equal(model.evidence.forecast.remaining, 1);
});

test('view history contains only retained terminal items', async () => {
  const { buildReportModel } = await import('../src/report.js');

  const model = buildReportModel(
    historyLedger(),
    viewConfig({ fields: { area: ['api'] } }),
    '2026-08-14',
  );

  assert.deepEqual(
    model.terminalItems.map(({ id }) => id),
    ['wb_api_done_late', 'wb_api_done_early'],
  );
});

// Readiness answers a question about the whole ledger. A view that hides the
// dependency cannot change the answer in either direction: excluding a
// satisfied prerequisite never blocks the work it released, and excluding an
// unsatisfied one never releases the work it holds.
test('view readiness stays a fact about the complete ledger', async () => {
  const satisfied = 'wb_infra_done';
  const unsatisfied = 'wb_infra_open';
  const items = [
    item(satisfied, { number: 20, area: 'infra', status: 'done', completed: '2026-08-05' }),
    item(unsatisfied, { number: 21, area: 'infra' }),
    item('wb_api_released', { number: 22, area: 'api', depends_on: [satisfied] }),
    item('wb_api_held', { number: 23, area: 'api', depends_on: [unsatisfied] }),
  ];
  const { buildReportModel } = await import('../src/report.js');

  const model = buildReportModel(items, viewConfig({ fields: { area: ['api'] } }), '2026-08-14');

  assert.deepEqual(
    model.items.map(({ id, readiness }) => [id, readiness]),
    [
      ['wb_api_held', {
        state: 'blocked',
        reasons: [{ code: 'dependency-unsatisfied', item_id: unsatisfied }],
      }],
      ['wb_api_released', { state: 'ready', reasons: [] }],
    ],
  );
  assert.equal(model.stats.ready, 1);
  assert.equal(model.stats.blocked, 1);
  assert.equal(model.itemNumbers[satisfied], 20);
  assert.equal(model.itemNumbers[unsatisfied], 21);
});

// Tags are the one multi-value mapped field: a scalar source reads as a
// one-tag set, exact duplicates collapse, and values sort deterministically.
// A mixed-type array is rejected whole, never partially accepted, and counts
// as invalid coverage instead of silently becoming a valid classification.
test('normalizes mapped tags and counts invalid tag metadata as invalid', async () => {
  const report = await import('../src/report.js');
  const model = report.buildReportModel([
    item('wb_a', { data: { area: 'Payments', tags: ['regression', 'customer-visible', 'regression'] } }),
    item('wb_b', { data: { area: 'Accounts', tags: ['regression', 4] } }),
  ], {
    reportVersion: 1, repository: { name: 'Example', logo: null },
    title: 'Example', outputPath: '/tmp/example.html',
    fields: { area: '/data/area', tags: '/data/tags' }, swarm: null,
  }, '2026-09-05');
  assert.deepEqual(model.items.find(x => x.id === 'wb_a').fields.tags,
    ['customer-visible', 'regression']);
  assert.equal(model.fieldCoverage.find(x => x.name === 'tags').invalid, 1);
});

// A named tag filter uses any-member matching: an item carrying two tags
// answers either tag, while an item carrying neither stays out.
test('a named tag filter matches either member of a tag array', async () => {
  const { buildReportModel } = await import('../src/report.js');
  const ledger = [
    item('wb_multi', { number: 30, tags: ['regression', 'customer-visible'] }),
    item('wb_other', { number: 31, tags: ['docs'] }),
  ];
  const configFor = (tags) => viewConfig(
    { fields: { tags } },
    { fields: { tags: '/tags' } },
  );

  const first = buildReportModel(ledger, configFor(['customer-visible']), '2026-08-14');
  const second = buildReportModel(ledger, configFor(['regression']), '2026-08-14');
  const neither = buildReportModel(ledger, configFor(['security']), '2026-08-14');

  assert.deepEqual(first.items.map(({ id }) => id), ['wb_multi']);
  assert.deepEqual(second.items.map(({ id }) => id), ['wb_multi']);
  assert.deepEqual(neither.items, []);
});

// Missing metadata is never a literal value: a tag filter for `Unclassified`
// matches only an item really carrying that tag, never an item with no tags.
test('a literal Unclassified tag matches while missing tags match nothing', async () => {
  const { buildReportModel } = await import('../src/report.js');
  const ledger = [
    item('wb_literal', { number: 40, tags: ['Unclassified'] }),
    item('wb_missing', { number: 41 }),
  ];
  const fields = { tags: '/tags' };
  const base = { reportVersion: 1, repository: { name: 'Example', logo: null } };

  const named = buildReportModel(
    ledger,
    viewConfig({ fields: { tags: ['Unclassified'] } }, { fields }),
    '2026-08-14',
  );
  const unfiltered = buildReportModel(
    ledger,
    { ...base, title: 'Example', outputPath: '/tmp/example.html', fields, swarm: null },
    '2026-08-14',
  );

  assert.deepEqual(named.items.map(({ id }) => id), ['wb_literal']);
  // Coverage counts the retained population: the view kept only the literal
  // carrier, while the unfiltered report counts the missing item as missing.
  assert.deepEqual(named.fieldCoverage.find((entry) => entry.name === 'tags'), {
    name: 'tags', mapped: true, present: 1, missing: 0, invalid: 0,
  });
  assert.deepEqual(unfiltered.fieldCoverage.find((entry) => entry.name === 'tags'), {
    name: 'tags', mapped: true, present: 1, missing: 1, invalid: 0,
  });
});
