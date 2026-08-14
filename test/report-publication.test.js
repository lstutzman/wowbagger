import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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
