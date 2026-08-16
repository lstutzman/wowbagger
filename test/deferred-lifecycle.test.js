import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { runCli, withLedger } from './support.js';

// Test the deferred status lifecycle: backlog -> deferred -> backlog
// These tests verify:
// 1. Transition to deferred writes the deferred date field
// 2. Transition from deferred to backlog removes it
// 3. Ready excludes deferred items
// 4. Validation enforces deferred date requirements

// ULIDs that work with validation (26 chars after wb_):
// wb_01KZMFG500A234567890123456 -> 2026-08-10
// wb_01KZQ1WW00A234567890123456 -> 2026-08-11
// wb_01KZQ1WW00B234567890123456 -> 2026-08-11
// wb_01KWDFKD00A234567890123456 -> 2026-07-01

test('transition from backlog to deferred writes the deferred date field', async () => {
  const source = `---
schema_version: 2
id: wb_01KZQ1WW00A234567890123456
number: 1
title: "Deferred task test"
kind: task
status: backlog
created: 2026-08-11
updated: 2026-08-11
provenance:
  source: "test"
  recorded_at: "2026-08-11T12:00:00Z"
depends_on: []
related: []
---

Test body.
`;

  const id = 'wb_01KZQ1WW00A234567890123456';
  const request = {
    id,
    expected_revision: null,
    to_status: 'deferred',
    date: '2026-08-11',
    decision: {
      summary: 'Deferred pending other work.',
      rationale: 'Waiting for item 22 and dogfood proof.',
    },
  };

  await withLedger({ [`${id}.md`]: source }, async (ledger) => {
    // First read to get the revision
    const inspectResult = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
    assert.equal(inspectResult.status, 0, inspectResult.stderr);
    const inspect = JSON.parse(inspectResult.stdout);
    request.expected_revision = inspect.result.item.revision;

    // Write request and run transition
    const requestPath = path.join(path.dirname(ledger), 'transition.json');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(requestPath, JSON.stringify(request));

    const result = runCli('transition', '--ledger', ledger, '--input', requestPath, '--json');
    assert.equal(result.status, 0, result.stderr);

    // Read the resulting item and verify deferred date is present
    const itemPath = path.join(ledger, `${id}.md`);
    const itemContent = await readFile(itemPath, 'utf8');

    // The deferred date field must be in the frontmatter
    assert.match(itemContent, /^deferred: 2026-08-11$/m,
      'Deferred date field must be written to frontmatter');
    assert.match(itemContent, /^status: deferred$/m,
      'Status must be deferred');
  });
});

test('transition from deferred to backlog removes the deferred date field', async () => {
  // Create a deferred item with the deferred date already set
  const source = `---
schema_version: 2
id: wb_01KZMFG500A234567890123456
number: 2
title: "Undefer task test"
kind: task
status: deferred
created: 2026-08-10
updated: 2026-08-11
deferred: 2026-08-11
provenance:
  source: "test"
  recorded_at: "2026-08-10T12:00:00Z"
depends_on: []
related: []
decisions:
  - action: defer
    date: 2026-08-11
    summary: "Deferred pending other work."
    rationale: "Waiting for item 22."
---

Test body.
`;

  const id = 'wb_01KZMFG500A234567890123456';
  const request = {
    id,
    expected_revision: null,
    to_status: 'backlog',
    date: '2026-08-12',
    decision: {
      summary: 'Resumed work.',
      rationale: 'Ready to proceed.',
    },
  };

  await withLedger({ [`${id}.md`]: source }, async (ledger) => {
    // Get revision
    const inspectResult = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
    assert.equal(inspectResult.status, 0, inspectResult.stderr);
    const inspect = JSON.parse(inspectResult.stdout);
    request.expected_revision = inspect.result.item.revision;

    // Run transition
    const requestPath = path.join(path.dirname(ledger), 'transition.json');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(requestPath, JSON.stringify(request));

    const result = runCli('transition', '--ledger', ledger, '--input', requestPath, '--json');
    assert.equal(result.status, 0, result.stderr);

    // Read the resulting item
    const itemPath = path.join(ledger, `${id}.md`);
    const itemContent = await readFile(itemPath, 'utf8');

    // The deferred date field must NOT be present
    assert.doesNotMatch(itemContent, /^deferred:/m,
      'Deferred date field must be removed on undefer');
    assert.match(itemContent, /^status: backlog$/m,
      'Status must be backlog');
  });
});

test('ready excludes deferred items', async () => {
  // Create one backlog item and one deferred item
  const backlogItem = `---
schema_version: 2
id: wb_01KZQ1WW00A234567890123456
number: 3
title: "Ready task"
kind: task
status: backlog
created: 2026-08-11
updated: 2026-08-11
provenance:
  source: "test"
  recorded_at: "2026-08-11T12:00:00Z"
depends_on: []
related: []
---

Should be in ready.
`;

  const deferredItem = `---
schema_version: 2
id: wb_01KZQ1WW00B234567890123456
number: 4
title: "Deferred task"
kind: task
status: deferred
created: 2026-08-11
updated: 2026-08-11
deferred: 2026-08-11
provenance:
  source: "test"
  recorded_at: "2026-08-11T12:00:00Z"
depends_on: []
related: []
decisions:
  - action: defer
    date: 2026-08-11
    summary: "Deferred"
    rationale: "Test"
---

Should NOT be in ready.
`;

  await withLedger({
    'ready.md': backlogItem,
    'deferred.md': deferredItem,
  }, async (ledger) => {
    const result = runCli('ready', '--ledger', ledger, '--as-of', '2026-08-11');
    assert.equal(result.status, 0, result.stderr);

    // Should include the backlog item (ready shows title, not ID)
    assert.match(result.stdout, /Ready task/,
      'Backlog item should be in ready queue');

    // Should NOT include the deferred item
    assert.doesNotMatch(result.stdout, /Deferred task/,
      'Deferred item should NOT be in ready queue');
  });
});

test('validate rejects deferred status without deferred date field', async () => {
  const invalidItem = `---
schema_version: 2
id: wb_01KWDFKD00C234567890123456
number: 5
title: "Invalid deferred"
kind: task
status: deferred
created: 2026-07-01
updated: 2026-07-01
provenance:
  source: "test"
  recorded_at: "2026-07-01T12:00:00Z"
depends_on: []
related: []
---

Missing deferred date field.
`;

  await withLedger({ 'item.md': invalidItem }, async (ledger) => {
    const result = runCli('validate', '--ledger', ledger, '--json');
    assert.equal(result.status, 1, result.stderr);

    const validation = JSON.parse(result.stdout);
    assert.equal(validation.valid, false);

    // Should have missing-terminal-date error
    const hasError = validation.errors.some((e) =>
      e.code === 'missing-terminal-date' && e.field === 'deferred'
    );
    assert.equal(hasError, true, 'Should have missing-terminal-date error for deferred');
  });
});

test('validate rejects non-deferred status with deferred date field', async () => {
  const invalidItem = `---
schema_version: 2
id: wb_01KWDFKD00D234567890123456
number: 6
title: "Invalid with deferred field"
kind: task
status: backlog
created: 2026-07-01
updated: 2026-07-01
deferred: 2026-07-01
provenance:
  source: "test"
  recorded_at: "2026-07-01T12:00:00Z"
depends_on: []
related: []
---

Has deferred field but not deferred status.
`;

  await withLedger({ 'item.md': invalidItem }, async (ledger) => {
    const result = runCli('validate', '--ledger', ledger, '--json');
    assert.equal(result.status, 1, result.stderr);

    const validation = JSON.parse(result.stdout);
    assert.equal(validation.valid, false);

    // Should have terminal-date-not-allowed error
    const hasError = validation.errors.some((e) =>
      e.code === 'terminal-date-not-allowed' && e.field === 'deferred'
    );
    assert.equal(hasError, true, 'Should have terminal-date-not-allowed error');
  });
});

test('transition from deferred to in-progress is rejected', async () => {
  // Create a deferred item
  const source = `---
schema_version: 2
id: wb_01KZMFG500B234567890123456
number: 7
title: "Deferred item"
kind: task
status: deferred
created: 2026-08-10
updated: 2026-08-11
deferred: 2026-08-11
provenance:
  source: "test"
  recorded_at: "2026-08-10T12:00:00Z"
depends_on: []
related: []
decisions:
  - action: defer
    date: 2026-08-11
    summary: "Deferred"
    rationale: "Test"
---

Test body.
`;

  const id = 'wb_01KZMFG500B234567890123456';
  const request = {
    id,
    expected_revision: null,
    to_status: 'in-progress',
    date: '2026-08-12',
    decision: {
      summary: 'Should fail',
      rationale: 'Cannot transition directly from deferred to in-progress',
    },
  };

  await withLedger({ [`${id}.md`]: source }, async (ledger) => {
    // Get revision
    const inspectResult = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
    assert.equal(inspectResult.status, 0, inspectResult.stderr);
    const inspect = JSON.parse(inspectResult.stdout);
    request.expected_revision = inspect.result.item.revision;

    // Try to transition - should fail
    const requestPath = path.join(path.dirname(ledger), 'transition.json');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(requestPath, JSON.stringify(request));

    const result = runCli('transition', '--ledger', ledger, '--input', requestPath, '--json');
    assert.notEqual(result.status, 0, 'Transition should be rejected');

    const response = JSON.parse(result.stdout);
    assert.equal(response.ok, false);
    // The transition fails with precondition-failed and invalid-edge code
    assert.equal(response.error.details.issues?.[0]?.code, 'invalid-edge',
      'Should reject with invalid-edge');
  });
});

test('transition from deferred to backlog without decision is rejected', async () => {
  const source = `---
schema_version: 2
id: wb_01KZMFG500C234567890123456
number: 8
title: "Deferred item no decision"
kind: task
status: deferred
created: 2026-08-10
updated: 2026-08-11
deferred: 2026-08-11
provenance:
  source: "test"
  recorded_at: "2026-08-10T12:00:00Z"
depends_on: []
related: []
decisions:
  - action: defer
    date: 2026-08-11
    summary: "Deferred"
    rationale: "Test"
---

Test body.
`;

  const id = 'wb_01KZMFG500C234567890123456';
  const request = {
    id,
    expected_revision: null,
    to_status: 'backlog',
    date: '2026-08-12',
    // No decision - should be rejected
  };

  await withLedger({ [`${id}.md`]: source }, async (ledger) => {
    // Get revision
    const inspectResult = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
    assert.equal(inspectResult.status, 0, inspectResult.stderr);
    const inspect = JSON.parse(inspectResult.stdout);
    request.expected_revision = inspect.result.item.revision;

    // Try to transition without decision - should fail
    const requestPath = path.join(path.dirname(ledger), 'transition.json');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(requestPath, JSON.stringify(request));

    const result = runCli('transition', '--ledger', ledger, '--input', requestPath, '--json');
    assert.notEqual(result.status, 0, 'Transition without decision should be rejected');

    const response = JSON.parse(result.stdout);
    assert.equal(response.ok, false);
    // The transition fails with invalid-value for decision
    assert.equal(response.error.details.issues?.[0]?.code, 'invalid-value',
      'Should require decision field');
  });
});

test('validate rejects deferred item when deferred date does not match updated', async () => {
  const invalidItem = `---
schema_version: 2
id: wb_01KZMFG500D234567890123456
number: 9
title: "Mismatch deferred date"
kind: task
status: deferred
created: 2026-08-10
updated: 2026-08-12
deferred: 2026-08-11
provenance:
  source: "test"
  recorded_at: "2026-08-10T12:00:00Z"
depends_on: []
related: []
decisions:
  - action: defer
    date: 2026-08-11
    summary: "Deferred"
    rationale: "Test"
---

Test body.
`;

  await withLedger({ 'item.md': invalidItem }, async (ledger) => {
    const result = runCli('validate', '--ledger', ledger, '--json');
    assert.equal(result.status, 1, result.stderr);

    const validation = JSON.parse(result.stdout);
    assert.equal(validation.valid, false);

    // Should have terminal-date-must-match-updated error
    const hasError = validation.errors.some((e) =>
      e.code === 'terminal-date-must-match-updated' && e.field === 'deferred'
    );
    assert.equal(hasError, true, 'Should have terminal-date-must-match-updated error');
  });
});

test('validate rejects deferred item without matching defer decision', async () => {
  const invalidItem = `---
schema_version: 2
id: wb_01KZMFG500E234567890123456
number: 10
title: "Missing defer decision"
kind: task
status: deferred
created: 2026-08-10
updated: 2026-08-11
deferred: 2026-08-11
provenance:
  source: "test"
  recorded_at: "2026-08-10T12:00:00Z"
depends_on: []
related: []
decisions:
  - action: some_other_action
    date: 2026-08-11
    summary: "Not a defer decision"
    rationale: "Wrong"
---

Test body.
`;

  await withLedger({ 'item.md': invalidItem }, async (ledger) => {
    const result = runCli('validate', '--ledger', ledger, '--json');
    assert.equal(result.status, 1, result.stderr);

    const validation = JSON.parse(result.stdout);
    assert.equal(validation.valid, false);

    // Should have missing-matching-terminal-decision error
    const hasError = validation.errors.some((e) =>
      e.code === 'missing-matching-terminal-decision'
    );
    assert.equal(hasError, true, 'Should have missing-matching-terminal-decision error');
  });
});