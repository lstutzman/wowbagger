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
  assert.match(first, /<table[^>]*>.*Completed item.*<\/table>/s);
  assert.match(first, /id="sort-by"/);
  assert.match(first, /class="slot-filter" data-field="area"/);
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
  assert.match(html, /<section id="history" class="panel">/);
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
  const surface = decisionSurface(html);

  assert.ok(surface.indexOf('id="work-next"') < surface.indexOf('id="attention"'));
  assert.ok(surface.indexOf('id="attention"') < surface.indexOf('id="evidence"'));
  assert.match(surface, /id="work-next"/);
  assert.match(surface, /<span class="handle">#7<\/span>/);
  assert.match(surface, /priority 1/);
  assert.match(surface, /age 13d/);
});

// A decision surface that names an item has to be able to show it. The row is
// the whole link so the pointer target matches the reading target, and the
// href alone reaches the card when scripting is off.
test('links a work-next row as a whole row to the canonical drill-down card', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const html = renderReportHtml(model(), options());
  const surface = decisionSurface(html);
  const detail = html.slice(html.indexOf('id="drilldown"'));
  const row = surface.slice(surface.indexOf('<ol class="ranked">'), surface.indexOf('</ol>'));

  assert.match(detail, /<details class="card" id="item-7"/);
  assert.match(row, /<li><a class="row-link" href="#item-7" data-reveal="item-7"/);
  assert.match(row, /aria-labelledby="row-work-next-item-7-name" aria-describedby="row-work-next-item-7-detail"/);
  assert.ok(row.indexOf('age 13d') < row.indexOf('</a>'));
});

test('renders the attention layer with blocker numbers and ages', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const surface = decisionSurface(renderReportHtml(model(), options()));

  assert.match(surface, /#12/);
  assert.match(surface, /blocked by #5/);
  assert.match(surface, /225d/);
  assert.match(surface, /44d/);
  assert.match(surface, /p85 20d/);
});

// Attention is three lists of items to act on, so every row in all three is a
// way into the item, not only the blocked ones.
test('links every attention row to the canonical drill-down card', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const surface = decisionSurface(renderReportHtml(model(), options()));
  const attention = surface.slice(surface.indexOf('id="attention"'), surface.indexOf('id="evidence"'));
  const lists = attention.split('<h3>').slice(1).map((section) => section.slice(0, section.indexOf('</section>')));

  assert.equal(lists.length, 3);
  assert.match(lists[0], /<li><a class="row-link" href="#item-12" data-reveal="item-12"[^>]*>.*age 10d.*<\/a><\/li>/s);
  assert.match(lists[1], /<li><a class="row-link" href="#item-3" data-reveal="item-3"[^>]*>.*age 225d.*<\/a><\/li>/s);
  assert.match(lists[2], /<li><a class="row-link" href="#item-10" data-reveal="item-10"[^>]*>.*p85 20d.*<\/a><\/li>/s);
});

// aria-label replaces every node nested inside the anchor, so a free-text label
// on a whole-row link costs the reader exactly what the row is for: the ranking
// reasons on Work next, and the blocked-by, age, and p85 facts on Attention. The
// row's own printed nodes have to be the name and the description.
test('names every row link by its handle and title and describes it with the row facts', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const html = renderReportHtml(model(), options());
  const surface = decisionSurface(html);
  const rows = [...surface.matchAll(/<a class="row-link"[^>]*>.*?<\/a>/gs)].map((match) => match[0]);
  const expected = new Map([
    ['item-7', { name: ['#7', 'Unsafe'], detail: ['priority 1', 'age 13d'] }],
    ['item-12', { name: ['#12', 'Blocked item'], detail: ['blocked by #5', 'age 10d'] }],
    ['item-3', { name: ['#3', 'Old item'], detail: ['age 225d', 'backlog', 'ready'] }],
    ['item-10', { name: ['#10', 'Stuck item'], detail: ['44d since accept', 'p85 20d'] }],
  ]);

  assert.equal(rows.length, expected.size);
  assert.doesNotMatch(surface, /class="row-link"[^>]*aria-label=/);

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
  const surface = decisionSurface(renderReportHtml(model(), options()));

  assert.match(surface, /0\.33/);
  assert.match(surface, /over 90d/);
  assert.match(surface, /2026-10-09/);
  assert.match(surface, /2026-10-30/);
  assert.match(surface, /50%/);
  assert.match(surface, /85%/);
});

test('draws the weekly flow as an inline SVG chart carrying its own numbers', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const surface = decisionSurface(renderReportHtml(model(), options()));

  assert.match(surface, /<svg[^>]*data-testid="chart-weekly-flow"/);
  assert.match(surface, /<title>Week of 2026-08-10: 0 arrivals, 3 completions<\/title>/);
});

test('draws all six evidence charts, each under its own stable test id', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const surface = decisionSurface(renderReportHtml(model(), options()));

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
  const surface = decisionSurface(renderReportHtml(model(), options()));

  assert.match(surface, /<title>backlog, 7-30d: 1 open item<\/title>/);
  assert.match(surface, /<title>in-progress, 30-90d: 0 open items<\/title>/);
  assert.match(surface, /<text class="chart-total" [^>]*>2<\/text>/);
});

test('draws the cycle-time scatter and the cumulative flow from the same model', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const surface = decisionSurface(renderReportHtml(model(), options()));

  assert.match(surface, /<title>#9 completed 2026-08-12 after 20 days<\/title>/);
  assert.match(surface, /<title>Terminal: 1 item on 2026-08-14<\/title>/);
  assert.match(surface, /<title>Week of 2026-08-10: 3 completions, 1 a week over the last 4<\/title>/);
});

test('draws the forecast fan and states all three percentile dates', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const surface = decisionSurface(renderReportHtml(model(), options()));

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
  const surface = decisionSurface(renderReportHtml(empty, options()));

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
  const surface = decisionSurface(renderReportHtml(settled, options()));

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
  const detail = html.slice(html.indexOf('id="drilldown"'));

  assert.match(detail, /<dt>Parent<\/dt><dd>#8<\/dd>/);
  assert.match(detail, /<dt>Depends on<\/dt><dd>#8<\/dd>/);
  assert.match(detail, /<dt>Related<\/dt><dd>wb_missing<\/dd>/);
  assert.match(detail, /<li>Dependency is not done: #8<\/li>/);
});

test('says how much of a truncated attention list is not shown', async () => {
  const { renderReportHtml } = await import('../src/report-html.js');
  const surface = decisionSurface(renderReportHtml(model(), options()));

  assert.match(surface, /Showing 1 of 3\./);
});

// A row above the drill-down is a promise that the item can be seen. The
// drill-down's own filters can have detached that card, so the runtime clears
// what hides it, re-applies the list, and then opens what it promised.
test('clears the filters that detach a targeted card and opens it', async () => {
  const { reportClientSource } = await import('../src/report-html.js');
  const dom = revealDom();
  runReportClient(reportClientSource(), dom);
  const target = dom.card('item-12');
  dom.search().value = 'ready';
  dom.slotFilter.value = 'core';
  dom.filter('ready').dispatch('click');

  assert.equal(target.isConnected, false);

  const event = dom.link('item-12').dispatch('click');

  assert.equal(event.defaultPrevented, true);
  assert.equal(dom.search().value, '');
  assert.equal(dom.slotFilter.value, '');
  assert.equal(dom.filter('all').classList.contains('active'), true);
  assert.equal(dom.filter('ready').classList.contains('active'), false);
  assert.equal(target.isConnected, true);
  assert.equal(target.open, true);
  assert.equal(target.querySelector('.rendered-markdown').dataset.rendered, '1');
  assert.equal(target.querySelector('.rendered-markdown').innerHTML, '<p># Blocked body</p>');
  assert.equal(dom.document.activeElement, target.querySelector('summary'));
  assert.deepEqual(target.scrolls, [{ behavior: 'smooth', block: 'start' }]);
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
