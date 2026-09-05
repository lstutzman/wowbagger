import test from 'node:test';
import assert from 'node:assert/strict';
import { graphDom, runReportClient } from './report-dom.js';

const readyId = 'wb_01KZAAAAAAAAAAAAAAAAAAAAAA';
const blockedId = 'wb_01KZBBBBBBBBBBBBBBBBBBBBBB';
const childId = 'wb_01KZCCCCCCCCCCCCCCCCCCCCCC';
const doneId = 'wb_01KZDDDDDDDDDDDDDDDDDDDDDD';
const epicId = 'wb_01KZEEEEEEEEEEEEEEEEEEEEEE';

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

function fixtureItems() {
  return [
    item(readyId, { number: 1, title: 'Ready item', priority: 2 }, '# Ready body'),
    item(blockedId, { number: 2, title: 'Blocked item', depends_on: [readyId] }),
    item(childId, { number: 3, title: 'Child item', parent: epicId }),
    item(doneId, { number: 4, title: 'Done item', status: 'done', completed: '2026-08-10' }),
    item(epicId, { number: 5, title: 'Epic item', kind: 'epic' }),
  ];
}

const fixtureConfig = {
  reportVersion: 1,
  repository: { name: 'Example', logo: null },
  title: 'Example report',
  outputPath: '/tmp/report.html',
  fields: {},
  swarm: null,
};

async function fixtureGraph(items = fixtureItems()) {
  const { buildReportModel } = await import('../src/report.js');
  const { buildGraphModel } = await import('../src/report-graph.js');
  const report = buildReportModel(items, fixtureConfig, '2026-08-14');
  return { report, graph: buildGraphModel(report) };
}

function nodeFor(graph, id) {
  return graph.nodes.find((node) => node.id === id);
}

test('loads the vendored bundle with the manifest that pins it', async () => {
  const { loadGraphBundle } = await import('../src/report-graph.js');

  const bundle = await loadGraphBundle();

  assert.equal(bundle.manifest.package, '3d-force-graph');
  assert.equal(bundle.manifest.version, '1.80.0');
  assert.match(bundle.source, /ForceGraph3D/);
});

test('refuses a vendored bundle whose bytes no longer match the pinned digest', async () => {
  const { loadGraphBundle } = await import('../src/report-graph.js');
  const readFile = async (target, encoding) => (String(target).endsWith('VERSIONS.json')
    ? JSON.stringify({ package: 'x', version: '1', file: 'bundle.js', sha256: 'a'.repeat(64) })
    : 'tampered');

  await assert.rejects(loadGraphBundle({ readFile }), (error) => {
    assert.equal(error.code, 'report-read-failed');
    assert.equal(error.details.operation, 'read-graph-bundle');
    assert.equal(error.details.expected_sha256, 'a'.repeat(64));
    return true;
  });
});

test('every ledger item becomes a node banded by readiness or terminal status', async () => {
  const { graph } = await fixtureGraph();

  assert.equal(graph.nodes.length, 5);
  assert.deepEqual(
    graph.nodes.map((node) => [node.handle, node.band]).sort(),
    [['#1', 'ready'], ['#2', 'blocked'], ['#3', 'ready'], ['#4', 'done'], ['#5', 'ineligible']].sort(),
  );
  assert.equal(nodeFor(graph, readyId).title, 'Ready item');
  assert.equal(nodeFor(graph, readyId).status, 'backlog');
  assert.equal(nodeFor(graph, readyId).ageDays, 13);
});

test('node size scales with the sequencing layer unblocking leverage', async () => {
  const { report, graph } = await fixtureGraph();

  assert.equal(report.items.find((entry) => entry.id === readyId).sequencing.leverage.count, 1);
  assert.equal(nodeFor(graph, readyId).leverage, 1);
  assert.equal(nodeFor(graph, readyId).size, 2);
  assert.equal(nodeFor(graph, blockedId).leverage, 0);
  assert.equal(nodeFor(graph, blockedId).size, 1);
  assert.equal(nodeFor(graph, doneId).size, 1);
});

test('a ready node carries the same reasons line the work-next entry prints', async () => {
  const { report, graph } = await fixtureGraph();
  const entry = report.workNext.find((candidate) => candidate.id === readyId);

  assert.ok(entry, 'the fixture ready item must reach work-next');
  assert.deepEqual(nodeFor(graph, readyId).reasons, entry.reasons);
  assert.ok(entry.reasons.some((reason) => reason.code === 'leverage'));
});

test('a node that is not ready explains what holds it there', async () => {
  const { graph } = await fixtureGraph();

  assert.deepEqual(nodeFor(graph, blockedId).reasons, [
    { code: 'dependency-unsatisfied', label: 'Dependency is not done: #1' },
    { code: 'age', label: 'age 13d' },
  ]);
  assert.deepEqual(nodeFor(graph, epicId).reasons, [
    { code: 'kind-not-task', label: 'Not a task' },
    { code: 'age', label: 'age 13d' },
  ]);
  assert.deepEqual(nodeFor(graph, doneId).reasons, [
    { code: 'terminal', label: 'done 2026-08-10' },
  ]);
});

test('links carry depends_on and parent as separate, distinguishable kinds', async () => {
  const { graph } = await fixtureGraph();

  assert.deepEqual(graph.links, [
    { source: readyId, target: blockedId, kind: 'depends-on' },
    { source: epicId, target: childId, kind: 'parent' },
  ]);
});

test('drops a relation whose other end is not in the ledger', async () => {
  const missingId = 'wb_01KZZZZZZZZZZZZZZZZZZZZZZZ';
  const items = fixtureItems();
  items[1].data.depends_on = [readyId, missingId];
  items[2].data.parent = missingId;
  const { graph } = await fixtureGraph(items);

  assert.deepEqual(graph.links, [{ source: readyId, target: blockedId, kind: 'depends-on' }]);
});

// A view cuts nodes out of the graph, and every edge that touched them goes
// with them. What it never cuts is the reason a retained node is blocked: the
// excluded prerequisite is still named, by the number the complete ledger gave
// it, without becoming a node of its own.
test('view graph drops excluded nodes and every incident link', async () => {
  const viewConfig = {
    ...fixtureConfig,
    reportVersion: 2,
    view: {
      name: 'unfinished',
      title: 'Unfinished work',
      outputPath: '/tmp/unfinished.html',
      filters: { readiness: ['blocked', 'ineligible'] },
    },
  };
  const { buildReportModel } = await import('../src/report.js');
  const { buildGraphModel } = await import('../src/report-graph.js');

  const report = buildReportModel(fixtureItems(), viewConfig, '2026-08-14');
  const graph = buildGraphModel(report);

  assert.deepEqual(graph.nodes.map((node) => node.id).sort(), [blockedId, doneId, epicId].sort());
  assert.deepEqual(graph.links, []);
  assert.deepEqual(nodeFor(graph, blockedId).reasons, [
    { code: 'dependency-unsatisfied', label: 'Dependency is not done: #1' },
    { code: 'age', label: 'age 13d' },
  ]);
});

const fixtureBundle = { manifest: { package: 'p', version: '1.2.3' }, source: 'window.ForceGraph3D=1;' };

async function fixtureHtml(items = fixtureItems()) {
  const { buildReportModel } = await import('../src/report.js');
  const { renderReportHtml } = await import('../src/report-html.js');
  return renderReportHtml(buildReportModel(items, fixtureConfig, '2026-08-14'), {
    logoDataUrl: null,
    graphBundle: fixtureBundle,
  });
}

test('the report inlines the vendored bundle and fetches nothing', async () => {
  const html = await fixtureHtml();
  const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((match) => match[0]);

  assert.ok(html.includes('window.ForceGraph3D=1;'), 'the vendored bundle must be inlined verbatim');
  assert.ok(scripts.every((tag) => !/\bsrc\s*=/.test(tag)), `a script element fetches: ${scripts}`);
  assert.doesNotMatch(html, /<link\b/i);
  assert.doesNotMatch(html, /@import/i);
  assert.doesNotMatch(html, /(?:src|href|srcset|poster)\s*=\s*["']?(?:https?:)?\/\//i);
  assert.doesNotMatch(html, /url\(\s*["']?(?:https?:)?\/\//i);
});

test('the report content security policy forbids every remote load', async () => {
  const html = await fixtureHtml();
  const policy = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];

  assert.ok(policy, 'a self-contained artifact must state its policy');
  assert.match(policy, /default-src 'none'/);
  assert.match(policy, /connect-src 'none'/);
  assert.doesNotMatch(policy, /https?:/);
});

test('the graph sits below the decision surface, never above it', async () => {
  const html = await fixtureHtml();
  const order = ['id="section-items"', 'id="attention-summary"', 'id="item-list"', 'id="section-flow"', 'id="section-dependencies"', 'id="graph"']
    .map((marker) => html.indexOf(marker));

  assert.ok(order.every((position) => position > -1), `a report section is missing: ${order}`);
  assert.deepEqual([...order].sort((left, right) => left - right), order);
});

// The roster carries the scope-independent actions: canonical details for every
// node, and labelled impact drilldowns only where the impact map is nonempty.
// There is no graph-only status filter left to pin.
test('roster rows carry canonical details and impact actions with counts', async () => {
  const html = await fixtureHtml();
  const { report, graph } = await fixtureGraph();
  const roster = html.match(/<ol class="graph-roster">[\s\S]*?<\/ol>/)?.[0];

  assert.ok(roster, 'the graph section must carry its own item roster');
  assert.doesNotMatch(html, /graph-status/);
  assert.doesNotMatch(html, /id="graph-filter"/);
  assert.match(html, /<p id="graph-node-count" class="result-count" role="status" aria-live="polite">Showing 5 of 5 nodes<\/p>/);
  for (const node of graph.nodes) {
    assert.match(roster, new RegExp(`data-node-id="${node.id}"`));
    assert.match(roster, new RegExp(`<button type="button" data-inspect="${node.id}">Details</button>`));
  }
  const impact = report.impactById[readyId];
  assert.match(roster, new RegExp(`<button type="button" data-downstream="${readyId}">Downstream \\(${impact.downstreamIds.length}\\)</button>`));
  assert.match(roster, new RegExp(`<button type="button" data-ready="${readyId}">Ready if done \\(${impact.readyIfDoneIds.length}\\)</button>`));
  const doneRow = roster.match(new RegExp(`<li[^>]*data-node-id="${doneId}"[^>]*>[\\s\\S]*?</li>`))?.[0];
  assert.ok(doneRow, 'the terminal row must render');
  assert.doesNotMatch(doneRow, /data-downstream/);
  assert.doesNotMatch(doneRow, /data-ready/);
});

test('every node is readable without WebGL, with its status, age, and reasons', async () => {
  const html = await fixtureHtml();
  const { graph } = await fixtureGraph();
  const roster = html.match(/<ol class="graph-roster">[\s\S]*?<\/ol>/)?.[0];

  assert.ok(roster, 'the graph section must carry its own item roster');
  assert.match(html, /id="graph-nowebgl"[^>]*hidden/, 'the notice only appears when the graph cannot draw');
  const entries = [...roster.matchAll(/<li class="graph-band-[^"]*"[^>]*>([\s\S]*?)<\/li>/g)].map((match) => match[1]);
  assert.equal(entries.length, graph.nodes.length);
  for (const [index, node] of graph.nodes.entries()) {
    const entry = entries[index];
    assert.ok(entry.includes(`>${node.handle}<`), `${node.handle} is missing from the roster`);
    assert.ok(entry.includes(node.title), `${node.handle} title is missing from the roster`);
    assert.ok(entry.includes(node.status), `${node.handle} status is missing from the roster`);
    assert.ok(entry.includes(`age ${node.ageDays}d`), `${node.handle} age is missing from the roster`);
    for (const reason of node.reasons) {
      assert.ok(entry.includes(reason.label), `${node.handle} lost the reason "${reason.label}"`);
    }
  }
});

test('escapes hostile item text in both the markup and the inline graph model', async () => {
  const items = fixtureItems();
  items[0].data.title = '</script><img src="https://evil.test/x" onerror="alert(1)">';
  const html = await fixtureHtml(items);
  const scriptOpens = [...html.matchAll(/<script\b/g)].length;
  const scriptCloses = [...html.matchAll(/<\/script>/g)].length;

  assert.doesNotMatch(html, /<img src="https:\/\/evil\.test/);
  assert.equal(scriptOpens, scriptCloses);
  assert.ok(html.includes('\\u003c/script>'), 'the graph model must not be able to close its element');
});

// One node whose prerequisite is terminal: enough for a scope the reader
// narrows to drop a link with it.
async function scopeGraphItems() {
  const items = fixtureItems();
  items[1].data.depends_on = [readyId, doneId];
  return items;
}

// A node outside the scope takes its edges with it. Leaving them drawn would
// show a dependency between things the reader cannot see, which is worse than
// showing nothing.
test('draws one node with no links for a single-item scope', async () => {
  const { graphClientSource } = await import('../src/report-graph.js');
  const { graph } = await fixtureGraph();
  const scope = scopeHarness(graph, { scopeIds: [childId] });
  runReportClient(graphClientSource(graph), scope.dom);
  scope.reveal();

  assert.deepEqual(scope.drawnIds(), [childId]);
  assert.deepEqual(scope.dom.lastData().links, []);
  assert.deepEqual(scope.rosterIds(), [childId]);
  assert.equal(scope.dom.nodeCount(), 'Showing 1 of 5 nodes');
});

test('takes a node off the graph card and out of the label layer when it leaves the scope', async () => {
  const { graphClientSource } = await import('../src/report-graph.js');
  const { graph } = await fixtureGraph(await scopeGraphItems());
  const scope = scopeHarness(graph, {});
  runReportClient(graphClientSource(graph), scope.dom);
  scope.reveal();
  const done = scope.dom.lastData().nodes.find((node) => node.id === doneId);

  scope.dom.hover(done);

  assert.equal(scope.dom.card.hidden, false);

  scope.setScope([readyId, blockedId, childId, epicId]);

  assert.equal(scope.dom.card.hidden, true, 'the card must not keep describing a node the graph no longer draws');
  const label = scope.dom.labels().find((node) => node.textContent === '#4');
  assert.equal(label.hidden, true);
  assert.equal(label.style.opacity, '0');
});

// An empty scope is a legitimate thing to ask for, and the honest answer is an
// empty graph that says it is empty — not the whole ledger back, and not a
// stage that silently keeps the last drawing.
test('answers a zero-node scope with the scope empty copy and restores on return', async () => {
  const { graphClientSource } = await import('../src/report-graph.js');
  const { graph } = await fixtureGraph(await scopeGraphItems());
  const scope = scopeHarness(graph, {});
  runReportClient(graphClientSource(graph), scope.dom);
  scope.reveal();

  assert.equal(scope.dom.emptyState.hidden, true);

  scope.setScope([]);

  assert.deepEqual(scope.dom.lastData(), { nodes: [], links: [] });
  assert.deepEqual(scope.rosterIds(), []);
  assert.equal(scope.dom.nodeCount(), 'Showing 0 of 5 nodes');
  assert.equal(scope.dom.emptyState.hidden, false);
  assert.match(scope.dom.emptyState.textContent, /current scope/);

  scope.setScope([readyId]);

  assert.equal(scope.dom.emptyState.hidden, true);
  assert.deepEqual(scope.drawnIds(), [readyId]);
  assert.equal(scope.dom.nodeCount(), 'Showing 1 of 5 nodes');
});

// Without WebGL the roster is the graph, so the shared scope still filters it.
test('filters the roster and the count from scope where the graph cannot draw at all', async () => {
  const { graphClientSource } = await import('../src/report-graph.js');
  const { graph } = await fixtureGraph(await scopeGraphItems());
  const scope = scopeHarness(graph, { webgl: false });
  runReportClient(graphClientSource(graph), scope.dom);
  scope.setScope([doneId]);
  scope.reveal();

  assert.equal(scope.dom.stage.hidden, true);
  assert.equal(scope.dom.notice.hidden, false);
  assert.deepEqual(scope.rosterIds(), [doneId]);
  assert.equal(scope.dom.nodeCount(), 'Showing 1 of 5 nodes');
});
// T7 drives the graph from the shared report scope instead of its own status
// chips. The harness stubs window.wowbaggerReport the way reportClientSource
// installs it and wraps the shared fixture with the hidden Dependencies
// section and nav node the real artifact carries.
function scopeHarness(graph, { scopeIds = null, impactById = {}, webgl = true, reducedMotion = false } = {}) {
  const dom = graphDom(graph, { webgl });
  let current = (scopeIds ?? graph.nodes.map((node) => node.id)).slice();
  const listeners = new Set();
  const calls = { inspect: [], show: [], unsubscribed: 0 };
  const itemObjects = () => current.map((id) => ({ id }));
  dom.window.wowbaggerReport = {
    getScopeItems: itemObjects,
    subscribeScope: (listener) => {
      listener(itemObjects());
      listeners.add(listener);
      return () => { listeners.delete(listener); calls.unsubscribed += 1; };
    },
    inspectItem: (id) => { calls.inspect.push(id); return true; },
    showItems: (selection) => { calls.show.push(selection); },
    impactById,
  };
  const windowEvents = {};
  const baseAddEventListener = dom.window.addEventListener;
  dom.window.addEventListener = (type, listener) => {
    (windowEvents[type] ??= []).push(listener);
  };
  if (reducedMotion) {
    const baseMatchMedia = dom.window.matchMedia;
    dom.window.matchMedia = (query) => (
      query === '(prefers-reduced-motion: reduce)' ? { matches: true } : baseMatchMedia(query)
    );
  }
  const rows = dom.document.querySelectorAll('[data-node-status]');
  rows.forEach((row, index) => { row.dataset.nodeId = graph.nodes[index].id; });
  const section = dom.document.createElement('section');
  section.id = 'section-dependencies';
  section.hidden = true;
  const nav = dom.document.createElement('button');
  nav.id = 'nav-dependencies';
  dom.document.body.append(section, nav);
  for (const row of rows) {
    const id = row.dataset.nodeId;
    const details = dom.document.createElement('button');
    details.dataset.inspect = id;
    details.textContent = 'Details';
    row.append(details);
    const entry = impactById[id] ?? {};
    for (const [key, text] of [
      ['downstream', `Downstream (${(entry.downstreamIds ?? []).length})`],
      ['ready', `Ready if done (${(entry.readyIfDoneIds ?? []).length})`],
    ]) {
      const ids = key === 'downstream' ? entry.downstreamIds : entry.readyIfDoneIds;
      if (Array.isArray(ids) && ids.length > 0) {
        const action = dom.document.createElement('button');
        action.dataset[key] = id;
        action.textContent = text;
        row.append(action);
      }
    }
  }
  const observers = [];
  dom.window.MutationObserver = function (callback) {
    const observer = { callback, observe() {}, disconnect() {} };
    observers.push(observer);
    return observer;
  };
  function fireObservers() {
    for (const observer of observers) observer.callback();
  }
  return {
    dom,
    calls,
    rows,
    section,
    windowEvents,
    setScope(ids) {
      current = ids.slice();
      for (const listener of listeners) listener(itemObjects());
    },
    hide() {
      section.hidden = true;
      fireObservers();
    },
    reveal() {
      section.hidden = false;
      fireObservers();
      nav.dispatch('click');
    },
    drawnIds() {
      return dom.lastData().nodes.map((node) => node.id).sort();
    },
    rosterIds() {
      return rows.filter((row) => !row.hidden).map((row) => row.dataset.nodeId).sort();
    },
  };
}
test('a scope selection leaves the same scoped ids in graph nodes and roster', async () => {
  const { graphClientSource } = await import('../src/report-graph.js');
  const { graph } = await fixtureGraph();
  const scope = scopeHarness(graph, {});
  runReportClient(graphClientSource(graph), scope.dom);
  scope.setScope([blockedId, childId]);
  scope.reveal();

  assert.deepEqual(scope.drawnIds(), [blockedId, childId].sort());
  assert.deepEqual(scope.rosterIds(), [blockedId, childId].sort());
  const blocked = scope.dom.lastData().nodes.find((node) => node.id === blockedId);
  assert.equal(blocked.band, 'blocked');
  assert.ok(
    blocked.reasons.some((reason) => reason.label.includes('#1')),
    'the hidden prerequisite stays named instead of turning the item ready',
  );
  assert.deepEqual(scope.dom.lastData().links, [], 'a link cannot land on a node outside the scope');
});
test('creates no canvas while Dependencies stays hidden, and pauses while hidden', async () => {
  const { graphClientSource } = await import('../src/report-graph.js');
  const { graph } = await fixtureGraph();
  const scope = scopeHarness(graph, {});
  let canvases = 0;
  const realForce = scope.dom.window.ForceGraph3D;
  scope.dom.window.ForceGraph3D = function (...args) {
    canvases += 1;
    return realForce.apply(this, args);
  };
  runReportClient(graphClientSource(graph), scope.dom);

  assert.equal(canvases, 0, 'no canvas while the section is still hidden');

  scope.reveal();

  assert.equal(canvases, 1);
  assert.deepEqual(scope.drawnIds(), graph.nodes.map((node) => node.id).sort());

  scope.hide();
  scope.reveal();
  scope.reveal();

  assert.equal(canvases, 1, 'repeated visits reuse the one canvas');
  const calls = scope.dom.renderer().calls.map(([name]) => name);
  assert.ok(calls.includes('pauseAnimation'), 'hiding the section pauses the layout');
  assert.ok(calls.includes('resumeAnimation'), 'returning to the section resumes it');
});
test('graph and roster selections open canonical details while impact actions drill down', async () => {
  const { graphClientSource } = await import('../src/report-graph.js');
  const { report, graph } = await fixtureGraph();
  const impact = report.impactById[readyId];
  assert.ok(impact.downstreamIds.length > 0 && impact.readyIfDoneIds.length > 0);
  const scope = scopeHarness(graph, { impactById: report.impactById });
  runReportClient(graphClientSource(graph), scope.dom);
  scope.reveal();

  const ready = scope.dom.lastData().nodes.find((node) => node.id === readyId);
  scope.dom.renderer().handlers.onNodeClick(ready);

  assert.deepEqual(scope.calls.inspect, [readyId]);
  assert.deepEqual(
    scope.drawnIds(),
    graph.nodes.map((node) => node.id).sort(),
    'inspecting an item never narrows the scope',
  );

  const row = scope.rows.find((candidate) => candidate.dataset.nodeId === readyId);
  row.children.find((child) => child.dataset.inspect !== undefined).dispatch('click');

  assert.deepEqual(scope.calls.inspect, [readyId, readyId]);

  row.children.find((child) => child.dataset.downstream !== undefined).dispatch('click');
  row.children.find((child) => child.dataset.ready !== undefined).dispatch('click');

  assert.equal(scope.calls.show.length, 2);
  assert.deepEqual(scope.calls.show[0].itemIds.slice().sort(), impact.downstreamIds.slice().sort());
  assert.deepEqual(scope.calls.show[1].itemIds.slice().sort(), impact.readyIfDoneIds.slice().sort());
  assert.match(scope.calls.show[0].label, /Downstream/);
  assert.match(scope.calls.show[1].label, /Ready if/);
  assert.notEqual(scope.calls.show[0].label, scope.calls.show[1].label);
  assert.match(scope.calls.show[0].label, new RegExp(String(impact.downstreamIds.length)));
  assert.match(scope.calls.show[1].label, new RegExp(String(impact.readyIfDoneIds.length)));
});
test('keeps a terminal prerequisite drawable in scope without changing readiness', async () => {
  const { graphClientSource } = await import('../src/report-graph.js');
  const { graph } = await fixtureGraph(await scopeGraphItems());
  const scope = scopeHarness(graph, { scopeIds: [blockedId, doneId] });
  runReportClient(graphClientSource(graph), scope.dom);
  scope.reveal();

  assert.deepEqual(scope.drawnIds(), [blockedId, doneId].sort());
  assert.deepEqual(scope.dom.lastData().links, [{ source: doneId, target: blockedId, kind: 'depends-on' }]);
  const blocked = scope.dom.lastData().nodes.find((node) => node.id === blockedId);
  assert.equal(blocked.band, 'blocked');

  scope.setScope([blockedId]);

  assert.deepEqual(scope.drawnIds(), [blockedId]);
  assert.deepEqual(scope.dom.lastData().links, [], 'the cross-scope edge leaves with its hidden end');
  assert.ok(
    scope.dom.lastData().nodes.find((node) => node.id === blockedId).reasons.some((reason) => reason.label.includes('#1')),
    'the omitted reference stays named without becoming a node',
  );
});

test('waits for measurable dimensions before the first sizing', async () => {
  const { graphClientSource } = await import('../src/report-graph.js');
  const { graph } = await fixtureGraph();
  const scope = scopeHarness(graph, {});
  let canvases = 0;
  const realForce = scope.dom.window.ForceGraph3D;
  scope.dom.window.ForceGraph3D = function (...args) {
    canvases += 1;
    return realForce.apply(this, args);
  };
  const mount = scope.dom.document.getElementById('graph-canvas');
  mount.clientWidth = 0;
  mount.clientHeight = 0;
  runReportClient(graphClientSource(graph), scope.dom);
  scope.reveal();

  assert.equal(canvases, 0, 'a hidden-sized container cannot be sized yet');

  mount.clientWidth = 800;
  mount.clientHeight = 600;
  scope.reveal();

  assert.equal(canvases, 1);
  assert.deepEqual(scope.drawnIds(), graph.nodes.map((node) => node.id).sort());
});

test('releases the layout and the scope subscription when the document is disposed', async () => {
  const { graphClientSource } = await import('../src/report-graph.js');
  const { graph } = await fixtureGraph();
  const scope = scopeHarness(graph, {});
  runReportClient(graphClientSource(graph), scope.dom);
  scope.reveal();

  assert.ok((scope.windowEvents.pagehide ?? []).length > 0, 'the runtime must listen for disposal');
  for (const listener of scope.windowEvents.pagehide) listener();

  assert.equal(scope.calls.unsubscribed, 1);
  const calls = scope.dom.renderer().calls.map(([name]) => name);
  assert.ok(calls.includes('_destructor'), 'the force layout is released');
});

test('settles the layout without animation when motion is not wanted', async () => {
  const { graphClientSource } = await import('../src/report-graph.js');
  const { graph } = await fixtureGraph();
  const scope = scopeHarness(graph, { reducedMotion: true });
  runReportClient(graphClientSource(graph), scope.dom);
  scope.reveal();

  const cooldowns = scope.dom.renderer().calls.filter(([name]) => name === 'cooldownTicks');
  assert.deepEqual(cooldowns, [['cooldownTicks', 0]]);
});
