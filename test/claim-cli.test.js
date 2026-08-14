// test/claim-cli.test.js
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
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
  assert.equal(spawnSync('git', ['init', '--quiet', root]).status, 0);
  await mkdir(path.join(root, 'ledger'));
  return root;
}

test('provision binds distinct namespaces to distinct ledgers in one repository', async () => {
  const root = await repository();
  const secondLedger = path.join(root, 'other-ledger');
  await mkdir(secondLedger);

  const first = await capture(['provision', '--ledger', path.join(root, 'ledger'), '--json']);
  const second = await capture(['provision', '--ledger', secondLedger, '--json']);

  assert.equal(first.exit, 0, JSON.stringify(first.envelope));
  assert.equal(second.exit, 0, JSON.stringify(second.envelope));
  assert.notEqual(first.envelope.result.ledger_namespace, second.envelope.result.ledger_namespace);
});

test('claim capabilities stay advisory for a fake git directory', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-fake-git-'));
  await mkdir(path.join(root, '.git'));
  const ledger = path.join(root, 'ledger');
  await mkdir(ledger);
  await mkdir(path.join(ledger, '.wowbagger'), { recursive: true });
  await writeFile(
    path.join(ledger, '.wowbagger', 'namespace'),
    'wbns_0123456789abcdef0123456789abcdef\n',
  );

  const capabilities = await capture(['claim', 'capabilities', '--ledger', ledger, '--json']);

  assert.equal(capabilities.exit, 0, JSON.stringify(capabilities.envelope));
  assert.equal(capabilities.envelope.result.operations.work_claim.mode, 'advisory');
});

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

test('claim capabilities, read, and verify do not write or reconcile', async () => {
  const root = await repository();
  const ledger = path.join(root, 'ledger');
  const provisioned = await capture(['provision', '--ledger', ledger, '--json']);
  const namespace = provisioned.envelope.result.ledger_namespace;
  const itemId = 'wb_01Q4837BM01W70T30B184GG1R6';
  const acquirePath = path.join(root, 'acquire-observational.json');
  await writeFile(acquirePath, JSON.stringify({
    ledger_namespace: namespace,
    item_id: itemId,
    owner_id: 'agent-observational',
    lease_duration_ms: 300000,
    expected: { last_epoch: '0', active: null },
  }));
  const acquired = await capture(['claim', 'acquire', '--ledger', ledger, '--input', acquirePath, '--json']);
  assert.equal(acquired.exit, 0, JSON.stringify(acquired.envelope));

  const claimRoot = path.join(root, '.git', 'wowbagger');
  const journalPath = path.join(claimRoot, namespace, 'journal.ndjson');
  const statePath = path.join(claimRoot, `claims-${namespace}.json`);
  const reconcilePath = path.join(ledger, '.wowbagger', `reconcile-${namespace}.md`);
  const before = await Promise.all([
    readFile(journalPath),
    readFile(statePath),
    readFile(reconcilePath),
    stat(claimRoot, { bigint: true }),
    stat(path.dirname(journalPath), { bigint: true }),
  ]);

  const capabilities = await capture(['claim', 'capabilities', '--ledger', ledger, '--json']);
  assert.equal(capabilities.exit, 0, JSON.stringify(capabilities.envelope));

  const readPath = path.join(root, 'read-observational.json');
  await writeFile(readPath, JSON.stringify({ ledger_namespace: namespace, item_id: itemId }));
  const observed = await capture(['claim', 'read', '--ledger', ledger, '--input', readPath, '--json']);
  assert.equal(observed.exit, 0, JSON.stringify(observed.envelope));
  assert.equal(observed.envelope.result.read_back.active.owner_id, 'agent-observational');

  const verifyPath = path.join(root, 'verify-observational.json');
  await writeFile(verifyPath, JSON.stringify({
    operation_id: 'pub_observational_0001',
    ledger_namespace: namespace,
    item_id: itemId,
  }));
  const verified = await capture(['claim', 'verify', '--ledger', ledger, '--input', verifyPath, '--json']);
  assert.equal(verified.exit, 2, JSON.stringify(verified.envelope));
  assert.equal(verified.envelope.error.code, 'operation-not-found');

  const after = await Promise.all([
    readFile(journalPath),
    readFile(statePath),
    readFile(reconcilePath),
    stat(claimRoot, { bigint: true }),
    stat(path.dirname(journalPath), { bigint: true }),
  ]);
  assert.deepEqual(after.slice(0, 3), before.slice(0, 3));
  assert.equal(after[3].mtimeNs, before[3].mtimeNs);
  assert.equal(after[4].mtimeNs, before[4].mtimeNs);
});

test('a full reconciliation log cannot hide a committed claim', async () => {
  const root = await repository();
  const ledger = path.join(root, 'ledger');
  const provisioned = await capture(['provision', '--ledger', ledger, '--json']);
  const namespace = provisioned.envelope.result.ledger_namespace;
  const request = {
    ledger_namespace: namespace,
    item_id: 'wb_01Q4837BM01W70T30B184GG1R6',
    owner_id: 'agent-a',
    lease_duration_ms: 300000,
    expected: { last_epoch: '0', active: null },
  };
  const requestPath = path.join(root, 'acquire-log-capacity.json');
  await writeFile(requestPath, JSON.stringify(request));
  const clockLine = `${JSON.stringify({
    seq: 2,
    type: 'clock',
    now: new Date().toISOString(),
    floor: '2030-01-11T09:00:00.000Z',
  })}\n`;
  const claimLine = `${JSON.stringify({
    seq: 3,
    type: 'claim',
    command: 'acquire',
    physical_now: new Date().toISOString(),
    request,
  })}\n`;
  const maxBytes = 8 * 1024 * 1024;
  const baseClock = {
    seq: 1,
    type: 'clock',
    now: '2030-01-11T09:00:00.000Z',
    floor: '2030-01-11T09:00:00.000Z',
    padding: '',
  };
  const baseLine = `${JSON.stringify(baseClock)}\n`;
  baseClock.padding = 'x'.repeat(
    maxBytes - Buffer.byteLength(clockLine) - Buffer.byteLength(claimLine) - Buffer.byteLength(baseLine),
  );
  const journalPath = path.join(root, '.git', 'wowbagger', namespace, 'journal.ndjson');
  await mkdir(path.dirname(journalPath), { recursive: true });
  await writeFile(journalPath, `${JSON.stringify(baseClock)}\n`);

  const acquired = await capture([
    'claim', 'acquire', '--ledger', ledger, '--input', requestPath, '--json',
  ]);

  assert.equal(acquired.exit, 0, JSON.stringify(acquired.envelope));
  assert.equal(acquired.envelope.state, 'committed');
  assert.equal(acquired.envelope.result.claim.owner_id, 'agent-a');
});

test('claim reads rebuild a corrupted snapshot memo from the journal', async () => {
  const root = await repository();
  const ledger = path.join(root, 'ledger');
  const provisioned = await capture(['provision', '--ledger', ledger, '--json']);
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
  const acquired = await capture(['claim', 'acquire', '--ledger', ledger, '--input', acquireRequest, '--json']);
  assert.equal(acquired.exit, 0);

  await writeFile(path.join(root, '.git', 'wowbagger', `claims-${namespace}.json`), '{corrupt');
  const readRequest = path.join(root, 'read.json');
  await writeFile(readRequest, JSON.stringify({ ledger_namespace: namespace, item_id: itemId }));
  const observed = await capture(['claim', 'read', '--ledger', ledger, '--input', readRequest, '--json']);

  assert.equal(observed.exit, 0);
  assert.equal(observed.envelope.result.read_back.active.owner_id, 'agent-a');
  assert.equal(observed.envelope.result.read_back.last_epoch, '1');
});

test('claim decisions materialize a per-namespace tracked reconciliation log', async () => {
  const root = await repository();
  const ledger = path.join(root, 'ledger');
  const provisioned = await capture(['provision', '--ledger', ledger, '--json']);
  const namespace = provisioned.envelope.result.ledger_namespace;
  const request = path.join(root, 'acquire.json');
  await writeFile(request, JSON.stringify({
    ledger_namespace: namespace,
    item_id: 'wb_01Q4837BM01W70T30B184GG1R6',
    owner_id: 'agent-a',
    lease_duration_ms: 300000,
    expected: { last_epoch: '0', active: null },
  }));

  const acquired = await capture(['claim', 'acquire', '--ledger', ledger, '--input', request, '--json']);

  assert.equal(acquired.exit, 0);
  const log = await readFile(path.join(ledger, '.wowbagger', `reconcile-${namespace}.md`), 'utf8');
  assert.match(log, new RegExp(`^# Wowbagger reconciliation log \`${namespace}\`\\n`, 'u'));
  assert.match(log, /"seq":1/u);
  assert.match(log, /"type":"claim"/u);
  assert.match(log, /"command":"acquire"/u);
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

test('a provisioned namespace advertises merge-coordinated claim capabilities', async () => {
  const root = await repository();
  const ledger = path.join(root, 'ledger');
  const provisioned = await capture(['provision', '--ledger', ledger, '--json']);
  const namespace = provisioned.envelope.result.ledger_namespace;

  const capabilities = await capture(['claim', 'capabilities', '--ledger', ledger, '--json']);

  assert.equal(capabilities.exit, 0);
  assert.deepEqual(capabilities.envelope.result.backend, {
    name: 'local-filesystem-git-journal',
    coordination_scope: 'shared-git-common-dir-serialized-journal',
    ledger_binding: { mode: 'explicit-allowlist', namespaces: [namespace] },
  });
  assert.deepEqual(capabilities.envelope.result.operations.work_claim, {
    supported: true,
    api_version: 1,
    mode: 'merge-coordinated',
    claim_protected_publication: true,
    fencing_enforced_at: 'git-history-reconciliation',
    safe_exclusive_dispatch: false,
    write_paths: {
      alternate: 'none',
      claimed_publication_v1: 'git-journal-fence',
      legacy_create_v1: 'reject-claimed-id',
      legacy_transition_v1: 'reject-active-claim',
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

test('a claim decision whose journal cannot be appended fails closed', async () => {
  const root = await repository();
  const provisioned = await capture(['provision', '--ledger', path.join(root, 'ledger'), '--json']);
  const namespace = provisioned.envelope.result.ledger_namespace;
  const journalPath = path.join(root, '.git', 'wowbagger', namespace, 'journal.ndjson');
  await mkdir(path.dirname(journalPath), { recursive: true });
  await writeFile(journalPath, '');
  await chmod(journalPath, 0o400);

  const request = path.join(root, 'acquire-read-only-journal.json');
  await writeFile(request, JSON.stringify({
    ledger_namespace: namespace,
    item_id: 'wb_01Q4837BM01W70T30B184GG1R6',
    owner_id: 'agent-read-only-journal',
    lease_duration_ms: 300000,
    expected: { last_epoch: '0', active: null },
  }));
  const refused = await capture([
    'claim', 'acquire', '--ledger', path.join(root, 'ledger'), '--input', request, '--json',
  ]);

  assert.equal(refused.exit, 6);
  assert.equal(refused.envelope.error.code, 'clock-floor-persistence-failed');
  assert.equal(refused.envelope.error.message, 'The authoritative clock floor could not be persisted.');
  assert.equal(refused.envelope.state, 'unchanged');
});

test('a corrupted claim journal returns claim-store-unavailable, not a crash', async () => {
  const root = await repository();
  const provisioned = await capture(['provision', '--ledger', path.join(root, 'ledger'), '--json']);
  const namespace = provisioned.envelope.result.ledger_namespace;
  const journalPath = path.join(root, '.git', 'wowbagger', namespace, 'journal.ndjson');
  await mkdir(path.dirname(journalPath), { recursive: true });
  await writeFile(journalPath, '{ not json');

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
