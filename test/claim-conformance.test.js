// test/claim-conformance.test.js
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { claimAcquire, claimRead, claimRelease, claimRenew } from '../src/claim-operations.js';
import { claimStorePath, readClaimState, resolveGitCommonDir, writeClaimState } from '../src/claim-store.js';
import { runCli } from '../src/cli.js';
import { runReferenceVector } from './work-claim-reference.js';

async function capture(argumentsList) {
  const written = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { written.push(chunk); return true; };
  process.exitCode = 0;
  try {
    await runCli(argumentsList);
  } finally {
    process.stdout.write = write;
  }
  const exit = process.exitCode;
  process.exitCode = 0;
  return { envelope: JSON.parse(written.join('')), exit };
}

async function repository() {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-conformance-cli-'));
  assert.equal(spawnSync('git', ['init', '--quiet', root]).status, 0);
  await mkdir(path.join(root, 'ledger'));
  return root;
}

const fixtureRoot = new URL('../spec/fixtures/work-claims/', import.meta.url);
const NS = 'wbns_11111111111111111111111111111111';

function manifest(name) {
  return JSON.parse(readFileSync(new URL(`${name}/manifest.json`, fixtureRoot), 'utf8'));
}

const operations = {
  'work-claim.read': claimRead,
  'work-claim.acquire': claimAcquire,
  'work-claim.renew': claimRenew,
  'work-claim.release': claimRelease,
};

// Translate a fixture's durable claim state into our store shape.
function toStoreState(durable) {
  const record = durable.claims.find((entry) => entry.ledger_namespace === NS);
  const floor = durable.clock_floors.find((entry) => entry.ledger_namespace === NS);
  return {
    schema_version: 1,
    ledger_namespace: NS,
    clock_floor: floor ? floor.observed_at : null,
    claims: record ? [{ item_id: record.item_id, last_epoch: record.last_epoch, active: record.active }] : [],
  };
}

for (const name of ['acquire-contention', 'expiry-takeover', 'renew-release-restart-aba', 'epoch-exhaustion']) {
  test(`${name}: implementation envelopes match the reference model`, () => {
    const source = manifest(name);
    const claimActions = source.actions.filter((action) => operations[action.operation]);
    assert.ok(claimActions.length > 0, 'fixture has no claim actions');

    const expected = runReferenceVector({ initial: source.initial, actions: source.actions });
    let state = toStoreState(source.initial.durable);
    let index = 0;
    for (const [position, action] of source.actions.entries()) {
      if (!operations[action.operation]) continue;
      const result = operations[action.operation](state, action.request, action.physical_now);
      state = result.state;
      assert.deepEqual(result.envelope, expected.transcript[position],
        `${name} action ${index} (${action.operation}) diverged from the reference model`);
      index += 1;
    }
  });
}

test('a claim taken in one worktree is visible from another', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-wt-'));
  const main = path.join(root, 'main');
  const tree = path.join(root, 'tree');
  await mkdir(path.join(main, '.git', 'worktrees', 'tree'), { recursive: true });
  await mkdir(path.join(main, 'ledger'), { recursive: true });
  await mkdir(path.join(tree, 'ledger'), { recursive: true });
  await writeFile(path.join(main, '.git', 'worktrees', 'tree', 'commondir'), '../..\n');
  await writeFile(path.join(tree, '.git'), `gitdir: ${path.join(main, '.git', 'worktrees', 'tree')}\n`);

  const fromMain = await resolveGitCommonDir(path.join(main, 'ledger'));
  const fromTree = await resolveGitCommonDir(path.join(tree, 'ledger'));
  assert.equal(fromMain, fromTree);

  const storePath = claimStorePath(fromMain, NS);
  const state = { schema_version: 1, ledger_namespace: NS, clock_floor: null, claims: [
    { item_id: 'wb_01Q4837BM01W70T30B184GG1R6', last_epoch: '1', active: {
      owner_id: 'agent-in-main', epoch: '1',
      issued_at: '2026-08-06T09:00:00.000Z', expires_at: '2026-08-06T09:05:00.000Z' } },
  ] };
  await writeClaimState(storePath, state);

  const seen = await readClaimState(claimStorePath(fromTree, NS), NS);
  assert.equal(seen.claims[0].active.owner_id, 'agent-in-main');
});

test('the durable clock floor advances even when an operation is rejected', async () => {
  const root = await repository();
  const provisioned = await capture(['provision', '--ledger', path.join(root, 'ledger'), '--json']);
  const namespace = provisioned.envelope.result.ledger_namespace;
  const itemId = 'wb_01Q4837BM01W70T30B184GG1R6';

  const acquireRequest = path.join(root, 'acquire.json');
  await writeFile(acquireRequest, JSON.stringify({
    ledger_namespace: namespace,
    item_id: itemId,
    owner_id: 'agent-a',
    lease_duration_ms: 300000,
    expected: { last_epoch: '0', active: null },
  }));
  const acquired = await capture(['claim', 'acquire', '--ledger', path.join(root, 'ledger'), '--input', acquireRequest, '--json']);
  assert.equal(acquired.exit, 0);

  const storePath = path.join(root, '.git', 'wowbagger', `claims-${namespace}.json`);
  const floorAfterAcquire = JSON.parse(await readFile(storePath, 'utf8')).clock_floor;

  // A wrong witness: this is REJECTED (claim-conflict), not applied, but the pure
  // operations still advance clock_floor on their returned state, and the CLI must
  // persist that state regardless of exit code. A refactor that only writes on
  // exit === 0 would silently stop advancing the floor on refusals, and every
  // existing test would still pass, because it doesn't check clock_floor movement
  // on a rejected operation.
  const rejectedRequest = path.join(root, 'acquire-rejected.json');
  await writeFile(rejectedRequest, JSON.stringify({
    ledger_namespace: namespace,
    item_id: itemId,
    owner_id: 'agent-b',
    lease_duration_ms: 300000,
    expected: { last_epoch: '0', active: null }, // stale witness — the item is already claimed
  }));
  const rejected = await capture(['claim', 'acquire', '--ledger', path.join(root, 'ledger'), '--input', rejectedRequest, '--json']);
  assert.equal(rejected.exit, 4);
  assert.equal(rejected.envelope.error.code, 'claim-conflict');

  const floorAfterRejection = JSON.parse(await readFile(storePath, 'utf8')).clock_floor;
  assert.ok(floorAfterRejection > floorAfterAcquire,
    `expected clock_floor to strictly advance after a REJECTED operation (was ${floorAfterAcquire}, now ${floorAfterRejection})`);
});

test('claim reads bypass a contended lock while claim decisions fail closed', async () => {
  const root = await repository();
  const ledger = path.join(root, 'ledger');
  const provisioned = await capture(['provision', '--ledger', ledger, '--json']);
  const namespace = provisioned.envelope.result.ledger_namespace;
  const storePath = path.join(root, '.git', 'wowbagger', `claims-${namespace}.json`);
  await mkdir(path.dirname(storePath), { recursive: true });
  const lockPath = `${storePath}.lock`;
  await writeFile(lockPath, '');

  try {
    const readRequest = path.join(root, 'read-contended.json');
    await writeFile(readRequest, JSON.stringify({
      ledger_namespace: namespace, item_id: 'wb_01Q4837BM01W70T30B184GG1R6',
    }));
    const observed = await capture([
      'claim', 'read', '--ledger', ledger, '--input', readRequest, '--json',
    ]);
    assert.equal(observed.exit, 0, JSON.stringify(observed.envelope));
    assert.equal(observed.envelope.result.read_back.active, null);

    const acquireRequest = path.join(root, 'acquire-contended.json');
    await writeFile(acquireRequest, JSON.stringify({
      ledger_namespace: namespace,
      item_id: 'wb_01Q4837BM01W70T30B184GG1R6',
      owner_id: 'agent-contended',
      lease_duration_ms: 300000,
      expected: { last_epoch: '0', active: null },
    }));
    const refused = await capture([
      'claim', 'acquire', '--ledger', ledger, '--input', acquireRequest, '--json',
    ]);
    assert.equal(refused.exit, 6);
    assert.equal(refused.envelope.error.code, 'claim-store-unavailable');
    assert.equal(refused.envelope.error.details.reason, 'claim-store-locked');
    assert.equal(refused.envelope.state, 'unchanged');
  } finally {
    await rm(lockPath, { force: true });
  }
});
