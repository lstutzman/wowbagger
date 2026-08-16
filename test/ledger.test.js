import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { lstat, open, readdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
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

test('validate rejects an item outside the committed items-directory layout', async () => {
  await withLedger({
    '.wowbagger/layout.json': '{"layout_version":1,"items_directory":"items"}\n',
    'items/.keep': '',
    'outside.md': validItemSource(),
  }, async (ledger) => {
    const result = runCli('validate', '--ledger', ledger, '--json');

    assert.equal(result.status, 1);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), {
      valid: false,
      errors: [{
        path: 'ledger/outside.md',
        field: 'path',
        code: 'item-outside-layout',
        message: 'Ledger item ledger/outside.md is outside the configured items directory; the committed layout expects it at ledger/items/outside.md.',
        expected_path: 'ledger/items/outside.md',
        remediation: 'Move ledger/outside.md to ledger/items/outside.md, stage the move with git add, commit it, then run claim-verify.',
      }],
    });
  });
});

test('validate fails closed for a malformed item-layout configuration', async () => {
  await withLedger({
    '.wowbagger/layout.json': '{"layout_version":1,',
    'item.md': validItemSource(),
  }, async (ledger) => {
    const result = runCli('validate', '--ledger', ledger, '--json');

    assert.equal(result.status, 1);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), {
      valid: false,
      errors: [{
        path: 'ledger/.wowbagger/layout.json',
        field: 'layout',
        code: 'item-layout-invalid',
        message: 'Item layout must select the version 1 items directory.',
      }],
    });
  });
});

test('validate rejects a metadata-directory alias in the item layout', async () => {
  await withLedger({
    '.wowbagger/layout.json': '{"layout_version":1,"items_directory":".WOWBAGGER/items"}\n',
  }, async (ledger) => {
    const result = runCli('validate', '--ledger', ledger, '--json');

    assert.equal(result.status, 1);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), {
      valid: false,
      errors: [{
        path: 'ledger/.wowbagger/layout.json',
        field: 'layout',
        code: 'item-layout-invalid',
        message: 'Item layout must select the version 1 items directory.',
      }],
    });
  });
});


test('validate fails closed for a symbolic metadata directory', async () => {
  await withLedger({
    '.config/layout.json': '{"layout_version":1,"items_directory":"items"}\n',
    'items/.keep': '',
  }, async (ledger) => {
    await symlink('.config', path.join(ledger, '.wowbagger'));

    const result = runCli('validate', '--ledger', ledger, '--json');

    assert.equal(result.status, 1);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), {
      valid: false,
      errors: [{
        path: 'ledger/.wowbagger',
        field: 'path',
        code: 'symlink-not-allowed',
        message: 'Ledger entries must not be symbolic links.',
      }],
    });
  });
});

test('validate rejects a symbolic item-layout configuration', async () => {
  await withLedger({
    '.wowbagger/layout-target.json': '{"layout_version":1,"items_directory":"items"}\n',
    'items/.keep': '',
  }, async (ledger) => {
    await symlink('layout-target.json', path.join(ledger, '.wowbagger', 'layout.json'));

    const result = runCli('validate', '--ledger', ledger, '--json');

    assert.equal(result.status, 1);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), {
      valid: false,
      errors: [{
        path: 'ledger/.wowbagger/layout.json',
        field: 'path',
        code: 'ledger-read-error',
        message: 'Ledger path could not be read.',
      }],
    });
  });
});

test('validate rejects a special item-layout configuration without blocking', async () => {
  await withLedger({
    '.wowbagger/.keep': '',
  }, async (ledger) => {
    execFileSync('mkfifo', [path.join(ledger, '.wowbagger', 'layout.json')]);

    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL('../bin/wowbagger.js', import.meta.url)),
      'validate', '--ledger', ledger, '--json',
    ], { encoding: 'utf8', timeout: 750 });

    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), {
      valid: false,
      errors: [{
        path: 'ledger/.wowbagger/layout.json',
        field: 'path',
        code: 'ledger-read-error',
        message: 'Ledger path could not be read.',
      }],
    });
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

test('lock metadata directory follows ordinary fail-closed ledger traversal without blocking', async () => {
  await withLedger({
    '.wowbagger-locks/hidden.md': 'not frontmatter\n',
    '.wowbagger-locks/ordinary.lock': '{"writer_id":"ordinary"}\n',
  }, async (ledger) => {
    const lockDirectory = path.join(ledger, '.wowbagger-locks');
    await symlink('ordinary.lock', path.join(lockDirectory, 'linked.lock'));
    execFileSync('mkfifo', [path.join(lockDirectory, 'special.lock')]);

    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL('../bin/wowbagger.js', import.meta.url)),
      'validate', '--ledger', ledger, '--json',
    ], { encoding: 'utf8', timeout: 750 });

    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), {
      valid: false,
      errors: [
        {
          path: 'ledger/.wowbagger-locks/hidden.md',
          field: 'frontmatter',
          code: 'malformed-frontmatter',
          message: 'Item must begin with one YAML frontmatter document delimited by --- lines.',
        },
        {
          path: 'ledger/.wowbagger-locks/linked.lock',
          field: 'path',
          code: 'symlink-not-allowed',
          message: 'Ledger entries must not be symbolic links.',
        },
      ],
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
