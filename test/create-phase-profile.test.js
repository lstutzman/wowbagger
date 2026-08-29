// The permanent cost profile of one journaled create on a provisioned Git
// ledger (ledger item #181). Task 2 moved every create behind the claim
// journal, so a create now pays for the namespace lock, this worktree's
// identity, its own item locks, and the journal records that fence the
// allocation. These are the numbers that say so, and a later change that adds
// a process lock, an extra fsync, or a second journal record to the clean
// create path has to change this file to land.
//
// Elapsed time is deliberately absent. Milliseconds are a property of the
// machine, not of the path; the measured large-ledger run lives in the task
// report, where a number that moves with the load average belongs.
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import test from 'node:test';

import { createFixtureLedger } from '../bench/ledger-fixture.js';
import { claimJournalPath, replayClaimJournal } from '../src/claim-journal.js';
import { countersSince, phaseCounters } from '../src/instrumentation.js';
import { createItem } from '../src/mutation.js';
import { provisionExistingLedger } from './claimed-publication-harness.js';

const DATE = '2026-08-29';
const CREATE_ID = 'wb_01M03X40000000000000000181';

// A schema-2 ledger the core validates, in a Git worktree with a provisioned
// namespace: the shape that engages the claim fence. A plain directory would
// take the unfenced path and count none of the locks this profile exists for.
async function withProvisionedFixture(count, callback) {
  const fixture = await createFixtureLedger(count);
  try {
    const provisioned = await provisionExistingLedger(fixture.root, fixture.ledger);
    return await callback({ ...fixture, ...provisioned });
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
}

function createRequest(id) {
  return {
    id,
    item: {
      title: 'Create phase profile candidate',
      kind: 'task',
      priority: 50,
      provenance: { source: 'create-phase-profile', recorded_at: `${DATE}T00:00:00.000Z` },
      depends_on: [],
    },
    body: 'Created by the create phase profile test.\n',
  };
}

async function journalEntries(fixture) {
  const { entries } = await replayClaimJournal(
    claimJournalPath(fixture.gitCommonDir, fixture.namespace),
    fixture.namespace,
  );
  return entries;
}

test('a journaled create takes each process lock exactly once per identity it names', async () => {
  await withProvisionedFixture(12, async (fixture) => {
    const before = phaseCounters();

    const outcome = await createItem(fixture.ledger, createRequest(CREATE_ID));

    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    const delta = countersSince(before);
    // One namespace lock serializes the journal for the whole command, and the
    // writer establishes its own worktree identity once under that command.
    assert.equal(delta.namespace_lock_acquisitions, 1);
    assert.equal(delta.worktree_identity_lock_acquisitions, 1);
    // The create closure is the new item ID plus NUMBER_INDEX_LOCK_ID: the
    // number is allocated under its own lock, and the item has no dependencies
    // to widen the closure further. Each lock is acquired, fsynced, released.
    assert.equal(delta.item_lock_acquisitions, 2);
    assert.equal(delta.item_lock_fsyncs, 2);
    assert.equal(delta.item_lock_releases, 2);
  });
});

test('a successful create appends exactly one clock, one create intent, and one create terminal', async () => {
  await withProvisionedFixture(12, async (fixture) => {
    const before = await journalEntries(fixture);

    const outcome = await createItem(fixture.ledger, createRequest(CREATE_ID));

    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    const appended = (await journalEntries(fixture)).slice(before.length);
    assert.deepEqual(appended.map((entry) => entry.type), [
      'clock',
      'legacy-mutation-intent',
      'legacy-mutation',
    ]);
    const [, intent, terminal] = appended;
    assert.equal(intent.command, 'create-v1');
    assert.equal(intent.item_id, CREATE_ID);
    assert.equal(intent.expected_revision, null);
    assert.equal(intent.candidate_revision, outcome.item.revision);
    assert.equal(terminal.command, 'create-v1');
    assert.equal(terminal.item_id, CREATE_ID);
    assert.equal(terminal.attempt_id, intent.attempt_id);
    assert.equal(terminal.committed_revision, outcome.item.revision);
  });
});
