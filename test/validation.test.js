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

test('validate accepts a uniform schema version 2 ledger', async () => {
  await withLedger({
    'item.md': `---
schema_version: 2
id: wb_01KDWPVNG05FCBFC6R7R7CJANX
title: "Versioned item"
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

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { valid: true, errors: [] });
  });
});

test('validate rejects a ledger that mixes schema versions 1 and 2', async () => {
  await withLedger({
    'version-1.md': `---
schema_version: 1
id: wb_01KDWPVNG05FCBFC6R7R7CJANX
title: "Version 1 item"
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
    'version-2.md': `---
schema_version: 2
id: wb_01KDZ98CG0YH769STZ754EKXSZ
title: "Version 2 item"
kind: task
status: backlog
created: 2026-01-02
updated: 2026-01-02
provenance:
  source: "test"
  recorded_at: "2026-01-02T12:00:00Z"
depends_on: []
---
`,
  }, async (ledger) => {
    const result = runCli('validate', '--ledger', ledger, '--json');

    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stdout), {
      valid: false,
      errors: [
        {
          path: 'ledger/version-1.md',
          field: 'schema_version',
          code: 'mixed-schema-versions',
          message: 'Schema versions 1 and 2 must not be mixed in one ledger.',
        },
        {
          path: 'ledger/version-2.md',
          field: 'schema_version',
          code: 'mixed-schema-versions',
          message: 'Schema versions 1 and 2 must not be mixed in one ledger.',
        },
      ],
    });
  });
});

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

test('validate rejects a related item outside the configured ledger', async () => {
  await withLedger({
    'item.md': `---
schema_version: 1
id: wb_01KDWPVNG05FCBFC6R7R7CJANX
title: "Dangling context"
kind: task
status: backlog
created: 2026-01-01
updated: 2026-01-01
provenance:
  source: "test"
  recorded_at: "2026-01-01T12:00:00Z"
depends_on: []
related: [wb_01KGHNZCG0Q4R81FQK9A85BN8E]
---
`,
  }, async (ledger) => {
    const result = runCli('validate', '--ledger', ledger, '--json');

    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stdout), {
      valid: false,
      errors: [{
        path: 'ledger/item.md',
        field: 'related',
        code: 'unresolved-related',
        message: 'Related item wb_01KGHNZCG0Q4R81FQK9A85BN8E does not resolve to an item in the configured ledger.',
      }],
    });
  });
});

test('validate rejects invalid date, UTC timestamp, and relation-list types', async () => {
  await withLedger({
    '01-date.md': `---
schema_version: 1
id: wb_01KDWPVNG05FCBFC6R7R7CJANX
title: "Bad date"
kind: task
status: backlog
created: 2026-02-30
updated: 2026-01-01
provenance:
  source: "test"
  recorded_at: "2026-01-01T12:00:00Z"
depends_on: []
---
`,
    '02-type.md': `---
schema_version: 1
id: wb_01KDZ98CG0YH769STZ754EKXSZ
title: "Bad collection type"
kind: task
status: backlog
created: 2026-01-02
updated: 2026-01-02
provenance:
  source: "test"
  recorded_at: "2026-01-02T12:00:00Z"
depends_on: wb_01KDWPVNG05FCBFC6R7R7CJANX
---
`,
    '03-provenance.md': `---
schema_version: 1
id: wb_01KE1VN3G0HV9ZDBB8BEASXBBG
title: "Bad provenance instant"
kind: task
status: backlog
created: 2026-01-03
updated: 2026-01-03
provenance:
  source: "test"
  recorded_at: "2026-01-03T12:00:00+00:00"
depends_on: []
---
`,
  }, async (ledger) => {
    const result = runCli('validate', '--ledger', ledger, '--json');

    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stdout), {
      valid: false,
      errors: [
        {
          path: 'ledger/01-date.md',
          field: 'created',
          code: 'invalid-date',
          message: 'Field created must be an ISO calendar date.',
        },
        {
          path: 'ledger/02-type.md',
          field: 'depends_on',
          code: 'invalid-field-type',
          message: 'Field depends_on must be a YAML sequence.',
        },
        {
          path: 'ledger/03-provenance.md',
          field: 'provenance.recorded_at',
          code: 'invalid-rfc3339-utc',
          message: 'Field provenance.recorded_at must be an RFC 3339 UTC instant.',
        },
      ],
    });
  });
});

test('validate reports every member of a dependency cycle', async () => {
  await withLedger({
    'a.md': `---
schema_version: 1
id: wb_01KDWPVNG05FCBFC6R7R7CJANX
title: "Cycle A"
kind: task
status: backlog
created: 2026-01-01
updated: 2026-01-01
provenance:
  source: "test"
  recorded_at: "2026-01-01T12:00:00Z"
depends_on: [wb_01KDZ98CG0YH769STZ754EKXSZ]
---
`,
    'b.md': `---
schema_version: 1
id: wb_01KDZ98CG0YH769STZ754EKXSZ
title: "Cycle B"
kind: task
status: backlog
created: 2026-01-02
updated: 2026-01-02
provenance:
  source: "test"
  recorded_at: "2026-01-02T12:00:00Z"
depends_on: [wb_01KE1VN3G0HV9ZDBB8BEASXBBG]
---
`,
    'c.md': `---
schema_version: 1
id: wb_01KE1VN3G0HV9ZDBB8BEASXBBG
title: "Cycle C"
kind: task
status: backlog
created: 2026-01-03
updated: 2026-01-03
provenance:
  source: "test"
  recorded_at: "2026-01-03T12:00:00Z"
depends_on: [wb_01KDWPVNG05FCBFC6R7R7CJANX]
---
`,
  }, async (ledger) => {
    const result = runCli('validate', '--ledger', ledger, '--json');

    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stdout), {
      valid: false,
      errors: [
        {
          path: 'ledger/a.md',
          field: 'depends_on',
          code: 'dependency-cycle',
          message: 'Dependency cycle detected in a component of 3 items; member wb_01KDWPVNG05FCBFC6R7R7CJANX.',
        },
        {
          path: 'ledger/b.md',
          field: 'depends_on',
          code: 'dependency-cycle',
          message: 'Dependency cycle detected in a component of 3 items; member wb_01KDZ98CG0YH769STZ754EKXSZ.',
        },
        {
          path: 'ledger/c.md',
          field: 'depends_on',
          code: 'dependency-cycle',
          message: 'Dependency cycle detected in a component of 3 items; member wb_01KE1VN3G0HV9ZDBB8BEASXBBG.',
        },
      ],
    });
  });
});

test('validate does not accept an incomplete decision as terminal evidence', async () => {
  await withLedger({
    'item.md': `---
schema_version: 1
id: wb_01KDWPVNG05FCBFC6R7R7CJANX
title: "Incomplete decision"
kind: task
status: done
created: 2026-01-01
updated: 2026-01-02
completed: 2026-01-02
provenance:
  source: "test"
  recorded_at: "2026-01-01T12:00:00Z"
depends_on: []
decisions:
  - action: complete
    date: 2026-01-02
    summary: "Attempt to record completion."
---
`,
  }, async (ledger) => {
    const result = runCli('validate', '--ledger', ledger, '--json');

    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stdout), {
      valid: false,
      errors: [
        {
          path: 'ledger/item.md',
          field: 'decisions',
          code: 'missing-matching-terminal-decision',
          message: 'Status done requires an action complete decision dated 2026-01-02.',
        },
        {
          path: 'ledger/item.md',
          field: 'decisions[0].rationale',
          code: 'missing-decision-field',
          message: 'Each decision requires rationale.',
        },
      ],
    });
  });
});

test('validate retains an independent rollup-placement error when terminal date is missing', async () => {
  await withLedger({
    'item.md': `---
schema_version: 1
id: wb_01KDWPVNG05FCBFC6R7R7CJANX
title: "Wrong rollup evidence"
kind: epic
status: done
created: 2026-01-01
updated: 2026-01-02
provenance:
  source: "test"
  recorded_at: "2026-01-01T12:00:00Z"
depends_on: []
decisions:
  - action: archive
    date: 2026-01-02
    summary: "Archive evidence in the wrong state."
    rationale: "This decision is not a completion record."
    rollup: []
---
`,
  }, async (ledger) => {
    const result = runCli('validate', '--ledger', ledger, '--json');

    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stdout), {
      valid: false,
      errors: [
        {
          path: 'ledger/item.md',
          field: 'completed',
          code: 'missing-terminal-date',
          message: 'Status done requires completed and forbids killed and archived.',
        },
        {
          path: 'ledger/item.md',
          field: 'decisions[0].rollup',
          code: 'rollup-not-allowed',
          message: 'rollup is allowed only on the matching complete decision of a done epic.',
        },
      ],
    });
  });
});

test('validate requires created to match the UTC date encoded by the ULID', async () => {
  await withLedger({
    'item.md': `---
schema_version: 1
id: wb_01KDWPVNG05FCBFC6R7R7CJANX
title: "Mismatched provenance date"
kind: task
status: backlog
created: 2026-01-02
updated: 2026-01-02
provenance:
  source: "test"
  recorded_at: "2026-01-02T12:00:00Z"
depends_on: []
---
`,
  }, async (ledger) => {
    const result = runCli('validate', '--ledger', ledger, '--json');

    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stdout), {
      valid: false,
      errors: [{
        path: 'ledger/item.md',
        field: 'created',
        code: 'id-created-date-mismatch',
        message: 'Field created must equal the UTC calendar date encoded by ID wb_01KDWPVNG05FCBFC6R7R7CJANX.',
      }],
    });
  });
});

test('validate contains YAML conversion failures in validation JSON', async () => {
  await withLedger({
    'alias-limit.md': `---
a: &a [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]
c: [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]
---
`,
    'unresolved-alias.md': `---
schema_version: 1
id: *missing
---
`,
  }, async (ledger) => {
    const result = runCli('validate', '--ledger', ledger, '--json');

    assert.equal(result.status, 1);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), {
      valid: false,
      errors: [
        {
          path: 'ledger/alias-limit.md',
          field: 'frontmatter',
          code: 'invalid-yaml',
          message: 'Frontmatter contains invalid YAML.',
        },
        {
          path: 'ledger/unresolved-alias.md',
          field: 'frontmatter',
          code: 'invalid-yaml',
          message: 'Frontmatter contains invalid YAML.',
        },
      ],
    });
  });
});

test('validate retains terminal conflicts when the active terminal date is missing', async () => {
  await withLedger({
    'item.md': `---
schema_version: 1
id: wb_01KDWPVNG05FCBFC6R7R7CJANX
title: "Conflicting terminal dates"
kind: task
status: done
created: 2026-01-01
updated: 2026-01-02
killed: 2026-01-02
archived: 2026-01-02
provenance:
  source: "test"
  recorded_at: "2026-01-01T12:00:00Z"
depends_on: []
---
`,
  }, async (ledger) => {
    const result = runCli('validate', '--ledger', ledger, '--json');

    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stdout), {
      valid: false,
      errors: [
        {
          path: 'ledger/item.md',
          field: 'archived',
          code: 'terminal-date-conflict',
          message: 'Status done forbids archived.',
        },
        {
          path: 'ledger/item.md',
          field: 'completed',
          code: 'missing-terminal-date',
          message: 'Status done requires completed and forbids killed and archived.',
        },
        {
          path: 'ledger/item.md',
          field: 'killed',
          code: 'terminal-date-conflict',
          message: 'Status done forbids killed.',
        },
      ],
    });
  });
});

test('validate retains terminal conflicts when the active terminal date is invalid', async () => {
  await withLedger({
    'item.md': `---
schema_version: 1
id: wb_01KDWPVNG05FCBFC6R7R7CJANX
title: "Invalid active terminal date"
kind: task
status: done
created: 2026-01-01
updated: 2026-01-02
completed: not-a-date
killed: 2026-01-02
archived: 2026-01-02
provenance:
  source: "test"
  recorded_at: "2026-01-01T12:00:00Z"
depends_on: []
decisions:
  - action: complete
    date: 2026-01-02
    summary: "Attempted completion."
    rationale: "The persisted completion date is malformed."
---
`,
  }, async (ledger) => {
    const result = runCli('validate', '--ledger', ledger, '--json');

    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stdout), {
      valid: false,
      errors: [
        {
          path: 'ledger/item.md',
          field: 'archived',
          code: 'terminal-date-conflict',
          message: 'Status done forbids archived.',
        },
        {
          path: 'ledger/item.md',
          field: 'completed',
          code: 'invalid-date',
          message: 'Field completed must be an ISO calendar date.',
        },
        {
          path: 'ledger/item.md',
          field: 'killed',
          code: 'terminal-date-conflict',
          message: 'Status done forbids killed.',
        },
      ],
    });
  });
});
