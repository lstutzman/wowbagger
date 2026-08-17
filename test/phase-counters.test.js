// The deterministic phase counters under a complete ledger load (ledger item
// #122, stage 0). The mutation latency benchmark could time a whole operation
// but could not say which phase inside it was paying: item-lock file work, the
// namespace process lock, or the Git HEAD tree scan and blob reads. These
// tests hold each counter to the work it names, so a later stage that claims
// to remove a phase has to prove it with a number instead of a wall time.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createFixtureLedger } from '../bench/ledger-fixture.js';
import { readGitHeadLedger } from '../src/git-reconciliation.js';
import {
  countersSince, phaseCounters, phaseTimings, timingsSince,
} from '../src/instrumentation.js';
import { createItem } from '../src/mutation.js';

const DATE = '2026-08-17';

async function withFixture(count, callback) {
  const fixture = await createFixtureLedger(count);
  try {
    return await callback(fixture);
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
}

function createRequest(id) {
  return {
    id,
    item: {
      title: 'Phase counter candidate',
      kind: 'task',
      priority: 50,
      provenance: { source: 'phase-counters', recorded_at: `${DATE}T00:00:00.000Z` },
      depends_on: [],
    },
    body: 'Created by the phase counter test.\n',
  };
}

async function commitFixture(fixture) {
  execFileSync('git', ['init', '--quiet'], { cwd: fixture.root });
  execFileSync('git', ['config', 'user.email', 'counters@example.invalid'], { cwd: fixture.root });
  execFileSync('git', ['config', 'user.name', 'Phase counters'], { cwd: fixture.root });
  execFileSync('git', ['add', '--all'], { cwd: fixture.root });
  execFileSync('git', ['commit', '--quiet', '--message', 'phase counter fixture'], { cwd: fixture.root });
}

test('create acquires, syncs, and releases one item lock per closure ID', async () => {
  await withFixture(12, async (fixture) => {
    const before = phaseCounters();

    const outcome = await createItem(fixture.ledger, createRequest('wb_01M03X40000000000000000001'));

    assert.equal(outcome.ok, true);
    const delta = countersSince(before);
    // The create closure on a schema-2 ledger is the new ID plus the number
    // index lock; the item has no dependencies to widen it.
    assert.equal(delta.item_lock_acquisitions, 2);
    assert.equal(delta.item_lock_fsyncs, 2);
    assert.equal(delta.item_lock_releases, 2);
  });
});

test('the HEAD read counts every tree entry it scanned and only the blobs it read', async () => {
  await withFixture(8, async (fixture) => {
    // One tree entry that is not an item: the scan pays for it, the batch read
    // does not, so the two counters cannot be the same number by construction.
    await writeFile(path.join(fixture.ledger, 'notes.txt'), 'not an item\n', 'utf8');
    await commitFixture(fixture);
    const bytes = fixture.items.reduce((total, item) => total + Buffer.byteLength(item.source, 'utf8'), 0);
    const before = phaseCounters();

    const head = await readGitHeadLedger(fixture.ledger);

    assert.equal(head.items.size, 8);
    const delta = countersSince(before);
    assert.equal(delta.head_tree_entries, 9);
    assert.equal(delta.head_blobs_read, 8);
    assert.equal(delta.head_bytes_read, bytes);
  });
});

test('the item-lock phase reports the wall time spent acquiring and releasing locks', async () => {
  await withFixture(12, async (fixture) => {
    const before = phaseTimings();

    const outcome = await createItem(fixture.ledger, createRequest('wb_01M03X40000000000000000002'));

    assert.equal(outcome.ok, true);
    const spent = timingsSince(before);
    assert.ok(spent.item_lock_acquire_ms > 0, `acquire ${spent.item_lock_acquire_ms}`);
    assert.ok(spent.item_lock_release_ms > 0, `release ${spent.item_lock_release_ms}`);
  });
});
