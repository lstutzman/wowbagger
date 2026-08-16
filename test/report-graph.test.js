import test from 'node:test';
import assert from 'node:assert/strict';

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

test('every node is readable without WebGL, with its status, age, and reasons', async () => {
  const html = await fixtureHtml();
  const { graph } = await fixtureGraph();
  const roster = html.match(/<ol class="graph-roster">[\s\S]*?<\/ol>/)?.[0];

  assert.ok(roster, 'the graph section must carry its own item roster');
  assert.match(html, /id="graph-nowebgl"[^>]*hidden/, 'the notice only appears when the graph cannot draw');
  const entries = [...roster.matchAll(/<li class="graph-band-[^"]*">([\s\S]*?)<\/li>/g)].map((match) => match[1]);
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
