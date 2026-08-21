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
  const order = ['id="work-next"', 'id="attention"', 'id="evidence"', 'id="graph"', 'id="drilldown"']
    .map((marker) => html.indexOf(marker));

  assert.ok(order.every((position) => position > -1), `a report section is missing: ${order}`);
  assert.deepEqual([...order].sort((left, right) => left - right), order);
});

// The graph draws the whole ledger, and most questions asked of it are about
// part of it. The status filter is therefore part of the graph, above the
// stage, in the same chip vocabulary the drill-down filters use: real
// checkboxes in a named group, so holding two statuses at once is the
// control's own semantics. Everything is selected until a reader says
// otherwise, because the graph's default is the whole ledger.
test('renders the graph status filter as accessible multi-select chips, all selected', async () => {
  const html = await fixtureHtml();
  const filter = html.slice(html.indexOf('id="graph-filter"'), html.indexOf('id="graph-stage"'));

  assert.ok(html.indexOf('id="graph-filter"') > -1, 'the graph must carry its own status filter');
  assert.ok(html.indexOf('id="graph-filter"') < html.indexOf('id="graph-stage"'), 'the filter sits above the stage');
  assert.match(filter, /<fieldset class="facet-group" data-group="graph-status"><legend>Status<\/legend>/);
  for (const [status, count] of [['backlog', 4], ['done', 1]]) {
    assert.match(
      filter,
      new RegExp(`<label class="chip"><input type="checkbox" class="graph-status" value="${status}" checked><span class="chip-text">${status}</span> <span class="chip-count">${count}</span></label>`),
    );
  }
  assert.match(filter, /<button type="button" id="graph-status-all">Select all<\/button>/);
  assert.match(filter, /<button type="button" id="graph-status-clear">Clear<\/button>/);
  assert.match(filter, /<p id="graph-node-count" class="result-count" role="status" aria-live="polite">Showing 5 of 5 nodes<\/p>/);
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

// One node whose prerequisite is terminal: enough for a status the reader hides
// to take a link with it.
async function clientGraph() {
  const items = fixtureItems();
  items[1].data.depends_on = [readyId, doneId];
  const { graph } = await fixtureGraph(items);
  return graph;
}

// A hidden node's edges have nowhere to land. Leaving them drawn would show a
// dependency between things the reader cannot see, which is worse than showing
// nothing: the filter drops the node, its links, and its label together.
test('hides every node outside the selected statuses, with the links that touch them', async () => {
  const { graphClientSource } = await import('../src/report-graph.js');
  const graph = await clientGraph();
  const dom = graphDom(graph);
  runReportClient(graphClientSource(graph), dom);

  assert.equal(dom.lastData().nodes.length, 5);
  assert.equal(dom.lastData().links.length, 3);

  dom.only('backlog');

  const data = dom.lastData();
  assert.deepEqual(data.nodes.map((node) => node.id).sort(), [readyId, blockedId, childId, epicId].sort());
  assert.equal(data.links.length, 2);
  assert.ok(
    data.links.every((link) => link.source !== doneId && link.target !== doneId),
    'a link to a hidden node is a dependency the reader cannot see',
  );
  assert.deepEqual(dom.rosterStatuses(), ['backlog', 'backlog', 'backlog', 'backlog']);
  assert.equal(dom.nodeCount(), 'Showing 4 of 5 nodes');

  dom.only('done');

  assert.deepEqual(dom.lastData().nodes.map((node) => node.id), [doneId]);
  assert.equal(dom.lastData().links.length, 0);
  assert.deepEqual(dom.rosterStatuses(), ['done']);
});

test('takes a hidden node off the graph card and out of the label layer', async () => {
  const { graphClientSource } = await import('../src/report-graph.js');
  const graph = await clientGraph();
  const dom = graphDom(graph);
  runReportClient(graphClientSource(graph), dom);
  const done = dom.lastData().nodes.find((node) => node.id === doneId);

  dom.hover(done);

  assert.equal(dom.card.hidden, false);

  dom.only('backlog');

  assert.equal(dom.card.hidden, true, 'the card must not keep describing a node the graph no longer draws');
  const label = dom.labels().find((node) => node.textContent === '#4');
  assert.equal(label.hidden, true);
  assert.equal(label.style.opacity, '0');
});

// Clearing every status is a legitimate thing to ask for, and the honest answer
// is an empty graph that says it is empty — not the whole ledger back, and not
// a stage that silently keeps the last drawing.
test('empties the graph on Clear, says so, and gives it all back on Select all', async () => {
  const { graphClientSource } = await import('../src/report-graph.js');
  const graph = await clientGraph();
  const dom = graphDom(graph);
  runReportClient(graphClientSource(graph), dom);

  assert.equal(dom.emptyState.hidden, true);

  dom.clear.dispatch('click');

  assert.equal(dom.statusChip('backlog').checked, false);
  assert.equal(dom.statusChip('done').checked, false);
  assert.deepEqual(dom.lastData(), { nodes: [], links: [] });
  assert.deepEqual(dom.rosterStatuses(), []);
  assert.equal(dom.nodeCount(), 'Showing 0 of 5 nodes');
  assert.equal(dom.emptyState.hidden, false);

  dom.selectAll.dispatch('click');

  assert.equal(dom.statusChip('backlog').checked, true);
  assert.equal(dom.statusChip('done').checked, true);
  assert.equal(dom.lastData().nodes.length, 5);
  assert.equal(dom.lastData().links.length, 3);
  assert.equal(dom.nodeCount(), 'Showing 5 of 5 nodes');
  assert.equal(dom.emptyState.hidden, true);
});

// Without WebGL the roster is the graph, so the same chips have to filter it.
test('filters the roster and the count where the graph cannot draw at all', async () => {
  const { graphClientSource } = await import('../src/report-graph.js');
  const graph = await clientGraph();
  const dom = graphDom(graph, { webgl: false });
  runReportClient(graphClientSource(graph), dom);

  assert.equal(dom.stage.hidden, true);
  assert.equal(dom.notice.hidden, false);

  dom.only('done');

  assert.deepEqual(dom.rosterStatuses(), ['done']);
  assert.equal(dom.nodeCount(), 'Showing 1 of 5 nodes');
});
