// Complete-ledger loads are the unit of mutation cost on a large ledger: each
// one reads and parses every item file. A claim-protected mutation used to
// perform three — one for journal reconciliation, one before lock closure, and
// one under lock. The first two are unlocked reads of the same directory
// inside one claim-lock hold, so they now share a single snapshot. The read
// under lock is what makes the revision compare-and-swap meaningful and stays.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { appendClaimEntry, claimJournalPath } from '../src/claim-journal.js';
import { operationDigest, publishClaimed } from '../src/claim-publication.js';
import { resolveGitCommonDir } from '../src/claim-store.js';
import { ledgerLoadCount } from '../src/ledger.js';
import { mintId } from '../src/mint.js';
import { createItem, inspectItem, patchItem, transitionItem } from '../src/mutation.js';
import { provisionNamespace, readNamespace } from '../src/namespace.js';

const CLI = fileURLToPath(new URL('../bin/wowbagger.js', import.meta.url));
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

// `publish-claimed` runs the same locked mutation engine behind the claim
// fence. Its unlocked pre-reads — the candidate ledger validation and the
// engine's pre-lock read, plus the journal reconciliation when an intent is
// unresolved — all happen inside one claim-lock hold on the same directory,
// so they share one snapshot. The read under lock still stands alone.
async function withClaimedItem(callback) {
  return withLedger(true, async (context) => {
    const id = mintId(DATE);
    assert.equal((await createItem(context.ledger, createRequest(id))).ok, true);
    const otherId = mintId(DATE);
    assert.equal((await createItem(context.ledger, createRequest(otherId))).ok, true);
    context.commit('create the items');
    const namespace = await readNamespace(context.ledger);
    const gitCommonDir = await resolveGitCommonDir(context.ledger);
    const claim = await acquireClaim(context.ledger, context.root, namespace, id);
    return callback({ ...context, claim, gitCommonDir, id, namespace, otherId });
  });
}

async function acquireClaim(ledger, root, namespace, itemId) {
  const requestPath = path.join(root, 'acquire.json');
  await writeFile(requestPath, JSON.stringify({
    ledger_namespace: namespace,
    item_id: itemId,
    owner_id: 'snapshot-agent',
    lease_duration_ms: 600_000,
    expected: { last_epoch: '0', active: null },
  }));
  const envelope = JSON.parse(execFileSync(
    process.execPath,
    [CLI, 'claim', 'acquire', '--ledger', ledger, '--input', requestPath, '--json'],
    { encoding: 'utf8' },
  ));
  assert.equal(envelope.ok, true, JSON.stringify(envelope));
  return envelope.result.claim;
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function publicationRequest(context, inspected, operationId, title, rewrite = (source) => source) {
  const candidate = Buffer.from(rewrite(Buffer.from(inspected.item.source_base64, 'base64')
    .toString('utf8')
    .replace(/^title: .*$/m, `title: "${title}"`)), 'utf8');
  return {
    operation_id: operationId,
    ledger_namespace: context.namespace,
    item_id: context.id,
    expected_revision: inspected.item.revision,
    candidate_source_base64: candidate.toString('base64'),
    candidate_sha256: sha256(candidate),
    claim_fence: {
      ledger_namespace: context.namespace,
      item_id: context.id,
      owner_id: context.claim.owner_id,
      epoch: context.claim.epoch,
    },
  };
}

function publish(context, request, scenario) {
  return publishClaimed({
    ledgerDirectory: context.ledger,
    gitCommonDir: context.gitCommonDir,
    namespace: context.namespace,
    request,
    scenario,
  });
}

test('a claim-protected publication reads the complete ledger twice', async () => {
  await withClaimedItem(async (context) => {
    const inspected = await inspectItem(context.ledger, context.id);
    const request = publicationRequest(context, inspected, 'pub_snapshot_0001', 'Published');

    const measured = await countLoads(() => publish(context, request));

    assert.equal(measured.outcome.stdout.ok, true, JSON.stringify(measured.outcome.stdout));
    assert.equal(measured.loads, 2);
  });
});

// An unresolved publish-intent forces journal reconciliation to read the
// ledger before the publication proceeds. That read is the same directory
// under the same lock, so it becomes the shared snapshot rather than a fourth.
test('a publication behind an unresolved intent still reads the complete ledger twice', async () => {
  await withClaimedItem(async (context) => {
    const inspected = await inspectItem(context.ledger, context.id);
    const request = publicationRequest(context, inspected, 'pub_snapshot_0002', 'Published');
    await appendClaimEntry(claimJournalPath(context.gitCommonDir, context.namespace), {
      type: 'publish-intent',
      operation_id: 'pub_snapshot_pending',
      operation_digest: operationDigest(request),
      ledger_namespace: context.namespace,
      item_id: context.id,
      fence: request.claim_fence,
      expected_revision: inspected.item.revision,
      candidate_sha256: sha256(Buffer.from('unresolved candidate', 'utf8')),
      state: 'pending',
    });

    const measured = await countLoads(() => publish(context, request));

    assert.equal(measured.outcome.stdout.ok, true, JSON.stringify(measured.outcome.stdout));
    assert.equal(measured.loads, 2);
  });
});

// The read under lock is what makes the revision compare-and-swap and the
// candidate validation meaningful. A duplicate number written after the
// shared snapshot but before the locked read must still refuse the
// publication: replaying the snapshot in place of that read would publish it.
test('a publication refuses a duplicate number written after the shared snapshot', async () => {
  await withClaimedItem(async (context) => {
    const inspected = await inspectItem(context.ledger, context.id);
    const other = await inspectItem(context.ledger, context.otherId);
    // The candidate takes a number no item holds yet, so the shared snapshot
    // sees a valid candidate. The mid-flight rewrite gives the same number to
    // the other item, which leaves the ledger on disk valid and the candidate
    // duplicated — a conflict only the read under lock can see.
    const request = publicationRequest(context, inspected, 'pub_snapshot_0003', 'Published',
      (source) => source.replace(/^number: .*$/m, 'number: 9'));

    const suffix = 'claimed-duplicate';
    const pending = publish(context, request, `pause-after-lock-acquired:${suffix}`);
    await waitForFile(path.join(context.ledger, `.wowbagger-test-${suffix}-acquired`));
    await rewriteNumber(context.ledger, other, 9);
    await writeFile(path.join(context.ledger, `.wowbagger-test-${suffix}-allow-successor`), 'continue\n');

    const outcome = await pending;

    assert.equal(outcome.stdout.ok, false, JSON.stringify(outcome.stdout));
    assert.equal(outcome.stdout.state, 'unchanged');
    assert.equal(outcome.stdout.error.code, 'ledger-invalid');
    assert.ok(
      outcome.stdout.error.details.some((error) => error.code === 'duplicate-number'),
      JSON.stringify(outcome.stdout.error.details),
    );
    const after = await inspectItem(context.ledger, context.id);
    assert.equal(after.item.revision, inspected.item.revision);
  });
});

// `publish-claimed` locks every item in the ledger, so an item created after
// the shared snapshot widens the lock closure and drops the locks. The retry
// must read fresh: replaying the snapshot would choose the same too-narrow
// closure on every attempt and exhaust the retry budget.
test('a claimed publication whose lock closure widens still commits on retry', async () => {
  await withClaimedItem(async (context) => {
    const inspected = await inspectItem(context.ledger, context.id);
    const request = publicationRequest(context, inspected, 'pub_snapshot_0004', 'Published');

    const suffix = 'claimed-widen-closure';
    const pending = publish(context, request, `pause-after-lock-acquired:${suffix}`);
    await waitForFile(path.join(context.ledger, `.wowbagger-test-${suffix}-acquired`));
    const laterId = referringId(context.otherId);
    await writeFile(path.join(context.ledger, `${laterId}.md`), standaloneSource(laterId, 3));
    await writeFile(path.join(context.ledger, `.wowbagger-test-${suffix}-allow-successor`), 'continue\n');

    const outcome = await pending;

    assert.equal(outcome.stdout.ok, true, JSON.stringify(outcome.stdout));
    assert.equal(outcome.stdout.state, 'committed');
    const after = await inspectItem(context.ledger, context.id);
    assert.equal(after.item.core.title, 'Published');
  });
});

async function rewriteNumber(ledger, inspected, number) {
  const file = path.join(ledger, inspected.item.path);
  const source = await readFile(file, 'utf8');
  await writeFile(file, source.replace(/^number: .*$/m, `number: ${number}`));
}

// A hand-written item added mid-publication. `publish-claimed` locks every
// item, so its arrival alone widens the closure the snapshot chose.
function standaloneSource(id, number) {
  return `---
schema_version: 2
id: ${id}
number: ${number}
title: "Later item"
kind: task
priority: 50
status: triage
created: ${DATE}
updated: ${DATE}
provenance:
  source: "load-count"
  recorded_at: "${DATE}T00:00:00.000Z"
depends_on: []
related: []
decisions: []
---

Hand-written to widen the lock closure mid-publication.
`;
}

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
