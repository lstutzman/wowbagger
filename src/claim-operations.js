// src/claim-operations.js
import { isDeepStrictEqual } from 'node:util';

const MAX_EPOCH = 18446744073709551615n;

export function advanceClockFloor(state, physicalNow) {
  const floor = state.clock_floor;
  const effective = floor === null || physicalNow > floor ? physicalNow : floor;
  state.clock_floor = effective;
  return effective;
}

export function findOrCreateClaim(state, itemId) {
  let record = state.claims.find((entry) => entry.item_id === itemId);
  if (!record) {
    record = { item_id: itemId, last_epoch: '0', active: null };
    state.claims.push(record);
  }
  return record;
}

export function readBack(namespace, itemId, observedAt, record) {
  return {
    ledger_namespace: namespace,
    item_id: itemId,
    observed_at: observedAt,
    last_epoch: record.last_epoch,
    active: record.active === null ? null : { ...record.active },
  };
}

function success(command, request, observedAt, record, extra) {
  return {
    exit: 0,
    stdout: {
      ok: true,
      namespace: 'work-claim',
      command,
      contract_version: 1,
      state: 'committed',
      result: { ...extra, read_back: readBack(request.ledger_namespace, request.item_id, observedAt, record) },
    },
  };
}

export function claimError(command, code, message, request, observedAt, record, exit = 4) {
  return {
    exit,
    stdout: {
      ok: false,
      namespace: 'work-claim',
      command,
      contract_version: 1,
      state: 'unchanged',
      error: {
        code,
        message,
        details: readBack(request.ledger_namespace, request.item_id, observedAt, record),
      },
    },
  };
}

export function claimRead(state, request, physicalNow) {
  const next = structuredClone(state);
  const observedAt = advanceClockFloor(next, physicalNow);
  const record = findOrCreateClaim(next, request.item_id);
  return { state: next, envelope: success('read', request, observedAt, record, {}) };
}

export function addMilliseconds(instant, milliseconds) {
  return new Date(Date.parse(instant) + milliseconds).toISOString();
}

export function claimAcquire(state, request, physicalNow) {
  const next = structuredClone(state);
  const observedAt = advanceClockFloor(next, physicalNow);
  const record = findOrCreateClaim(next, request.item_id);
  const observed = { last_epoch: record.last_epoch, active: record.active };
  if (!isDeepStrictEqual(observed, { last_epoch: request.expected.last_epoch, active: request.expected.active })) {
    return { state: next, envelope: claimError('acquire', 'claim-conflict',
      'The observed claim state no longer matches this request.', request, observedAt, record) };
  }
  if (record.active !== null && observedAt < record.active.expires_at) {
    return { state: next, envelope: claimError('acquire', 'claim-held',
      'The item has an unexpired active claim.', request, observedAt, record) };
  }
  if (BigInt(record.last_epoch) >= MAX_EPOCH) {
    return { state: next, envelope: claimError('acquire', 'epoch-exhausted',
      'The epoch high-water mark is exhausted.', request, observedAt, record, 6) };
  }
  const epoch = (BigInt(record.last_epoch) + 1n).toString();
  record.last_epoch = epoch;
  record.active = {
    owner_id: request.owner_id,
    epoch,
    issued_at: observedAt,
    expires_at: addMilliseconds(observedAt, request.lease_duration_ms),
  };
  return { state: next, envelope: success('acquire', request, observedAt, record, { claim: { ...record.active } }) };
}

function tupleMatches(active, request) {
  return active !== null
    && active.owner_id === request.owner_id
    && active.epoch === request.epoch
    && active.expires_at === request.expected_expires_at;
}

function renewOrRelease(command, state, request, physicalNow, apply) {
  const next = structuredClone(state);
  const observedAt = advanceClockFloor(next, physicalNow);
  const record = findOrCreateClaim(next, request.item_id);
  if (!tupleMatches(record.active, request)) {
    return { state: next, envelope: claimError(command, 'claim-conflict',
      'The active claim tuple no longer matches this request.', request, observedAt, record) };
  }
  if (observedAt >= record.active.expires_at) {
    return { state: next, envelope: claimError(command, 'claim-expired',
      'The matching claim has expired.', request, observedAt, record) };
  }
  return apply(next, record, observedAt);
}

export function claimRenew(state, request, physicalNow) {
  return renewOrRelease('renew', state, request, physicalNow, (next, record, observedAt) => {
    record.active = { ...record.active, expires_at: addMilliseconds(observedAt, request.lease_duration_ms) };
    return { state: next, envelope: success('renew', request, observedAt, record, { claim: { ...record.active } }) };
  });
}

export function claimRelease(state, request, physicalNow) {
  return renewOrRelease('release', state, request, physicalNow, (next, record, observedAt) => {
    const released = { ...record.active };
    record.active = null;
    return { state: next, envelope: success('release', request, observedAt, record, { released_claim: released }) };
  });
}
