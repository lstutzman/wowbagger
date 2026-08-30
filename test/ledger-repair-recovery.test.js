import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';

import {
  appendClaimEntry,
  claimJournalPath,
  replayClaimJournal,
} from '../src/claim-journal.js';
import {
  readStagedNumberRepair,
  repairStagingPath,
  stageNumberRepairCandidates,
} from '../src/ledger-repair.js';

const NS = 'ledger-repair-test';
const ITEM = 'wb_01Q4837BM01W70T30B184GG1R6';
const REVISION = `sha256:${'a'.repeat(64)}`;
const CANDIDATE = `sha256:${'b'.repeat(64)}`;

function intent() {
  return {
    type: 'number-repair-intent',
    repair_id: 'nr_20260830_0001',
    ledger_namespace: NS,
    ledger_snapshot_revision: REVISION,
    date: '2026-08-30',
    staging_id: 'nr_20260830_0001',
    items: [{
      item_id: ITEM,
      item_path: `items/${ITEM}.md`,
      expected_revision: REVISION,
      expected_number: 7,
      replacement_number: 8,
      candidate_revision: CANDIDATE,
    }],
  };
}

test('number-repair journal accepts one valid intent and final pair', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-repair-journal-'));
  try {
    const journalPath = claimJournalPath(root, NS);
    await appendClaimEntry(journalPath, intent());
    await appendClaimEntry(journalPath, {
      type: 'number-repair-final',
      repair_id: 'nr_20260830_0001',
      ledger_namespace: NS,
      staging_id: 'nr_20260830_0001',
      items: [{
        item_id: ITEM,
        item_path: `items/${ITEM}.md`,
        candidate_revision: CANDIDATE,
        committed_revision: CANDIDATE,
      }],
      observed_at: '2030-01-11T09:00:00.000Z',
    });
    const replayed = await replayClaimJournal(journalPath, NS);
    assert.equal(replayed.entries.length, 2);
    assert.equal(replayed.entries[0].type, 'number-repair-intent');
    assert.equal(replayed.entries[1].type, 'number-repair-final');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('number-repair staging durably round-trips candidate bytes and manifest', async () => {
  const common = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-repair-stage-'));
  const bytes = Buffer.from('candidate bytes\n');
  const candidateRevision = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  try {
    const manifest = await stageNumberRepairCandidates({
      gitCommonDir: common,
      namespace: NS,
      repairId: 'nr_20260830_0002',
      ledgerSnapshotRevision: REVISION,
      candidates: [{
        item_id: ITEM,
        path: `items/${ITEM}.md`,
        candidate_revision: candidateRevision,
        candidate_bytes: bytes,
      }],
    });
    assert.equal(manifest.candidates[0].sha256, candidateRevision);
    const staged = await readStagedNumberRepair({
      gitCommonDir: common,
      namespace: NS,
      repairId: 'nr_20260830_0002',
    });
    assert.deepEqual(staged.candidates[0].candidate_bytes, bytes);
    assert.equal(
      await readFile(path.join(repairStagingPath(common, NS, 'nr_20260830_0002'), 'manifest.json'), 'utf8'),
      `${JSON.stringify(manifest)}\n`,
    );
  } finally {
    await rm(common, { recursive: true, force: true });
  }
});

test('number-repair staging rejects a tampered candidate digest', async () => {
  const common = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-repair-stage-tamper-'));
  const bytes = Buffer.from('candidate bytes\n');
  const candidateRevision = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const repairId = 'nr_20260830_0003';
  try {
    await stageNumberRepairCandidates({
      gitCommonDir: common,
      namespace: NS,
      repairId,
      ledgerSnapshotRevision: REVISION,
      candidates: [{
        item_id: ITEM,
        path: `items/${ITEM}.md`,
        candidate_revision: candidateRevision,
        candidate_bytes: bytes,
      }],
    });
    await writeFile(
      path.join(repairStagingPath(common, NS, repairId), 'candidates', 'items', `${ITEM}.md`),
      'tampered\n',
    );
    await assert.rejects(
      readStagedNumberRepair({ gitCommonDir: common, namespace: NS, repairId }),
      (error) => error.code === 'LEDGER_REPAIR_STAGING_INVALID'
        && error.reason === 'candidate-digest-mismatch',
    );
  } finally {
    await rm(common, { recursive: true, force: true });
  }
});

test('number-repair staging rejects traversal candidate paths', async () => {
  const common = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-repair-stage-traversal-'));
  try {
    await assert.rejects(
      stageNumberRepairCandidates({
        gitCommonDir: common,
        namespace: NS,
        repairId: 'nr_20260830_0004',
        ledgerSnapshotRevision: REVISION,
        candidates: [{
          item_id: ITEM,
          path: '../escape.md',
          candidate_revision: CANDIDATE,
          candidate_bytes: Buffer.from('candidate bytes\\n'),
        }],
      }),
      (error) => error.code === 'LEDGER_REPAIR_STAGING_INVALID'
        && error.reason === 'candidate-shape',
    );
  } finally {
    await rm(common, { recursive: true, force: true });
  }
});

test('number-repair staging rejects an absent candidate file', async () => {
  const common = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-repair-stage-absent-'));
  const bytes = Buffer.from('candidate bytes\n');
  const candidateRevision = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const repairId = 'nr_20260830_0005';
  try {
    await stageNumberRepairCandidates({
      gitCommonDir: common,
      namespace: NS,
      repairId,
      ledgerSnapshotRevision: REVISION,
      candidates: [{
        item_id: ITEM,
        path: `items/${ITEM}.md`,
        candidate_revision: candidateRevision,
        candidate_bytes: bytes,
      }],
    });
    await rm(
      path.join(repairStagingPath(common, NS, repairId), 'candidates', 'items', `${ITEM}.md`),
    );
    await assert.rejects(
      readStagedNumberRepair({ gitCommonDir: common, namespace: NS, repairId }),
      (error) => error.code === 'LEDGER_REPAIR_STAGING_INVALID'
        && error.reason === 'candidate-absent',
    );
  } finally {
    await rm(common, { recursive: true, force: true });
  }
});
