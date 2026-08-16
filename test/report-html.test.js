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
      weeks: [
        { weekStart: '2026-08-03', arrivals: 2, completions: 1 },
        { weekStart: '2026-08-10', arrivals: 0, completions: 3 },
      ],
      throughput: { total: 4, windowWeeks: 12, perWeek: 0.33 },
      cycleTime: { sampleCount: 3, medianDays: 10, p85Days: 20 },
      forecast: {
        remaining: 4,
        weeks50: 8,
        weeks85: 11,
        date50: '2026-10-09',
        date85: '2026-10-30',
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
