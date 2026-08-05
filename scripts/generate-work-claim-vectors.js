import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';


const root = fileURLToPath(new URL('../spec/fixtures/work-claims/', import.meta.url));
const itemId = 'wb_01Q4837BM01W70T30B184GG1R6';
const otherItemId = 'wb_01Q4837BM01W70T30B184GG1R7';
const namespaceA = 'wbns_11111111111111111111111111111111';
const namespaceB = 'wbns_22222222222222222222222222222222';
const before = source('ledger/before.md');
const after = source('ledger/after.md');

const scenarios = [
  scenario(
    'capabilities-fenced',
    'All mutation paths are atomically fenced, absent, or refuse claimed items, so exclusive dispatch is safe.',
    ['capabilities', 'legacy-bypass', 'safe-exclusive-dispatch'],
    state(),
    [{ operation: 'work-claim.capabilities', request: {} }],
  ),
  scenario(
    'advisory-unfenced',
    'One alternate writer bypasses the coordinator, forcing advisory capability even though the claimed endpoint fences.',
    ['advisory', 'alternate-bypass', 'capabilities'],
    state({ backend: advisoryBackend() }),
    [{ operation: 'work-claim.capabilities', request: {} }],
  ),
  (() => {
    const active = claim('agent-a-run-1', '1', '2030-01-11T09:00:00.000Z', '2030-01-11T09:05:00.000Z');
    return scenario(
      'advisory-publication-rejection',
      'An advisory backend rejects claim-protected publication before preflight can authorize a write.',
      ['advisory', 'advisory-publication-rejection', 'capability-rejection'],
      state({
        backend: advisoryBackend(),
        clock_floors: [floor(namespaceA, active.issued_at)],
        claims: [claimRecord(namespaceA, '1', active)],
        ledgers: [ledger(namespaceA, before)],
      }),
      [preflight(publication('pub_advisory_rejected', active.owner_id, active.epoch))],
    );
  })(),
  scenario(
    'capabilities-missing-write-path',
    'Omitting a required mutation entry point from capability enumeration is itself an unsafe bypass.',
    ['advisory', 'capabilities', 'missing-write-path'],
    state({ backend: missingPathBackend() }),
    [{ operation: 'work-claim.capabilities', request: {} }],
  ),
  scenario(
    'namespace-isolation',
    'The same item ID in two immutable ledger namespaces has independent epoch high-water marks.',
    ['ledger-binding', 'namespace-isolation', 'same-item-id'],
    state({
      clock_floors: [floor(namespaceA, '2030-01-11T09:00:00.000Z'), floor(namespaceB, '2030-01-11T09:00:00.000Z')],
      claims: [claimRecord(namespaceA, '0', null), claimRecord(namespaceB, '4', null)],
    }),
    [
      acquire(namespaceA, 'agent-a-run-1', '0', null, '2030-01-11T09:00:01.000Z'),
      acquire(namespaceB, 'agent-b-run-1', '4', null, '2030-01-11T09:00:02.000Z'),
    ],
  ),
  scenario(
    'epoch-exhaustion',
    'A uint64 epoch high-water mark rejects acquisition without changing claim state.',
    ['acquire', 'epoch-exhausted', 'epoch-monotonicity', 'fail-closed'],
    state({
      clock_floors: [floor(namespaceA, '2030-01-11T09:00:00.000Z')],
      claims: [claimRecord(namespaceA, '18446744073709551615', null)],
    }),
    [acquire(namespaceA, 'agent-next-run-1', '18446744073709551615', null, '2030-01-11T09:00:01.000Z')],
  ),
  (() => {
    const active = claim('agent-a-run-1', '1', '2030-01-11T09:00:00.000Z', '2030-01-11T09:01:00.000Z');
    return scenario(
      'acquire-contention',
      'A competing owner is rejected while the active lease is unexpired, and that rejection advances the durable clock floor.',
      ['acquire', 'clock-floor', 'contention', 'rejection-persistence'],
      state({
        clock_floors: [floor(namespaceA, active.issued_at)],
        claims: [claimRecord(namespaceA, '1', active)],
      }),
      [acquire(namespaceA, 'agent-b-run-1', '1', active, '2030-01-11T09:00:30.000Z')],
    );
  })(),
  (() => {
    const active = claim('agent-a-run-1', '1', '2030-01-11T09:00:00.000Z', '2030-01-11T09:01:00.000Z');
    return scenario(
      'expiry-takeover',
      'Equality with expiry permits epoch N+1 takeover; the paused epoch N cannot release the new owner.',
      ['expiry-boundary', 'paused-writer', 'release', 'takeover'],
      state({
        clock_floors: [floor(namespaceA, active.issued_at)],
        claims: [claimRecord(namespaceA, '1', active)],
      }),
      [
        acquire(namespaceA, 'agent-b-run-1', '1', active, active.expires_at),
        release(namespaceA, active, '2030-01-11T09:01:01.000Z'),
      ],
    );
  })(),
  (() => {
    const active = claim('agent-a-run-1', '7', '2030-01-11T09:00:00.000Z', '2030-01-11T09:01:00.000Z');
    return scenario(
      'renew-release-restart-aba',
      'Renew and release survive restart, and reacquisition allocates epoch 8 instead of reusing epoch 7.',
      ['aba', 'epoch-monotonicity', 'reacquire', 'release', 'renew', 'restart'],
      state({
        clock_floors: [floor(namespaceA, active.issued_at)],
        claims: [claimRecord(namespaceA, '7', active)],
      }),
      [
        renew(namespaceA, active, '2030-01-11T09:00:30.000Z', 90000),
        { operation: 'control.restart' },
        release(namespaceA, { ...active, expires_at: '2030-01-11T09:02:00.000Z' }, '2030-01-11T09:00:31.000Z'),
        acquire(namespaceA, 'agent-a-run-2', '7', null, '2030-01-11T09:00:32.000Z'),
      ],
    );
  })(),
  (() => {
    const active = claim('agent-a-run-1', '9', '2030-01-11T09:00:00.000Z', '2030-01-11T09:01:00.000Z');
    return scenario(
      'paused-writer-commit-boundary',
      'Writer N preflights, writer N+1 takes over, and only N+1 can publish at the atomic commit boundary.',
      ['atomic-publication', 'barrier', 'commit-boundary', 'paused-writer', 'stale-fence', 'takeover'],
      state({
        clock_floors: [floor(namespaceA, active.issued_at)],
        claims: [claimRecord(namespaceA, '9', active)],
        ledgers: [ledger(namespaceA, before)],
      }),
      [
        preflight(publication('pub_agent_a_1', 'agent-a-run-1', '9')),
        acquire(namespaceA, 'agent-b-run-1', '9', active, active.expires_at),
        commit('pub_agent_a_1', '2030-01-11T09:01:01.000Z'),
        preflight(publication('pub_agent_b_1', 'agent-b-run-1', '10')),
        commit('pub_agent_b_1', '2030-01-11T09:01:02.000Z'),
      ],
    );
  })(),
  (() => {
    const active = claim('agent-a-run-1', '3', '2030-01-11T09:00:00.000Z', '2030-01-11T09:10:00.000Z');
    const wrongNamespace = publication('pub_wrong_namespace', active.owner_id, active.epoch);
    wrongNamespace.claim_fence.ledger_namespace = namespaceB;
    const wrongItem = publication('pub_wrong_item', active.owner_id, active.epoch);
    wrongItem.claim_fence.item_id = otherItemId;
    return scenario(
      'fence-dimension-rejections',
      'Wrong namespace, item, owner, and epoch fences are rejected in deterministic precedence order.',
      ['epoch-fence', 'item-fence', 'namespace-fence', 'owner-fence', 'precedence'],
      state({
        clock_floors: [floor(namespaceA, active.issued_at)],
        claims: [claimRecord(namespaceA, '3', active)],
        ledgers: [ledger(namespaceA, before)],
      }),
      [
        preflight(wrongNamespace), commit(wrongNamespace.operation_id, '2030-01-11T09:00:01.000Z'),
        preflight(wrongItem), commit(wrongItem.operation_id, '2030-01-11T09:00:02.000Z'),
        preflight(publication('pub_wrong_owner', 'agent-b-run-1', active.epoch)), commit('pub_wrong_owner', '2030-01-11T09:00:03.000Z'),
        preflight(publication('pub_wrong_epoch', active.owner_id, '2')), commit('pub_wrong_epoch', '2030-01-11T09:00:04.000Z'),
      ],
    );
  })(),
  (() => {
    const active = claim('agent-a-run-1', '4', '2030-01-11T09:00:00.000Z', '2030-01-11T09:12:00.000Z');
    return scenario(
      'backward-clock-rejection-restart',
      'A rejection persists the clock floor, and restart plus a backward wall clock cannot resurrect earlier effective time.',
      ['backward-clock', 'clock-floor', 'rejection-persistence', 'restart'],
      state({
        clock_floors: [floor(namespaceA, active.issued_at)],
        claims: [claimRecord(namespaceA, '4', active)],
      }),
      [
        acquire(namespaceA, 'agent-b-run-1', '4', active, '2030-01-11T09:10:00.000Z'),
        { operation: 'control.restart' },
        acquire(namespaceA, 'agent-b-run-1', '4', active, '2030-01-11T08:00:00.000Z'),
      ],
    );
  })(),
  (() => {
    const active = claim('agent-a-run-1', '5', '2030-01-11T09:00:00.000Z', '2030-01-11T09:05:00.000Z');
    return scenario(
      'clock-floor-persistence-failure',
      'A clock-floor persistence failure returns storage failure and leaves claim and ledger state unchanged.',
      ['clock-floor', 'fail-closed', 'fault', 'storage-failure'],
      state({
        faults: { clock_floor_persist: true },
        clock_floors: [floor(namespaceA, active.issued_at)],
        claims: [claimRecord(namespaceA, '5', active)],
      }),
      [release(namespaceA, active, '2030-01-11T09:01:00.000Z')],
    );
  })(),
  (() => {
    return scenario(
      'claim-response-loss-read',
      'A lost claim response is recovered by reading the durable claim record.',
      ['acquire', 'claim-read', 'fault', 'read', 'response-loss', 'publication-recovery'],
      state({ claims: [claimRecord(namespaceA, '0', null)] }),
      [
        { operation: 'control.inject-fault', target: 'claim-response-loss' },
        acquire(namespaceA, 'agent-a-run-1', '0', null, '2030-01-11T09:00:01.000Z'),
        {
          operation: 'work-claim.read',
          physical_now: '2030-01-11T09:00:02.000Z',
          request: { ledger_namespace: namespaceA, item_id: itemId },
        },
      ],
    );
  })(),
  (() => {
    const active = claim('agent-a-run-1', '6', '2030-01-11T09:00:00.000Z', '2030-01-11T09:05:00.000Z');
    return scenario(
      'legacy-write-refusals',
      'Legacy transition and create endpoints refuse writes that could bypass active or historical claim coordination.',
      ['create-refusal', 'legacy-bypass', 'transition-refusal'],
      state({
        clock_floors: [floor(namespaceA, active.issued_at)],
        claims: [claimRecord(namespaceA, '6', active)],
        ledgers: [ledger(namespaceA, before)],
      }),
      [
        legacy('legacy-transition-v1.commit', '2030-01-11T09:00:01.000Z'),
        legacy('legacy-create-v1.commit', '2030-01-11T09:00:02.000Z'),
      ],
    );
  })(),
  (() => {
    const active = claim('agent-a-run-1', '11', '2030-01-11T09:00:00.000Z', '2030-01-11T09:05:00.000Z');
    return scenario(
      'publication-response-loss',
      'The atomic ledger write and idempotency outcome survive response loss and restart, so retry returns the committed envelope.',
      ['fault', 'idempotency', 'operation-read', 'publication-recovery', 'response-loss', 'restart'],
      state({
        clock_floors: [floor(namespaceA, active.issued_at)],
        claims: [claimRecord(namespaceA, '11', active)],
        ledgers: [ledger(namespaceA, before)],
      }),
      [
        preflight(publication('pub_response_lost', active.owner_id, active.epoch)),
        { operation: 'control.inject-fault', target: 'publication-response-loss' },
        commit('pub_response_lost', '2030-01-11T09:00:01.000Z'),
        { operation: 'ledger-publication.read', request: { operation_id: 'pub_response_lost' } },
        { operation: 'control.restart' },
        { operation: 'ledger-publication.read', request: { operation_id: 'pub_response_lost' } },
        commit('pub_response_lost', '2030-01-11T08:00:00.000Z'),
      ],
    );
  })(),
  (() => {
    const active = claim('agent-a-run-1', '12', '2030-01-11T09:00:00.000Z', '2030-01-11T09:05:00.000Z');
    return scenario(
      'publication-clock-floor-failure',
      'Claimed publication cannot change ledger bytes or record an outcome when its authoritative clock floor cannot persist.',
      ['clock-floor', 'fail-closed', 'publication-fail-closed', 'storage-failure'],
      state({
        faults: { clock_floor_persist: true },
        clock_floors: [floor(namespaceA, active.issued_at)],
        claims: [claimRecord(namespaceA, '12', active)],
        ledgers: [ledger(namespaceA, before)],
      }),
      [
        preflight(publication('pub_clock_failure', active.owner_id, active.epoch)),
        commit('pub_clock_failure', '2030-01-11T09:00:01.000Z'),
      ],
    );
  })(),
  (() => {
    const active = claim('agent-a-run-1', '13', '2030-01-11T09:00:00.000Z', '2030-01-11T09:05:00.000Z');
    return scenario(
      'publication-outcome-unknown',
      'An indeterminate publication boundary returns a deterministic unknown outcome that is recovered by an operation read.',
      ['fault', 'operation-read', 'publication-recovery', 'publication-outcome-unknown'],
      state({
        faults: { 'publication-outcome-unknown': true },
        clock_floors: [floor(namespaceA, active.issued_at)],
        claims: [claimRecord(namespaceA, '13', active)],
        ledgers: [ledger(namespaceA, before)],
      }),
      [
        preflight(publication('pub_unknown', active.owner_id, active.epoch)),
        commit('pub_unknown', '2030-01-11T09:00:01.000Z'),
        { operation: 'ledger-publication.read', request: { operation_id: 'pub_unknown' } },
      ],
    );
  })(),
];

for (const entry of scenarios) {
  const directory = join(root, entry.case);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'manifest.json'), `${JSON.stringify(entry, null, 2)}\n`);
}

function scenario(caseName, description, coverage, initial, actions) {
  const requests = new Map(actions
    .filter((action) => action.operation === 'ledger-publication.preflight')
    .map((action) => [action.request.operation_id, action.request]));
  const normalizedActions = actions.map((action) => {
    if (action.operation === 'ledger-publication.commit' && !action.request) {
      return { ...action, request: requests.get(action.operation_id) };
    }
    if (action.operation === 'ledger-publication.read' && !action.request.ledger_namespace) {
      const request = requests.get(action.request.operation_id);
      return { ...action, request: { ...action.request, ledger_namespace: request.ledger_namespace, item_id: request.item_id } };
    }
    return action;
  });
  const existingManifest = join(root, caseName, 'manifest.json');
  return {
    case: caseName,
    fixture_version: 2,
    status: 'normative-reference-model',
    description,
    coverage: [...coverage].sort(),
    clock: {
      authority: 'backend-effective-utc',
      client_timestamps_trusted: false,
      durable_floor_scope: 'ledger-namespace',
    },
    source_files: [before, after],
    initial,
    actions: normalizedActions,
    expected: JSON.parse(readFileSync(existingManifest, 'utf8')).expected,
  };
}

function state({ backend = safeBackend(), faults = {}, clock_floors = [], claims = [], ledgers = [] } = {}) {
  return {
    backend,
    faults,
    durable: { clock_floors, claims, ledgers, publication_outcomes: [] },
    process: { preflights: [] },
  };
}

function safeBackend() {
  return {
    name: 'reference-backend',
    coordination_scope: 'shared-transactional-coordinator',
    durability: 'durable-coordinator',
    ledger_binding: { mode: 'explicit-allowlist', namespaces: [namespaceA, namespaceB] },
    write_paths: {
      alternate: 'none',
      claimed_publication_v1: 'atomic-fence',
      legacy_create_v1: 'reject-claimed-id',
      legacy_transition_v1: 'reject-active-claim',
    },
  };
}

function advisoryBackend() {
  const backend = safeBackend();
  backend.name = 'advisory-reference-backend';
  backend.write_paths.alternate = 'bypass';
  return backend;
}

function missingPathBackend() {
  const backend = safeBackend();
  delete backend.write_paths.legacy_transition_v1;
  return backend;
}

function source(path) {
  const bytes = readFileSync(join(root, path));
  return {
    path,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    source_base64: bytes.toString('base64'),
  };
}

function floor(ledgerNamespace, observedAt) {
  return { ledger_namespace: ledgerNamespace, observed_at: observedAt };
}

function claim(ownerId, epoch, issuedAt, expiresAt) {
  return { owner_id: ownerId, epoch, issued_at: issuedAt, expires_at: expiresAt };
}

function claimRecord(ledgerNamespace, lastEpoch, active) {
  return { ledger_namespace: ledgerNamespace, item_id: itemId, last_epoch: lastEpoch, active };
}

function ledger(ledgerNamespace, sourceFile) {
  return {
    ledger_namespace: ledgerNamespace,
    item_id: itemId,
    revision: sourceFile.sha256,
    source_base64: sourceFile.source_base64,
  };
}

function acquire(ledgerNamespace, ownerId, lastEpoch, active, physicalNow) {
  return {
    operation: 'work-claim.acquire',
    physical_now: physicalNow,
    request: {
      ledger_namespace: ledgerNamespace,
      item_id: itemId,
      owner_id: ownerId,
      lease_duration_ms: 60000,
      expected: { last_epoch: lastEpoch, active },
    },
  };
}

function renew(ledgerNamespace, active, physicalNow, leaseDurationMs) {
  return {
    operation: 'work-claim.renew',
    physical_now: physicalNow,
    request: {
      ledger_namespace: ledgerNamespace,
      item_id: itemId,
      owner_id: active.owner_id,
      epoch: active.epoch,
      expected_expires_at: active.expires_at,
      lease_duration_ms: leaseDurationMs,
    },
  };
}

function release(ledgerNamespace, active, physicalNow) {
  return {
    operation: 'work-claim.release',
    physical_now: physicalNow,
    request: {
      ledger_namespace: ledgerNamespace,
      item_id: itemId,
      owner_id: active.owner_id,
      epoch: active.epoch,
      expected_expires_at: active.expires_at,
    },
  };
}

function publication(operationId, ownerId, epoch) {
  return {
    operation_id: operationId,
    ledger_namespace: namespaceA,
    item_id: itemId,
    expected_revision: before.sha256,
    candidate_source_base64: after.source_base64,
    candidate_sha256: after.sha256,
    claim_fence: {
      ledger_namespace: namespaceA,
      item_id: itemId,
      owner_id: ownerId,
      epoch,
    },
  };
}

function preflight(request) {
  return { operation: 'ledger-publication.preflight', request };
}

function commit(operationId, physicalNow) {
  return { operation: 'ledger-publication.commit', physical_now: physicalNow, operation_id: operationId };
}

function legacy(operation, physicalNow) {
  return { operation, physical_now: physicalNow, request: { ledger_namespace: namespaceA, item_id: itemId } };
}
