// test/claim-operations.test.js
import assert from 'node:assert/strict';
import test from 'node:test';

import { claimAcquire, claimRead, claimRelease, claimRenew } from '../src/claim-operations.js';

const NS = 'wbns_0123456789abcdef0123456789abcdef';
const ITEM = 'wb_01Q4837BM01W70T30B184GG1R6';
const empty = () => ({ schema_version: 1, ledger_namespace: NS, clock_floor: null, claims: [] });

test('read of a never-claimed tuple returns the empty state', () => {
  const { envelope } = claimRead(empty(), { ledger_namespace: NS, item_id: ITEM }, '2026-08-06T09:00:00.000Z');
  assert.deepEqual(envelope, {
    exit: 0,
    stdout: {
      ok: true,
      namespace: 'work-claim',
      command: 'read',
      contract_version: 1,
      state: 'committed',
      result: {
        read_back: {
          ledger_namespace: NS,
          item_id: ITEM,
          observed_at: '2026-08-06T09:00:00.000Z',
          last_epoch: '0',
          active: null,
        },
      },
    },
  });
});

const witness = (last_epoch, active) => ({ last_epoch, active });

test('acquire allocates exactly one epoch above the high-water mark', () => {
  const { envelope, state } = claimAcquire(empty(), {
    ledger_namespace: NS, item_id: ITEM, owner_id: 'agent-a', lease_duration_ms: 300000,
    expected: witness('0', null),
  }, '2026-08-06T09:00:00.000Z');
  assert.equal(envelope.exit, 0);
  assert.deepEqual(envelope.stdout.result.claim, {
    owner_id: 'agent-a', epoch: '1',
    issued_at: '2026-08-06T09:00:00.000Z', expires_at: '2026-08-06T09:05:00.000Z',
  });
  assert.equal(state.claims[0].last_epoch, '1');
});

test('acquire with an unequal witness is a conflict and changes nothing', () => {
  const { envelope, state } = claimAcquire(empty(), {
    ledger_namespace: NS, item_id: ITEM, owner_id: 'agent-a', lease_duration_ms: 300000,
    expected: witness('7', null),
  }, '2026-08-06T09:00:00.000Z');
  assert.equal(envelope.exit, 4);
  assert.equal(envelope.stdout.error.code, 'claim-conflict');
  assert.equal(envelope.stdout.error.message, 'The observed claim state no longer matches this request.');
  assert.equal(state.claims[0].active, null);
});

test('acquire against an unexpired active claim is held', () => {
  const held = empty();
  held.claims.push({ item_id: ITEM, last_epoch: '3', active: {
    owner_id: 'agent-b', epoch: '3', issued_at: '2026-08-06T09:00:00.000Z', expires_at: '2026-08-06T09:05:00.000Z' } });
  const { envelope } = claimAcquire(held, {
    ledger_namespace: NS, item_id: ITEM, owner_id: 'agent-a', lease_duration_ms: 300000,
    expected: witness('3', held.claims[0].active),
  }, '2026-08-06T09:01:00.000Z');
  assert.equal(envelope.exit, 4);
  assert.equal(envelope.stdout.error.code, 'claim-held');
  assert.equal(envelope.stdout.error.message, 'The item has an unexpired active claim.');
});

test('acquiring an expired claim is takeover and advances the epoch', () => {
  const stale = empty();
  stale.claims.push({ item_id: ITEM, last_epoch: '3', active: {
    owner_id: 'agent-b', epoch: '3', issued_at: '2026-08-06T09:00:00.000Z', expires_at: '2026-08-06T09:05:00.000Z' } });
  const { envelope } = claimAcquire(stale, {
    ledger_namespace: NS, item_id: ITEM, owner_id: 'agent-a', lease_duration_ms: 60000,
    expected: witness('3', stale.claims[0].active),
  }, '2026-08-06T09:05:00.000Z');
  assert.equal(envelope.exit, 0);
  assert.equal(envelope.stdout.result.claim.epoch, '4');
});

test('an exhausted high-water mark refuses rather than wrapping', () => {
  const full = empty();
  full.claims.push({ item_id: ITEM, last_epoch: '18446744073709551615', active: null });
  const { envelope } = claimAcquire(full, {
    ledger_namespace: NS, item_id: ITEM, owner_id: 'agent-a', lease_duration_ms: 60000,
    expected: witness('18446744073709551615', null),
  }, '2026-08-06T09:00:00.000Z');
  assert.equal(envelope.exit, 6);
  assert.equal(envelope.stdout.error.code, 'epoch-exhausted');
  assert.equal(envelope.stdout.error.message, 'The epoch high-water mark is exhausted.');
});

test('the clock floor never moves backwards', () => {
  const seeded = empty();
  seeded.clock_floor = '2026-08-06T10:00:00.000Z';
  const { envelope } = claimRead(seeded, { ledger_namespace: NS, item_id: ITEM }, '2026-08-06T09:00:00.000Z');
  assert.equal(envelope.stdout.result.read_back.observed_at, '2026-08-06T10:00:00.000Z');
});

const active = (over = {}) => ({
  owner_id: 'agent-a', epoch: '3',
  issued_at: '2026-08-06T09:00:00.000Z', expires_at: '2026-08-06T09:05:00.000Z', ...over,
});
const seeded = () => {
  const state = empty();
  state.claims.push({ item_id: ITEM, last_epoch: '3', active: active() });
  return state;
};

test('renew extends expiry while retaining issued_at and epoch', () => {
  const { envelope } = claimRenew(seeded(), {
    ledger_namespace: NS, item_id: ITEM, owner_id: 'agent-a', epoch: '3',
    expected_expires_at: '2026-08-06T09:05:00.000Z', lease_duration_ms: 300000,
  }, '2026-08-06T09:01:00.000Z');
  assert.equal(envelope.exit, 0);
  assert.deepEqual(envelope.stdout.result.claim, {
    owner_id: 'agent-a', epoch: '3',
    issued_at: '2026-08-06T09:00:00.000Z', expires_at: '2026-08-06T09:06:00.000Z',
  });
});

test('renew with a mismatched tuple conflicts using the renew wording', () => {
  const { envelope } = claimRenew(seeded(), {
    ledger_namespace: NS, item_id: ITEM, owner_id: 'agent-b', epoch: '3',
    expected_expires_at: '2026-08-06T09:05:00.000Z', lease_duration_ms: 300000,
  }, '2026-08-06T09:01:00.000Z');
  assert.equal(envelope.stdout.error.code, 'claim-conflict');
  assert.equal(envelope.stdout.error.message, 'The active claim tuple no longer matches this request.');
});

test('renew of an exactly matching but expired tuple is claim-expired', () => {
  const { envelope } = claimRenew(seeded(), {
    ledger_namespace: NS, item_id: ITEM, owner_id: 'agent-a', epoch: '3',
    expected_expires_at: '2026-08-06T09:05:00.000Z', lease_duration_ms: 300000,
  }, '2026-08-06T09:05:00.000Z');
  assert.equal(envelope.exit, 4);
  assert.equal(envelope.stdout.error.code, 'claim-expired');
  assert.equal(envelope.stdout.error.message, 'The matching claim has expired.');
});

test('release clears active and retains the high-water mark', () => {
  const { envelope, state } = claimRelease(seeded(), {
    ledger_namespace: NS, item_id: ITEM, owner_id: 'agent-a', epoch: '3',
    expected_expires_at: '2026-08-06T09:05:00.000Z',
  }, '2026-08-06T09:01:00.000Z');
  assert.equal(envelope.exit, 0);
  assert.equal(envelope.stdout.result.read_back.active, null);
  assert.equal(envelope.stdout.result.read_back.last_epoch, '3');
  assert.equal(state.claims[0].active, null);
});

test('a released item cannot be reacquired at the same epoch', () => {
  const released = claimRelease(seeded(), {
    ledger_namespace: NS, item_id: ITEM, owner_id: 'agent-a', epoch: '3',
    expected_expires_at: '2026-08-06T09:05:00.000Z',
  }, '2026-08-06T09:01:00.000Z').state;
  const { envelope } = claimAcquire(released, {
    ledger_namespace: NS, item_id: ITEM, owner_id: 'agent-a', lease_duration_ms: 60000,
    expected: { last_epoch: '3', active: null },
  }, '2026-08-06T09:02:00.000Z');
  assert.equal(envelope.stdout.result.claim.epoch, '4');
});
