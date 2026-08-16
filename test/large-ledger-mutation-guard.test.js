// The mutation guard on a large ledger. Reading Git HEAD through one batched
// process instead of one process per item made mutations fast; these tests
// hold the line that nothing about the refusal was skipped for that speed. A
// candidate that would make the complete ledger invalid is still refused, and
// the ledger on disk is still unchanged.
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import test from 'node:test';
import { createFixtureLedger } from '../bench/ledger-fixture.js';
import { loadLedger } from '../src/ledger.js';
import { createItem, inspectItem, publishClaimedCandidate } from '../src/mutation.js';
import { validateLedger } from '../src/validate.js';

const ITEMS = 1500;
const DATE = '2026-08-16';
const MISSING_ID = 'wb_01M0000000ZZZZZZZZZZZZZZZZ';

async function withLargeLedger(callback) {
  const fixture = await createFixtureLedger(ITEMS);
  try {
    return await callback(fixture);
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
}

function createRequest(id, dependsOn) {
  return {
    id,
    item: {
      title: 'Guard candidate',
      kind: 'task',
      priority: 50,
      provenance: { source: 'mutation-guard', recorded_at: `${DATE}T00:00:00.000Z` },
      depends_on: dependsOn,
    },
    body: 'Candidate written by the large-ledger mutation guard test.\n',
  };
}

test('the large fixture is a valid ledger', async () => {
  await withLargeLedger(async (fixture) => {
    const ledger = await loadLedger(fixture.ledger);

    assert.equal(ledger.items.length, ITEMS);
    assert.deepEqual(validateLedger(ledger), { valid: true, errors: [] });
  });
});

test('create refuses a candidate whose dependency does not resolve on a large ledger', async () => {
  await withLargeLedger(async (fixture) => {
    const id = 'wb_01M03X40000000000000000001';

    const outcome = await createItem(fixture.ledger, createRequest(id, [MISSING_ID]));

    assert.equal(outcome.ok, false);
    assert.equal(outcome.state, 'unchanged');
    assert.equal(outcome.error.code, 'candidate-invalid');
    assert.ok(
      outcome.error.details.validation_errors.some((error) => error.code === 'unresolved-dependency'),
      JSON.stringify(outcome.error.details.validation_errors),
    );
    const after = await loadLedger(fixture.ledger);
    assert.equal(after.items.length, ITEMS);
    assert.equal(after.items.some((item) => item.data.id === id), false);
  });
});

test('publication refuses a candidate that duplicates an item number on a large ledger', async () => {
  await withLargeLedger(async (fixture) => {
    const target = fixture.items.at(-1);
    const other = fixture.items[0];
    const inspected = await inspectItem(fixture.ledger, target.id);
    const candidate = Buffer.from(Buffer.from(inspected.item.source_base64, 'base64')
      .toString('utf8')
      .replace(`number: ${target.number}`, `number: ${other.number}`), 'utf8');

    const outcome = await publishClaimedCandidate(fixture.ledger, {
      item_id: target.id,
      expected_revision: inspected.item.revision,
      candidate_source_base64: candidate.toString('base64'),
    });

    assert.equal(outcome.ok, false);
    assert.equal(outcome.state, 'unchanged');
    assert.equal(outcome.error.code, 'candidate-invalid');
    assert.ok(
      outcome.error.details.validation_errors.some((error) => error.code === 'duplicate-number'),
      JSON.stringify(outcome.error.details.validation_errors),
    );
    const after = await inspectItem(fixture.ledger, target.id);
    assert.equal(after.item.revision, inspected.item.revision);
  });
});
