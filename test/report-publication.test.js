import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCli, withLedger } from './support.js';

async function withTemporaryDirectory(callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-report-write-'));
  try {
    return await callback(directory);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

test('atomically replaces the configured report', async () => {
  await withTemporaryDirectory(async (directory) => {
    const output = path.join(directory, 'report.html');
    await writeFile(output, 'old report', 'utf8');
    const { writeReportFile } = await import('../src/report.js');

    await writeReportFile(output, 'new report');

    assert.equal(await readFile(output, 'utf8'), 'new report');
    assert.deepEqual(await readdir(directory), ['report.html']);
  });
});

test('preserves the old report and removes its temporary file when rename fails', async () => {
  await withTemporaryDirectory(async (directory) => {
    const output = path.join(directory, 'report.html');
    await writeFile(output, 'old report', 'utf8');
    const { writeReportFile } = await import('../src/report.js');

    await assert.rejects(
      writeReportFile(output, 'new report', {
        rename: async () => {
          const error = new Error('injected rename failure');
          error.code = 'EIO';
          throw error;
        },
      }),
      { code: 'report-write-failed' },
    );

    assert.equal(await readFile(output, 'utf8'), 'old report');
    assert.deepEqual(await readdir(directory), ['report.html']);
  });
});

test('preserves the old report and removes its temporary file when writing fails', async () => {
  await withTemporaryDirectory(async (directory) => {
    const output = path.join(directory, 'report.html');
    await writeFile(output, 'old report', 'utf8');
    const { writeReportFile } = await import('../src/report.js');

    await assert.rejects(
      writeReportFile(output, 'new report', {
        open: async (...argumentsList) => {
          const { open } = await import('node:fs/promises');
          const handle = await open(...argumentsList);
          return {
            close: () => handle.close(),
            sync: () => handle.sync(),
            writeFile: async () => {
              const error = new Error('injected write failure');
              error.code = 'EIO';
              throw error;
            },
          };
        },
      }),
      { code: 'report-write-failed' },
    );

    assert.equal(await readFile(output, 'utf8'), 'old report');
    assert.deepEqual(await readdir(directory), ['report.html']);
  });
});

test('preserves the old report and removes its temporary file when closing fails', async () => {
  await withTemporaryDirectory(async (directory) => {
    const output = path.join(directory, 'report.html');
    await writeFile(output, 'old report', 'utf8');
    const { writeReportFile } = await import('../src/report.js');

    await assert.rejects(
      writeReportFile(output, 'new report', {
        open: async (...argumentsList) => {
          const { open } = await import('node:fs/promises');
          const handle = await open(...argumentsList);
          let closeCalls = 0;
          return {
            close: async () => {
              closeCalls += 1;
              if (closeCalls === 1) {
                const error = new Error('injected close failure');
                error.code = 'EIO';
                throw error;
              }
              await handle.close();
            },
            sync: () => handle.sync(),
            writeFile: (...writeArguments) => handle.writeFile(...writeArguments),
          };
        },
      }),
      { code: 'report-write-failed' },
    );

    assert.equal(await readFile(output, 'utf8'), 'old report');
    assert.deepEqual(await readdir(directory), ['report.html']);
  });
});

test('reports a leftover temporary artifact when cleanup fails', async () => {
  await withTemporaryDirectory(async (directory) => {
    const output = path.join(directory, 'report.html');
    await writeFile(output, 'old report', 'utf8');
    const { writeReportFile } = await import('../src/report.js');
    let publicationError;

    try {
      await writeReportFile(output, 'new report', {
        rename: async () => {
          const error = new Error('injected rename failure');
          error.code = 'EIO';
          throw error;
        },
        rm: async () => {
          const error = new Error('injected cleanup failure');
          error.code = 'EPERM';
          throw error;
        },
      });
    } catch (error) {
      publicationError = error;
    }

    assert.equal(publicationError?.code, 'report-write-failed');
    assert.equal(publicationError?.details?.cause, 'EIO');
    assert.equal(publicationError?.details?.cleanup_cause, 'EPERM');
    assert.match(publicationError?.details?.leftover_artifact, /\.report\.html\..+\.tmp$/);
    assert.equal(await readFile(output, 'utf8'), 'old report');
    assert.deepEqual((await readdir(directory)).sort(), [
      path.basename(publicationError.details.leftover_artifact),
      'report.html',
    ].sort());
  });
});

test('uses the normal rename implementation when an unrelated hook is overridden', async () => {
  await withTemporaryDirectory(async (directory) => {
    const output = path.join(directory, 'report.html');
    const { writeReportFile } = await import('../src/report.js');

    await writeReportFile(output, 'report', { rename });

    assert.equal(await readFile(output, 'utf8'), 'report');
  });
});

// Every named-view refusal is judged before publication, so the report already
// at the selected path is the one that must survive. These cases drive the CLI
// because the guarantee belongs to the command, not to the writer.
const sentinel = '<!doctype html><title>previous report</title>';
const viewItem = [
  '---',
  'schema_version: 1',
  'id: wb_01Q45X474NEEEEEEEEEEEEEEEE',
  'title: "Publication view item"',
  'kind: task',
  'status: backlog',
  'created: 2030-01-10',
  'updated: 2030-01-10',
  'provenance:',
  '  source: "fixture/report"',
  '  recorded_at: "2030-01-10T12:34:56.789Z"',
  'depends_on: []',
  'related: []',
  'class: bug',
  '---',
  '',
  '# Body',
].join('\n');

async function refusedNamedView(config, viewName, outputRelativePath) {
  return await withLedger({
    'wb_01Q45X474NEEEEEEEEEEEEEEEE.md': viewItem,
    '.wowbagger/report.json': JSON.stringify(config),
  }, async (ledger) => {
    const output = path.resolve(ledger, '..', outputRelativePath);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, sentinel, 'utf8');

    const result = runCli(
      'report', '--ledger', ledger, '--view', viewName, '--as-of', '2030-01-15', '--json',
    );

    return {
      status: result.status,
      code: JSON.parse(result.stdout).error.code,
      output: await readFile(output, 'utf8'),
    };
  });
}

function viewConfiguration(views, fields = { class: '/class' }) {
  return {
    report_version: 2,
    repository: { name: 'Example repository' },
    title: 'Ledger report',
    output: '../../report.html',
    fields,
    views,
  };
}

test('preserves the selected report when the named view is unknown', async () => {
  const refusal = await refusedNamedView(
    viewConfiguration({
      'security-blockers': {
        title: 'Security bugs',
        output: '../../reports/security-blockers.html',
        filters: { fields: { class: ['bug'] } },
      },
    }),
    'performance',
    'reports/security-blockers.html',
  );

  assert.equal(refusal.status, 2);
  assert.equal(refusal.code, 'report-view-not-found');
  assert.equal(refusal.output, sentinel);
});

test('preserves the selected report when a named view filters an unmapped field', async () => {
  const refusal = await refusedNamedView(
    viewConfiguration({
      'security-blockers': {
        title: 'Security bugs',
        output: '../../reports/security-blockers.html',
        filters: { fields: { security: ['high'] } },
      },
    }),
    'security-blockers',
    'reports/security-blockers.html',
  );

  assert.equal(refusal.status, 2);
  assert.equal(refusal.code, 'report-config-invalid');
  assert.equal(refusal.output, sentinel);
});

test('preserves the selected report when a named view collides with the base output', async () => {
  const refusal = await refusedNamedView(
    viewConfiguration({
      'security-blockers': {
        title: 'Security bugs',
        output: '../../report.html',
        filters: { fields: { class: ['bug'] } },
      },
    }),
    'security-blockers',
    'report.html',
  );

  assert.equal(refusal.status, 2);
  assert.equal(refusal.code, 'report-config-invalid');
  assert.equal(refusal.output, sentinel);
});
