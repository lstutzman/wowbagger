import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli, withLedger } from './support.js';

const runner = fileURLToPath(new URL('./mutation-runner.js', import.meta.url));

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

// A failure before publication is a different fact from a failed publication,
// and a caller can only act on the difference if the envelope carries it. These
// two cases drive the CLI through the exact conditions that used to collapse
// into a causeless `report-write-failed`.
test('classifies an unresolvable output path as a read failure and publishes nothing', async () => {
  await withLedger({
    'wb_01Q45X474NEEEEEEEEEEEEEEEE.md': viewItem,
    '.wowbagger/report.json': JSON.stringify({
      report_version: 1,
      repository: { name: 'Example repository' },
      title: 'Ledger report',
      output: '../../report.html',
    }),
  }, async (ledger) => {
    const root = path.dirname(ledger);
    const blocker = path.join(root, 'not-a-directory');
    await writeFile(blocker, 'occupied', 'utf8');
    const override = path.join(blocker, 'report.html');

    const result = runCli(
      'report', '--ledger', ledger, '--out', override, '--as-of', '2030-01-15', '--json',
    );

    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: false,
      command: 'report',
      contract_version: 5,
      error: {
        code: 'report-read-failed',
        message: 'A report input could not be read.',
        details: { operation: 'resolve-output-path', path: override, cause: 'ENOTDIR' },
      },
    });
    assert.equal(await readFile(blocker, 'utf8'), 'occupied');
    await assert.rejects(readFile(path.join(root, 'report.html'), 'utf8'), { code: 'ENOENT' });
  });
});

// An error no report path throws on purpose is only reachable through the
// fixture scenario, so the catch-all classification is executed rather than
// trusted. The cause is the error's own kind and nothing else: a message can
// carry a path or a credential, so it never reaches the envelope.
test('names a bounded cause for an unexpected report failure and publishes nothing', async () => {
  await withLedger({
    'wb_01Q45X474NEEEEEEEEEEEEEEEE.md': viewItem,
    '.wowbagger/report.json': JSON.stringify({
      report_version: 1,
      repository: { name: 'Example repository' },
      title: 'Ledger report',
      output: '../../report.html',
    }),
  }, async (ledger) => {
    const output = path.join(path.dirname(ledger), 'report.html');
    await writeFile(output, sentinel, 'utf8');

    const result = spawnSync(
      process.execPath,
      [runner, 'report', '--ledger', ledger, '--as-of', '2030-01-15', '--json'],
      { encoding: 'utf8', env: { ...process.env, WOWBAGGER_TEST_SCENARIO: 'report-render-fails' } },
    );

    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: false,
      command: 'report',
      contract_version: 5,
      error: {
        code: 'report-write-failed',
        message: 'The report could not be published.',
        details: { operation: 'publish-report', cause: 'TypeError' },
      },
    });
    assert.equal(await readFile(output, 'utf8'), sentinel);
    assert.deepEqual(
      (await readdir(path.dirname(output))).filter((entry) => entry.endsWith('.tmp')),
      [],
    );
  });
});

// A publication failure the runtime gave no code for still has to name a cause,
// and the message is not it: a message carries the paths and values that made
// the failure, and the envelope publishes the details verbatim.
test('names the error kind, never its message, when a publication failure carries no code', async () => {
  await withTemporaryDirectory(async (directory) => {
    const output = path.join(directory, 'report.html');
    await writeFile(output, 'old report', 'utf8');
    const { writeReportFile } = await import('../src/report.js');
    let publicationError;

    try {
      await writeReportFile(output, 'new report', {
        rename: async () => {
          throw new Error(`injected failure for /secret/token-abc123 at ${output}`);
        },
      });
    } catch (error) {
      publicationError = error;
    }

    assert.equal(publicationError?.code, 'report-write-failed');
    assert.deepEqual(publicationError?.details, { cause: 'Error' });
    assert.equal(await readFile(output, 'utf8'), 'old report');
    assert.deepEqual(await readdir(directory), ['report.html']);
  });
});
