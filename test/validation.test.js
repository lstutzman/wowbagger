import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runCli, withLedger } from './support.js';

const invalidFixtureLedger = fileURLToPath(
  new URL('../spec/fixtures/validation-errors/ledger', import.meta.url),
);
const expectedFixtureErrors = JSON.parse(readFileSync(
  new URL('../spec/fixtures/validation-errors/expected-errors.json', import.meta.url),
));

test('validate rejects a status outside schema version 1', async () => {
  await withLedger({
    'item.md': `---
schema_version: 1
id: wb_01KDWPVNG05FCBFC6R7R7CJANX
title: "Unknown lifecycle"
kind: task
status: paused
created: 2026-01-01
updated: 2026-01-01
provenance:
  source: "test"
  recorded_at: "2026-01-01T12:00:00Z"
depends_on: []
---
`,
  }, async (ledger) => {
    const result = runCli('validate', '--ledger', ledger, '--json');

    assert.equal(result.status, 1);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), {
      valid: false,
      errors: [{
        path: 'ledger/item.md',
        field: 'status',
        code: 'unknown-status',
        message: 'Status paused is not one of the schema version 1 statuses.',
      }],
    });
  });
});

test('validate rejects duplicate YAML mapping keys', async () => {
  await withLedger({
    'item.md': `---
schema_version: 1
id: wb_01KDWPVNG05FCBFC6R7R7CJANX
title: "First title"
title: "Overwritten title"
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
    const result = runCli('validate', '--ledger', ledger, '--json');

    assert.equal(result.status, 1);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), {
      valid: false,
      errors: [{
        path: 'ledger/item.md',
        field: 'frontmatter',
        code: 'duplicate-yaml-key',
        message: 'YAML mapping keys must be unique.',
      }],
    });
  });
});

test('validate matches the normative invalid-ledger fixture', () => {
  const result = runCli('validate', '--ledger', invalidFixtureLedger, '--json');

  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), expectedFixtureErrors);
});
