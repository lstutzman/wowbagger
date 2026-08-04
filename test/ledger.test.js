import assert from 'node:assert/strict';
import { lstat, open, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { loadLedger } from '../src/ledger.js';
import { withLedger } from './support.js';

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
