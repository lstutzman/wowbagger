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

test('bare ready prints a human table of number, priority, and title in ready order', async () => {
  await withLedger({
    'gamma.md': `---
schema_version: 1
id: wb_01KDVDNA00VRQEQ2TK3KYPAZSK
title: "Later priority task"
kind: task
status: backlog
created: 2026-01-01
updated: 2026-01-01
number: 3
priority: 20
provenance:
  source: "test"
  recorded_at: "2026-01-01T12:00:00Z"
depends_on: []
---
`,
    'alpha.md': `---
schema_version: 1
id: wb_01KDY02100WSA62GG817MX7V12
title: "Earlier priority task"
kind: task
status: backlog
created: 2026-01-02
updated: 2026-01-02
number: 1
priority: 10
provenance:
  source: "test"
  recorded_at: "2026-01-02T12:00:00Z"
depends_on: []
---
`,
    'beta.md': `---
schema_version: 1
id: wb_01KDVDNA00AAAAAAAAAAAAAAAA
title: "Unprioritized handle task"
kind: task
status: backlog
created: 2026-01-01
updated: 2026-01-01
number: 2
provenance:
  source: "test"
  recorded_at: "2026-01-01T12:00:00Z"
depends_on: []
---
`,
    'delta.md': `---
schema_version: 1
id: wb_01KE0JER00BBMZDN1QMWY06NYZ
title: "Unnumbered task"
kind: task
status: backlog
created: 2026-01-03
updated: 2026-01-03
provenance:
  source: "test"
  recorded_at: "2026-01-03T12:00:00Z"
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
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, [
      'number  priority  title',
      '1       10        Earlier priority task',
      '3       20        Later priority task',
      '2       -         Unprioritized handle task',
      '-       -         Unnumbered task',
      '',
    ].join('\n'));
  });
});

test('bare ready prints only the header when nothing is ready', async () => {
  await withLedger({
    'triage.md': `---
schema_version: 1
id: wb_01KDVDNA00AAAAAAAAAAAAAAAA
title: "Triaged task"
kind: task
status: triage
created: 2026-01-01
updated: 2026-01-01
number: 4
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
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'number  priority  title\n');
  });
});

test('ready --json keeps its byte-exact machine output', () => {
  const result = runCli('ready', '--ledger', ledger, '--as-of', '2030-01-15', '--json');

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, readFileSync(
    new URL('../spec/fixtures/adapters/03-ready-forwarding/expected-core-stdout.jsonl', import.meta.url),
    'utf8',
  ));
});

test('bare ready surfaces validation failure without a partial table', () => {
  const result = runCli('ready', '--ledger', invalidLedger, '--as-of', '2030-01-15');

  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), expectedValidationFailure);
});
