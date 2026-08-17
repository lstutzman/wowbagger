// Crash recovery at every barrier of a claimed publication (ledger item #122).
//
// The publication now takes no per-item locks and relies entirely on the
// namespace process lock it already holds. That makes the namespace lock the
// only thing standing between a killed writer and a successor, so every
// barrier is tested by actually killing the process there: SIGKILL leaves the
// lock file behind with a dead PID, and the successor must recover it, resolve
// the journal, and produce the same claim-verify finding a survivor would.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  publicationRequest, waitForFile, withProvisionedLedger,
} from './claimed-publication-harness.js';
import { inspectItem } from '../src/mutation.js';

const CLI = fileURLToPath(new URL('../bin/wowbagger.js', import.meta.url));
const CHILD = fileURLToPath(new URL('./publish-kill-child.js', import.meta.url));

function capture(argumentsList) {
  const result = spawnSync(process.execPath, [CLI, ...argumentsList], { encoding: 'utf8' });
  return { envelope: JSON.parse(result.stdout), exit: result.status };
}

// Runs the publication in a child process, waits for it to announce the
// barrier, and kills it there. Returns once the child is gone.
async function killAtBarrier(context, request, point) {
  const requestPath = path.join(context.root, `kill-${point}.json`);
  await writeFile(requestPath, JSON.stringify(request));
  const child = spawn(process.execPath, [
    CHILD, context.ledger, context.gitCommonDir, context.namespace, requestPath, point,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  await waitForFile(path.join(context.ledger, `.wowbagger-test-reached-${point}`));
  child.kill('SIGKILL');
  const result = await exited;
  assert.equal(result.signal, 'SIGKILL', `child exited ${result.code} instead of being killed`);
}

async function verifyPublication(context, request) {
  const readPath = path.join(context.root, `read-${request.operation_id}.json`);
  await writeFile(readPath, JSON.stringify({
    operation_id: request.operation_id,
    ledger_namespace: request.ledger_namespace,
    item_id: request.item_id,
  }));
  return capture(['claim', 'verify', '--ledger', context.ledger, '--input', readPath, '--json']);
}

// The killed writer holds no item locks to leak. Before this stage a killed
// publication left one stale lock file per ledger item, and nothing removes
// those automatically.
async function assertNoItemLocks(context) {
  let entries = [];
  try {
    entries = await readdir(path.join(context.ledger, '.wowbagger-locks'));
  } catch (error) {
    assert.equal(error.code, 'ENOENT');
  }
  assert.deepEqual(entries.filter((name) => name.endsWith('.lock')), []);
}

async function claimedContext(callback) {
  return withProvisionedLedger(2, async (context) => {
    const inspected = await inspectItem(context.ledger, context.id);
    return callback(context, inspected);
  });
}

test('a publication killed before its intent leaves nothing to recover', async () => {
  await claimedContext(async (context, inspected) => {
    const request = publicationRequest(context, inspected, 'pub_kill_0001', 'Published');

    await killAtBarrier(context, request, 'before-publish-intent');

    const verified = capture(['claim-verify', '--ledger', context.ledger, '--json']);
    assert.equal(verified.exit, 0, JSON.stringify(verified.envelope));
    assert.deepEqual(verified.envelope.result.findings.map(({ code }) => code), []);
    const after = await inspectItem(context.ledger, context.id);
    assert.equal(after.item.revision, inspected.item.revision);
    await assertNoItemLocks(context);
  });
});

test('a publication killed after its intent but before the write is rolled back', async () => {
  await claimedContext(async (context, inspected) => {
    const request = publicationRequest(context, inspected, 'pub_kill_0002', 'Published');

    await killAtBarrier(context, request, 'after-publish-intent');

    const verified = capture(['claim-verify', '--ledger', context.ledger, '--json']);
    assert.equal(verified.exit, 0, JSON.stringify(verified.envelope));
    assert.deepEqual(verified.envelope.result.findings.map(({ code }) => code), ['pending-intent-resolved']);
    const read = await verifyPublication(context, request);
    assert.equal(read.envelope.result.outcome.stdout.error.code, 'ledger-revision-conflict');
    const after = await inspectItem(context.ledger, context.id);
    assert.equal(after.item.revision, inspected.item.revision);
    await assertNoItemLocks(context);
  });
});

test('a publication killed after the item is written but before its terminal record rolls forward', async () => {
  await claimedContext(async (context, inspected) => {
    const request = publicationRequest(context, inspected, 'pub_kill_0003', 'Published');

    await killAtBarrier(context, request, 'after-ledger-commit');

    const verified = capture(['claim-verify', '--ledger', context.ledger, '--json']);
    assert.equal(verified.exit, 0, JSON.stringify(verified.envelope));
    assert.deepEqual(verified.envelope.result.findings.map(({ code }) => code), ['pending-intent-resolved']);
    const read = await verifyPublication(context, request);
    assert.equal(read.envelope.result.outcome.stdout.state, 'committed');
    const after = await inspectItem(context.ledger, context.id);
    assert.equal(after.item.core.title, 'Published');
    await assertNoItemLocks(context);
  });
});

test('a publication killed after its terminal record but before Git finalization stays committed', async () => {
  await claimedContext(async (context, inspected) => {
    const request = publicationRequest(context, inspected, 'pub_kill_0004', 'Published');

    await killAtBarrier(context, request, 'after-terminal-record');

    const verified = capture(['claim-verify', '--ledger', context.ledger, '--json']);
    assert.equal(verified.exit, 0, JSON.stringify(verified.envelope));
    const publication = verified.envelope.result.publications
      .find((entry) => entry.operation_id === request.operation_id);
    assert.equal(publication.git_finalized, false, JSON.stringify(verified.envelope.result.publications));
    const read = await verifyPublication(context, request);
    assert.equal(read.envelope.result.outcome.stdout.state, 'committed');
    const after = await readFile(path.join(context.ledger, `${context.id}.md`), 'utf8');
    assert.match(after, /title: "Published"/);
    await assertNoItemLocks(context);
  });
});
