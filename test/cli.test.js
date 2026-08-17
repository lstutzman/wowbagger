import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { linkDirectory, runCli, withLedger } from './support.js';

const validLedger = fileURLToPath(
  new URL('../spec/fixtures/ready-selection/ledger', import.meta.url),
);

test('JSON commands surface a missing ledger root as validation failure', async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-root-test-'));
  const missingRoot = path.join(temporaryDirectory, 'missing-ledger');

  try {
    for (const argumentsList of rootFailureCommands(missingRoot)) {
      const result = runCli(...argumentsList);

      assert.equal(result.status, 1, argumentsList[0]);
      assert.equal(result.stderr, '', argumentsList[0]);
      assert.deepEqual(JSON.parse(result.stdout), {
        valid: false,
        errors: [{
          path: 'missing-ledger',
          field: 'path',
          code: 'ledger-read-error',
          message: 'Ledger path could not be read.',
        }],
      });
    }
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
});

test('JSON commands reject a symbolic-link ledger root without following it', async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-root-test-'));
  const target = path.join(temporaryDirectory, 'target');
  const linkedRoot = path.join(temporaryDirectory, 'linked-ledger');

  try {
    await mkdir(target);
    await linkDirectory(target, linkedRoot);

    for (const argumentsList of rootFailureCommands(linkedRoot)) {
      const result = runCli(...argumentsList);

      assert.equal(result.status, 1, argumentsList[0]);
      assert.equal(result.stderr, '', argumentsList[0]);
      assert.deepEqual(JSON.parse(result.stdout), {
        valid: false,
        errors: [{
          path: 'linked-ledger',
          field: 'path',
          code: 'symlink-not-allowed',
          message: 'Ledger entries must not be symbolic links.',
        }],
      });
    }
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
});

test('JSON commands reject a regular file as the ledger root', async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-root-test-'));
  const fileRoot = path.join(temporaryDirectory, 'ledger.md');

  try {
    await writeFile(fileRoot, 'not a ledger directory', 'utf8');

    for (const argumentsList of rootFailureCommands(fileRoot)) {
      const result = runCli(...argumentsList);

      assert.equal(result.status, 1, argumentsList[0]);
      assert.equal(result.stderr, '', argumentsList[0]);
      assert.deepEqual(JSON.parse(result.stdout), {
        valid: false,
        errors: [{
          path: 'ledger.md',
          field: 'path',
          code: 'ledger-root-not-directory',
          message: 'Ledger root must be a real directory.',
        }],
      });
    }
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
});

test('ready rejects a non-calendar as-of value', () => {
  const result = runCli(
    'ready',
    '--ledger',
    validLedger,
    '--as-of',
    '2030-02-30',
    '--json',
  );

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /--as-of must be an ISO calendar date/);
});

function humanReadyItem(id, extraLines = []) {
  return [
    '---',
    'schema_version: 1',
    `id: ${id}`,
    ...extraLines,
    `title: "Ready item ${id}"`,
    'kind: task',
    'status: backlog',
    'created: 2030-01-10',
    'updated: 2030-01-10',
    'provenance:',
    '  source: "fixture/ready"',
    '  recorded_at: "2030-01-10T12:34:56.789Z"',
    'depends_on: []',
    'related: []',
    '---',
    '',
  ].join('\n');
}

test('ready without --json prints number, priority, and title per ready item', async () => {
  const plain = 'wb_01Q45X474NAAAAAAAAAAAAAAAA';
  const prioritised = 'wb_01Q45X474NBBBBBBBBBBBBBBBB';

  await withLedger({
    [`${plain}.md`]: humanReadyItem(plain),
    [`${prioritised}.md`]: humanReadyItem(prioritised, ['number: 5', 'priority: 1']),
  }, async (ledger) => {
    const result = runCli('ready', '--ledger', ledger, '--as-of', '2030-01-15');

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.stdout,
      `#5 pri=1 Ready item ${prioritised}\n#- pri=- Ready item ${plain}\n`,
    );
  });
});

test('commands reject missing, unknown, and repeated arguments', () => {
  const calls = [
    ['validate', '--json'],
    ['validate', '--ledger', validLedger, '--unknown', '--json'],
    ['ready', '--ledger', validLedger, '--json'],
    ['ready', '--ledger', validLedger, '--ledger', validLedger, '--as-of', '2030-01-15', '--json'],
  ];

  for (const argumentsList of calls) {
    const result = runCli(...argumentsList);
    assert.equal(result.status, 1, argumentsList.join(' '));
    assert.equal(result.stdout, '', argumentsList.join(' '));
    assert.notEqual(result.stderr, '', argumentsList.join(' '));
  }
});

function rootFailureCommands(ledgerRoot) {
  return [
    ['validate', '--ledger', ledgerRoot, '--json'],
    ['ready', '--ledger', ledgerRoot, '--as-of', '2030-01-15', '--json'],
  ];
}
