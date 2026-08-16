// Complete-ledger loads are the unit of mutation cost on a large ledger: each
// one reads and parses every item file. A claim-protected mutation used to
// perform three — one for journal reconciliation, one before lock closure, and
// one under lock. The first two are unlocked reads of the same directory
// inside one claim-lock hold, so they now share a single snapshot. The read
// under lock is what makes the revision compare-and-swap meaningful and stays.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ledgerLoadCount } from '../src/ledger.js';
import { mintId } from '../src/mint.js';
import { createItem, inspectItem, patchItem, transitionItem } from '../src/mutation.js';
import { provisionNamespace } from '../src/namespace.js';

const DATE = '2026-08-16';

function git(cwd, ...argumentsList) {
  execFileSync('git', argumentsList, { cwd });
}

async function withLedger(provisioned, callback) {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-load-count-'));
  const ledger = path.join(root, 'ledger');
  await mkdir(ledger);
  if (provisioned) {
    git(root, 'init', '-q');
    git(root, 'config', 'user.email', 'load-count@example.invalid');
    git(root, 'config', 'user.name', 'Load Count');
    await provisionNamespace(ledger);
    git(root, 'add', '--all');
    git(root, 'commit', '-qm', 'provision the ledger');
  }
  try {
    return await callback({ ledger, root, commit: (message) => {
      if (!provisioned) return;
      git(root, 'add', '--all');
      git(root, 'commit', '-qm', message);
    } });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

function createRequest(id) {
  return {
    id,
    item: {
      title: 'Load count item',
      kind: 'task',
      priority: 50,
      provenance: { source: 'load-count', recorded_at: `${DATE}T00:00:00.000Z` },
      depends_on: [],
    },
    body: 'Written by the ledger load-count guard.\n',
  };
}

async function countLoads(run) {
  const before = ledgerLoadCount();
  const outcome = await run();
  return { loads: ledgerLoadCount() - before, outcome };
}

test('a claim-protected create reads the complete ledger twice', async () => {
  await withLedger(true, async ({ ledger }) => {
    const measured = await countLoads(() => createItem(ledger, createRequest(mintId(DATE))));

    assert.equal(measured.outcome.ok, true, JSON.stringify(measured.outcome));
    assert.equal(measured.loads, 2);
  });
});

test('a claim-protected transition reads the complete ledger twice', async () => {
  await withLedger(true, async ({ ledger, commit }) => {
    const id = mintId(DATE);
    assert.equal((await createItem(ledger, createRequest(id))).ok, true);
    commit('create the item');
    const inspected = await inspectItem(ledger, id);

    const measured = await countLoads(() => transitionItem(ledger, {
      id,
      expected_revision: inspected.item.revision,
      to_status: 'backlog',
      date: DATE,
      decision: { summary: 'Accept.', rationale: 'Load-count guard.' },
    }));

    assert.equal(measured.outcome.ok, true, JSON.stringify(measured.outcome));
    assert.equal(measured.loads, 2);
  });
});

test('a claim-protected patch reads the complete ledger twice', async () => {
  await withLedger(true, async ({ ledger, commit }) => {
    const id = mintId(DATE);
    assert.equal((await createItem(ledger, createRequest(id))).ok, true);
    commit('create the item');
    const inspected = await inspectItem(ledger, id);

    const measured = await countLoads(() => patchItem(ledger, {
      id,
      expected_revision: inspected.item.revision,
      set: { priority: 20 },
      date: DATE,
    }));

    assert.equal(measured.outcome.ok, true, JSON.stringify(measured.outcome));
    assert.equal(measured.loads, 2);
  });
});

test('an unprovisioned mutation still reads the complete ledger twice', async () => {
  await withLedger(false, async ({ ledger }) => {
    const measured = await countLoads(() => createItem(ledger, createRequest(mintId(DATE))));

    assert.equal(measured.outcome.ok, true, JSON.stringify(measured.outcome));
    assert.equal(measured.loads, 2);
  });
});

// When the read under lock discovers a wider lock closure than the shared
// snapshot chose, the mutation drops its locks and retries. The retry must
// read the ledger fresh: replaying the same snapshot would choose the same
// too-narrow closure on every attempt and exhaust the retry budget.
test('a lock closure that widens after the shared snapshot still commits on retry', async () => {
  await withLedger(true, async ({ ledger, commit }) => {
    const id = mintId(DATE);
    assert.equal((await createItem(ledger, createRequest(id))).ok, true);
    commit('create the item');
    const inspected = await inspectItem(ledger, id);

    const suffix = 'widen-closure';
    const pending = transitionItem(ledger, {
      id,
      expected_revision: inspected.item.revision,
      to_status: 'backlog',
      date: DATE,
      decision: { summary: 'Accept.', rationale: 'Exercise the lock-closure retry.' },
    }, `pause-after-lock-acquired:${suffix}`);
    await waitForFile(path.join(ledger, `.wowbagger-test-${suffix}-acquired`));
    await writeFile(path.join(ledger, `${referringId(id)}.md`), referringSource(id));
    await writeFile(path.join(ledger, `.wowbagger-test-${suffix}-allow-successor`), 'continue\n');

    const outcome = await pending;

    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    assert.equal(outcome.item.core.status, 'backlog');
  });
});

function referringId(targetId) {
  return `${targetId.slice(0, -1)}${targetId.endsWith('Z') ? 'Y' : 'Z'}`;
}

// A hand-written second item that depends on the transition target, so the
// read under lock computes a wider closure than the snapshot did.
function referringSource(targetId) {
  return `---
schema_version: 2
id: ${referringId(targetId)}
number: 2
title: "Referring item"
kind: task
priority: 50
status: triage
created: ${DATE}
updated: ${DATE}
provenance:
  source: "load-count"
  recorded_at: "${DATE}T00:00:00.000Z"
depends_on:
  - ${targetId}
related: []
decisions: []
---

Hand-written to widen the lock closure mid-mutation.
`;
}

async function waitForFile(file) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      await lstat(file);
      return;
    } catch (error) {
      assert.equal(error.code, 'ENOENT');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`Timed out waiting for ${path.basename(file)}`);
}
