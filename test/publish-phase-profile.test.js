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

// A publication used to lock every item in the ledger — one create, metadata
// write, fsync, and unlink per item, for one item's publication. It runs
// inside the namespace process lock from journal replay through the terminal
// record, and every other provisioned writer takes that same lock, so the
// per-item closure bought no exclusion the publication did not already have.
// On 1,500 items it cost 1,503 acquisitions and 11.2 s of the 12.6 s the
// publication took. The number it must be is zero.
test('a claimed publication takes no item locks at all', async () => {
  await withProvisionedLedger(3, async (context) => {
    const inspected = await inspectItem(context.ledger, context.id);
    const request = publicationRequest(context, inspected, 'pub_phase_0002', 'Published');
    const before = phaseCounters();

    const outcome = await publish(context, request);

    assert.equal(outcome.stdout.ok, true, JSON.stringify(outcome.stdout));
    const delta = countersSince(before);
    assert.equal(delta.item_lock_acquisitions, 0);
    assert.equal(delta.item_lock_fsyncs, 0);
    assert.equal(delta.item_lock_releases, 0);
  });
});
