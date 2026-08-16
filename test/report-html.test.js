import test from 'node:test';
import assert from 'node:assert/strict';

function sequencing(overrides = {}) {
  return {
    class: { value: 'standard', raw: null, known: true },
    due: null,
    ageDays: 13,
    size: { value: 'small', weight: 1 },
    leverage: { count: 0, numbers: [] },
    epic: null,
    ...overrides,
  };
}

function model() {
  return {
    reportVersion: 1,
    repository: { name: 'Example <script>', logo: null },
    title: 'Report & status',
    asOf: '2026-08-14',
    stats: { total: 2, open: 1, terminal: 1, ready: 1, blocked: 0, ineligible: 0 },
    swarm: null,
    swarmBatches: [],
    items: [{
      id: 'wb_hostile',
      number: 7,
      title: 'Unsafe </script><img src=x onerror=alert(1)>',
      kind: 'task',
      status: 'backlog',
      created: '2026-08-01',
      updated: '2026-08-02',
      terminalDate: null,
      priority: 1,
      parent: 'wb_done',
      dependsOn: ['wb_done'],
      related: ['wb_missing'],
      decisions: [],
      body: '# Body\n\n</script><script>alert(1)</script>',
      readiness: { state: 'blocked', reasons: [{ code: 'dependency-unsatisfied', item_id: 'wb_done' }] },
      fields: { area: 'Core & CLI', complexity: 'small' },
      sequencing: sequencing(),
    }],
    terminalItems: [{
      id: 'wb_done',
      number: 8,
      title: 'Completed item',
      kind: 'task',
      status: 'done',
      created: '2026-08-01',
      updated: '2026-08-10',
      terminalDate: '2026-08-10',
      priority: null,
      parent: null,
      dependsOn: [],
      related: [],
      decisions: [{ action: 'complete', date: '2026-08-10', summary: 'Done', rationale: 'Verified' }],
      body: '',
      readiness: { state: 'ineligible', reasons: [{ code: 'status-not-backlog' }] },
      fields: {},
    }],
    workNext: [{
      id: 'wb_hostile',
      number: 7,
      title: 'Unsafe </script><img src=x onerror=alert(1)>',
      reasons: [
        { code: 'priority', label: 'priority 1' },
        { code: 'age', label: 'age 13d' },
      ],
    }],
    unknownClasses: [{ value: 'urgent & loud', numbers: [7] }],
    attention: {
      blocked: [{
        id: 'wb_blocked',
        number: 12,
        title: 'Blocked item',
        ageDays: 10,
        blockers: [
          { code: 'dependency-unsatisfied', id: 'wb_dependency', number: 5, title: 'Dependency', status: 'in-progress' },
        ],
      }],
      aging: [
        { id: 'wb_old', number: 3, title: 'Old item', status: 'backlog', state: 'ready', ageDays: 225 },
      ],
      blockedTotal: 3,
      agingTotal: 1,
      stuckTotal: 1,
      stuck: [{
        id: 'wb_stuck',
        number: 10,
        title: 'Stuck item',
        status: 'in-progress',
        startedOn: '2026-07-01',
        elapsedDays: 44,
        thresholdDays: 20,
      }],
    },
    evidence: {
      agingBuckets: [
        { label: 'under 7d', count: 1 },
        { label: '7-30d', count: 2 },
        { label: '30-90d', count: 0 },
        { label: 'over 90d', count: 1 },
      ],
      agingMatrix: {
        statuses: ['backlog', 'in-progress'],
        rows: [
          { label: 'under 7d', counts: [1, 0] },
          { label: '7-30d', counts: [1, 1] },
          { label: '30-90d', counts: [0, 0] },
          { label: 'over 90d', counts: [1, 0] },
        ],
      },
      weeks: [
        { weekStart: '2026-08-03', arrivals: 2, completions: 1, rolling: 0.25 },
        { weekStart: '2026-08-10', arrivals: 0, completions: 3, rolling: 1 },
      ],
      cumulativeFlow: [
        { date: '2026-08-13', triage: 1, accepted: 1, terminal: 0 },
        { date: '2026-08-14', triage: 1, accepted: 0, terminal: 1 },
      ],
      throughput: { total: 4, windowWeeks: 12, perWeek: 0.33 },
      cycleTime: {
        sampleCount: 3,
        medianDays: 10,
        p85Days: 20,
        samples: [
          { number: 8, completedOn: '2026-08-10', days: 10 },
          { number: 9, completedOn: '2026-08-12', days: 20 },
          { number: 10, completedOn: '2026-08-14', days: 4 },
        ],
      },
      forecast: {
        remaining: 4,
        weeks50: 8,
        weeks85: 11,
        weeks95: 13,
        date50: '2026-10-09',
        date85: '2026-10-30',
        date95: '2026-11-13',
        distribution: [
          { weeks: 0, share: 0 },
          { weeks: 8, share: 0.63 },
          { weeks: 11, share: 0.88 },
          { weeks: 13, share: 0.95 },
        ],
        trials: 5000,
      },
    },
  };
}

function decisionSurface(html) {
  return html.slice(0, html.indexOf('id="drilldown"'));
}

test('renders deterministic self-contained HTML without executable ledger content', async () => {
  const report = await import('../src/report-html.js').catch(() => ({}));
  const first = report.renderReportHtml?.(model());
  const second = report.renderReportHtml?.(model());

  assert.equal(first, second);
  assert.match(first, /^<!doctype html>/);
  assert.match(first, /<title>Report &amp; status<\/title>/);
  assert.match(first, /Example &lt;script&gt;/);
  assert.match(first, /Unsafe &lt;\/script&gt;&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(first, /type="text\/markdown"/);
  assert.match(first, /\\u003c\/script>/);
  assert.match(first, /<table[^>]*>.*Completed item.*<\/table>/s);
  assert.match(first, /id="sort-by"/);
  assert.match(first, /class="slot-filter" data-field="area"/);
  assert.match(first, /class="body-excerpt standard-only"/);
  assert.match(first, /class="body-section detailed-only"/);
  assert.doesNotMatch(first, /<script>alert\(1\)<\/script>|<img src=x|<link\s|<script\s+src=/);
});

test('renders a checked control for hiding terminal history', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const html = renderReportHtml(model());

  assert.match(
    html,
    /<label class="history-toggle"><input id="show-history" type="checkbox" checked>Show history<\/label>/,
  );
  assert.match(html, /<section id="history" class="panel">/);
});

test('opens with the ranked work-next list and its reasons', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const html = renderReportHtml(model());
  const surface = decisionSurface(html);

  assert.ok(surface.indexOf('id="work-next"') < surface.indexOf('id="attention"'));
  assert.ok(surface.indexOf('id="attention"') < surface.indexOf('id="evidence"'));
  assert.match(surface, /id="work-next"/);
  assert.match(surface, /<span class="handle">#7<\/span>/);
  assert.match(surface, /priority 1/);
  assert.match(surface, /age 13d/);
});

test('renders the attention layer with blocker numbers and ages', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const surface = decisionSurface(renderReportHtml(model()));

  assert.match(surface, /#12/);
  assert.match(surface, /blocked by #5/);
  assert.match(surface, /225d/);
  assert.match(surface, /44d/);
  assert.match(surface, /p85 20d/);
});

test('renders the evidence layer with throughput, buckets, and forecast bands', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const surface = decisionSurface(renderReportHtml(model()));

  assert.match(surface, /0\.33/);
  assert.match(surface, /over 90d/);
  assert.match(surface, /2026-10-09/);
  assert.match(surface, /2026-10-30/);
  assert.match(surface, /50%/);
  assert.match(surface, /85%/);
});

test('draws the weekly flow as an inline SVG chart carrying its own numbers', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const surface = decisionSurface(renderReportHtml(model()));

  assert.match(surface, /<svg[^>]*data-testid="chart-weekly-flow"/);
  assert.match(surface, /<title>Week of 2026-08-10: 0 arrivals, 3 completions<\/title>/);
});

test('draws all six evidence charts, each under its own stable test id', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const surface = decisionSurface(renderReportHtml(model()));

  for (const id of [
    'chart-aging-heatmap',
    'chart-throughput',
    'chart-weekly-flow',
    'chart-cumulative-flow',
    'chart-cycle-time',
    'chart-forecast',
  ]) {
    assert.match(surface, new RegExp(`<svg[^>]*data-testid="${id}"`), id);
  }
});

test('draws the aging heatmap as age crossed with status', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const surface = decisionSurface(renderReportHtml(model()));

  assert.match(surface, /<title>backlog, 7-30d: 1 open item<\/title>/);
  assert.match(surface, /<title>in-progress, 30-90d: 0 open items<\/title>/);
  assert.match(surface, /<text class="chart-total" [^>]*>2<\/text>/);
});

test('draws the cycle-time scatter and the cumulative flow from the same model', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const surface = decisionSurface(renderReportHtml(model()));

  assert.match(surface, /<title>#9 completed 2026-08-12 after 20 days<\/title>/);
  assert.match(surface, /<title>Terminal: 1 item on 2026-08-14<\/title>/);
  assert.match(surface, /<title>Week of 2026-08-10: 3 completions, 1 a week over the last 4<\/title>/);
});

test('draws the forecast fan and states all three percentile dates', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const surface = decisionSurface(renderReportHtml(model()));

  assert.match(surface, /<title>50% of trials finish 4 items by 2026-10-09, 8 weeks from 2026-08-14<\/title>/);
  assert.match(surface, /<title>95% of trials finish 4 items by 2026-11-13, 13 weeks from 2026-08-14<\/title>/);
  assert.match(surface, /95% by <strong>2026-11-13<\/strong> \(13 weeks\)/);
});

test('draws no chart for a series with no history and keeps the numeric statement', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const empty = model();
  empty.evidence = {
    agingBuckets: [{ label: 'under 7d', count: 0 }, { label: 'over 90d', count: 0 }],
    agingMatrix: { statuses: [], rows: [] },
    weeks: [{ weekStart: '2026-08-10', arrivals: 0, completions: 0, rolling: null }],
    cumulativeFlow: [{ date: '2026-08-14', triage: 0, accepted: 0, terminal: 0 }],
    throughput: { total: 0, windowWeeks: 12, perWeek: 0 },
    cycleTime: {
      sampleCount: 0, medianDays: null, p85Days: null, samples: [],
    },
    forecast: null,
  };
  const surface = decisionSurface(renderReportHtml(empty));

  assert.doesNotMatch(surface, /data-testid="chart-/);
  assert.match(surface, /No completions in the window, so no forecast\./);
  assert.match(surface, /No accept-to-complete history yet\./);
});

test('draws the forecast band without dividing by zero when nothing remains', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const settled = model();
  settled.evidence.forecast = {
    remaining: 0,
    weeks50: 0,
    weeks85: 0,
    weeks95: 0,
    date50: '2026-08-14',
    date85: '2026-08-14',
    date95: '2026-08-14',
    distribution: [{ weeks: 0, share: 1 }],
    trials: 5000,
  };
  const surface = decisionSurface(renderReportHtml(settled));

  assert.doesNotMatch(surface, /data-testid="chart-forecast"/);
  assert.match(surface, /<strong>0<\/strong> open items remaining\./);
});

test('fetches nothing at view time: every reference is inline or a data URL', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const html = renderReportHtml(model(), { logoDataUrl: 'data:image/png;base64,AAAA' });

  assert.match(html, /<img class="logo" src="data:image\/png;base64,AAAA"/);
  assert.match(html, /content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"/);
  assert.doesNotMatch(html, /<link\b|@import|xlink:href|<use\b|<image\b|<iframe\b|<object\b|<embed\b/);
  assert.doesNotMatch(html, /\ssrc="(?!data:)/);
  assert.doesNotMatch(html, /url\(\s*['"]?(?:https?:)?\/\//);
});

test('reports unrecognised class values instead of dropping them', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const surface = decisionSurface(renderReportHtml(model()));

  assert.match(surface, /urgent &amp; loud/);
});

test('refers to items by number above the drill-down', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const surface = decisionSurface(renderReportHtml(model()));

  assert.doesNotMatch(surface, /wb_hostile|wb_blocked|wb_dependency|wb_old|wb_stuck/);
});

test('names related items by number inside the drill-down detail', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const html = renderReportHtml(model());
  const detail = html.slice(html.indexOf('id="drilldown"'));

  assert.match(detail, /<dt>Parent<\/dt><dd>#8<\/dd>/);
  assert.match(detail, /<dt>Depends on<\/dt><dd>#8<\/dd>/);
  assert.match(detail, /<dt>Related<\/dt><dd>wb_missing<\/dd>/);
  assert.match(detail, /<li>Dependency is not done: #8<\/li>/);
});

test('says how much of a truncated attention list is not shown', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const surface = decisionSurface(renderReportHtml(model()));

  assert.match(surface, /Showing 1 of 3\./);
});
