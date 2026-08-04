import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runCli } from './support.js';

const validLedger = fileURLToPath(
  new URL('../spec/fixtures/ready-selection/ledger', import.meta.url),
);

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
