// The namespace-lock-held mutation strategy (ledger item #122).
//
// A claimed publication takes no per-item locks, so the only thing keeping a
// second writer out is the namespace process lock it already holds. These
// tests hold that boundary: the strategy cannot be entered without the lock,
// ordinary mutations keep their own per-ID closures, a concurrent provisioned
// writer is still refused, and the checks the publication runs under the lock
// are still the ones that decide.
import assert from 'node:assert/strict';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  publicationRequest, publish, waitForFile, withProvisionedLedger,
} from './claimed-publication-harness.js';
import { claimStorePath, namespaceLockHeld, withClaimLock } from '../src/claim-store.js';
import { countersSince, phaseCounters } from '../src/instrumentation.js';
import { inspectItem, publishClaimedCandidate, transitionItem } from '../src/mutation.js';

test('the candidate publication refuses to run without a held namespace lock', async () => {
  await withProvisionedLedger(1, async (context) => {
    const inspected = await inspectItem(context.ledger, context.id);
    const request = publicationRequest(context, inspected, 'pub_strategy_0001', 'Published');
    const forged = { storePath: 'anything', released: false };

    for (const namespaceLock of [undefined, null, forged, { ...forged, released: true }]) {
      await assert.rejects(() => publishClaimedCandidate({
        ledgerDirectory: context.ledger,
        request,
        namespaceLock,
        storePath: 'anything',
      }), /namespace process lock/);
    }
    const after = await inspectItem(context.ledger, context.id);
    assert.equal(after.item.revision, inspected.item.revision);
  });
});

// A hold is proof that the lock is held now, not that it was held once. The
// object handed to the callback stops being proof the moment the callback
// returns and the lock file is removed.
test('a namespace-lock hold stops being proof once the lock is released', async () => {
  await withProvisionedLedger(1, async (context) => {
    const inspected = await inspectItem(context.ledger, context.id);
    const request = publicationRequest(context, inspected, 'pub_strategy_0005', 'Published');
    const storePath = claimStorePath(context.gitCommonDir, context.namespace);
    let escaped = null;
    await withClaimLock(storePath, async (hold) => {
      assert.equal(namespaceLockHeld(hold, storePath), true);
      escaped = hold;
    });

    assert.equal(namespaceLockHeld(escaped, storePath), false);
    await assert.rejects(() => publishClaimedCandidate({
      ledgerDirectory: context.ledger,
      request,
      namespaceLock: escaped,
      storePath,
    }), /namespace process lock/);
  });
});

// Coarsening is scoped to the publication. An ordinary transition has no
// namespace-wide hold to rely on when the ledger is not provisioned, so it
// keeps its per-ID lock closure: the target plus every item that refers to it.
test('a transition keeps its per-ID lock closure', async () => {
  await withProvisionedLedger(1, async (context) => {
    const target = context.otherIds[0];
    const inspected = await inspectItem(context.ledger, target);
    const before = phaseCounters();

    const outcome = await transitionItem(context.ledger, {
      id: target,
      expected_revision: inspected.item.revision,
      to_status: 'backlog',
      date: '2026-08-17',
      decision: { summary: 'Accept.', rationale: 'Lock closure guard.' },
    });

    assert.equal((outcome.stdout ?? outcome).ok, true, JSON.stringify(outcome));
    const delta = countersSince(before);
    assert.equal(delta.item_lock_acquisitions, 1);
    assert.equal(delta.item_lock_fsyncs, 1);
    assert.equal(delta.item_lock_releases, 1);
  });
});

// The publication holds the namespace lock for its whole length, so a
// provisioned legacy mutation arriving mid-publication is refused by that lock
// rather than by an item lock. The refusal is the claim-store one it has
// always been.
test('a provisioned legacy mutation is refused while a publication holds the namespace lock', async () => {
  await withProvisionedLedger(1, async (context) => {
    const inspected = await inspectItem(context.ledger, context.id);
    const other = await inspectItem(context.ledger, context.otherIds[0]);
    const request = publicationRequest(context, inspected, 'pub_strategy_0002', 'Published');

    const suffix = 'legacy-during-publish';
    const pending = publish(context, request, `pause-after-lock-acquired:${suffix}`);
    await waitForFile(path.join(context.ledger, `.wowbagger-test-${suffix}-acquired`));
    const refused = await transitionItem(context.ledger, {
      id: context.otherIds[0],
      expected_revision: other.item.revision,
      to_status: 'backlog',
      date: '2026-08-17',
      decision: { summary: 'Accept.', rationale: 'Concurrent legacy writer.' },
    });
    await writeFile(path.join(context.ledger, `.wowbagger-test-${suffix}-allow-successor`), 'continue\n');
    const published = await pending;

    assert.equal(published.stdout.ok, true, JSON.stringify(published.stdout));
    assert.equal(refused.stdout.ok, false, JSON.stringify(refused.stdout));
    assert.equal(refused.stdout.state, 'unchanged');
    assert.equal(refused.stdout.error.code, 'claim-store-unavailable');
    assert.equal(refused.stdout.error.details.reason, 'claim-store-locked');
  });
});

// The engine still re-reads the complete working tree after it takes its
// (now empty) lock closure. A revision change landing between the shared
// snapshot and that reload must still refuse, and must leave the item holding
// the bytes the other writer put there.
test('a publication refuses a target revision that changed after the shared snapshot', async () => {
  await withProvisionedLedger(1, async (context) => {
    const inspected = await inspectItem(context.ledger, context.id);
    const request = publicationRequest(context, inspected, 'pub_strategy_0003', 'Published');

    const suffix = 'revision-moved';
    const pending = publish(context, request, `pause-after-lock-acquired:${suffix}`);
    await waitForFile(path.join(context.ledger, `.wowbagger-test-${suffix}-acquired`));
    const moved = Buffer.from(inspected.item.source_base64, 'base64')
      .toString('utf8')
      .replace(/^title: .*$/m, 'title: "Moved by another writer"');
    await writeFile(path.join(context.ledger, inspected.item.path.replace(/^ledger\//, '')), moved, 'utf8');
    await writeFile(path.join(context.ledger, `.wowbagger-test-${suffix}-allow-successor`), 'continue\n');

    const outcome = await pending;

    assert.equal(outcome.stdout.ok, false, JSON.stringify(outcome.stdout));
    assert.equal(outcome.stdout.state, 'unchanged');
    assert.equal(outcome.stdout.error.code, 'ledger-revision-conflict');
    const after = await inspectItem(context.ledger, context.id);
    assert.equal(after.item.core.title, 'Moved by another writer');
  });
});

// The absorbed defect. A publication used to write item locks whose metadata
// said `"operation": "publish-claimed"`, which the lock reader rejects as
// invalid-shape, so a concurrent observer misread a live publication lock as a
// broken one. With no publication lock files there is nothing to misread.
test('a publication in flight leaves no lock file for an observer to misclassify', async () => {
  await withProvisionedLedger(2, async (context) => {
    const inspected = await inspectItem(context.ledger, context.id);
    const request = publicationRequest(context, inspected, 'pub_strategy_0004', 'Published');

    const suffix = 'observer';
    const pending = publish(context, request, `pause-after-lock-acquired:${suffix}`);
    await waitForFile(path.join(context.ledger, `.wowbagger-test-${suffix}-acquired`));
    const locks = await readdir(path.join(context.ledger, '.wowbagger-locks'));
    await writeFile(path.join(context.ledger, `.wowbagger-test-${suffix}-allow-successor`), 'continue\n');

    assert.equal((await pending).stdout.ok, true);
    assert.deepEqual(locks.filter((name) => name.endsWith('.lock')), []);
  });
});
