import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { appendClaimEntry, claimJournalPath, replayClaimJournal } from '../src/claim-journal.js';
import {
  claimStorePath,
  readClaimState,
  resolveGitCommonDir,
  withClaimLock,
  writeClaimState,
} from '../src/claim-store.js';

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

test('a dead lock owner does not disable the claim namespace', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-stale-lock-'));
  const storePath = claimStorePath(root, NS);
  await mkdir(path.dirname(storePath), { recursive: true });
  await writeFile(`${storePath}.lock`, `${JSON.stringify({
    version: 1,
    pid: 2147483647,
    token: 'stale-owner',
  })}\n`);

  const result = await withClaimLock(storePath, async () => 'recovered');

  assert.equal(result, 'recovered');
});

test('claim journal replay rebuilds the exact acquired state after restart', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-journal-'));
  const journalPath = claimJournalPath(root, NS);
  const itemId = 'wb_01Q4837BM01W70T30B184GG1R6';
  await appendClaimEntry(journalPath, {
    type: 'claim',
    command: 'acquire',
    physical_now: '2030-01-11T09:00:00.000Z',
    request: {
      ledger_namespace: NS,
      item_id: itemId,
      owner_id: 'agent-a-run-1',
      lease_duration_ms: 300000,
      expected: { last_epoch: '0', active: null },
    },
  });

  const replayed = await replayClaimJournal(journalPath, NS);
  assert.equal(replayed.entries.length, 1);
  assert.deepEqual(replayed.state, {
    schema_version: 1,
    ledger_namespace: NS,
    clock_floor: '2030-01-11T09:00:00.000Z',
    claims: [{
      item_id: itemId,
      last_epoch: '1',
      active: {
        owner_id: 'agent-a-run-1',
        epoch: '1',
        issued_at: '2030-01-11T09:00:00.000Z',
        expires_at: '2030-01-11T09:05:00.000Z',
      },
    }],
  });
});

test('claim journal replay retains a later durable clock floor', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-journal-floor-'));
  const journalPath = claimJournalPath(root, NS);
  await appendClaimEntry(journalPath, {
    type: 'clock',
    now: '2030-01-11T10:00:00.000Z',
    floor: '2030-01-11T10:00:00.000Z',
  });

  const replayed = await replayClaimJournal(journalPath, NS);

  assert.equal(replayed.state.clock_floor, '2030-01-11T10:00:00.000Z');
});

test('claim journal rejects entry 65537 without truncating history', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-journal-limit-'));
  const journalPath = claimJournalPath(root, NS);
  await mkdir(path.dirname(journalPath), { recursive: true });
  const entries = Array.from({ length: 65536 }, (_, index) => JSON.stringify({
    seq: index + 1,
    type: 'clock',
    now: '2030-01-11T09:00:00.000Z',
    floor: '2030-01-11T09:00:00.000Z',
  })).join('\n');
  await writeFile(journalPath, `${entries}\n`);

  await assert.rejects(
    appendClaimEntry(journalPath, { type: 'clock', now: '2030-01-11T09:00:00.000Z' }),
    (error) => error.code === 'CLAIM_JOURNAL_CAPACITY'
      && error.reason === 'journal-capacity-exceeded',
  );
});

test('claim journal rejects the first byte beyond 8 MiB', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-journal-bytes-'));
  const journalPath = claimJournalPath(root, NS);
  await mkdir(path.dirname(journalPath), { recursive: true });
  const prefix = '{"seq":1,"type":"clock","now":"2030-01-11T09:00:00.000Z","floor":"2030-01-11T09:00:00.000Z","padding":"';
  const suffix = '"}\n';
  const padding = 'x'.repeat(8388608 - Buffer.byteLength(prefix) - Buffer.byteLength(suffix));
  await writeFile(journalPath, `${prefix}${padding}${suffix}`);

  await assert.rejects(
    appendClaimEntry(journalPath, { type: 'clock', now: '2030-01-11T09:00:00.000Z' }),
    (error) => error.code === 'CLAIM_JOURNAL_CAPACITY'
      && error.reason === 'journal-capacity-exceeded',
  );
});

test('claim journal rejects a non-contiguous sequence during replay', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-journal-sequence-'));
  const journalPath = claimJournalPath(root, NS);
  await mkdir(path.dirname(journalPath), { recursive: true });
  await writeFile(journalPath, `${JSON.stringify({
    seq: 2,
    type: 'clock',
    now: '2030-01-11T09:00:00.000Z',
    floor: '2030-01-11T09:00:00.000Z',
  })}\n`);

  await assert.rejects(replayClaimJournal(journalPath, NS), (error) => (
    error.code === 'CLAIM_JOURNAL_INVALID'
      && error.reason === 'non-contiguous-sequence'
  ));
});

test('claim journal rejects an unknown entry type during replay', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-journal-type-'));
  const journalPath = claimJournalPath(root, NS);
  await mkdir(path.dirname(journalPath), { recursive: true });
  await writeFile(journalPath, '{"seq":1,"type":"unknown"}\n');

  await assert.rejects(replayClaimJournal(journalPath, NS), (error) => (
    error.code === 'CLAIM_JOURNAL_INVALID'
      && error.reason === 'unknown-entry-type'
  ));
});

test('claim journal rejects a malformed known entry during replay', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-journal-shape-'));
  const journalPath = claimJournalPath(root, NS);
  await mkdir(path.dirname(journalPath), { recursive: true });
  await writeFile(journalPath, '{"seq":1,"type":"claim","command":"read","physical_now":"2030-01-11T09:00:00.000Z","request":null}\n');

  await assert.rejects(replayClaimJournal(journalPath, NS), (error) => (
    error.code === 'CLAIM_JOURNAL_INVALID'
      && error.reason === 'invalid-entry'
  ));
});

test('claim journal rejects a publication final from another namespace', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-journal-terminal-'));
  const journalPath = claimJournalPath(root, NS);
  await mkdir(path.dirname(journalPath), { recursive: true });
  await writeFile(journalPath, `${JSON.stringify({
    seq: 1,
    type: 'publish-final',
    operation_id: 'pub_agent-a_0001',
    operation_digest: `sha256:${'0'.repeat(64)}`,
    ledger_namespace: 'wbns_ffffffffffffffffffffffffffffffff',
    item_id: 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV',
    outcome: {
      exit: 0,
      stdout: {
        ok: true,
        namespace: 'ledger-publication',
        command: 'publish-claimed',
        contract_version: 1,
        state: 'committed',
        operation_id: 'pub_agent-a_0001',
        result: {
          ledger_namespace: 'wbns_ffffffffffffffffffffffffffffffff',
          item_id: 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV',
          committed_revision: `sha256:${'1'.repeat(64)}`,
          claim_fence: {
            ledger_namespace: 'wbns_ffffffffffffffffffffffffffffffff',
            item_id: 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV',
            owner_id: 'agent-a',
            epoch: '1',
          },
          claim_read_back: {},
        },
      },
    },
  })}\n`);

  await assert.rejects(replayClaimJournal(journalPath, NS), (error) => (
    error.code === 'CLAIM_JOURNAL_INVALID'
      && error.reason === 'invalid-entry'
  ));
});
