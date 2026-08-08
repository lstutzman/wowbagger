import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { mintId } from '../src/mint.js';
import { runCli, withLedger } from './support.js';

const CANONICAL = /^wb_[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

test('minted IDs are canonical, distinct, and use the full Crockford alphabet', () => {
  const minted = Array.from({ length: 200 }, () => mintId('2030-01-10'));

  for (const id of minted) {
    assert.match(id, CANONICAL);
  }
  assert.equal(new Set(minted).size, minted.length, 'entropy must make same-instant IDs distinct');

  const entropyCharacters = new Set(minted.flatMap((id) => [...id.slice(13)]));
  assert.ok(entropyCharacters.size > 20, `expected broad alphabet usage, saw ${entropyCharacters.size} distinct characters`);
  for (const character of entropyCharacters) {
    assert.ok(!'ILOU'.includes(character), `excluded letter ${character} appeared`);
  }
});

test('a dated minted ID creates an item whose created date matches', async () => {
  const minted = runCli('mint-id', '--date', '2030-01-10', '--json');
  assert.equal(minted.status, 0, minted.stderr);
  const id = JSON.parse(minted.stdout).result.id;

  await withLedger({}, async (ledger) => {
    const requestPath = path.join(path.dirname(ledger), 'request.json');
    await writeFile(requestPath, JSON.stringify({
      id,
      item: {
        title: 'Minted item',
        kind: 'task',
        provenance: { source: 'fixture/mutations', recorded_at: '2030-01-10T12:34:56.789Z' },
        depends_on: [],
      },
      body: '',
    }));

    const result = runCli('create', '--ledger', ledger, '--input', requestPath, '--json');

    assert.equal(result.status, 0, result.stdout);
    assert.equal(JSON.parse(result.stdout).result.item.core.created, '2030-01-10');
  });
});

test('mint-id prints one canonical contract-valid ID', () => {
  const result = runCli('mint-id', '--json');

  assert.equal(result.status, 0, result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.command, 'mint-id');
  assert.equal(envelope.contract_version, 1);
  assert.match(envelope.result.id, CANONICAL);
});
