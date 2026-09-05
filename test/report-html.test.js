import test from 'node:test';
import assert from 'node:assert/strict';
import { reportDom, runReportClient } from './report-dom.js';

// The report always carries the dependency graph, so every render needs the
// vendored bundle. A stub keeps these tests about the report, not the renderer.
const graphBundle = {
  manifest: { package: '3d-force-graph', version: '0.0.0-test' },
  source: 'window.ForceGraph3D=function(){};',
};

function options(extra = {}) {
  return { graphBundle: graphBundle, ...extra };
}

// Two cards, one ready and one blocked, with one mapped value between them:
// enough for a state filter, a search term, and a slot filter each to detach
// the card a row above the drill-down points at.
function revealDom() {
  return reportDom({
    items: [
      {
        id: 'item-7',
        order: 0,
        state: 'ready',
        status: 'backlog',
        priority: 1,
        created: '2026-08-01',
        title: 'Ready item',
        fields: { area: 'core' },
        search: '#7 ready item core',
        body: '# Ready body',
      },
      {
        id: 'item-12',
        order: 1,
        state: 'blocked',
        status: 'backlog',
        priority: null,
        created: '2026-08-02',
        title: 'Blocked item',
        fields: { area: 'docs' },
        search: '#12 blocked item docs',
        body: '# Blocked body',
      },
    ],
  });
}

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
    fieldCoverage: [
      { name: 'area', mapped: true, present: 1, missing: 1, invalid: 0 },
      { name: 'complexity', mapped: true, present: 1, missing: 1, invalid: 0 },
      { name: 'tags', mapped: false, present: 0, missing: 2, invalid: 0 },
    ],
    swarm: null,
    swarmBatches: [],
    // The complete-ledger label lookup the report keeps: every item the ledger
    // numbers, including the ones this projection does not carry a row for.
    itemNumbers: {
      wb_hostile: 7,
      wb_done: 8,
      wb_dependency: 5,
      wb_blocked: 12,
      wb_old: 3,
      wb_stuck: 10,
    },
    view: null,
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
        { weekStart: '2026-08-03', arrivals: 2, closures: 1, done: 1, partial: false, rolling: 0.25 },
        { weekStart: '2026-08-10', arrivals: 0, closures: 3, done: 2, partial: false, rolling: 1 },
      ],
      cumulativeFlow: [
        { date: '2026-08-13', triage: 1, accepted: 1, terminal: 0 },
        { date: '2026-08-14', triage: 1, accepted: 0, terminal: 1 },
      ],
      throughput: { total: 4, done: 3, windowWeeks: 12, perWeek: 0.33 },
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
  return html.slice(0, html.indexOf('id="items"'));
}

function flowSurface(html) {
  const start = html.indexOf('id="section-flow"');
  const end = html.indexOf('id="section-dependencies"');
  return html.slice(start, end);
}

// What a screen reader would read out of the element an aria reference names:
// the report escapes every ledger value, so stripping tags is enough to get the
// announced text out of the rendered string.
function elementText(html, id) {
  const at = html.indexOf(`id="${id}"`);
  assert.notEqual(at, -1, `no element carries id ${id}`);
  const tag = /^<([a-z]+)/.exec(html.slice(html.lastIndexOf('<', at)))[1];
  const start = html.indexOf('>', at) + 1;
  let cursor = start;
  let depth = 1;
  while (depth > 0) {
    const opened = html.indexOf(`<${tag}`, cursor);
    const closed = html.indexOf(`</${tag}`, cursor);
    assert.notEqual(closed, -1, `element ${id} is never closed`);
    if (opened !== -1 && opened < closed) {
      depth += 1;
      cursor = opened + tag.length + 1;
      continue;
    }
    depth -= 1;
    if (depth === 0) {
      return html.slice(start, closed).replace(/<[^>]*>/g, ' ');
    }
    cursor = closed + tag.length + 2;
  }
  throw new Error(`unreachable for ${id}`);
}

test('renders deterministic self-contained HTML without executable ledger content', async () => {
  const report = await import('../src/report-html.js').catch(() => ({}));
  const first = report.renderReportHtml?.(model(), options());
  const second = report.renderReportHtml?.(model(), options());

  assert.equal(first, second);
  assert.match(first, /^<!doctype html>/);
  assert.match(first, /<title>Report &amp; status<\/title>/);
  assert.match(first, /Example &lt;script&gt;/);
  assert.match(first, /Unsafe &lt;\/script&gt;&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(first, /type="text\/markdown"/);
  assert.match(first, /\\u003c\/script>/);
  assert.match(first, /History.*Completed item/s);
  assert.match(first, /id="sort-by"/);
  assert.match(first, /<fieldset class="facet-group" data-group="field:area">/);
  assert.match(first, /class="body-excerpt standard-only"/);
  assert.match(first, /class="body-section detailed-only"/);
  assert.doesNotMatch(first, /<script>alert\(1\)<\/script>|<img src=x|<link\s|<script\s+src=/);
});

test('renders a checked control for hiding terminal history', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const html = renderReportHtml(model(), options());

  assert.match(
    html,
    /<label class="history-toggle"><input id="show-history" type="checkbox" checked>Show history<\/label>/,
  );
});

// The dropdown only moves the body's richness attribute, so a mode is visible
// on a shut card only if the summary itself carries richness-gated nodes.
test('gates extra collapsed-card summary content behind the standard and detailed modes', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const html = renderReportHtml(model(), options());
  const card = html.slice(html.indexOf('<details class="card"'));
  const summary = card.slice(0, card.indexOf('</summary>'));

  assert.match(summary, /class="summary-context standard-only"[^>]*>[^<]*task[^<]*<\/span>/);
  assert.match(summary, /updated 2026-08-02/);
  assert.match(summary, /class="summary-preview detailed-only"[^>]*># Body/);
  assert.match(
    html,
    /body\[data-richness="basic"\] \.standard-only[^{]*body\[data-richness="standard"\] \.detailed-only\{display:none\}/,
  );
});

test('opens with the ranked work-next list and its reasons', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const html = renderReportHtml(model(), options());
  const items = html.slice(html.indexOf('id="section-items"'), html.indexOf('id="section-flow"'));

  assert.match(items, /data-quick="work-next"[^>]*aria-pressed="true"/);
  assert.match(items, /<span class="handle">#7<\/span>/);
  assert.match(items, /priority 1/);
  assert.match(items, /age 13d/);
  assert.match(items, /Unrecognised class values, ranked as standard/);
  assert.match(items, /urgent &amp; loud/);
});

// A decision surface that names an item has to be able to show it. The row is
// the whole link so the pointer target matches the reading target, and the
// href alone reaches the card when scripting is off.
test('links a work-next row as a whole row to the canonical detail card', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const html = renderReportHtml(model(), options());
  const items = html.slice(html.indexOf('id="section-items"'), html.indexOf('id="section-flow"'));
  const row = items.slice(items.indexOf('<ol id="item-list"'), items.indexOf('</ol>'));

  assert.match(html, /<details class="card" id="item-7"/);
  assert.match(row, /<li><a class="row-link" href="#item-7" data-reveal="item-7"/);
  assert.match(row, /aria-labelledby="row-work-next-item-7-name" aria-describedby="row-work-next-item-7-detail"/);
  assert.ok(row.indexOf('age 13d') < row.indexOf('</a>'));
});

test('renders the attention summary with blocker numbers and ages', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const items = htmlSlice(renderReportHtml(model(), options()));

  assert.match(items, /#12/);
  assert.match(items, /#5/);
  assert.match(items, /225d/);
  assert.match(items, /44d/);
  assert.match(items, /p85 20d/);
  assert.match(items, /Showing 1 of 3\./);
});

function htmlSlice(html) {
  return html.slice(html.indexOf('id="section-items"'), html.indexOf('id="section-flow"'));
}

test('summarises attention without duplicating full item lists', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const items = htmlSlice(renderReportHtml(model(), options()));

  assert.match(items, /id="attention-summary"/);
  assert.doesNotMatch(items, /<section id="attention"/);
  assert.doesNotMatch(items, /<section id="work-next"/);
});

// aria-label replaces every node nested inside the anchor, so a free-text label
// on a whole-row link costs the reader exactly what the row is for: the ranking
// reasons on Work next and the history facts below it. The row's own printed
// nodes have to be the name and the description.
test('names every list row by its handle and title and describes it with row facts', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const html = renderReportHtml(model(), options());
  const items = htmlSlice(html);
  const rows = [...items.matchAll(/<a class="row-link"[^>]*>.*?<\/a>/gs)].map((match) => match[0]);
  const expected = new Map([
    ['item-7', { name: ['#7', 'Unsafe'], detail: ['priority 1', 'age 13d'] }],
    ['item-8', { name: ['#8', 'Completed item'], detail: ['done', 'terminal'] }],
  ]);

  assert.equal(rows.length, expected.size);
  assert.doesNotMatch(items, /class="row-link"[^>]*aria-label=/);

  for (const row of rows) {
    const anchor = /data-reveal="([^"]+)"/.exec(row)[1];
    const nameId = /aria-labelledby="([^"]+)"/.exec(row)?.[1];
    const detailId = /aria-describedby="([^"]+)"/.exec(row)?.[1];
    assert.ok(nameId !== undefined && detailId !== undefined, `${anchor} row link names nothing: ${row}`);

    const facts = expected.get(anchor);
    for (const [id, substrings] of [[nameId, facts.name], [detailId, facts.detail]]) {
      assert.equal(html.split(`id="${id}"`).length - 1, 1, `id ${id} is not unique in the document`);
      assert.ok(row.includes(`id="${id}"`), `${anchor} points outside its own row at ${id}`);
      const text = elementText(html, id);
      for (const substring of substrings) {
        assert.match(text, new RegExp(substring.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      }
    }
  }
});

test('renders the evidence layer with throughput, buckets, and forecast bands', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const surface = flowSurface(renderReportHtml(model(), options()));

  assert.match(surface, /0\.33/);
  assert.match(surface, /over 90d/);
  assert.match(surface, /2026-10-09/);
  assert.match(surface, /2026-10-30/);
  assert.match(surface, /50%/);
  assert.match(surface, /85%/);
});

test('labels closures as closures and states the snapshot limits', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const surface = flowSurface(renderReportHtml(model(), options()));

  assert.match(surface, /4 closures \(3 done\) over 12 weeks/);
  assert.match(surface, /3 done items with recorded acceptance, accept to completion/);
  assert.match(surface, /Closed includes done, killed, deferred, and archived/);
  assert.match(surface, /closure-based estimate, not a delivery commitment/);
  assert.doesNotMatch(surface, /completions over/);
});

test('draws the weekly flow as an inline SVG chart carrying its own numbers', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const surface = flowSurface(renderReportHtml(model(), options()));

  assert.match(surface, /<svg[^>]*data-testid="chart-weekly-flow"/);
  assert.match(surface, /<title>Week of 2026-08-10: 0 arrivals, 3 closures<\/title>/);
});

test('draws all six evidence charts, each under its own stable test id', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const surface = flowSurface(renderReportHtml(model(), options()));

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
  const surface = flowSurface(renderReportHtml(model(), options()));

  assert.match(surface, /<title>backlog, 7-30d: 1 open item<\/title>/);
  assert.match(surface, /<title>in-progress, 30-90d: 0 open items<\/title>/);
  assert.match(surface, /<text class="chart-total" [^>]*>2<\/text>/);
});

test('draws the cycle-time scatter and the cumulative flow from the same model', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const surface = flowSurface(renderReportHtml(model(), options()));

  assert.match(surface, /<title>#9 completed 2026-08-12 after 20 days<\/title>/);
  assert.match(surface, /<title>Terminal: 1 item on 2026-08-14<\/title>/);
  assert.match(surface, /<title>Week of 2026-08-10: 3 closures \(2 done\), 1 a week over the last 4<\/title>/);
});

test('draws the forecast fan and states all three percentile dates', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const surface = flowSurface(renderReportHtml(model(), options()));

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
    weeks: [{ weekStart: '2026-08-10', arrivals: 0, closures: 0, done: 0, partial: false, rolling: null }],
    cumulativeFlow: [{ date: '2026-08-14', triage: 0, accepted: 0, terminal: 0 }],
    throughput: { total: 0, done: 0, windowWeeks: 12, perWeek: 0 },
    cycleTime: {
      sampleCount: 0, medianDays: null, p85Days: null, samples: [],
    },
    forecast: null,
  };
  const surface = flowSurface(renderReportHtml(empty, options()));

  assert.doesNotMatch(surface, /data-testid="chart-/);
  assert.match(surface, /No closures in the window, so no forecast\./);
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
  const surface = flowSurface(renderReportHtml(settled, options()));

  assert.doesNotMatch(surface, /data-testid="chart-forecast"/);
  assert.match(surface, /<strong>0<\/strong> open items remaining\./);
});

test('fetches nothing at view time: every reference is inline or a data URL', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const html = renderReportHtml(model(), options({ logoDataUrl: 'data:image/png;base64,AAAA' }));

  assert.match(html, /<img class="logo" src="data:image\/png;base64,AAAA"/);
  assert.match(html, /content="default-src 'none'; connect-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"/);
  assert.doesNotMatch(html, /<link\b|@import|xlink:href|<use\b|<image\b|<iframe\b|<object\b|<embed\b/);
  assert.doesNotMatch(html, /\ssrc="(?!data:)/);
  assert.doesNotMatch(html, /url\(\s*['"]?(?:https?:)?\/\//);
});

test('reports unrecognised class values instead of dropping them', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const surface = decisionSurface(renderReportHtml(model(), options()));

  assert.match(surface, /urgent &amp; loud/);
});

test('refers to items by number above the drill-down', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const surface = decisionSurface(renderReportHtml(model(), options()));

  assert.doesNotMatch(surface, /wb_hostile|wb_blocked|wb_dependency|wb_old|wb_stuck/);
});

test('names related items by number inside the drill-down detail', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const html = renderReportHtml(model(), options());
  const detail = html.slice(html.indexOf('id="items"'));

  assert.match(detail, /<dt>Parent<\/dt><dd><a href="#item-8" data-reveal="item-8" data-inspect="wb_done">#8<\/a><\/dd>/);
  assert.match(detail, /<dt>Depends on<\/dt><dd><a href="#item-8" data-reveal="item-8" data-inspect="wb_done">#8<\/a><\/dd>/);
  assert.match(detail, /<dt>Related<\/dt><dd>wb_missing \(not included in this report\)<\/dd>/);
  assert.match(detail, /<li>Dependency is not done: #8<\/li>/);
});

// A view drops the item, never the reader's handle on it: an included item that
// depends on an excluded one still names it by the number the complete ledger
// gave it, and the excluded item contributes nothing else to the artifact.
const excludedId = 'wb_01KZFFFFFFFFFFFFFFFFFFFFFF';

function viewModel() {
  const base = model();
  return {
    ...base,
    itemNumbers: { ...base.itemNumbers, [excludedId]: 40 },
    view: {
      name: 'security-blockers',
      title: 'Security blockers',
      criteria: [{ key: 'field:area', values: ['Core & CLI'] }],
    },
    items: [{
      ...base.items[0],
      dependsOn: ['wb_done', excludedId],
      readiness: {
        state: 'blocked',
        reasons: [
          { code: 'dependency-unsatisfied', item_id: 'wb_done' },
          { code: 'dependency-unsatisfied', item_id: excludedId },
        ],
      },
    }],
  };
}

test('labels an excluded reference with its complete-ledger number', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const html = renderReportHtml(viewModel(), options());
  const detail = html.slice(html.indexOf('id="items"'));

  assert.match(detail, /<dt>Depends on<\/dt><dd><a href="#item-8"[^>]*>#8<\/a>, #40 \(not included in this report\)<\/dd>/);
  assert.match(detail, /<li>Dependency is not done: #40<\/li>/);
  assert.doesNotMatch(html, new RegExp(excludedId));
});

// A named report is an artifact about a subset, so it says which subset in its
// own voice: the view's title, the stable name automation selected it by, and
// the criteria the generator applied. Those criteria are facts about the file
// rather than controls over it, so they wear the report's chip vocabulary
// without carrying an input a reader could toggle. A typed criterion prints the
// value the configuration wrote, and the base report states none of this.
test('identifies a named view and its fixed criteria', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const named = viewModel();
  named.view.criteria = [
    { key: 'readiness', values: ['blocked'] },
    { key: 'status', values: ['backlog', 'in-progress'] },
    { key: 'field:area', values: ['Core & CLI'] },
    { key: 'field:security_tier', values: [2, true] },
  ];
  const html = renderReportHtml(named, options());
  const contextStart = html.indexOf('<section class="view-context"');
  const context = html.slice(contextStart, html.indexOf('<nav class="view-nav"', contextStart));

  assert.match(html, /<section class="view-context" aria-label="Custom report view">/);
  assert.match(context, /<p class="eyebrow">Custom view<\/p>/);
  assert.match(context, /<h2>Security blockers<\/h2>/);
  assert.match(context, /<code>security-blockers<\/code>/);
  assert.match(
    context,
    /Filtered subset of Example &lt;script&gt;\. Interactive filters below can narrow this view further\./,
  );
  assert.match(
    context,
    /<p class="criteria-label">Readiness<\/p><div class="chips"><span class="chip chip-fixed">Blocked<\/span><\/div>/,
  );
  assert.match(
    context,
    /<p class="criteria-label">Status<\/p><div class="chips"><span class="chip chip-fixed">backlog<\/span><span class="chip chip-fixed">in-progress<\/span><\/div>/,
  );
  assert.match(
    context,
    /<p class="criteria-label">Area<\/p><div class="chips"><span class="chip chip-fixed">Core &amp; CLI<\/span><\/div>/,
  );
  assert.match(
    context,
    /<p class="criteria-label">Security Tier<\/p><div class="chips"><span class="chip chip-fixed">2<\/span><span class="chip chip-fixed">true<\/span><\/div>/,
  );
  assert.doesNotMatch(context, /<input|<button|<label/);
  assert.doesNotMatch(renderReportHtml(model(), options()), /view-context|Custom view|chip-fixed/);
});

// Client filters narrow a named view; they cannot widen it. The artifact holds
// the retained cards and nothing else, so clearing every filter gives the
// reader the whole custom view back and still names no excluded item - not in
// a card, not in a chip, not in the graph payload.
test('restores only the named view subset when the reader clears the filters', async () => {
  const { renderReportHtml, reportClientSource } = await import('../src/report-html.js');
  const html = renderReportHtml(viewModel(), options());
  const facets = html.slice(html.indexOf('id="facets"'), html.indexOf('id="items"'));
  const dom = reportDom({
    items: [
      {
        id: 'item-2',
        order: 0,
        state: 'blocked',
        status: 'backlog',
        kind: 'task',
        priority: 2,
        created: '2026-08-01',
        title: 'Retained blocked task',
        fields: { area: 'core' },
        search: '#2 retained blocked task',
        body: '# Two',
      },
      {
        id: 'item-3',
        order: 1,
        state: 'ready',
        status: 'in-progress',
        kind: 'task',
        priority: 3,
        created: '2026-08-02',
        title: 'Retained ready task',
        fields: { area: 'core' },
        search: '#3 retained ready task',
        body: '# Three',
      },
    ],
  });
  runReportClient(reportClientSource(), dom);

  dom.select('readiness', 'ready');
  dom.select('status', 'in-progress');

  assert.deepEqual(dom.visible(), ['item-3']);

  dom.clearFacets.dispatch('click');

  assert.deepEqual(dom.visible(), ['item-2', 'item-3']);
  assert.equal(dom.resultCount(), 'Showing 2 of 2 items');
  assert.equal(dom.card(excludedId), null);
  assert.doesNotMatch(facets, new RegExp(excludedId));
  assert.doesNotMatch(html, new RegExp(excludedId));
});

test('says how much of a truncated attention list is not shown', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const surface = decisionSurface(renderReportHtml(model(), options()));

  assert.match(surface, /Showing 1 of 3\./);
});

// One filter vocabulary for the whole drill-down: every dimension of the open
// set is a named group of checkbox chips, so a reader can hold two readiness
// states at once instead of choosing one and losing the other. A group is a
// fieldset with a legend, and a chip is a real checkbox inside its own label,
// so the grouping and the multi-select are announced rather than implied.
// The workspace replaces duplicated Work next and Attention lists with one
// canonical list driven by five quick views. Work next keeps its rank and
// reasons; the other views filter the same scoped population honestly.
test('opens Items with the work-next quick view selected and its reasons', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const html = renderReportHtml(model(), options());

  assert.match(html, /<button[^>]*data-quick="work-next"[^>]*aria-pressed="true"[^>]*>Work next<\/button>/);
  assert.match(html, /<ol id="item-list"[^>]*>.*priority 1.*age 13d.*<\/ol>/s);
  assert.doesNotMatch(html, /<section id="work-next"/);
  assert.doesNotMatch(html, /<section id="attention"/);
});

test('exposes metadata gaps through coverage instead of guessing', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const html = renderReportHtml(model(), options());

  assert.match(html, /id="coverage"/);
  assert.match(html, /Tags.*not configured|not configured.*Tags/is);
});

test('navigates Items, Flow, and Dependencies without losing scope', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const html = renderReportHtml(model(), options());

  assert.match(html, /<button[^>]*id="nav-items"[^>]*aria-pressed="true"/);
  assert.match(html, /<section id="section-items"[^>]*>/);
  assert.match(html, /<section id="section-flow"[^>]*>.*id="evidence"/s);
  assert.match(html, /<section id="section-dependencies"[^>]*>.*id="graph"/s);
});

test('renders the drill-down filters as grouped accessible multi-select chips', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const html = renderReportHtml(model(), options());
  const facets = html.slice(html.indexOf('id="facets"'), html.indexOf('id="items"'));

  assert.doesNotMatch(html, /slot-filter|data-filter=/);
  assert.match(facets, /<fieldset class="facet-group" data-group="readiness"><legend>Readiness<\/legend>/);
  for (const [value, label] of [['ready', 'Ready'], ['blocked', 'Blocked'], ['ineligible', 'Ineligible']]) {
    assert.match(
      facets,
      new RegExp(`<label class="chip"><input type="checkbox" class="facet" data-group="readiness" data-kind="value" data-value="&quot;${value}&quot;" value="${value}"><span class="chip-text">${label}</span>`),
    );
  }
  assert.match(facets, /<fieldset class="facet-group" data-group="priority"><legend>Priority<\/legend>/);
  assert.match(facets, /<p id="result-count" class="result-count" role="status" aria-live="polite">Showing 2 of 2 items<\/p>/);
  assert.match(facets, /<fieldset class="facet-group" data-group="kind"><legend>Kind<\/legend>.*value="task".*value="epic"/);
  assert.match(facets, /<fieldset class="facet-group" data-group="priority"><legend>Priority<\/legend>/);
  assert.match(facets, /<button type="button" id="clear-facets">Clear filters<\/button>/);
});

// A chip's name is read out as one string. With the count welded to the label
// it is announced as "bug0", so the two carry a separator that flexbox drops
// from the layout and the accessible name keeps.
test('separates a chip label from its count in the announced name', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const mapped = model();
  mapped.items[0].fields = { class: 'bug' };
  const html = renderReportHtml(mapped, options());

  assert.match(html, /<span class="chip-text">Ready<\/span> <span class="chip-count">0<\/span>/);
  assert.match(html, /<span class="chip-text">bug<\/span> <span class="chip-count">1<\/span>/);
  assert.doesNotMatch(html, /<\/span><span class="chip-count">/);
});

// Four cards spanning three readiness states, three statuses, both kinds, and
// two mapped areas: enough for one group to widen and another to narrow.
function facetDom() {
  return reportDom({
    items: [
      {
        id: 'item-1',
        order: 0,
        state: 'ready',
        status: 'backlog',
        kind: 'task',
        priority: 1,
        created: '2026-08-01',
        title: 'Ready core task',
        fields: { area: 'core' },
        search: '#1 ready core task',
        body: '# One',
      },
      {
        id: 'item-2',
        order: 1,
        state: 'blocked',
        status: 'backlog',
        kind: 'task',
        priority: 2,
        created: '2026-08-02',
        title: 'Blocked docs task',
        fields: { area: 'docs' },
        search: '#2 blocked docs task',
        body: '# Two',
      },
      {
        id: 'item-3',
        order: 2,
        state: 'ready',
        status: 'in-progress',
        kind: 'task',
        priority: 3,
        created: '2026-08-03',
        title: 'Ready core in flight',
        fields: { area: 'core' },
        search: '#3 ready core in flight',
        body: '# Three',
      },
      {
        id: 'item-4',
        order: 3,
        state: 'ineligible',
        status: 'triage',
        kind: 'epic',
        priority: null,
        created: '2026-08-04',
        title: 'Triage epic',
        fields: {},
        search: '#4 triage epic',
        body: '# Four',
      },
    ],
  });
}

// Two values in one group are alternatives and two groups are conditions: a
// reader asking for ready-or-blocked backlog work is asking one question, and
// the search box is one more condition on the same answer.
test('widens within a facet group and narrows across facet groups and the search', async () => {
  const { reportClientSource } = await import('../src/report-html.js');
  const dom = facetDom();
  runReportClient(reportClientSource(), dom);

  assert.deepEqual(dom.visible(), ['item-1', 'item-2', 'item-3', 'item-4']);

  dom.select('readiness', 'ready');
  assert.deepEqual(dom.visible(), ['item-1', 'item-3']);

  dom.select('readiness', 'blocked');
  assert.deepEqual(dom.visible(), ['item-1', 'item-2', 'item-3']);

  dom.select('status', 'backlog');
  assert.deepEqual(dom.visible(), ['item-1', 'item-2']);

  dom.search().value = 'docs';
  dom.search().dispatch('input');
  assert.deepEqual(dom.visible(), ['item-2']);
});

test('treats kind as one more facet group over the same cards', async () => {
  const { reportClientSource } = await import('../src/report-html.js');
  const dom = facetDom();
  runReportClient(reportClientSource(), dom);

  dom.select('kind', 'epic');

  assert.deepEqual(dom.visible(), ['item-4']);

  dom.select('kind', 'task');

  assert.deepEqual(dom.visible(), ['item-1', 'item-2', 'item-3', 'item-4']);
});

// A chip's count answers one question: how many items would be left if this
// value were the one selected in its group. Counting a chip against its own
// group makes every unselected sibling read zero the moment anything in the
// group is selected, which is a lie the reader cannot see through.
test('counts every chip against the search and the other groups, never its own', async () => {
  const { reportClientSource } = await import('../src/report-html.js');
  const dom = facetDom();
  runReportClient(reportClientSource(), dom);

  assert.equal(dom.chipCount('readiness', 'ready'), '2');
  assert.equal(dom.chipCount('status', 'backlog'), '2');
  assert.equal(dom.resultCount(), 'Showing 4 of 4 items');

  dom.select('status', 'backlog');

  assert.equal(dom.chipCount('readiness', 'ready'), '1');
  assert.equal(dom.chipCount('readiness', 'blocked'), '1');
  assert.equal(dom.chipCount('readiness', 'ineligible'), '0');
  assert.equal(dom.chipCount('status', 'in-progress'), '1');
  assert.equal(dom.resultCount(), 'Showing 2 of 4 items');

  dom.select('readiness', 'ready');

  assert.equal(dom.chipCount('readiness', 'blocked'), '1');
  assert.equal(dom.chipCount('status', 'backlog'), '1');
  assert.equal(dom.resultCount(), 'Showing 1 of 4 items');

  dom.select('readiness', 'blocked');

  assert.equal(dom.chipCount('status', 'backlog'), '2');
  assert.equal(dom.chipCount('readiness', 'ready'), '1');
  assert.equal(dom.resultCount(), 'Showing 2 of 4 items');

  dom.search().value = 'docs';
  dom.search().dispatch('input');

  assert.equal(dom.chipCount('readiness', 'ready'), '0');
  assert.equal(dom.chipCount('readiness', 'blocked'), '1');
  assert.equal(dom.resultCount(), 'Showing 1 of 4 items');
});

test('marks a selected chip and gives every selection back at once', async () => {
  const { reportClientSource } = await import('../src/report-html.js');
  const dom = facetDom();
  runReportClient(reportClientSource(), dom);

  dom.select('readiness', 'ready');
  dom.select('status', 'in-progress');

  assert.equal(dom.chipState('readiness', 'ready').classList.contains('selected'), true);
  assert.equal(dom.chipState('readiness', 'blocked').classList.contains('selected'), false);
  assert.deepEqual(dom.visible(), ['item-3']);

  dom.clearFacets.dispatch('click');

  assert.equal(dom.chip('readiness', 'ready').checked, false);
  assert.equal(dom.chip('status', 'in-progress').checked, false);
  assert.equal(dom.chipState('readiness', 'ready').classList.contains('selected'), false);
  assert.deepEqual(dom.visible(), ['item-1', 'item-2', 'item-3', 'item-4']);
  assert.equal(dom.resultCount(), 'Showing 4 of 4 items');
});

// Every configured mapped field is a dimension of the same open set, so its
// values are chips beside the built-in groups rather than a separate control.
// The values are the ledger's own: nothing is inferred from a title.
test('gives every configured mapped field its own facet group of its own values', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const mapped = model();
  mapped.items[0].fields = { area: 'Core & CLI', class: 'bug' };
  const html = renderReportHtml(mapped, options());
  const facets = html.slice(html.indexOf('id="facets"'), html.indexOf('id="items"'));

  assert.match(facets, /<fieldset class="facet-group" data-group="field:area"><legend>Area<\/legend>/);
  assert.match(
    facets,
    /<fieldset class="facet-group" data-group="field:class"><legend>Class<\/legend><div class="chips"><label class="chip"><input type="checkbox" class="facet" data-group="field:class" data-kind="value" data-value="&quot;bug&quot;" value="bug"><span class="chip-text">bug<\/span> <span class="chip-count">1<\/span><\/label>/,
  );
  assert.doesNotMatch(facets, /data-group="field:complexity"/);
});

// A card that does not carry the mapped field has no value in that dimension.
// Selecting a value there must leave it out rather than wave it through, or a
// facet would widen the answer instead of narrowing it.
test('filters by mapped field values and leaves out cards that carry none', async () => {
  const { reportClientSource } = await import('../src/report-html.js');
  const dom = facetDom();
  runReportClient(reportClientSource(), dom);

  assert.equal(dom.chipCount('field:area', 'core'), '2');
  assert.equal(dom.chipCount('field:area', 'docs'), '1');

  dom.select('field:area', 'core');

  assert.deepEqual(dom.visible(), ['item-1', 'item-3']);

  dom.select('field:area', 'docs');

  assert.deepEqual(dom.visible(), ['item-1', 'item-2', 'item-3']);
  assert.equal(dom.resultCount(), 'Showing 3 of 4 items');

  dom.select('readiness', 'ready');

  assert.deepEqual(dom.visible(), ['item-1', 'item-3']);
  assert.equal(dom.chipCount('field:area', 'docs'), '0');
});

// Inspecting an item must not clear the reader's scope: opening a detail
// outside the current search leaves the search text and the visible list
// exactly where they were, while still opening the targeted detail.
test('opens an out-of-filter detail without resetting the search or visible list', async () => {
  const { reportClientSource } = await import('../src/report-html.js');
  const dom = revealDom();
  runReportClient(reportClientSource(), dom);
  dom.search().value = 'ready';
  dom.search().dispatch('input');
  const visibleBefore = dom.visible();
  assert.deepEqual(visibleBefore, ['item-7']);
  const event = dom.link('item-12').dispatch('click');
  assert.equal(event.defaultPrevented, true);
  assert.equal(dom.search().value, 'ready');
  assert.deepEqual(dom.visible(), visibleBefore);
  const target = dom.card('item-12');
  assert.equal(target.open, true);
  assert.equal(target.querySelector('.rendered-markdown').dataset.rendered, '1');
  assert.equal(target.isConnected, true);
});

// A row above the drill-down is a promise that the item can be seen, without
// resetting what the reader already chose. The runtime opens the detached
// canonical card in the detail pane and leaves the search, facets, and visible
// list exactly where they were.
test('opens a detached card without clearing the search or facets', async () => {
  const { reportClientSource } = await import('../src/report-html.js');
  const dom = revealDom();
  runReportClient(reportClientSource(), dom);
  const target = dom.card('item-12');
  dom.search().value = 'ready';
  dom.search().dispatch('input');
  dom.select('readiness', 'ready');
  dom.select('field:area', 'core');

  assert.equal(target.isConnected, false);
  assert.deepEqual(dom.visible(), ['item-7']);

  const event = dom.link('item-12').dispatch('click');

  assert.equal(event.defaultPrevented, true);
  assert.equal(dom.search().value, 'ready');
  assert.equal(dom.chip('readiness', 'ready').checked, true);
  assert.equal(dom.chip('field:area', 'core').checked, true);
  assert.equal(dom.chipState('readiness', 'ready').classList.contains('selected'), true);
  assert.deepEqual(dom.visible(), ['item-7']);
  assert.equal(dom.resultCount(), 'Showing 1 of 2 items');
  assert.equal(target.isConnected, true);
  assert.equal(target.open, true);
  assert.equal(target.querySelector('.rendered-markdown').dataset.rendered, '1');
  assert.equal(target.querySelector('.rendered-markdown').innerHTML, '<p># Blocked body</p>');
  assert.equal(dom.document.activeElement, target.querySelector('summary'));
  assert.deepEqual(target.scrolls, [{ behavior: 'smooth', block: 'start' }]);
});
// The browser controller is the integration seam T5B/T7 build on: scope
// observation plus detail and drilldown actions, installed before the graph
// runtime runs. These cases execute the shipped runtime, not its text.
test('installs the report controller with the scoped inspection contract', async () => {
  const { reportClientSource } = await import('../src/report-html.js');
  const dom = revealDom();
  runReportClient(reportClientSource(), dom);

  const controller = dom.window.wowbaggerReport;
  assert.equal(typeof controller?.getScopeItems, 'function');
  assert.equal(typeof controller?.subscribeScope, 'function');
  assert.equal(typeof controller?.inspectItem, 'function');
  assert.equal(typeof controller?.showItems, 'function');
  assert.deepEqual(controller.getScopeItems().map((entry) => entry.id).sort(), ['item-12', 'item-7']);
});

test('notifies scope subscribers immediately and on later scope changes', async () => {
  const { reportClientSource } = await import('../src/report-html.js');
  const dom = revealDom();
  runReportClient(reportClientSource(), dom);
  const seen = [];
  const unsubscribe = dom.window.wowbaggerReport.subscribeScope((items) => {
    seen.push(items.map((entry) => entry.id).sort().join(','));
  });
  dom.search().value = 'ready';
  dom.search().dispatch('input');
  unsubscribe();
  dom.search().value = '';
  dom.search().dispatch('input');

  assert.deepEqual(seen, ['item-12,item-7', 'item-7']);
});

test('inspects an item through the controller without changing scope', async () => {
  const { reportClientSource } = await import('../src/report-html.js');
  const dom = revealDom();
  runReportClient(reportClientSource(), dom);
  dom.search().value = 'ready';
  dom.search().dispatch('input');
  const visibleBefore = dom.visible();

  assert.equal(dom.window.wowbaggerReport.inspectItem('item-12'), true);
  assert.equal(dom.search().value, 'ready');
  assert.deepEqual(dom.visible(), visibleBefore);
  assert.equal(dom.card('item-12').open, true);
  assert.equal(dom.window.wowbaggerReport.inspectItem('missing-id'), false);
});

test('shows a labelled drilldown through the controller and clears it', async () => {
  const { reportClientSource } = await import('../src/report-html.js');
  const dom = revealDom();
  runReportClient(reportClientSource(), dom);

  dom.window.wowbaggerReport.showItems({ label: 'Test bucket', itemIds: ['item-12'] });
  assert.deepEqual(dom.visible(), ['item-12']);
  assert.match(dom.document.getElementById('drilldown-label').textContent, /Test bucket/);

  dom.document.getElementById('clear-drilldown').dispatch('click');
  assert.deepEqual(dom.visible().sort(), ['item-12', 'item-7']);
});


test('jumps to a revealed card without animation when motion is not wanted', async () => {
  const { reportClientSource } = await import('../src/report-html.js');
  const dom = revealDom();
  dom.prefersReducedMotion();
  runReportClient(reportClientSource(), dom);
  const target = dom.card('item-7');

  dom.link('item-7').dispatch('click');

  assert.deepEqual(target.scrolls, [{ behavior: 'auto', block: 'start' }]);
});

// Scrolling a card to the top of the viewport parks it under the sticky
// control strip, which is opaque. The reveal has to clear the strip's own
// height, and only while the strip is actually sticky.
test('keeps a revealed card clear of the sticky control strip', async () => {
  const { reportClientSource } = await import('../src/report-html.js');
  const dom = revealDom();
  runReportClient(reportClientSource(), dom);
  const target = dom.card('item-7');

  dom.link('item-7').dispatch('click');

  assert.equal(target.style.scrollMarginTop, '141px');
});

test('adds no scroll offset where the control strip does not stick', async () => {
  const { reportClientSource } = await import('../src/report-html.js');
  const dom = revealDom();
  dom.unstickControls();
  runReportClient(reportClientSource(), dom);
  const target = dom.card('item-7');

  dom.link('item-7').dispatch('click');

  assert.equal(target.style.scrollMarginTop, '0px');
});

// Focusing an element scrolls it, which cancels the smooth scroll already
// running and abandons the card wherever the animation had reached. The focus
// has to leave the scroll alone.
test('focuses a revealed card without cancelling the scroll to it', async () => {
  const { reportClientSource } = await import('../src/report-html.js');
  const dom = revealDom();
  runReportClient(reportClientSource(), dom);
  const target = dom.card('item-7');

  dom.link('item-7').dispatch('click');

  assert.deepEqual(target.querySelector('summary').focusOptions, { preventScroll: true });
});

// A row whose padding belongs to the list item has a dead border around its
// link, so a click near the edge or on the rank badge does nothing. The row's
// own spacing belongs to the link.
test('gives the whole row, padding and rank badge included, to its link', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const html = renderReportHtml(model(), options());

  assert.equal(/\.ranked li\{([^}]*)\}/.exec(html)[1], 'counter-increment:rank;border:1px solid var(--line);border-radius:9px;background:#fff');
  assert.match(html, /\.ranked \.row-link\{position:relative;padding:12px 14px 12px 52px\}/);
  assert.match(html, /\.ranked \.row-link::before\{content:counter\(rank\);position:absolute/);
  assert.equal(/\.plain li\{([^}]*)\}/.exec(html)[1], 'border-bottom:1px solid var(--line)');
  assert.match(html, /\.plain \.row-link\{padding-bottom:8px\}/);
  assert.match(html, /\.plain li:last-child \.row-link\{padding-bottom:0\}/);
});

// A ledger that has not numbered an item names it by its 26-character ULID,
// and a ULID carries no break opportunity. A ranked row is a grid item, so
// that one token sets the track's minimum width and takes the whole document
// sideways with it: at a 390px viewport the list measured 396px and the report
// scrolled horizontally. The handle has to break where the title beside it
// already breaks.
test('breaks a numberless handle instead of widening the ranked row', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const unnumbered = model();
  unnumbered.workNext[0].number = null;
  const html = renderReportHtml(unnumbered, options());

  assert.match(decisionSurface(html), /<span class="handle">wb_hostile<\/span>/);
  assert.ok(
    /\.handle\{([^}]*)\}/.exec(html)[1].split(';').includes('overflow-wrap:anywhere'),
    'a handle with no break opportunity must be breakable',
  );
});

// The href is the whole behaviour when scripting is off, and a bare hash jump
// parks the card under the sticky control strip. The stylesheet has to clear
// the strip on its own, wherever the strip is sticky.
test('keeps a hash-targeted card clear of the control strip without scripting', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const html = renderReportHtml(model(), options());

  assert.match(html, /@media\(min-width:851px\)\{\.card\{scroll-margin-top:140px\}\}/);
});

// A card holds a whole item: a wrapped title, badges, readiness, relations, a
// decision, and a body. Tiling those side by side at desktop widths costs the
// line length the content needs, so an item group is one column at any width.
test('lays ledger items out as full-width rows at every width', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const html = renderReportHtml(model(), options());

  assert.equal(/\.card-grid\{([^}]*)\}/.exec(html)[1], 'display:grid;grid-template-columns:1fr;gap:12px');
  assert.doesNotMatch(html, /\.card\[open\]\{[^}]*grid-column/);
});

// An empty artifact and a narrowed one are different facts. A named view whose
// criteria match nothing was never narrowed by the reader, so the two empty
// states have to say which one happened: the artifact's own emptiness in the
// named case, the reader's filters and status selection in the base case.
function emptyViewModel() {
  const base = viewModel();
  return {
    ...base,
    stats: { total: 0, open: 0, terminal: 0, ready: 0, blocked: 0, ineligible: 0 },
    items: [],
    terminalItems: [],
    workNext: [],
    attention: {
      blocked: [], aging: [], stuck: [], blockedTotal: 0, agingTotal: 0, stuckTotal: 0,
    },
  };
}

test('states that a named view matched nothing rather than blaming the reader', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const html = renderReportHtml(emptyViewModel(), options());

  assert.match(
    html,
    /<p id="empty" class="empty">No ledger item matches this view's criteria\.<\/p>/,
  );
  assert.match(
    html,
    /<p id="graph-empty">No ledger item matches this view's criteria, so the graph has nothing to draw\.<\/p>/,
  );
  assert.doesNotMatch(html, /No items match these filters\./);
  assert.doesNotMatch(html, /No status is selected/);
});

test('keeps the filter and status copy for a base report the reader can narrow', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const html = renderReportHtml(model(), options());

  assert.match(html, /<p id="empty" class="empty" hidden>No items match these filters\.<\/p>/);
  assert.match(
    html,
    /<p id="graph-empty" hidden>No status is selected, so the graph is empty\. Select a status above to draw that part of the ledger\.<\/p>/,
  );
  assert.doesNotMatch(html, /matches this view's criteria/);
});

test('hides Flow and Dependencies on initial Items view with one canonical items container', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const html = renderReportHtml(model(), options());

  assert.match(html, /<section id="section-flow" data-section="flow" hidden>/);
  assert.match(html, /<section id="section-dependencies" data-section="dependencies" hidden>/);
  assert.equal((html.match(/id="items"/g) ?? []).length, 1);
});

test('offers facet groups through a collapsed expandable control', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const html = renderReportHtml(model(), options());
  const facets = html.slice(html.indexOf('id="facets"'), html.indexOf('id="items"'));

  assert.match(facets, /<details class="facet-expand" id="facets-expand"><summary>Filters<\/summary>/);
  assert.match(facets, /<fieldset class="facet-group" data-group="readiness">/);
});

test('uses a desktop split at 1100px with inline mobile details and scoped print', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const html = renderReportHtml(model(), options());

  assert.match(html, /@media\(min-width:1100px\)/);
  assert.match(html, /#workspace-split/);
  assert.match(html, /@media print/);
  assert.match(html, /<noscript>.*href="#section-items"/s);
  assert.doesNotMatch(html, /\.controls\{position:static/);
});

test('collapses only visible details and leaves hidden bodies alone', async () => {
  const { reportClientSource } = await import('../src/report-html.js');
  const dom = facetDom();
  runReportClient(reportClientSource(), dom);
  const hidden = dom.card('item-2');
  hidden.open = true;
  dom.select('readiness', 'ready');
  assert.deepEqual(dom.visible(), ['item-1', 'item-3']);
  dom.document.getElementById('expand-all').dispatch('click');
  assert.equal(dom.card('item-1').open, true);
  assert.equal(hidden.open, true);
  dom.document.getElementById('collapse-all').dispatch('click');
  assert.equal(dom.card('item-1').open, false);
  assert.equal(hidden.open, true);
});

test('embeds the immutable impact map in report data', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const shaped = model();
  shaped.impactById = {
    wb_hostile: { downstreamIds: ['wb_done'], readyIfDoneIds: [] },
  };
  const html = renderReportHtml(shaped, options());
  const json = html.slice(html.indexOf('<script id="report-data"'), html.indexOf('</script>', html.indexOf('<script id="report-data"')));

  assert.match(json, /"impactById"/);
  assert.match(json, /wb_hostile/);
});

test('exposes an immutable impact map on the report controller', async () => {
  const { reportClientSource } = await import('../src/report-html.js');
  const dom = revealDom();
  const data = JSON.parse(dom.document.getElementById('report-data').textContent);
  data.impactById = {
    'item-7': { downstreamIds: ['item-12'], readyIfDoneIds: [] },
    'item-12': { downstreamIds: [], readyIfDoneIds: [] },
  };
  dom.document.getElementById('report-data').textContent = JSON.stringify(data);
  runReportClient(reportClientSource(), dom);

  assert.deepEqual(dom.window.wowbaggerReport.impactById, data.impactById);
  assert.equal(Object.isFrozen(dom.window.wowbaggerReport.impactById), true);
});

test('distinguishes downstream reach from ready-if-done with exact drilldowns', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const shaped = model();
  shaped.impactById = {
    wb_hostile: { downstreamIds: ['wb_done'], readyIfDoneIds: [] },
    wb_done: { downstreamIds: [], readyIfDoneIds: [] },
  };
  const html = renderReportHtml(shaped, options());
  const detail = html.slice(html.indexOf('id="items"'));

  assert.match(detail, /Downstream reach/);
  assert.match(detail, /Ready if done/);
  assert.match(detail, /data-show-items="wb_done"/);
});

test('renders a scoped area/status matrix with exact contributor drilldowns', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const shaped = model();
  shaped.impactById = {};
  const html = renderReportHtml(shaped, options());
  const items = html.slice(html.indexOf('id="section-items"'), html.indexOf('id="section-flow"'));

  assert.match(items, /id="area-matrix"/);
  assert.match(items, /Core &amp; CLI/);
  assert.match(items, /1 \(blocked 1\)/);
  assert.match(items, /data-matrix-status="backlog"/);
  assert.match(items, /data-matrix-area="Core &amp; CLI"/);
});

test('offers scoped attention actions that open exact item sets', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const shaped = model();
  shaped.impactById = {};
  const html = renderReportHtml(shaped, options());
  const items = html.slice(html.indexOf('id="section-items"'), html.indexOf('id="section-flow"'));

  assert.match(items, /id="attention-summary"/);
  assert.match(items, /data-show-numbers="12"/);
  assert.match(items, /data-show-numbers="3"/);
  assert.match(items, /data-show-numbers="10"/);
});

test('shows scoped members of existing batches with exact drilldowns', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const shaped = model();
  shaped.swarm = { eligibleComplexities: ['small'] };
  shaped.swarmBatches = [[{ id: 'wb_hostile', number: 7, title: 'Unsafe item' }]];
  shaped.impactById = {};
  const html = renderReportHtml(shaped, options());
  const items = html.slice(html.indexOf('id="section-items"'), html.indexOf('id="section-flow"'));

  assert.match(items, /id="batches"/);
  assert.match(items, /Scoped members of existing batches/);
  assert.match(items, /data-show-items="wb_hostile"/);
});
