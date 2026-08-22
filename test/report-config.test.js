import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { linkDirectory } from './support.js';

function readGuidance(file) {
  return readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
}

// Installed guidance is hard-wrapped prose, so a documented claim is asserted
// against its words rather than against the column it happens to break at.
function collapse(text) {
  return text.replace(/\s+/g, ' ');
}

function guidanceSurfaces() {
  return [
    ['README.md', readGuidance('README.md')],
    ['docs/mutation-contract.md', readGuidance('docs/mutation-contract.md')],
    ['skills/wowbagger/SKILL.md', readGuidance('skills/wowbagger/SKILL.md')],
  ];
}

// The documented example is the one a consumer copies, so the guard parses the
// fenced block itself rather than a hand-kept duplicate of it.
function documentedViewConfig(readme) {
  const block = /```json\n(\{[^`]*?"report_version": 2[^`]*?\})\n```/.exec(readme);
  assert.ok(block, 'README must carry one complete version 2 configuration example');
  return JSON.parse(block[1]);
}

async function withTemporaryLedger(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-report-config-'));
  const ledger = path.join(root, 'ledger');
  await mkdir(ledger);

  try {
    return await callback(ledger);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function writeConfig(ledger, value) {
  const configDirectory = path.join(ledger, '.wowbagger');
  await mkdir(configDirectory, { recursive: true });
  await writeFile(path.join(configDirectory, 'report.json'), JSON.stringify(value), 'utf8');
}

function validConfig(overrides = {}) {
  return {
    report_version: 1,
    repository: { name: 'Example repository' },
    title: 'Ledger report',
    output: '../../ledger-report.html',
    ...overrides,
  };
}

function validView(overrides = {}) {
  return {
    title: 'Security blockers',
    output: '../../security.html',
    filters: { kind: ['task'] },
    ...overrides,
  };
}

function viewConfig(views) {
  return {
    report_version: 2,
    repository: { name: 'Example repository' },
    title: 'Ledger report',
    output: '../../ledger-report.html',
    fields: { class: '/class', security: '/security' },
    views,
  };
}

test('rejects a missing report configuration', async () => {
  await withTemporaryLedger(async (ledger) => {
    const report = await import('../src/report.js').catch(() => ({}));
    const result = typeof report.loadReportConfig === 'function'
      ? report.loadReportConfig(ledger)
      : Promise.resolve();

    await assert.rejects(result, { code: 'report-config-invalid' });
  });
});

test('rejects malformed report JSON', async () => {
  await withTemporaryLedger(async (ledger) => {
    const configDirectory = path.join(ledger, '.wowbagger');
    await mkdir(configDirectory);
    await writeFile(path.join(configDirectory, 'report.json'), '{', 'utf8');
    const { loadReportConfig } = await import('../src/report.js');

    await assert.rejects(loadReportConfig(ledger), { code: 'report-config-invalid' });
  });
});

test('rejects null and array report configuration roots', async () => {
  for (const value of [null, []]) {
    await withTemporaryLedger(async (ledger) => {
      await writeConfig(ledger, value);
      const { loadReportConfig } = await import('../src/report.js');

      await assert.rejects(loadReportConfig(ledger), { code: 'report-config-invalid' });
    });
  }
});

test('normalizes the minimum valid report configuration', async () => {
  await withTemporaryLedger(async (ledger) => {
    await writeConfig(ledger, {
      report_version: 1,
      repository: { name: 'Example repository' },
      title: 'Ledger report',
      output: '../../ledger-report.html',
    });
    const { loadReportConfig } = await import('../src/report.js');

    const config = await loadReportConfig(ledger);

    assert.deepEqual(config, {
      reportVersion: 1,
      repository: { name: 'Example repository', logo: null },
      title: 'Ledger report',
      outputPath: path.resolve(ledger, '..', 'ledger-report.html'),
      fields: {},
      swarm: null,
      view: null,
    });
  });
});

test('rejects missing or invalid required report values', async () => {
  const invalidConfigurations = [
    {},
    validConfig({ report_version: 2 }),
    validConfig({ repository: null }),
    validConfig({ repository: { name: '' } }),
    validConfig({ title: '' }),
    validConfig({ output: '' }),
  ];

  for (const value of invalidConfigurations) {
    await withTemporaryLedger(async (ledger) => {
      await writeConfig(ledger, value);
      const { loadReportConfig } = await import('../src/report.js');

      await assert.rejects(loadReportConfig(ledger), { code: 'report-config-invalid' });
    });
  }
});

test('rejects an unsupported logo extension', async () => {
  await withTemporaryLedger(async (ledger) => {
    await writeConfig(ledger, validConfig({
      repository: { name: 'Example repository', logo: 'mark.gif' },
    }));
    const { loadReportConfig } = await import('../src/report.js');

    await assert.rejects(loadReportConfig(ledger), { code: 'report-config-invalid' });
  });
});

test('rejects unknown keys at every report configuration level', async () => {
  const invalidConfigurations = [
    validConfig({ unexpected: true }),
    validConfig({ repository: { name: 'Example repository', unexpected: true } }),
    validConfig({ fields: { unexpected: '/data/value' } }),
    validConfig({
      fields: { area: '/data/area', complexity: '/data/complexity' },
      swarm: { eligible_complexities: ['small'], unexpected: true },
    }),
  ];

  for (const value of invalidConfigurations) {
    await withTemporaryLedger(async (ledger) => {
      await writeConfig(ledger, value);
      const { loadReportConfig } = await import('../src/report.js');

      await assert.rejects(loadReportConfig(ledger), { code: 'report-config-invalid' });
    });
  }
});

test('resolves RFC 6901 pointers against parsed frontmatter', async () => {
  const report = await import('../src/report.js');
  const frontmatter = {
    'a/b': { '~key': 42 },
    '': 'empty segment',
  };

  assert.equal(report.resolvePointer?.(frontmatter, '/a~1b/~0key'), 42);
  assert.equal(report.resolvePointer?.(frontmatter, '/'), 'empty segment');
  assert.equal(report.resolvePointer?.(frontmatter, '/missing'), undefined);
  assert.equal(report.resolvePointer?.(frontmatter, ''), frontmatter);
});

test('rejects invalid semantic field mappings', async () => {
  const invalidFields = [
    null,
    [],
    { area: '' },
    { area: 'data/area' },
    { area: '/data/~2area' },
    { area: 42 },
  ];

  for (const fields of invalidFields) {
    await withTemporaryLedger(async (ledger) => {
      await writeConfig(ledger, validConfig({ fields }));
      const { loadReportConfig } = await import('../src/report.js');

      await assert.rejects(loadReportConfig(ledger), { code: 'report-config-invalid' });
    });
  }
});

test('rejects invalid swarm configuration', async () => {
  const invalidConfigurations = [
    validConfig({ swarm: null }),
    validConfig({ swarm: [] }),
    validConfig({ swarm: {} }),
    validConfig({ swarm: { eligible_complexities: [] } }),
    validConfig({ swarm: { eligible_complexities: ['small', 'small'] } }),
    validConfig({ swarm: { eligible_complexities: [''] } }),
    validConfig({ swarm: { eligible_complexities: [42] } }),
    validConfig({
      fields: { area: '/data/area' },
      swarm: { eligible_complexities: ['small'] },
    }),
    validConfig({
      fields: { complexity: '/data/complexity' },
      swarm: { eligible_complexities: ['small'] },
    }),
  ];

  for (const value of invalidConfigurations) {
    await withTemporaryLedger(async (ledger) => {
      await writeConfig(ledger, value);
      const { loadReportConfig } = await import('../src/report.js');

      await assert.rejects(loadReportConfig(ledger), { code: 'report-config-invalid' });
    });
  }
});

test('rejects a report output inside the resolved ledger', async () => {
  await withTemporaryLedger(async (ledger) => {
    await writeConfig(ledger, validConfig({ output: '../report.html' }));
    const { loadReportConfig } = await import('../src/report.js');

    await assert.rejects(loadReportConfig(ledger), { code: 'report-config-invalid' });
  });
});

test('rejects an output symlink that resolves inside the ledger', async () => {
  await withTemporaryLedger(async (ledger) => {
    await linkDirectory(ledger, path.join(path.dirname(ledger), 'back-into-ledger'));
    await writeConfig(ledger, validConfig({ output: '../../back-into-ledger/report.html' }));
    const { loadReportConfig } = await import('../src/report.js');

    await assert.rejects(loadReportConfig(ledger), { code: 'report-config-invalid' });
  });
});

test('uses the CLI output override and resolves a configured logo', async () => {
  await withTemporaryLedger(async (ledger) => {
    const logoPath = path.join(ledger, '.wowbagger', 'mark.svg');
    await writeConfig(ledger, {
      report_version: 1,
      repository: { name: 'Example repository', logo: 'mark.svg' },
      title: 'Ledger report',
    });
    await writeFile(logoPath, '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const outputPath = path.join(path.dirname(ledger), 'override.html');
    const report = await import('../src/report.js');

    const config = await report.loadReportConfig(ledger, outputPath);

    assert.equal(config.outputPath, outputPath);
    assert.equal(config.repository.logo, logoPath);
    assert.match(await report.readLogoDataUrl(config.repository.logo), /^data:image\/svg\+xml;base64,/);
  });
});

test('accepts class-of-service and due-date field mappings', async () => {
  await withTemporaryLedger(async (ledger) => {
    await writeConfig(ledger, validConfig({ fields: { class: '/class', due: '/due' } }));
    const { loadReportConfig } = await import('../src/report.js');

    const config = await loadReportConfig(ledger);

    assert.deepEqual(config.fields, { class: '/class', due: '/due' });
  });
});

test('normalizes a selected version 2 report view', async () => {
  await withTemporaryLedger(async (ledger) => {
    await writeConfig(ledger, {
      report_version: 2,
      repository: { name: 'Example' },
      title: 'Base report',
      output: '../../base.html',
      fields: { area: '/area', class: '/class', security: '/security' },
      views: {
        'security-blockers': {
          title: 'Security blockers',
          output: '../../security.html',
          filters: {
            readiness: ['blocked'],
            status: ['backlog', 'in-progress'],
            kind: ['task'],
            fields: { class: ['bug'], security: ['high', 'critical'] },
          },
        },
      },
    });
    const { loadReportConfig } = await import('../src/report.js');

    const config = await loadReportConfig(ledger, undefined, 'security-blockers');

    assert.equal(config.reportVersion, 2);
    assert.equal(config.outputPath, path.resolve(ledger, '..', 'security.html'));
    assert.deepEqual(config.view, {
      name: 'security-blockers',
      title: 'Security blockers',
      outputPath: path.resolve(ledger, '..', 'security.html'),
      filters: {
        readiness: ['blocked'],
        status: ['backlog', 'in-progress'],
        kind: ['task'],
        fields: { class: ['bug'], security: ['high', 'critical'] },
      },
    });
  });
});

test('keeps version 1 report configuration byte-compatible', async () => {
  await withTemporaryLedger(async (ledger) => {
    await writeConfig(ledger, validConfig({
      fields: { area: '/area', complexity: '/complexity' },
      swarm: { eligible_complexities: ['small'] },
    }));
    const { loadReportConfig } = await import('../src/report.js');

    const config = await loadReportConfig(ledger);

    assert.deepEqual(config, {
      reportVersion: 1,
      repository: { name: 'Example repository', logo: null },
      title: 'Ledger report',
      outputPath: path.resolve(ledger, '..', 'ledger-report.html'),
      fields: { area: '/area', complexity: '/complexity' },
      swarm: { eligibleComplexities: ['small'] },
      view: null,
    });
  });
});

test('rejects named views under version 1 configuration', async () => {
  await withTemporaryLedger(async (ledger) => {
    await writeConfig(ledger, validConfig({
      views: {
        'security-blockers': {
          title: 'Security blockers',
          output: '../../security.html',
          filters: { kind: ['task'] },
        },
      },
    }));
    const { loadReportConfig } = await import('../src/report.js');

    await assert.rejects(loadReportConfig(ledger), { code: 'report-config-invalid' });
  });
});

test('rejects malformed report view names and excess views', async () => {
  const excessViews = Object.fromEntries(Array.from(
    { length: 65 },
    (_ignored, index) => [`view-${index}`, validView({ output: `../../view-${index}.html` })],
  ));
  const invalidViews = [
    { 'Security-blockers': validView() },
    { '1-security': validView() },
    { '': validView() },
    { security_blockers: validView() },
    { [`s${'x'.repeat(64)}`]: validView() },
    { '-security': validView() },
    excessViews,
  ];

  for (const views of invalidViews) {
    await withTemporaryLedger(async (ledger) => {
      await writeConfig(ledger, viewConfig(views));
      const { loadReportConfig } = await import('../src/report.js');

      await assert.rejects(loadReportConfig(ledger), { code: 'report-config-invalid' });
    });
  }
});

test('rejects empty duplicate or unknown built-in filter values', async () => {
  const invalidFilters = [
    {},
    { kind: [] },
    { kind: 'task' },
    { kind: ['task', 'task'] },
    { kind: ['story'] },
    { readiness: ['done'] },
    { readiness: [42] },
    { status: ['shipped'] },
    { status: ['backlog', 'backlog'] },
  ];

  for (const filters of invalidFilters) {
    await withTemporaryLedger(async (ledger) => {
      await writeConfig(ledger, viewConfig({ 'security-blockers': validView({ filters }) }));
      const { loadReportConfig } = await import('../src/report.js');

      await assert.rejects(loadReportConfig(ledger), { code: 'report-config-invalid' });
    });
  }
});

test('rejects mapped-field filters whose field is not configured', async () => {
  const invalidFilters = [
    { fields: { area: ['core'] } },
    { fields: { unexpected: ['value'] } },
    { fields: {} },
    { fields: [] },
    { kind: ['task'], fields: { area: ['core'] } },
  ];

  for (const filters of invalidFilters) {
    await withTemporaryLedger(async (ledger) => {
      await writeConfig(ledger, viewConfig({ 'security-blockers': validView({ filters }) }));
      const { loadReportConfig } = await import('../src/report.js');

      await assert.rejects(loadReportConfig(ledger), { code: 'report-config-invalid' });
    });
  }
});

test('rejects unknown view and filter members', async () => {
  const invalidViews = [
    { 'security-blockers': validView({ unexpected: true }) },
    { 'security-blockers': validView({ filters: { kind: ['task'], unexpected: ['value'] } }) },
    { 'security-blockers': validView({ filters: { title_contains: ['bug'] } }) },
  ];

  for (const views of invalidViews) {
    await withTemporaryLedger(async (ledger) => {
      await writeConfig(ledger, viewConfig(views));
      const { loadReportConfig } = await import('../src/report.js');

      await assert.rejects(loadReportConfig(ledger), { code: 'report-config-invalid' });
    });
  }
});

test('preserves scalar types when matching mapped-field filter values', async () => {
  const { matchesReportView } = await import('../src/report-view.js');
  const filters = { fields: { security: [1, true, 'high'] } };
  const itemWith = (fields) => ({
    kind: 'task',
    status: 'backlog',
    readiness: { state: 'ready' },
    fields,
  });

  assert.equal(matchesReportView(itemWith({ security: 1 }), filters), true);
  assert.equal(matchesReportView(itemWith({ security: true }), filters), true);
  assert.equal(matchesReportView(itemWith({ security: 'high' }), filters), true);
  assert.equal(matchesReportView(itemWith({ security: '1' }), filters), false);
  assert.equal(matchesReportView(itemWith({ security: 'true' }), filters), false);
  assert.equal(matchesReportView(itemWith({}), filters), false);
});

test('matches grouped view filters with OR inside and AND across groups', async () => {
  const { matchesReportView } = await import('../src/report-view.js');
  const filters = {
    readiness: ['blocked', 'ineligible'],
    status: ['backlog'],
    kind: ['task'],
    fields: { class: ['bug'] },
  };
  const itemWith = (overrides = {}) => ({
    kind: 'task',
    status: 'backlog',
    readiness: { state: 'blocked' },
    fields: { class: 'bug' },
    ...overrides,
  });

  assert.equal(matchesReportView(itemWith(), filters), true);
  assert.equal(matchesReportView(itemWith({ readiness: { state: 'ineligible' } }), filters), true);
  assert.equal(matchesReportView(itemWith({ readiness: { state: 'ready' } }), filters), false);
  assert.equal(matchesReportView(itemWith({ status: 'in-progress' }), filters), false);
  assert.equal(matchesReportView(itemWith({ kind: 'epic' }), filters), false);
  assert.equal(matchesReportView(itemWith({ fields: { class: 'feature' } }), filters), false);
  assert.equal(matchesReportView(itemWith({ kind: 'epic' }), { status: ['backlog'] }), true);
});

test('rejects a named view output inside the resolved ledger', async () => {
  await withTemporaryLedger(async (ledger) => {
    await writeConfig(ledger, viewConfig({
      'security-blockers': validView({ output: '../security.html' }),
    }));
    const { loadReportConfig } = await import('../src/report.js');

    await assert.rejects(loadReportConfig(ledger), { code: 'report-config-invalid' });
  });

  await withTemporaryLedger(async (ledger) => {
    await linkDirectory(ledger, path.join(path.dirname(ledger), 'back-into-ledger'));
    await writeConfig(ledger, viewConfig({
      'security-blockers': validView({ output: '../../back-into-ledger/security.html' }),
    }));
    const { loadReportConfig } = await import('../src/report.js');

    await assert.rejects(loadReportConfig(ledger), { code: 'report-config-invalid' });
  });
});

test('rejects colliding base and named output paths', async () => {
  const collidingViews = [
    { 'security-blockers': validView({ output: '../../ledger-report.html' }) },
    { 'security-blockers': validView({ output: './../../ledger-report.html' }) },
    {
      'security-blockers': validView({ output: '../../security.html' }),
      'stale-bugs': validView({ output: '../../security.html' }),
    },
  ];

  for (const views of collidingViews) {
    await withTemporaryLedger(async (ledger) => {
      await writeConfig(ledger, viewConfig(views));
      const { loadReportConfig } = await import('../src/report.js');

      await assert.rejects(loadReportConfig(ledger), { code: 'report-config-invalid' });
    });
  }

  await withTemporaryLedger(async (ledger) => {
    await linkDirectory(path.dirname(ledger), path.join(path.dirname(ledger), 'alias'));
    await writeConfig(ledger, viewConfig({
      'security-blockers': validView({ output: '../../alias/ledger-report.html' }),
    }));
    const { loadReportConfig } = await import('../src/report.js');

    await assert.rejects(loadReportConfig(ledger), { code: 'report-config-invalid' });
  });
});

test('accepts an output override without ignoring configured path validation', async () => {
  await withTemporaryLedger(async (ledger) => {
    await writeConfig(ledger, viewConfig({ 'security-blockers': validView() }));
    const overridePath = path.join(path.dirname(ledger), 'override.html');
    const { loadReportConfig } = await import('../src/report.js');

    const config = await loadReportConfig(ledger, overridePath, 'security-blockers');

    assert.equal(config.outputPath, overridePath);
    assert.equal(config.view.outputPath, path.resolve(ledger, '..', 'security.html'));
  });

  const invalidViews = [
    { 'security-blockers': validView({ output: '../../ledger-report.html' }) },
    { 'security-blockers': validView({ output: '../security.html' }) },
  ];

  for (const views of invalidViews) {
    await withTemporaryLedger(async (ledger) => {
      await writeConfig(ledger, viewConfig(views));
      const overridePath = path.join(path.dirname(ledger), 'override.html');
      const { loadReportConfig } = await import('../src/report.js');

      await assert.rejects(
        loadReportConfig(ledger, overridePath, 'security-blockers'),
        { code: 'report-config-invalid' },
      );
    });
  }
});

test('returns report-view-not-found for version 1 or an unknown name', async () => {
  await withTemporaryLedger(async (ledger) => {
    await writeConfig(ledger, validConfig());
    const { loadReportConfig } = await import('../src/report.js');

    await assert.rejects(loadReportConfig(ledger, undefined, 'security-blockers'), {
      code: 'report-view-not-found',
      details: { view: 'security-blockers' },
    });
  });

  for (const viewName of ['stale-bugs', 'constructor']) {
    await withTemporaryLedger(async (ledger) => {
      await writeConfig(ledger, viewConfig({ 'security-blockers': validView() }));
      const { loadReportConfig } = await import('../src/report.js');

      await assert.rejects(loadReportConfig(ledger, undefined, viewName), {
        code: 'report-view-not-found',
        details: { view: viewName },
      });
    });
  }

  await withTemporaryLedger(async (ledger) => {
    await writeConfig(ledger, viewConfig({ 'security-blockers': validView({ filters: {} }) }));
    const { loadReportConfig } = await import('../src/report.js');

    await assert.rejects(loadReportConfig(ledger, undefined, 'stale-bugs'), {
      code: 'report-config-invalid',
    });
  });
});

test('lists configured view criteria as grouped facet keys', async () => {
  const { reportViewCriteria } = await import('../src/report-view.js');

  assert.deepEqual(
    reportViewCriteria({
      kind: ['task'],
      readiness: ['blocked', 'ineligible'],
      fields: { class: ['bug'], security: ['high', 'critical'] },
    }),
    [
      { key: 'readiness', values: ['blocked', 'ineligible'] },
      { key: 'kind', values: ['task'] },
      { key: 'field:class', values: ['bug'] },
      { key: 'field:security', values: ['high', 'critical'] },
    ],
  );
  assert.deepEqual(
    reportViewCriteria({ status: ['backlog'] }),
    [{ key: 'status', values: ['backlog'] }],
  );
});

// A consumer never reads this repository: it reads the installed README, the
// installed contract, and the installed skill. The configuration example is
// executed rather than trusted, so documentation drift fails here instead of in
// a consumer's ledger.
test('documents named custom report views in the shipped configuration guidance', async () => {
  for (const [surface, text] of guidanceSurfaces()) {
    const prose = collapse(text);
    assert.match(prose, /report_version: 2/, surface);
    assert.match(prose, /\bviews\b/, surface);
    assert.match(prose, /security-blockers/, surface);
    assert.match(prose, /OR within one filter group; AND across groups/, surface);
  }

  const readme = readGuidance('README.md');
  const prose = collapse(readme);
  assert.match(prose, /\^\[a-z\]\[a-z0-9-\]\{0,63\}\$/, 'view name pattern');
  assert.match(prose, /at most 64 views/, 'view count bound');
  assert.match(prose, /exactly `title`, `output`, and `filters`/, 'exact view members');
  assert.match(prose, /[Uu]nknown members? fail closed/, 'unknown members fail closed');
  assert.match(prose, /at least one of `readiness`, `status`, `kind`, or `fields`/, 'one group required');
  assert.match(prose, /JSON scalar type/, 'typed mapped values');
  assert.match(prose, /stringification is not equality/, 'typed mapped values');
  assert.match(prose, /readiness against the complete ledger/, 'full-ledger readiness');
  assert.match(prose, /pairwise distinct/, 'output collision rule');
  assert.match(prose, /report-config-invalid/, 'collision refusal code');
  assert.match(prose, /outside the ledger/, 'output containment');
  assert.match(prose, /empty (matched )?subset/, 'empty subset success');
  assert.match(prose, /[Vv]ersion 1 configuration [^.]*unchanged/, 'version 1 compatibility');
  for (const section of [
    'statistics', 'Work next', 'Attention', 'graph', 'drill-down', 'terminal history',
  ]) {
    assert.ok(readme.includes(section), `README must say ${section} describes the subset`);
  }

  const documented = documentedViewConfig(readme);
  await withTemporaryLedger(async (ledger) => {
    await writeConfig(ledger, documented);
    const { loadReportConfig } = await import('../src/report.js');

    const config = await loadReportConfig(ledger, undefined, 'security-blockers');

    assert.equal(config.reportVersion, 2);
    assert.equal(config.view.name, 'security-blockers');
    assert.equal(config.view.title, documented.views['security-blockers'].title);
    assert.deepEqual(config.view.filters, documented.views['security-blockers'].filters);
  });
});
