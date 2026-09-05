import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runCli, withLedger } from './support.js';
import { coreCapabilities, verifyCoreProbe } from '../src/adapter/core-probe.js';
import { dynamicDescribe } from './adapter-contract-fixtures.js';

function readGuidance(file) {
  return readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
}

// Installed guidance is hard-wrapped prose, so a documented claim is asserted
// against its words rather than against the column it happens to break at.
function collapse(text) {
  return text.replace(/\s+/g, ' ');
}

const itemId = 'wb_01Q45X474NAAAAAAAAAAAAAAAA';
const itemSource = [
  '---',
  'schema_version: 1',
  `id: ${itemId}`,
  'title: "Ready report item"',
  'kind: task',
  'status: backlog',
  'created: 2030-01-10',
  'updated: 2030-01-10',
  'provenance:',
  '  source: "fixture/report"',
  '  recorded_at: "2030-01-10T12:34:56.789Z"',
  'depends_on: []',
  'related: []',
  '---',
  '',
  '# Body',
].join('\n');

function reportConfig(output = '../../report.html') {
  return JSON.stringify({
    report_version: 1,
    repository: { name: 'Example repository' },
    title: 'Ledger report',
    output,
  });
}

// A named view is a second report generated from the same complete ledger, so
// its fixture states both an item the criteria keep and one they drop: the only
// honest proof that the artifact describes the subset is the excluded title's
// absence from the bytes.
function viewItemSource(id, title, extraLines = []) {
  return [
    '---',
    'schema_version: 1',
    `id: ${id}`,
    `title: "${title}"`,
    'kind: task',
    'status: backlog',
    'created: 2030-01-10',
    'updated: 2030-01-10',
    'provenance:',
    '  source: "fixture/report"',
    '  recorded_at: "2030-01-10T12:34:56.789Z"',
    'depends_on: []',
    'related: []',
    ...extraLines,
    '---',
    '',
    '# Body',
  ].join('\n');
}

const securityBugId = 'wb_01Q45X474NCCCCCCCCCCCCCCCC';
const choreId = 'wb_01Q45X474NDDDDDDDDDDDDDDDD';
const viewLedger = {
  [`${securityBugId}.md`]: viewItemSource(securityBugId, 'Retained security bug', [
    'class: bug',
    'security: high',
  ]),
  [`${choreId}.md`]: viewItemSource(choreId, 'Excluded styling chore', ['class: chore']),
};

function viewConfig(views) {
  return JSON.stringify({
    report_version: 2,
    repository: { name: 'Example repository' },
    title: 'Ledger report',
    output: '../../report.html',
    fields: { class: '/class', security: '/security' },
    views,
  });
}

const securityBlockersView = {
  'security-blockers': {
    title: 'Security bugs',
    output: '../../reports/security-blockers.html',
    filters: { kind: ['task'], fields: { class: ['bug'] } },
  },
};

test('renders one selected named report view', async () => {
  await withLedger({
    ...viewLedger,
    '.wowbagger/report.json': viewConfig(securityBlockersView),
  }, async (ledger) => {
    const output = path.resolve(ledger, '..', 'reports', 'security-blockers.html');

    const result = runCli(
      'report', '--ledger', ledger, '--view', 'security-blockers', '--as-of', '2030-01-15', '--json',
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      command: 'report',
      contract_version: 5,
      result: {
        report_version: 2,
        as_of: '2030-01-15',
        output,
        item_count: 1,
        ready_count: 1,
        view: 'security-blockers',
      },
    });
    const html = await readFile(output, 'utf8');
    assert.match(html, /Retained security bug/);
    assert.doesNotMatch(html, /Excluded styling chore/);
  });
});

test('refuses an unknown report view by name', async () => {
  await withLedger({
    ...viewLedger,
    '.wowbagger/report.json': viewConfig(securityBlockersView),
  }, async (ledger) => {
    const result = runCli(
      'report', '--ledger', ledger, '--view', 'performance', '--as-of', '2030-01-15', '--json',
    );

    assert.equal(result.status, 2);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: false,
      command: 'report',
      contract_version: 5,
      error: {
        code: 'report-view-not-found',
        message: 'The requested report view was not found.',
        details: { view: 'performance' },
      },
    });
  });
});

test('refuses a named view against version 1 report configuration', async () => {
  await withLedger({
    ...viewLedger,
    '.wowbagger/report.json': reportConfig(),
  }, async (ledger) => {
    const result = runCli(
      'report', '--ledger', ledger, '--view', 'security-blockers', '--as-of', '2030-01-15', '--json',
    );

    assert.equal(result.status, 2);
    assert.deepEqual(JSON.parse(result.stdout).error, {
      code: 'report-view-not-found',
      message: 'The requested report view was not found.',
      details: { view: 'security-blockers' },
    });
  });
});

test('publishes a named view to an output override without touching the configured path', async () => {
  await withLedger({
    ...viewLedger,
    '.wowbagger/report.json': viewConfig(securityBlockersView),
  }, async (ledger) => {
    const override = path.resolve(ledger, '..', 'override.html');
    const configured = path.resolve(ledger, '..', 'reports', 'security-blockers.html');

    const result = runCli(
      'report', '--ledger', ledger, '--view', 'security-blockers',
      '--as-of', '2030-01-15', '--out', override, '--json',
    );

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).result, {
      report_version: 2,
      as_of: '2030-01-15',
      output: override,
      item_count: 1,
      ready_count: 1,
      view: 'security-blockers',
    });
    assert.match(await readFile(override, 'utf8'), /Retained security bug/);
    await assert.rejects(readFile(configured, 'utf8'), { code: 'ENOENT' });
  });
});

test('succeeds with an empty named view subset', async () => {
  await withLedger({
    ...viewLedger,
    '.wowbagger/report.json': viewConfig({
      'unmatched-work': {
        title: 'Unmatched work',
        output: '../../reports/unmatched.html',
        filters: { fields: { class: ['regression'] } },
      },
    }),
  }, async (ledger) => {
    const output = path.resolve(ledger, '..', 'reports', 'unmatched.html');

    const result = runCli(
      'report', '--ledger', ledger, '--view', 'unmatched-work', '--as-of', '2030-01-15', '--json',
    );

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).result, {
      report_version: 2,
      as_of: '2030-01-15',
      output,
      item_count: 0,
      ready_count: 0,
      view: 'unmatched-work',
    });
    const html = await readFile(output, 'utf8');
    assert.doesNotMatch(html, /Retained security bug/);
    assert.doesNotMatch(html, /Excluded styling chore/);
    // Nothing narrowed this artifact, so it must not send the reader to the
    // filters or to the graph's status chips for items it does not hold.
    assert.match(html, /No ledger item matches this view's criteria\./);
    assert.match(html, /No ledger item matches this view's criteria, so the graph has nothing to draw\./);
    assert.doesNotMatch(html, /No items match these filters\./);
    assert.doesNotMatch(html, /No status is selected/);
  });
});

test('renders the same named view bytes for the same ledger and as-of', async () => {
  await withLedger({
    ...viewLedger,
    '.wowbagger/report.json': viewConfig(securityBlockersView),
  }, async (ledger) => {
    const output = path.resolve(ledger, '..', 'reports', 'security-blockers.html');
    const invoke = () => runCli(
      'report', '--ledger', ledger, '--view', 'security-blockers', '--as-of', '2030-01-15', '--json',
    );

    assert.equal(invoke().status, 0);
    const first = await readFile(output, 'utf8');
    assert.equal(invoke().status, 0);

    assert.equal(await readFile(output, 'utf8'), first);
  });
});

// A named artifact and the base artifact are two files a reader opens side by
// side, so the two places a title lands — the browser tab and the masthead —
// have to name which one is open. The view's own title is the generated
// report's title; the base report in the same configuration keeps the
// configured one.
test('titles a named artifact with its view title and the base artifact with the configured title', async () => {
  await withLedger({
    ...viewLedger,
    '.wowbagger/report.json': viewConfig(securityBlockersView),
  }, async (ledger) => {
    const named = path.resolve(ledger, '..', 'reports', 'security-blockers.html');
    const base = path.resolve(ledger, '..', 'report.html');

    assert.equal(runCli(
      'report', '--ledger', ledger, '--view', 'security-blockers', '--as-of', '2030-01-15', '--json',
    ).status, 0);
    assert.equal(runCli('report', '--ledger', ledger, '--as-of', '2030-01-15', '--json').status, 0);

    const namedHtml = await readFile(named, 'utf8');
    assert.match(namedHtml, /<title>Security bugs<\/title>/);
    assert.match(namedHtml, /<h1>Security bugs<\/h1>/);
    assert.doesNotMatch(namedHtml, /<title>Ledger report<\/title>/);
    assert.doesNotMatch(namedHtml, /<h1>Ledger report<\/h1>/);

    const baseHtml = await readFile(base, 'utf8');
    assert.match(baseHtml, /<title>Ledger report<\/title>/);
    assert.match(baseHtml, /<h1>Ledger report<\/h1>/);
    assert.doesNotMatch(baseHtml, /Security bugs/);
  });
});

// The base report is the surface every existing consumer already reads. A
// version 2 configuration only names views, so with no view selected it must
// publish the same members and the same bytes a version 1 configuration does.
test('keeps base report result members and bytes unchanged under configuration version 2', async () => {
  const baseResult = async (config) => await withLedger({
    ...viewLedger,
    '.wowbagger/report.json': config,
  }, async (ledger) => {
    const output = path.resolve(ledger, '..', 'report.html');
    const result = runCli('report', '--ledger', ledger, '--as-of', '2030-01-15', '--json');
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout).result;
    return {
      members: Object.keys(parsed),
      counts: [parsed.item_count, parsed.ready_count],
      html: (await readFile(output, 'utf8')).replaceAll(output, '<output>'),
    };
  });

  const version1 = await baseResult(JSON.stringify({
    report_version: 1,
    repository: { name: 'Example repository' },
    title: 'Ledger report',
    output: '../../report.html',
    fields: { class: '/class', security: '/security' },
  }));
  const version2 = await baseResult(viewConfig(securityBlockersView));

  assert.deepEqual(version1.members, ['report_version', 'as_of', 'output', 'item_count', 'ready_count']);
  assert.deepEqual(version2.members, version1.members);
  assert.deepEqual(version2.counts, version1.counts);
  assert.deepEqual(version1.counts, [2, 2]);
  assert.equal(version2.html, version1.html);
});

test('report help states the named view flag', () => {
  const result = runCli('report', '--help');

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /Usage: wowbagger report --ledger <dir> --as-of YYYY-MM-DD \[--view <name>] \[--out <file>] --json/,
  );
});

// A consumer must learn that named views exist by asking, never by generating
// an artifact and inspecting it.
test('capabilities advertises named report view support', () => {
  const result = runCli('capabilities', '--json');

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).result.operations.report, {
    supported: true,
    write_scope: 'derived-output',
    config_versions: [1, 2],
    named_views: true,
  });
});

// The adapter reads the same advertisement through its core probe, so the
// engine's snapshot must carry the report operation and the probe must refuse a
// core that claims named views it does not implement.
test('the core probe carries the report operation and refuses an elevated one', () => {
  const probe = coreCapabilities();

  assert.deepEqual(probe.result.operations.report, {
    supported: true,
    write_scope: 'derived-output',
    config_versions: [1, 2],
    named_views: true,
  });
  assert.equal(verifyCoreProbe(dynamicDescribe(), probe).ok, true);
  for (const mutate of [
    (value) => { delete value.result.operations.report; },
    (value) => { value.result.operations.report.named_views = 'yes'; },
    (value) => { value.result.operations.report.config_versions = [1]; },
    (value) => { value.result.operations.report.write_scope = 'single-item'; },
    (value) => { value.result.operations.report.extra = true; },
  ]) {
    const elevated = coreCapabilities();
    mutate(elevated);
    const refusal = verifyCoreProbe(dynamicDescribe(), elevated);
    assert.equal(refusal.ok, false);
    assert.equal(refusal.error_code, 'core-protocol-error');
  }
});

test('report writes the configured HTML and one success envelope', async () => {
  await withLedger({
    [`${itemId}.md`]: itemSource,
    '.wowbagger/report.json': reportConfig(),
  }, async (ledger) => {
    const output = path.resolve(ledger, '..', 'report.html');

    const result = runCli('report', '--ledger', ledger, '--as-of', '2030-01-15', '--json');

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      command: 'report',
      contract_version: 5,
      result: {
        report_version: 1,
        as_of: '2030-01-15',
        output,
        item_count: 1,
        ready_count: 1,
      },
    });
    const html = await readFile(output, 'utf8');
    assert.match(html, /Ready report item/);
    // The base artifact holds items, so an empty list there is the reader's
    // own filtering and says so.
    assert.match(html, /No items match these filters\./);
    assert.match(html, /No status is selected, so the graph is empty\./);
    assert.doesNotMatch(html, /matches this view's criteria/);
  });
});

const completedId = 'wb_01Q45X474NBBBBBBBBBBBBBBBB';
const completedSource = [
  '---',
  'schema_version: 1',
  `id: ${completedId}`,
  'title: "Completed report item"',
  'kind: task',
  'status: done',
  'created: 2030-01-10',
  'updated: 2030-01-12',
  'completed: 2030-01-12',
  'provenance:',
  '  source: "fixture/report"',
  '  recorded_at: "2030-01-10T12:34:56.789Z"',
  'depends_on: []',
  'related: []',
  'decisions:',
  '  - action: accept',
  '    date: 2030-01-10',
  '    summary: "Accept it."',
  '    rationale: "See https://example.invalid/why for the reasoning."',
  '  - action: complete',
  '    date: 2030-01-12',
  '    summary: "Finish it."',
  '    rationale: "Verified."',
  '---',
  '',
  '# Body',
  '',
  'See <https://example.invalid/spec> for detail.',
].join('\n');

test('report renders byte-identical evidence charts for the same ledger and as-of', async () => {
  await withLedger({
    [`${itemId}.md`]: itemSource,
    [`${completedId}.md`]: completedSource,
    '.wowbagger/report.json': reportConfig(),
  }, async (ledger) => {
    const output = path.resolve(ledger, '..', 'report.html');

    assert.equal(runCli('report', '--ledger', ledger, '--as-of', '2030-01-15', '--json').status, 0);
    const first = await readFile(output, 'utf8');
    assert.equal(runCli('report', '--ledger', ledger, '--as-of', '2030-01-15', '--json').status, 0);
    const second = await readFile(output, 'utf8');

    assert.equal(first, second);
    for (const id of [
      'chart-aging-heatmap',
      'chart-throughput',
      'chart-weekly-flow',
      'chart-cumulative-flow',
      'chart-cycle-time',
      'chart-forecast',
    ]) {
      assert.match(first, new RegExp(`data-testid="${id}"`), id);
    }
  });
});

test('report keeps every reference inline even when item prose carries URLs', async () => {
  await withLedger({
    [`${itemId}.md`]: itemSource,
    [`${completedId}.md`]: completedSource,
    '.wowbagger/report.json': reportConfig(),
  }, async (ledger) => {
    const output = path.resolve(ledger, '..', 'report.html');
    assert.equal(runCli('report', '--ledger', ledger, '--as-of', '2030-01-15', '--json').status, 0);
    const html = await readFile(output, 'utf8');

    assert.doesNotMatch(html, /<link\b|@import|xlink:href|<use\b|<image\b|<iframe\b|<object\b|<embed\b/);
    assert.doesNotMatch(html, /\ssrc="(?!data:)/);
    assert.doesNotMatch(html, /url\(\s*['"]?(?:https?:)?\/\//);
  });
});

test('report renders an empty ledger without charts and without errors', async () => {
  await withLedger({
    '.wowbagger/report.json': reportConfig(),
  }, async (ledger) => {
    const output = path.resolve(ledger, '..', 'report.html');

    const result = runCli('report', '--ledger', ledger, '--as-of', '2030-01-15', '--json');

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    const html = await readFile(output, 'utf8');
    // The chart runtime is inlined as script source; only rendered markup counts.
    assert.doesNotMatch(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ''), /data-testid="chart-/);
  });
});

test('report rejects missing required arguments with one JSON envelope', () => {
  const result = runCli('report');

  assert.equal(result.status, 2);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: false,
    command: 'report',
    contract_version: 5,
    error: {
      code: 'invalid-request',
      message: 'The report request is invalid.',
      details: {
        issues: [
          {
            path: '/arguments',
            code: 'missing-argument',
            message: 'Argument --as-of is required.',
          },
          {
            path: '/arguments',
            code: 'missing-argument',
            message: 'Argument --json is required.',
          },
          {
            path: '/arguments',
            code: 'missing-argument',
            message: 'Argument --ledger is required.',
          },
        ],
      },
    },
  });
});

test('report validates the ledger before reading report configuration', async () => {
  await withLedger({
    'invalid.md': 'not frontmatter',
  }, async (ledger) => {
    const result = runCli('report', '--ledger', ledger, '--as-of', '2030-01-15', '--json');
    const output = JSON.parse(result.stdout);

    assert.equal(result.status, 1);
    assert.equal(result.stderr, '');
    assert.deepEqual(Object.keys(output), ['ok', 'command', 'contract_version', 'error']);
    assert.equal(output.ok, false);
    assert.equal(output.command, 'report');
    assert.equal(output.contract_version, 5);
    assert.equal(output.error.code, 'ledger-invalid');
    assert.equal(output.error.message, 'The configured ledger is invalid.');
    assert.ok(Array.isArray(output.error.details.errors));
    assert.ok(output.error.details.errors.length > 0);
  });
});

// Named views are only reachable if the installed guidance states the flag, the
// result member, the refusal, and the capability that advertises them. The
// advertisement is compared against the bytes the core actually emits, so the
// contract document cannot drift from the probe.
test('documents named custom report views on the command line', () => {
  const surfaces = [
    ['README.md', readGuidance('README.md')],
    ['docs/mutation-contract.md', readGuidance('docs/mutation-contract.md')],
    ['skills/wowbagger/SKILL.md', readGuidance('skills/wowbagger/SKILL.md')],
  ];
  for (const [surface, text] of surfaces) {
    assert.ok(
      text.includes('report --ledger <dir> --view <name> --as-of YYYY-MM-DD --json'),
      `${surface} must state the exact named view command`,
    );
  }

  const [, contract] = surfaces[1];
  assert.ok(
    contract.includes(JSON.stringify(coreCapabilities().result.operations.report)),
    'the contract must carry the exact advertised report operation',
  );
  assert.match(
    collapse(contract),
    /`inspect`, `list`, `create`, `transition`, `patch`, `report`, `work_claim`/,
    'the contract must place report in the advertised order',
  );

  for (const [surface, text] of [surfaces[0], surfaces[2]]) {
    const prose = collapse(text);
    assert.match(prose, /--out <file>/, `${surface} must state the output override`);
    assert.match(prose, /report-view-not-found/, `${surface} must state the unknown view refusal`);
    assert.match(prose, /result\.view/, `${surface} must state the named view result member`);
    assert.match(prose, /not a security boundary/, `${surface} must refuse to imply redaction`);
  }
  assert.match(
    collapse(surfaces[2][1]),
    /Do not parse the generated HTML/,
    'the skill must send automation to the JSON result',
  );
});
