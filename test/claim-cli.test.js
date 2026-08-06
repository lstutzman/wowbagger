// test/claim-cli.test.js
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
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
