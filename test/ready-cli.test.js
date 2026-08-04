import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

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
