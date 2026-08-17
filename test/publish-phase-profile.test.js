// The phase profile of one claimed publication (ledger item #122). A
// publication runs inside the namespace process lock for its whole length,
// and the counters below say how many times that lock is taken and how much
// per-item lock file work happens underneath it.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  publicationRequest, publish, withProvisionedLedger,
} from './claimed-publication-harness.js';
import { countersSince, phaseCounters } from '../src/instrumentation.js';
import { inspectItem } from '../src/mutation.js';

test('a claimed publication acquires the namespace process lock exactly once', async () => {
  await withProvisionedLedger(3, async (context) => {
    const inspected = await inspectItem(context.ledger, context.id);
    const request = publicationRequest(context, inspected, 'pub_phase_0001', 'Published');
    const before = phaseCounters();

    const outcome = await publish(context, request);

    assert.equal(outcome.stdout.ok, true, JSON.stringify(outcome.stdout));
    assert.equal(countersSince(before).namespace_lock_acquisitions, 1);
  });
});

// Today a publication locks every item in the ledger: the closure is the whole
// ID set, so a four-item ledger pays four create/write/fsync/unlink cycles for
// one item's publication. This is the baseline the lock-coarsening stage has
// to move, and the number it must move to is zero.
test('a claimed publication locks every item in the ledger', async () => {
  await withProvisionedLedger(3, async (context) => {
    const inspected = await inspectItem(context.ledger, context.id);
    const request = publicationRequest(context, inspected, 'pub_phase_0002', 'Published');
    const before = phaseCounters();

    const outcome = await publish(context, request);

    assert.equal(outcome.stdout.ok, true, JSON.stringify(outcome.stdout));
    const delta = countersSince(before);
    assert.equal(delta.item_lock_acquisitions, 4);
    assert.equal(delta.item_lock_fsyncs, 4);
    assert.equal(delta.item_lock_releases, 4);
  });
});
