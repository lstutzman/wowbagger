import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { claimStorePath, readClaimState, resolveGitCommonDir, writeClaimState } from '../src/claim-store.js';

const NS = 'wbns_0123456789abcdef0123456789abcdef';

test('a .git directory is the common directory', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-store-'));
  await mkdir(path.join(root, '.git'));
  await mkdir(path.join(root, 'ledger'));
  assert.equal(await resolveGitCommonDir(path.join(root, 'ledger')), path.join(root, '.git'));
});

test('no git layout resolves to null', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-store-'));
  await mkdir(path.join(root, 'ledger'));
  assert.equal(await resolveGitCommonDir(path.join(root, 'ledger')), null);
});

test('a .git file follows gitdir and commondir to the shared directory', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-store-'));
  const main = path.join(root, 'main');
  const tree = path.join(root, 'tree');
  await mkdir(path.join(main, '.git', 'worktrees', 'tree'), { recursive: true });
  await mkdir(path.join(tree, 'ledger'), { recursive: true });
  await writeFile(path.join(main, '.git', 'worktrees', 'tree', 'commondir'), '../..\n');
  await writeFile(path.join(tree, '.git'), `gitdir: ${path.join(main, '.git', 'worktrees', 'tree')}\n`);
  assert.equal(await resolveGitCommonDir(path.join(tree, 'ledger')), path.join(main, '.git'));
});

test('claim state round-trips and is absent-safe', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-store-'));
  const storePath = claimStorePath(root, NS);
  const empty = await readClaimState(storePath, NS);
  assert.deepEqual(empty, { schema_version: 1, ledger_namespace: NS, clock_floor: null, claims: [] });
  empty.clock_floor = '2026-08-06T09:00:00.000Z';
  empty.claims.push({ item_id: 'wb_01Q4837BM01W70T30B184GG1R6', last_epoch: '1', active: null });
  await writeClaimState(storePath, empty);
  assert.deepEqual(await readClaimState(storePath, NS), empty);
});

test('state written for another namespace is not readable as this one', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-store-'));
  const storePath = claimStorePath(root, NS);
  await writeClaimState(storePath, { schema_version: 1, ledger_namespace: 'wbns_ffffffffffffffffffffffffffffffff', clock_floor: null, claims: [] });
  assert.deepEqual(await readClaimState(storePath, NS), { schema_version: 1, ledger_namespace: NS, clock_floor: null, claims: [] });
});
