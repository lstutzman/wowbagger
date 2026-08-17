import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { linkDirectory } from './support.js';

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
