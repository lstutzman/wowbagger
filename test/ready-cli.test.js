import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runCli, withLedger } from './support.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = fileURLToPath(new URL('../bin/wowbagger.js', import.meta.url));
const ledger = fileURLToPath(
  new URL('../spec/fixtures/ready-selection/ledger', import.meta.url),
);
const invalidLedger = fileURLToPath(
  new URL('../spec/fixtures/validation-errors/ledger', import.meta.url),
);
const expectedValidationFailure = JSON.parse(readFileSync(
  new URL('../spec/fixtures/validation-errors/expected-errors.json', import.meta.url),
));

test('ready prints the normative selected fixture result', () => {
  const result = spawnSync(
    process.execPath,
    [cli, 'ready', '--ledger', ledger, '--as-of', '2030-01-15', '--json'],
    { cwd: root, encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    as_of: '2030-01-15',
    valid: true,
    ready: [
      'wb_01KDZ98CG0YH769STZ754EKXSZ',
      'wb_01KE1VN3G0HV9ZDBB8BEASXBBG',
      'wb_01KEPETVG05Z5FTGZFS1B26Z51',
      'wb_01KF21M300CGWT7S7X5W8PZ1DC',
    ],
  });
});

test('validate prints the canonical valid-ledger result', () => {
  const result = spawnSync(
    process.execPath,
    [cli, 'validate', '--ledger', ledger, '--json'],
    { cwd: root, encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    valid: true,
    errors: [],
  });
});

test('ready selects schema version 2 tasks only when every prerequisite is done', async () => {
  await withLedger({
    'done.md': `---
schema_version: 2
id: wb_01KDWPVNG05FCBFC6R7R7CJANX
number: 1
title: "Done prerequisite"
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
    summary: "Complete the prerequisite."
    rationale: "The work is complete."
---
`,
    'ready.md': `---
schema_version: 2
id: wb_01KDZ98CG0YH769STZ754EKXSZ
number: 2
title: "Ready dependent"
kind: task
status: backlog
created: 2026-01-02
updated: 2026-01-02
provenance:
  source: "test"
  recorded_at: "2026-01-02T12:00:00Z"
depends_on: [wb_01KDWPVNG05FCBFC6R7R7CJANX]
---
`,
    'live.md': `---
schema_version: 2
id: wb_01KE1VN3G0HV9ZDBB8BEASXBBG
number: 3
title: "Live prerequisite"
kind: task
status: in-progress
created: 2026-01-03
updated: 2026-01-03
provenance:
  source: "test"
  recorded_at: "2026-01-03T12:00:00Z"
depends_on: []
---
`,
    'blocked.md': `---
schema_version: 2
id: wb_01KE4E1TG0ZEEX37TTS82ME1JK
number: 4
title: "Blocked dependent"
kind: task
status: backlog
created: 2026-01-04
updated: 2026-01-04
provenance:
  source: "test"
  recorded_at: "2026-01-04T12:00:00Z"
depends_on: [wb_01KE1VN3G0HV9ZDBB8BEASXBBG]
---
`,
  }, async (temporaryLedger) => {
    const result = runCli(
      'ready',
      '--ledger',
      temporaryLedger,
      '--as-of',
      '2030-01-15',
      '--json',
    );

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      as_of: '2030-01-15',
      valid: true,
      ready: ['wb_01KDZ98CG0YH769STZ754EKXSZ'],
    });
  });
});

test('ready surfaces validation failure without a partial ready list', () => {
  const result = spawnSync(
    process.execPath,
    [cli, 'ready', '--ledger', invalidLedger, '--as-of', '2030-01-15', '--json'],
    { cwd: root, encoding: 'utf8' },
  );

  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), expectedValidationFailure);
});

test('ready breaks equal creation dates by immutable ID', async () => {
  await withLedger({
    'later-id.md': `---
schema_version: 1
id: wb_01KDWPVNG0ZZZZZZZZZZZZZZZZ
title: "Later ID"
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
    'earlier-id.md': `---
schema_version: 1
id: wb_01KDWPVNG00000000000000000
title: "Earlier ID"
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
  }, async (temporaryLedger) => {
    const result = runCli(
      'ready',
      '--ledger',
      temporaryLedger,
      '--as-of',
      '2030-01-15',
      '--json',
    );

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      as_of: '2030-01-15',
      valid: true,
      ready: [
        'wb_01KDWPVNG00000000000000000',
        'wb_01KDWPVNG0ZZZZZZZZZZZZZZZZ',
      ],
    });
  });
});

test('ready fails closed with validation JSON for invalid UTF-8', async () => {
  const invalidUtf8 = Buffer.from([
    0x2d, 0x2d, 0x2d, 0x0a,
    0x74, 0x69, 0x74, 0x6c, 0x65, 0x3a, 0x20,
    0xc3, 0x28, 0x0a,
    0x2d, 0x2d, 0x2d, 0x0a,
  ]);

  await withLedger({ 'item.md': invalidUtf8 }, async (temporaryLedger) => {
    const result = runCli(
      'ready',
      '--ledger',
      temporaryLedger,
      '--as-of',
      '2030-01-15',
      '--json',
    );

    assert.equal(result.status, 1);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), {
      valid: false,
      errors: [{
        path: 'ledger/item.md',
        field: 'encoding',
        code: 'invalid-utf8',
        message: 'Ledger items must be valid UTF-8.',
      }],
    });
  });
});
