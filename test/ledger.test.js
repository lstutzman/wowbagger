import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { lstat, open, readdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { loadLedger } from '../src/ledger.js';
import { runCli, withLedger } from './support.js';

test('loader contains a root lstat failure as a ledger error', async () => {
  await withLedger({}, async (ledger) => {
    const permissionDenied = new Error('simulated root permission failure');
    permissionDenied.code = 'EACCES';
    const fileSystem = {
      lstat: async () => { throw permissionDenied; },
      open,
      readdir,
    };

    const result = await loadLedger(ledger, fileSystem);

    assert.deepEqual(result, {
      items: [],
      errors: [{
        path: 'ledger',
        field: 'path',
        code: 'ledger-read-error',
        message: 'Ledger path could not be read.',
      }],
    });
  });
});

test('loader traverses an indeterminate directory entry after lstat classification', async () => {
  await withLedger({
    'nested/item.md': validItemSource(),
  }, async (ledger) => {
    const result = await loadLedger(ledger, fileSystemWithUnknownTypes(['nested']));

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.items.map((item) => item.path), ['ledger/nested/item.md']);
  });
});

test('loader rejects an indeterminate symbolic link even without a markdown name', async () => {
  await withLedger({
    'target.txt': 'not a ledger item',
  }, async (ledger) => {
    await symlink('target.txt', path.join(ledger, 'unknown-link'));

    const result = await loadLedger(ledger, fileSystemWithUnknownTypes(['unknown-link']));

    assert.deepEqual(result, {
      items: [],
      errors: [{
        path: 'ledger/unknown-link',
        field: 'path',
        code: 'symlink-not-allowed',
        message: 'Ledger entries must not be symbolic links.',
      }],
    });
  });
});

test('loader reads an indeterminate regular markdown file after lstat classification', async () => {
  await withLedger({
    'unknown.md': validItemSource(),
  }, async (ledger) => {
    const result = await loadLedger(ledger, fileSystemWithUnknownTypes(['unknown.md']));

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.items.map((item) => item.path), ['ledger/unknown.md']);
  });
});

test('loader reports an indeterminate entry when fallback lstat fails', async () => {
  await withLedger({
    'unknown-entry': 'not a ledger item',
  }, async (ledger) => {
    const failingLstat = async (entryPath) => {
      if (path.basename(entryPath) === 'unknown-entry') {
        const error = new Error('simulated lstat failure');
        error.code = 'EACCES';
        throw error;
      }
      return lstat(entryPath);
    };

    const result = await loadLedger(
      ledger,
      fileSystemWithUnknownTypes(['unknown-entry'], failingLstat),
    );

    assert.deepEqual(result, {
      items: [],
      errors: [{
        path: 'ledger/unknown-entry',
        field: 'path',
        code: 'ledger-read-error',
        message: 'Ledger path could not be read.',
      }],
    });
  });
});

test('validate rejects special filesystem entries with markdown names', async () => {
  await withLedger({}, async (ledger) => {
    execFileSync('mkfifo', [path.join(ledger, 'special.md')]);

    const result = runCli('validate', '--ledger', ledger, '--json');

    assert.equal(result.status, 1);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), {
      valid: false,
      errors: [{
        path: 'ledger/special.md',
        field: 'path',
        code: 'ledger-read-error',
        message: 'Ledger path could not be read.',
      }],
    });
  });
});

test('loader accumulates nested traversal failures as ledger errors', async () => {
  await withLedger({
    'nested/item.md': `---
schema_version: 1
id: wb_01KDWPVNG05FCBFC6R7R7CJANX
title: "Nested item"
kind: task
status: backlog
created: 2026-01-01
updated: 2026-01-01
provenance:
  source: "test"
  recorded_at: "2026-01-01T12:00:00Z"
depends_on: []
---
`,
  }, async (ledger) => {
    const fileSystem = {
      lstat,
      open,
      readdir: async (directory, options) => {
        if (path.basename(directory) === 'nested') {
          const error = new Error('simulated traversal failure');
          error.code = 'EACCES';
          throw error;
        }
        return readdir(directory, options);
      },
    };

    const result = await loadLedger(ledger, fileSystem);

    assert.deepEqual(result, {
      items: [],
      errors: [{
        path: 'ledger/nested',
        field: 'path',
        code: 'ledger-read-error',
        message: 'Ledger path could not be read.',
      }],
    });
  });
});

function fileSystemWithUnknownTypes(names, lstatImplementation = lstat) {
  const unknownNames = new Set(names);
  return {
    lstat: lstatImplementation,
    open,
    readdir: async (directory, options) => {
      const entries = await readdir(directory, options);
      return entries.map((entry) => unknownNames.has(entry.name) ? unknownDirent(entry.name) : entry);
    },
  };
}

function unknownDirent(name) {
  return {
    name,
    isSymbolicLink: () => false,
    isDirectory: () => false,
    isFile: () => false,
  };
}

function validItemSource() {
  return `---
schema_version: 1
id: wb_01KDWPVNG05FCBFC6R7R7CJANX
title: "Nested item"
kind: task
status: backlog
created: 2026-01-01
updated: 2026-01-01
provenance:
  source: "test"
  recorded_at: "2026-01-01T12:00:00Z"
depends_on: []
---
`;
}
