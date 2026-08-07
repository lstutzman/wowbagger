import assert from 'node:assert/strict';
import test from 'node:test';

import { mintId } from '../src/mint-id.js';
import { ULID_ALPHABET, ULID_PATTERN, dateFromId, validateLedger } from '../src/validate.js';
import { runCli } from './support.js';

test('mintId mints a canonical ID encoding the current UTC date', () => {
  const id = mintId();

  assert.match(id, ULID_PATTERN);
  assert.equal(dateFromId(id), new Date().toISOString().slice(0, 10));
});

test('mintId draws 80 bits of Crockford-alphabet entropy per ID', () => {
  const entropyValues = new Set();
  const entropyCharacters = new Set();
  let highest = 0n;

  for (let index = 0; index < 10000; index += 1) {
    const id = mintId();
    assert.match(id, ULID_PATTERN);
    const entropy = decodeEntropy(id);
    entropyValues.add(entropy);
    if (entropy > highest) {
      highest = entropy;
    }
    for (const character of id.slice(13)) {
      entropyCharacters.add(character);
    }
  }

  // 10000 independent draws collide unless the random portion is real entropy.
  assert.equal(entropyValues.size, 10000);
  // A draw above 2^72 is impossible unless more than 72 of the 80 bits live;
  // with 80-bit entropy 10000 draws miss that range with probability ~2^-80.
  assert.ok(highest >= 2n ** 72n, 'entropy must span the 80-bit space');
  // Across 160000 entropy characters an alphabet missing any of the 32
  // Crockford characters — or admitting I, L, O or U — cannot hide.
  assert.equal(entropyCharacters.size, ULID_ALPHABET.length);
});

function decodeEntropy(id) {
  let value = 0n;
  for (const character of id.slice(13)) {
    value = (value * 32n) + BigInt(ULID_ALPHABET.indexOf(character));
  }
  return value;
}

test('mintId encodes a requested created date that round-trips through the validator', () => {
  const id = mintId('2030-01-15');

  assert.match(id, ULID_PATTERN);
  assert.equal(dateFromId(id), '2030-01-15');
});

test('mintId rejects a date that is not an ISO calendar date', () => {
  assert.throws(() => mintId('2030-02-30'), /ISO calendar date/);
  assert.throws(() => mintId('yesterday'), /ISO calendar date/);
});

test('a minted ID passes ledger validation as an item id with its encoded created date', () => {
  const id = mintId('2030-01-15');
  const validation = validateLedger({
    errors: [],
    items: [{
      path: `${id}.md`,
      data: {
        schema_version: 1,
        id,
        title: 'Minted item',
        kind: 'task',
        status: 'backlog',
        created: '2030-01-15',
        updated: '2030-01-15',
        provenance: { source: 'test', recorded_at: '2030-01-15T00:00:00.000Z' },
        depends_on: [],
        related: [],
      },
    }],
  });

  assert.deepEqual(validation, { valid: true, errors: [] });
});

test('wowbagger mint-id prints a canonical ID encoding the current UTC date', () => {
  const result = runCli('mint-id');

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.ok(result.stdout.endsWith('\n'));
  const id = result.stdout.trim();
  assert.match(id, ULID_PATTERN);
  assert.equal(dateFromId(id), new Date().toISOString().slice(0, 10));
});

test('wowbagger mint-id --date encodes the requested created date', () => {
  const result = runCli('mint-id', '--date', '2030-01-15');

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const id = result.stdout.trim();
  assert.match(id, ULID_PATTERN);
  assert.equal(dateFromId(id), '2030-01-15');
});

test('wowbagger mint-id rejects a non-calendar --date value', () => {
  const result = runCli('mint-id', '--date', '2030-02-30');

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /--date must be an ISO calendar date/);
});

test('wowbagger mint-id rejects unknown, repeated, and valueless arguments', () => {
  const calls = [
    ['mint-id', '--json'],
    ['mint-id', '--date'],
    ['mint-id', '--date', '2030-01-15', '--date', '2030-01-16'],
    ['mint-id', '--ledger', 'ledger'],
  ];

  for (const argumentsList of calls) {
    const result = runCli(...argumentsList);
    assert.equal(result.status, 1, argumentsList.join(' '));
    assert.equal(result.stdout, '', argumentsList.join(' '));
    assert.notEqual(result.stderr, '', argumentsList.join(' '));
  }
});
