import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { symlink } from 'node:fs/promises';
import path from 'node:path';
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

test('validate fails closed instead of following a ledger symbolic link', async () => {
  await withLedger({
    'real.md': `---
schema_version: 1
id: wb_01KDWPVNG05FCBFC6R7R7CJANX
title: "Real item"
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
    await symlink('real.md', path.join(ledger, 'linked.md'));
    const result = runCli('validate', '--ledger', ledger, '--json');

    assert.equal(result.status, 1);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), {
      valid: false,
      errors: [{
        path: 'ledger/linked.md',
        field: 'path',
        code: 'symlink-not-allowed',
        message: 'Ledger entries must not be symbolic links.',
      }],
    });
  });
});

test('validate reports malformed YAML with a stable diagnostic', async () => {
  await withLedger({
    'item.md': `---
schema_version: 1
id: [
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
        code: 'invalid-yaml',
        message: 'Frontmatter contains invalid YAML.',
      }],
    });
  });
});

test('validate suppresses rollup diagnostics when an epic terminal date is missing', async () => {
  await withLedger({
    'item.md': `---
schema_version: 1
id: wb_01KDWPVNG05FCBFC6R7R7CJANX
title: "Incomplete epic transition"
kind: epic
status: done
created: 2026-01-01
updated: 2026-01-02
provenance:
  source: "test"
  recorded_at: "2026-01-01T12:00:00Z"
depends_on: []
decisions:
  - action: complete
    date: 2026-01-02
    summary: "Attempted completion."
    rationale: "This intentionally omits the terminal date."
    rollup: []
---
`,
  }, async (ledger) => {
    const result = runCli('validate', '--ledger', ledger, '--json');

    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stdout), {
      valid: false,
      errors: [{
        path: 'ledger/item.md',
        field: 'completed',
        code: 'missing-terminal-date',
        message: 'Status done requires completed and forbids killed and archived.',
      }],
    });
  });
});
