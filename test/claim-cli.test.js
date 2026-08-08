// test/claim-cli.test.js
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runCli } from '../src/cli.js';

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
  const root = await mkdtemp(path.join(tmpdir(), 'wb-cli-'));
  await mkdir(path.join(root, '.git'));
  await mkdir(path.join(root, 'ledger'));
  return root;
}

test('a claim acquired through the CLI is visible to a later read', async () => {
  const root = await repository();
  const provisioned = await capture(['provision', '--ledger', path.join(root, 'ledger'), '--json']);
  const namespace = provisioned.envelope.result.ledger_namespace;
  const request = path.join(root, 'acquire.json');
  await writeFile(request, JSON.stringify({
    ledger_namespace: namespace,
    item_id: 'wb_01Q4837BM01W70T30B184GG1R6',
    owner_id: 'agent-a',
    lease_duration_ms: 300000,
    expected: { last_epoch: '0', active: null },
  }));
  const acquired = await capture(['claim', 'acquire', '--ledger', path.join(root, 'ledger'), '--input', request, '--json']);
  assert.equal(acquired.exit, 0);
  assert.equal(acquired.envelope.result.claim.epoch, '1');

  const readRequest = path.join(root, 'read.json');
  await writeFile(readRequest, JSON.stringify({
    ledger_namespace: namespace, item_id: 'wb_01Q4837BM01W70T30B184GG1R6',
  }));
  const observed = await capture(['claim', 'read', '--ledger', path.join(root, 'ledger'), '--input', readRequest, '--json']);
  assert.equal(observed.envelope.result.read_back.active.owner_id, 'agent-a');
  assert.equal(observed.envelope.result.read_back.last_epoch, '1');
});

test('claim commands refuse outside a git repository', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-nogit-'));
  await mkdir(path.join(root, 'ledger'));
  await mkdir(path.join(root, '.wowbagger'));
  await writeFile(path.join(root, '.wowbagger', 'namespace'), 'wbns_0123456789abcdef0123456789abcdef\n');
  const request = path.join(root, 'read.json');
  await writeFile(request, JSON.stringify({
    ledger_namespace: 'wbns_0123456789abcdef0123456789abcdef',
    item_id: 'wb_01Q4837BM01W70T30B184GG1R6',
  }));
  const refused = await capture(['claim', 'read', '--ledger', path.join(root, 'ledger'), '--input', request, '--json']);
  assert.equal(refused.exit, 6);
  assert.equal(refused.envelope.error.code, 'claim-store-unavailable');
  assert.equal(refused.envelope.error.message, 'The durable claim store is unavailable.');
  assert.equal(refused.envelope.error.details.reason, 'git-directory-not-found');
  assert.equal(refused.envelope.state, 'unchanged');
});

test('a request naming an unprovisioned namespace is rejected', async () => {
  const root = await repository();
  await capture(['provision', '--ledger', path.join(root, 'ledger'), '--json']);
  const request = path.join(root, 'read.json');
  await writeFile(request, JSON.stringify({
    ledger_namespace: 'wbns_ffffffffffffffffffffffffffffffff',
    item_id: 'wb_01Q4837BM01W70T30B184GG1R6',
  }));
  const refused = await capture(['claim', 'read', '--ledger', path.join(root, 'ledger'), '--input', request, '--json']);
  assert.equal(refused.exit, 2);
  assert.equal(refused.envelope.error.code, 'ledger-namespace-unbound');
});

test('claim capabilities reports the contract-shaped envelope, distinct from top-level capabilities', async () => {
  const root = await repository();
  const capabilities = await capture(['claim', 'capabilities', '--ledger', path.join(root, 'ledger'), '--json']);
  assert.equal(capabilities.exit, 0);
  assert.deepEqual(capabilities.envelope, {
    ok: true,
    namespace: 'work-claim',
    command: 'capabilities',
    contract_version: 1,
    result: {
      backend: {
        name: 'local-filesystem',
        coordination_scope: 'shared-git-directory-cooperative-writers',
      },
      operations: {
        work_claim: {
          supported: true,
          api_version: 1,
          mode: 'advisory',
          claim_protected_publication: false,
          fencing_enforced_at: 'none',
          safe_exclusive_dispatch: false,
        },
      },
    },
  });
});

test('a takeover with a non-null observed active claim succeeds and advances the epoch', async () => {
  // Regression for the CRITICAL defect: the loose JSON parser gives every nested
  // request object a null prototype, and claimAcquire's CAS check compares the
  // witness with isDeepStrictEqual, which treats prototypes as significant. A
  // shallow request normalization (unwrapping only the top-level lease_duration_ms)
  // left `expected.active` null-prototyped, so this exact flow always returned
  // claim-conflict even for a byte-identical, expired witness.
  const root = await repository();
  const provisioned = await capture(['provision', '--ledger', path.join(root, 'ledger'), '--json']);
  const namespace = provisioned.envelope.result.ledger_namespace;
  const itemId = 'wb_01Q4837BM01W70T30B184GG1R6';

  const firstRequest = path.join(root, 'acquire-1.json');
  await writeFile(firstRequest, JSON.stringify({
    ledger_namespace: namespace,
    item_id: itemId,
    owner_id: 'agent-a',
    lease_duration_ms: 1,
    expected: { last_epoch: '0', active: null },
  }));
  const first = await capture(['claim', 'acquire', '--ledger', path.join(root, 'ledger'), '--input', firstRequest, '--json']);
  assert.equal(first.exit, 0);
  assert.equal(first.envelope.result.claim.epoch, '1');

  // Guarantee the 1ms lease has expired before the takeover attempt.
  await new Promise((resolve) => { setTimeout(resolve, 20); });

  const takeoverRequest = path.join(root, 'acquire-2.json');
  await writeFile(takeoverRequest, JSON.stringify({
    ledger_namespace: namespace,
    item_id: itemId,
    owner_id: 'agent-b',
    lease_duration_ms: 300000,
    // The exact tuple returned by the first acquire — a non-null active object,
    // which is the shape the null-prototype bug broke.
    expected: { last_epoch: '1', active: first.envelope.result.claim },
  }));
  const takeover = await capture(['claim', 'acquire', '--ledger', path.join(root, 'ledger'), '--input', takeoverRequest, '--json']);
  assert.equal(takeover.exit, 0);
  assert.equal(takeover.envelope.result.claim.epoch, '2');
  assert.equal(takeover.envelope.result.claim.owner_id, 'agent-b');
});

test('a null request body is rejected as invalid-request instead of crashing', async () => {
  const root = await repository();
  await capture(['provision', '--ledger', path.join(root, 'ledger'), '--json']);
  const request = path.join(root, 'null.json');
  await writeFile(request, 'null');
  const refused = await capture(['claim', 'read', '--ledger', path.join(root, 'ledger'), '--input', request, '--json']);
  assert.equal(refused.exit, 2);
  assert.equal(refused.envelope.error.code, 'invalid-request');
});

test('an acquire request missing the expected member is rejected as invalid-request', async () => {
  const root = await repository();
  const provisioned = await capture(['provision', '--ledger', path.join(root, 'ledger'), '--json']);
  const namespace = provisioned.envelope.result.ledger_namespace;
  const request = path.join(root, 'acquire-missing-expected.json');
  await writeFile(request, JSON.stringify({
    ledger_namespace: namespace,
    item_id: 'wb_01Q4837BM01W70T30B184GG1R6',
    owner_id: 'agent-a',
    lease_duration_ms: 300000,
  }));
  const refused = await capture(['claim', 'acquire', '--ledger', path.join(root, 'ledger'), '--input', request, '--json']);
  assert.equal(refused.exit, 2);
  assert.equal(refused.envelope.error.code, 'invalid-request');
});

// validateClaimRequest holds the request to an exact member set. `__proto__`
// is the member spelling a rebuild that assigns rather than defines silently
// erases from `Object.keys`, so the extra member would otherwise slip past
// the exact-member check.
test('a read request carrying a __proto__ member is rejected as invalid-request', async () => {
  const root = await repository();
  const provisioned = await capture(['provision', '--ledger', path.join(root, 'ledger'), '--json']);
  const namespace = provisioned.envelope.result.ledger_namespace;
  const request = path.join(root, 'read-proto-member.json');
  await writeFile(request, `{"__proto__":{"polluted":true},"ledger_namespace":"${namespace}",`
    + '"item_id":"wb_01Q4837BM01W70T30B184GG1R6"}');
  const refused = await capture(['claim', 'read', '--ledger', path.join(root, 'ledger'), '--input', request, '--json']);
  assert.equal(refused.exit, 2);
  assert.equal(refused.envelope.error.code, 'invalid-request');
});

test('a read request missing item_id is rejected without persisting a junk record', async () => {
  const root = await repository();
  const provisioned = await capture(['provision', '--ledger', path.join(root, 'ledger'), '--json']);
  const namespace = provisioned.envelope.result.ledger_namespace;
  const request = path.join(root, 'read-missing-item-id.json');
  await writeFile(request, JSON.stringify({ ledger_namespace: namespace }));
  const refused = await capture(['claim', 'read', '--ledger', path.join(root, 'ledger'), '--input', request, '--json']);
  assert.equal(refused.exit, 2);
  assert.equal(refused.envelope.error.code, 'invalid-request');

  const storePath = path.join(root, '.git', 'wowbagger', `claims-${namespace}.json`);
  await assert.rejects(stat(storePath), { code: 'ENOENT' });
});

test('a claim store that cannot be written returns clock-floor-persistence-failed', async () => {
  const root = await repository();
  const provisioned = await capture(['provision', '--ledger', path.join(root, 'ledger'), '--json']);
  const namespace = provisioned.envelope.result.ledger_namespace;
  const storePath = path.join(root, '.git', 'wowbagger', `claims-${namespace}.json`);
  await mkdir(`${storePath}.tmp`, { recursive: true });

  const request = path.join(root, 'read.json');
  await writeFile(request, JSON.stringify({
    ledger_namespace: namespace, item_id: 'wb_01Q4837BM01W70T30B184GG1R6',
  }));
  const refused = await capture(['claim', 'read', '--ledger', path.join(root, 'ledger'), '--input', request, '--json']);

  assert.equal(refused.exit, 6);
  assert.equal(refused.envelope.error.code, 'clock-floor-persistence-failed');
  assert.equal(refused.envelope.error.message, 'The authoritative clock floor could not be persisted.');
  assert.equal(refused.envelope.state, 'unchanged');
});

test('a corrupted claim store returns claim-store-unavailable, not a crash', async () => {
  const root = await repository();
  const provisioned = await capture(['provision', '--ledger', path.join(root, 'ledger'), '--json']);
  const namespace = provisioned.envelope.result.ledger_namespace;
  const storePath = path.join(root, '.git', 'wowbagger', `claims-${namespace}.json`);
  await mkdir(path.dirname(storePath), { recursive: true });
  await writeFile(storePath, '{ not json');

  const request = path.join(root, 'read.json');
  await writeFile(request, JSON.stringify({
    ledger_namespace: namespace, item_id: 'wb_01Q4837BM01W70T30B184GG1R6',
  }));
  const refused = await capture(['claim', 'read', '--ledger', path.join(root, 'ledger'), '--input', request, '--json']);

  assert.equal(refused.exit, 6);
  assert.equal(refused.envelope.error.code, 'claim-store-unavailable');
  assert.equal(refused.envelope.error.message, 'The durable claim store is unavailable.');
  assert.equal(refused.envelope.error.details.reason, 'claim-store-unreadable');
  assert.equal(refused.envelope.state, 'unchanged');
});
