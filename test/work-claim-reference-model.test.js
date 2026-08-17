import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { runReferenceVector } from './work-claim-reference.js';

const itemId = 'wb_01Q4837BM01W70T30B184GG1R6';
const namespaceA = 'wbns_11111111111111111111111111111111';
const namespaceB = 'wbns_22222222222222222222222222222222';
const namespaceC = 'wbns_33333333333333333333333333333333';
const fixtureRoot = fileURLToPath(new URL('../spec/fixtures/work-claims/ledger/', import.meta.url));
const beforeBytes = readFileSync(`${fixtureRoot}/before.md`);
const afterBytes = readFileSync(`${fixtureRoot}/after.md`);
const beforeSource = beforeBytes.toString('base64');
const beforeRevision = `sha256:${createHash('sha256').update(beforeBytes).digest('hex')}`;
const afterSource = afterBytes.toString('base64');
const afterRevision = `sha256:${createHash('sha256').update(afterBytes).digest('hex')}`;

test('local filesystem binding with an empty allowlist is advisory and rejects publication', () => {
  const backend = safeBackend();
  backend.coordination_scope = 'local-filesystem';
  backend.ledger_binding.namespaces = [];
  const request = publicationRequest('pub_local_filesystem', 'agent-a-run-1', '1');
  const result = runReferenceVector({
    initial: {
      backend,
      durable: {
        clock_floors: [],
        claims: [],
        ledgers: [{ ledger_namespace: namespaceA, item_id: itemId, revision: beforeRevision, source_base64: beforeSource }],
        publication_outcomes: [],
      },
      process: { preflights: [] },
    },
    actions: [
      { operation: 'work-claim.capabilities', request: {} },
      { operation: 'ledger-publication.preflight', request },
    ],
  });
  assert.equal(result.transcript[0].stdout.result.operations.work_claim.mode, 'advisory');
  assert.equal(result.transcript[0].stdout.result.operations.work_claim.safe_exclusive_dispatch, false);
  assert.equal(result.transcript[1].stdout.error.code, 'ledger-namespace-unbound');
  assert.deepEqual(result.final.durable.publication_outcomes, []);
});

test('unbound namespace is rejected before every claim operation', () => {
  const unbound = namespaceC;
  const actions = [
    { operation: 'work-claim.read', request: { ledger_namespace: unbound, item_id: itemId }, physical_now: '2030-01-11T09:00:00.000Z' },
    { operation: 'work-claim.acquire', request: { ledger_namespace: unbound, item_id: itemId, owner_id: 'agent-a-run-1', lease_duration_ms: 60000, expected: { last_epoch: '0', active: null } }, physical_now: '2030-01-11T09:00:00.000Z' },
    { operation: 'work-claim.renew', request: { ledger_namespace: unbound, item_id: itemId, owner_id: 'agent-a-run-1', epoch: '1', expected_expires_at: '2030-01-11T09:01:00.000Z', lease_duration_ms: 60000 }, physical_now: '2030-01-11T09:00:00.000Z' },
    { operation: 'work-claim.release', request: { ledger_namespace: unbound, item_id: itemId, owner_id: 'agent-a-run-1', epoch: '1', expected_expires_at: '2030-01-11T09:01:00.000Z' }, physical_now: '2030-01-11T09:00:00.000Z' },
  ];
  const result = runReferenceVector({ initial: { backend: safeBackend(), durable: { clock_floors: [], claims: [], ledgers: [], publication_outcomes: [] }, process: { preflights: [] } }, actions });
  assert.deepEqual(result.transcript.map((entry) => entry.stdout.error.code), ['ledger-namespace-unbound', 'ledger-namespace-unbound', 'ledger-namespace-unbound', 'ledger-namespace-unbound']);
  assert.deepEqual(result.final.durable.claims, []);
});

test('bound untouched acquire initializes epoch zero before allocating epoch one', () => {
  const result = runReferenceVector({ initial: { backend: safeBackend(), durable: { clock_floors: [], claims: [], ledgers: [], publication_outcomes: [] }, process: { preflights: [] } }, actions: [acquireAction(namespaceA, 'agent-a-run-1', '0', '2030-01-11T09:00:00.000Z')] });
  assert.equal(result.transcript[0].stdout.result.claim.epoch, '1');
  assert.equal(result.final.durable.claims[0].last_epoch, '1');
});

test('publication preflight rejects arbitrary bytes before any publication mutation', () => {
  const request = publicationRequest('pub_not_a_ledger', 'agent-a-run-1', '1');
  request.candidate_source_base64 = Buffer.from('not a ledger\n').toString('base64');
  request.candidate_sha256 = `sha256:${createHash('sha256').update('not a ledger\n').digest('hex')}`;
  const result = runReferenceVector({
    initial: {
      backend: safeBackend(),
      durable: {
        clock_floors: [],
        claims: [{ ledger_namespace: namespaceA, item_id: itemId, last_epoch: '1', active: { owner_id: 'agent-a-run-1', epoch: '1', issued_at: '2030-01-11T08:59:00.000Z', expires_at: '2030-01-11T09:05:00.000Z' } }],
        ledgers: [{ ledger_namespace: namespaceA, item_id: itemId, revision: beforeRevision, source_base64: beforeSource }],
        publication_outcomes: [],
      },
      process: { preflights: [] },
    },
    actions: [{ operation: 'ledger-publication.preflight', request }],
  });
  assert.equal(result.transcript[0].exit, 3);
  assert.equal(result.transcript[0].stdout.error.code, 'ledger-invalid');
  assert.equal(result.final.durable.ledgers[0].revision, beforeRevision);
  assert.deepEqual(result.final.durable.publication_outcomes, []);
});

test('work-claim.read returns an empty state for an untouched tuple', () => {
  const result = runReferenceVector({
    initial: {
      backend: safeBackend(),
      durable: { clock_floors: [], claims: [], ledgers: [], publication_outcomes: [] },
      process: { preflights: [] },
    },
    actions: [{
      operation: 'work-claim.read',
      physical_now: '2030-01-11T09:00:00.000Z',
      request: { ledger_namespace: namespaceA, item_id: itemId },
    }],
  });
  assert.deepEqual(result.transcript[0], {
    exit: 0,
    stdout: {
      ok: true,
      namespace: 'work-claim',
      command: 'read',
      contract_version: 1,
      state: 'committed',
      result: {
        read_back: {
          ledger_namespace: namespaceA,
          item_id: itemId,
          observed_at: '2030-01-11T09:00:00.000Z',
          last_epoch: '0',
          active: null,
        },
      },
    },
  });
});

test('reference model marks an alternate bypass path unsafe for exclusive dispatch', () => {
  const vector = {
    initial: {
      backend: {
        name: 'reference-backend',
        coordination_scope: 'shared-transactional-coordinator',
        ledger_binding: {
          mode: 'explicit-allowlist',
          namespaces: [namespaceA],
        },
        write_paths: {
          alternate: 'bypass',
          claimed_publication_v1: 'atomic-fence',
          legacy_create_v1: 'reject-claimed-id',
          legacy_transition_v1: 'reject-active-claim',
        },
        write_serialization: {
          scope: 'shared-coordinator-writers',
          blocks_until: 'coordinator-transaction-complete',
        },
      },
      durable: {
        clock_floors: [],
        claims: [],
        ledgers: [],
        publication_outcomes: [],
      },
      process: { preflights: [] },
    },
    actions: [{ operation: 'work-claim.capabilities', request: {} }],
  };

  assert.deepEqual(runReferenceVector(vector).transcript, [{
    exit: 0,
    stdout: {
      ok: true,
      namespace: 'work-claim',
      command: 'capabilities',
      contract_version: 1,
      result: {
        backend: {
          name: 'reference-backend',
          coordination_scope: 'shared-transactional-coordinator',
          ledger_binding: {
            mode: 'explicit-allowlist',
            namespaces: [namespaceA],
          },
          write_serialization: {
            scope: 'shared-coordinator-writers',
            blocks_until: 'coordinator-transaction-complete',
          },
        },
        operations: {
          work_claim: {
            supported: true,
            api_version: 2,
            mode: 'advisory',
            claim_protected_publication: false,
            fencing_enforced_at: 'none',
            safe_exclusive_dispatch: false,
            write_paths: {
              alternate: 'bypass',
              claimed_publication_v1: 'atomic-fence',
              legacy_create_v1: 'reject-claimed-id',
              legacy_transition_v1: 'reject-active-claim',
            },
          },
        },
      },
    },
  }]);
});

test('reference model treats an unenumerated required write path as a bypass', () => {
  const backend = safeBackend();
  delete backend.write_paths.legacy_transition_v1;
  const vector = {
    initial: {
      backend,
      durable: { clock_floors: [], claims: [], ledgers: [], publication_outcomes: [] },
      process: { preflights: [] },
    },
    actions: [{ operation: 'work-claim.capabilities', request: {} }],
  };

  const capability = runReferenceVector(vector).transcript[0].stdout.result.operations.work_claim;
  assert.equal(capability.mode, 'advisory');
  assert.equal(capability.safe_exclusive_dispatch, false);
});

test('reference model keeps equal item IDs isolated by ledger namespace', () => {
  const vector = {
    initial: {
      backend: safeBackend(),
      durable: {
        clock_floors: [
          { ledger_namespace: namespaceA, observed_at: '2030-01-11T09:00:00.000Z' },
          { ledger_namespace: namespaceB, observed_at: '2030-01-11T09:00:00.000Z' },
        ],
        claims: [
          { ledger_namespace: namespaceA, item_id: itemId, last_epoch: '0', active: null },
          { ledger_namespace: namespaceB, item_id: itemId, last_epoch: '4', active: null },
        ],
        ledgers: [],
        publication_outcomes: [],
      },
      process: { preflights: [] },
    },
    actions: [
      acquireAction(namespaceA, 'agent-a-run-1', '0', '2030-01-11T09:00:01.000Z'),
      acquireAction(namespaceB, 'agent-b-run-1', '4', '2030-01-11T09:00:02.000Z'),
    ],
  };

  const result = runReferenceVector(vector);
  assert.deepEqual(result.transcript.map((entry) => entry.stdout.result.read_back), [
    {
      ledger_namespace: namespaceA,
      item_id: itemId,
      observed_at: '2030-01-11T09:00:01.000Z',
      last_epoch: '1',
      active: {
        owner_id: 'agent-a-run-1',
        epoch: '1',
        issued_at: '2030-01-11T09:00:01.000Z',
        expires_at: '2030-01-11T09:01:01.000Z',
      },
    },
    {
      ledger_namespace: namespaceB,
      item_id: itemId,
      observed_at: '2030-01-11T09:00:02.000Z',
      last_epoch: '5',
      active: {
        owner_id: 'agent-b-run-1',
        epoch: '5',
        issued_at: '2030-01-11T09:00:02.000Z',
        expires_at: '2030-01-11T09:01:02.000Z',
      },
    },
  ]);
  assert.deepEqual(result.final.durable.claims.map((claim) => [
    claim.ledger_namespace,
    claim.last_epoch,
    claim.active.owner_id,
  ]), [
    [namespaceA, '1', 'agent-a-run-1'],
    [namespaceB, '5', 'agent-b-run-1'],
  ]);
});

test('reference model exhausts uint64 epochs without mutating the claim', () => {
  const maxEpoch = '18446744073709551615';
  const vector = {
    initial: {
      backend: safeBackend(),
      durable: {
        clock_floors: [{ ledger_namespace: namespaceA, observed_at: '2030-01-11T09:00:00.000Z' }],
        claims: [{ ledger_namespace: namespaceA, item_id: itemId, last_epoch: maxEpoch, active: null }],
        ledgers: [],
        publication_outcomes: [],
      },
      process: { preflights: [] },
    },
    actions: [{
      operation: 'work-claim.acquire',
      physical_now: '2030-01-11T09:00:01.000Z',
      request: {
        ledger_namespace: namespaceA,
        item_id: itemId,
        owner_id: 'agent-next-run-1',
        lease_duration_ms: 60000,
        expected: { last_epoch: maxEpoch, active: null },
      },
    }],
  };

  const result = runReferenceVector(vector);
  assert.deepEqual(result.transcript, [{
    exit: 6,
    stdout: {
      ok: false,
      namespace: 'work-claim',
      command: 'acquire',
      contract_version: 1,
      state: 'unchanged',
      error: {
        code: 'epoch-exhausted',
        message: 'The epoch high-water mark is exhausted.',
        details: {
          ledger_namespace: namespaceA,
          item_id: itemId,
          observed_at: '2030-01-11T09:00:01.000Z',
          last_epoch: maxEpoch,
          active: null,
        },
      },
    },
  }]);
  assert.deepEqual(result.final.durable.claims[0], {
    ledger_namespace: namespaceA,
    item_id: itemId,
    last_epoch: maxEpoch,
    active: null,
  });
});

test('advisory capability rejects claimed publication before preflight or commit', () => {
  const active = {
    owner_id: 'agent-a-run-1',
    epoch: '1',
    issued_at: '2030-01-11T09:00:00.000Z',
    expires_at: '2030-01-11T09:05:00.000Z',
  };
  const advisory = safeBackend();
  advisory.write_paths.alternate = 'bypass';
  const request = publicationRequest('pub_advisory_rejected', active.owner_id, active.epoch);
  const vector = {
    initial: {
      backend: advisory,
      durable: {
        clock_floors: [{ ledger_namespace: namespaceA, observed_at: active.issued_at }],
        claims: [{ ledger_namespace: namespaceA, item_id: itemId, last_epoch: '1', active }],
        ledgers: [{
          ledger_namespace: namespaceA,
          item_id: itemId,
          revision: beforeRevision,
          source_base64: beforeSource,
        }],
        publication_outcomes: [],
      },
      process: { preflights: [] },
    },
    actions: [
      { operation: 'ledger-publication.preflight', request },
    ],
  };

  const result = runReferenceVector(vector);
  assert.deepEqual(result.transcript, [
    {
      exit: 2,
      stdout: {
        ok: false,
        namespace: 'ledger-publication',
        command: 'publish-claimed',
        contract_version: 1,
        state: 'unchanged',
        operation_id: request.operation_id,
        error: {
          code: 'capability-unavailable',
          message: 'Claim-protected publication is unavailable on an advisory backend.',
          details: { reason: 'advisory-capability' },
        },
      },
    },
  ]);
  assert.deepEqual(result.final.durable.ledgers[0], vector.initial.durable.ledgers[0]);
  assert.deepEqual(result.final.durable.publication_outcomes, []);
});

test('publication idempotency conflict resolves before revision or fence checks', () => {
  const request = publicationRequest('pub_immutable_identity', 'agent-a-run-1', '1');
  const tampered = { ...request, candidate_source_base64: beforeSource, candidate_sha256: beforeRevision };
  const storedEnvelope = {
    exit: 0,
    stdout: {
      ok: true,
      namespace: 'ledger-publication',
      command: 'publish-claimed',
      contract_version: 1,
      state: 'committed',
      operation_id: request.operation_id,
      result: {
        ledger_namespace: namespaceA,
        item_id: itemId,
        committed_revision: afterRevision,
        claim_fence: request.claim_fence,
        claim_read_back: {
          ledger_namespace: namespaceA,
          item_id: itemId,
          observed_at: '2030-01-11T09:00:01.000Z',
          last_epoch: '1',
          active: null,
        },
      },
    },
  };
  const vector = {
    initial: {
      backend: safeBackend(),
      durable: {
        clock_floors: [{ ledger_namespace: namespaceA, observed_at: '2030-01-11T09:00:01.000Z' }],
        claims: [{ ledger_namespace: namespaceA, item_id: itemId, last_epoch: '1', active: { owner_id: 'agent-a-run-1', epoch: '1', issued_at: '2030-01-11T08:59:00.000Z', expires_at: '2030-01-11T09:05:00.000Z' } }],
        ledgers: [{
          ledger_namespace: namespaceA,
          item_id: itemId,
          revision: beforeRevision,
          source_base64: beforeSource,
        }],
        publication_outcomes: [{
          operation_id: request.operation_id,
          ledger_namespace: namespaceA,
          item_id: itemId,
          request,
          operation_digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          envelope: storedEnvelope,
        }],
      },
      process: { preflights: [] },
    },
    actions: [{
      operation: 'ledger-publication.commit',
      operation_id: request.operation_id,
      request: tampered,
      physical_now: '2030-01-11T09:00:02.000Z',
    }],
  };

  const result = runReferenceVector(vector);
  assert.equal(result.transcript[0].stdout.error.code, 'idempotency-conflict');
  assert.equal(result.transcript[0].stdout.error.details.operation_id, request.operation_id);
  assert.equal(result.final.durable.clock_floors[0].observed_at, '2030-01-11T09:00:01.000Z');
  assert.deepEqual(result.final.durable.ledgers[0].revision, beforeRevision);
  assert.equal(result.final.durable.publication_outcomes.length, 1);
});

test('publication refusal cases expose exact independent envelopes', () => {
  const unboundBackend = safeBackend();
  unboundBackend.ledger_binding.namespaces = [namespaceB];
  const unboundRequest = publicationRequest('pub_unbound_case', 'agent-a-run-1', '1');
  const unbound = runReferenceVector({ initial: { backend: unboundBackend, durable: { clock_floors: [], claims: [], ledgers: [], publication_outcomes: [] }, process: { preflights: [] } }, actions: [{ operation: 'ledger-publication.preflight', request: unboundRequest }] }).transcript[0];
  assert.deepEqual(unbound, { exit: 2, stdout: { ok: false, namespace: 'ledger-publication', command: 'publish-claimed', contract_version: 1, state: 'unchanged', operation_id: unboundRequest.operation_id, error: { code: 'ledger-namespace-unbound', message: 'The ledger namespace is not provisioned for this endpoint.', details: { ledger_namespace: namespaceA } } } });

  const expired = { owner_id: 'agent-a-run-1', epoch: '1', issued_at: '2030-01-11T08:00:00.000Z', expires_at: '2030-01-11T09:00:00.000Z' };
  const expiredResult = runReferenceVector({ initial: { backend: safeBackend(), durable: { clock_floors: [], claims: [{ ledger_namespace: namespaceA, item_id: itemId, last_epoch: '1', active: expired }], ledgers: [], publication_outcomes: [] }, process: { preflights: [] } }, actions: [{ operation: 'work-claim.renew', physical_now: '2030-01-11T09:00:01.000Z', request: { ledger_namespace: namespaceA, item_id: itemId, owner_id: expired.owner_id, epoch: expired.epoch, expected_expires_at: expired.expires_at, lease_duration_ms: 60000 } }] }).transcript[0];
  assert.equal(expiredResult.stdout.error.code, 'claim-expired');

  const request = publicationRequest('pub_valid_conflict', 'agent-a-run-1', '1');
  const active = { owner_id: request.claim_fence.owner_id, epoch: '1', issued_at: '2030-01-11T08:00:00.000Z', expires_at: '2030-01-11T09:05:00.000Z' };
  const initial = { backend: safeBackend(), durable: { clock_floors: [], claims: [{ ledger_namespace: namespaceA, item_id: itemId, last_epoch: '1', active }], ledgers: [{ ledger_namespace: namespaceA, item_id: itemId, revision: beforeRevision, source_base64: beforeSource }], publication_outcomes: [] }, process: { preflights: [] } };
  const committed = runReferenceVector({ initial, actions: [{ operation: 'ledger-publication.preflight', request }, { operation: 'ledger-publication.commit', request, operation_id: request.operation_id, physical_now: '2030-01-11T08:01:00.000Z' }] });
  const tampered = { ...request, candidate_sha256: beforeRevision, candidate_source_base64: beforeSource };
  const conflict = runReferenceVector({ initial: committed.final, actions: [{ operation: 'ledger-publication.commit', request: tampered, operation_id: request.operation_id, physical_now: '2030-01-11T08:01:01.000Z' }] }).transcript[0];
  assert.equal(conflict.stdout.error.code, 'idempotency-conflict');
  assert.notDeepEqual(conflict.stdout.error.details, { operation_id: request.operation_id });
});

test('publication read gates an unbound namespace before operation lookup', () => {
  const result = runReferenceVector({ initial: { backend: safeBackend(), durable: { clock_floors: [], claims: [], ledgers: [], publication_outcomes: [] }, process: { preflights: [] } }, actions: [{ operation: 'ledger-publication.read', request: { operation_id: 'missing', ledger_namespace: namespaceC, item_id: itemId } }] });
  assert.equal(result.transcript[0].stdout.error.code, 'ledger-namespace-unbound');
});

test('blocked candidate status is rejected before publication', () => {
  const request = publicationRequest('pub_blocked', 'agent-a-run-1', '1');
  const blocked = Buffer.from(Buffer.from(afterSource, 'base64').toString().replace('status: done', 'status: blocked'));
  request.candidate_source_base64 = blocked.toString('base64');
  request.candidate_sha256 = `sha256:${createHash('sha256').update(blocked).digest('hex')}`;
  const result = runReferenceVector({ initial: { backend: safeBackend(), durable: { clock_floors: [], claims: [], ledgers: [{ ledger_namespace: namespaceA, item_id: itemId, revision: beforeRevision, source_base64: beforeSource }], publication_outcomes: [] }, process: { preflights: [] } }, actions: [{ operation: 'ledger-publication.preflight', request }] });
  assert.equal(result.transcript[0].stdout.error.code, 'ledger-invalid');
});

test('claim response loss is recovered by work-claim.read', () => {
  const vector = {
    initial: {
      backend: safeBackend(),
      durable: {
        clock_floors: [{ ledger_namespace: namespaceA, observed_at: '2030-01-11T09:00:00.000Z' }],
        claims: [{ ledger_namespace: namespaceA, item_id: itemId, last_epoch: '0', active: null }],
        ledgers: [],
        publication_outcomes: [],
      },
      process: { preflights: [] },
    },
    actions: [
      { operation: 'control.inject-fault', target: 'claim-response-loss' },
      {
        operation: 'work-claim.acquire',
        physical_now: '2030-01-11T09:00:01.000Z',
        request: {
          ledger_namespace: namespaceA,
          item_id: itemId,
          owner_id: 'agent-a-run-1',
          lease_duration_ms: 60000,
          expected: { last_epoch: '0', active: null },
        },
      },
      {
        operation: 'work-claim.read',
        physical_now: '2030-01-11T09:00:02.000Z',
        request: { ledger_namespace: namespaceA, item_id: itemId },
      },
    ],
  };

  const result = runReferenceVector(vector);
  assert.deepEqual(result.transcript[1], {
    event: 'response-lost',
    namespace: 'work-claim',
    command: 'acquire',
  });
  assert.equal(result.transcript[2].stdout.result.read_back.active.epoch, '1');
  assert.equal(result.transcript[2].stdout.result.read_back.active.owner_id, 'agent-a-run-1');
});

test('publication response loss is recovered by operation-outcome read before retry', () => {
  const active = {
    owner_id: 'agent-a-run-1',
    epoch: '1',
    issued_at: '2030-01-11T09:00:00.000Z',
    expires_at: '2030-01-11T09:05:00.000Z',
  };
  const request = publicationRequest('pub_read_back', active.owner_id, active.epoch);
  const vector = {
    initial: {
      backend: safeBackend(),
      durable: {
        clock_floors: [{ ledger_namespace: namespaceA, observed_at: active.issued_at }],
        claims: [{ ledger_namespace: namespaceA, item_id: itemId, last_epoch: '1', active }],
        ledgers: [{ ledger_namespace: namespaceA, item_id: itemId, revision: beforeRevision, source_base64: beforeSource }],
        publication_outcomes: [],
      },
      process: { preflights: [] },
    },
    actions: [
      { operation: 'ledger-publication.preflight', request },
      { operation: 'control.inject-fault', target: 'publication-response-loss' },
      { operation: 'ledger-publication.commit', operation_id: request.operation_id, request, physical_now: '2030-01-11T09:00:01.000Z' },
      { operation: 'ledger-publication.read', request: { operation_id: request.operation_id, ledger_namespace: namespaceA, item_id: itemId } },
      { operation: 'ledger-publication.commit', operation_id: request.operation_id, request, physical_now: '2030-01-11T09:00:02.000Z' },
    ],
  };

  const result = runReferenceVector(vector);
  assert.deepEqual(result.transcript[2], { event: 'response-lost', operation_id: request.operation_id });
  assert.equal(result.transcript[3].stdout.result.operation_id, request.operation_id);
  assert.equal(result.transcript[4].stdout.operation_id, request.operation_id);
  assert.equal(result.transcript[4].stdout.result.committed_revision, afterRevision);
});

test('unknown publication outcome has deterministic recovery envelope', () => {
  const active = { owner_id: 'agent-a-run-1', epoch: '1', issued_at: '2030-01-11T09:00:00.000Z', expires_at: '2030-01-11T09:05:00.000Z' };
  const request = publicationRequest('pub_unknown', active.owner_id, active.epoch);
  const result = runReferenceVector({
    initial: {
      backend: safeBackend(),
      faults: { 'publication-outcome-unknown': true },
      durable: {
        clock_floors: [{ ledger_namespace: namespaceA, observed_at: active.issued_at }],
        claims: [{ ledger_namespace: namespaceA, item_id: itemId, last_epoch: '1', active }],
        ledgers: [{ ledger_namespace: namespaceA, item_id: itemId, revision: beforeRevision, source_base64: beforeSource }],
        publication_outcomes: [],
      },
      process: { preflights: [] },
    },
    actions: [
      { operation: 'ledger-publication.preflight', request },
      { operation: 'ledger-publication.commit', operation_id: request.operation_id, request, physical_now: '2030-01-11T09:00:01.000Z' },
      { operation: 'ledger-publication.read', request: { operation_id: request.operation_id, ledger_namespace: namespaceA, item_id: itemId } },
    ],
  });
  assert.equal(result.transcript[1].exit, 6);
  assert.equal(result.transcript[1].stdout.error.code, 'publication-outcome-unknown');
  assert.equal(result.transcript[2].stdout.error.code, 'operation-not-found');
});

test('reference model rejects contention and persists the rejection clock floor', () => {
  const active = {
    owner_id: 'agent-a-run-1',
    epoch: '1',
    issued_at: '2030-01-11T09:00:00.000Z',
    expires_at: '2030-01-11T09:01:00.000Z',
  };
  const vector = {
    initial: {
      backend: safeBackend(),
      durable: {
        clock_floors: [{ ledger_namespace: namespaceA, observed_at: '2030-01-11T09:00:00.000Z' }],
        claims: [{ ledger_namespace: namespaceA, item_id: itemId, last_epoch: '1', active }],
        ledgers: [],
        publication_outcomes: [],
      },
      process: { preflights: [] },
    },
    actions: [{
      operation: 'work-claim.acquire',
      physical_now: '2030-01-11T09:00:30.000Z',
      request: {
        ledger_namespace: namespaceA,
        item_id: itemId,
        owner_id: 'agent-b-run-1',
        lease_duration_ms: 60000,
        expected: { last_epoch: '1', active },
      },
    }],
  };

  const result = runReferenceVector(vector);
  assert.deepEqual(result.transcript, [{
    exit: 4,
    stdout: {
      ok: false,
      namespace: 'work-claim',
      command: 'acquire',
      contract_version: 1,
      state: 'unchanged',
      error: {
        code: 'claim-held',
        message: 'The item has an unexpired active claim.',
        details: {
          ledger_namespace: namespaceA,
          item_id: itemId,
          observed_at: '2030-01-11T09:00:30.000Z',
          last_epoch: '1',
          active,
        },
      },
    },
  }]);
  assert.equal(result.final.durable.clock_floors[0].observed_at, '2030-01-11T09:00:30.000Z');
  assert.deepEqual(result.final.durable.claims[0].active, active);
});

test('reference model allows takeover exactly at expiry and rejects the paused epoch', () => {
  const epochOne = {
    owner_id: 'agent-a-run-1',
    epoch: '1',
    issued_at: '2030-01-11T09:00:00.000Z',
    expires_at: '2030-01-11T09:01:00.000Z',
  };
  const vector = {
    initial: {
      backend: safeBackend(),
      durable: {
        clock_floors: [{ ledger_namespace: namespaceA, observed_at: '2030-01-11T09:00:00.000Z' }],
        claims: [{ ledger_namespace: namespaceA, item_id: itemId, last_epoch: '1', active: epochOne }],
        ledgers: [],
        publication_outcomes: [],
      },
      process: { preflights: [] },
    },
    actions: [
      {
        operation: 'work-claim.acquire',
        physical_now: epochOne.expires_at,
        request: {
          ledger_namespace: namespaceA,
          item_id: itemId,
          owner_id: 'agent-b-run-1',
          lease_duration_ms: 60000,
          expected: { last_epoch: '1', active: epochOne },
        },
      },
      {
        operation: 'work-claim.release',
        physical_now: '2030-01-11T09:01:01.000Z',
        request: {
          ledger_namespace: namespaceA,
          item_id: itemId,
          owner_id: 'agent-a-run-1',
          epoch: '1',
          expected_expires_at: epochOne.expires_at,
        },
      },
    ],
  };

  const result = runReferenceVector(vector);
  assert.equal(result.transcript[0].stdout.result.claim.epoch, '2');
  assert.deepEqual(result.transcript[1], {
    exit: 4,
    stdout: {
      ok: false,
      namespace: 'work-claim',
      command: 'release',
      contract_version: 1,
      state: 'unchanged',
      error: {
        code: 'claim-conflict',
        message: 'The active claim tuple no longer matches this request.',
        details: {
          ledger_namespace: namespaceA,
          item_id: itemId,
          observed_at: '2030-01-11T09:01:01.000Z',
          last_epoch: '2',
          active: {
            owner_id: 'agent-b-run-1',
            epoch: '2',
            issued_at: '2030-01-11T09:01:00.000Z',
            expires_at: '2030-01-11T09:02:00.000Z',
          },
        },
      },
    },
  });
});

test('reference model persists renew and release across restart without epoch reuse', () => {
  const epochSeven = {
    owner_id: 'agent-a-run-1',
    epoch: '7',
    issued_at: '2030-01-11T09:00:00.000Z',
    expires_at: '2030-01-11T09:01:00.000Z',
  };
  const vector = {
    initial: {
      backend: safeBackend(),
      durable: {
        clock_floors: [{ ledger_namespace: namespaceA, observed_at: '2030-01-11T09:00:00.000Z' }],
        claims: [{ ledger_namespace: namespaceA, item_id: itemId, last_epoch: '7', active: epochSeven }],
        ledgers: [],
        publication_outcomes: [],
      },
      process: { preflights: [] },
    },
    actions: [
      {
        operation: 'work-claim.renew',
        physical_now: '2030-01-11T09:00:30.000Z',
        request: {
          ledger_namespace: namespaceA,
          item_id: itemId,
          owner_id: epochSeven.owner_id,
          epoch: epochSeven.epoch,
          expected_expires_at: epochSeven.expires_at,
          lease_duration_ms: 90000,
        },
      },
      { operation: 'control.restart' },
      {
        operation: 'work-claim.release',
        physical_now: '2030-01-11T09:00:31.000Z',
        request: {
          ledger_namespace: namespaceA,
          item_id: itemId,
          owner_id: epochSeven.owner_id,
          epoch: epochSeven.epoch,
          expected_expires_at: '2030-01-11T09:02:00.000Z',
        },
      },
      acquireAction(namespaceA, 'agent-a-run-2', '7', '2030-01-11T09:00:32.000Z'),
    ],
  };

  const result = runReferenceVector(vector);
  assert.deepEqual(result.transcript.map((entry) => entry.stdout?.command ?? entry.event), [
    'renew',
    'restart',
    'release',
    'acquire',
  ]);
  assert.equal(result.transcript[0].stdout.result.claim.expires_at, '2030-01-11T09:02:00.000Z');
  assert.equal(result.transcript[2].stdout.result.read_back.active, null);
  assert.equal(result.transcript[3].stdout.result.claim.epoch, '8');
  assert.equal(result.final.durable.claims[0].last_epoch, '8');
  assert.equal(result.final.durable.claims[0].active.owner_id, 'agent-a-run-2');
  assert.equal(result.final.durable.clock_floors[0].observed_at, '2030-01-11T09:00:32.000Z');
});

test('reference model rejects paused epoch N at commit after takeover N+1', () => {
  const epochNine = {
    owner_id: 'agent-a-run-1',
    epoch: '9',
    issued_at: '2030-01-11T09:00:00.000Z',
    expires_at: '2030-01-11T09:01:00.000Z',
  };
  const vector = {
    initial: {
      backend: safeBackend(),
      durable: {
        clock_floors: [{ ledger_namespace: namespaceA, observed_at: epochNine.issued_at }],
        claims: [{ ledger_namespace: namespaceA, item_id: itemId, last_epoch: '9', active: epochNine }],
        ledgers: [{
          ledger_namespace: namespaceA,
          item_id: itemId,
          revision: beforeRevision,
          source_base64: beforeSource,
        }],
        publication_outcomes: [],
      },
      process: { preflights: [] },
    },
    actions: [
      {
        operation: 'ledger-publication.preflight',
        request: publicationRequest('pub_agent_a_1', 'agent-a-run-1', '9'),
      },
      {
        operation: 'work-claim.acquire',
        physical_now: epochNine.expires_at,
        request: {
          ledger_namespace: namespaceA,
          item_id: itemId,
          owner_id: 'agent-b-run-1',
          lease_duration_ms: 60000,
          expected: { last_epoch: '9', active: epochNine },
        },
      },
      {
        operation: 'ledger-publication.commit',
        physical_now: '2030-01-11T09:01:01.000Z',
        operation_id: 'pub_agent_a_1',
        request: publicationRequest('pub_agent_a_1', 'agent-a-run-1', '9'),
      },
      {
        operation: 'ledger-publication.preflight',
        request: publicationRequest('pub_agent_b_1', 'agent-b-run-1', '10'),
      },
      {
        operation: 'ledger-publication.commit',
        physical_now: '2030-01-11T09:01:02.000Z',
        operation_id: 'pub_agent_b_1',
        request: publicationRequest('pub_agent_b_1', 'agent-b-run-1', '10'),
      },
    ],
  };

  const result = runReferenceVector(vector);
  assert.deepEqual(result.transcript[0], { event: 'preflight-complete', operation_id: 'pub_agent_a_1' });
  assert.equal(result.transcript[1].stdout.result.claim.epoch, '10');
  assert.deepEqual(result.transcript[2], {
    exit: 4,
    stdout: {
      ok: false,
      namespace: 'ledger-publication',
      command: 'publish-claimed',
      contract_version: 1,
      state: 'unchanged',
      operation_id: 'pub_agent_a_1',
      error: {
        code: 'claim-fence-rejected',
        message: 'The supplied claim fence is not the active owner generation.',
        details: {
          ledger_namespace: namespaceA,
          item_id: itemId,
          observed_at: '2030-01-11T09:01:01.000Z',
          reason: 'owner-mismatch',
          supplied_owner_id: 'agent-a-run-1',
          supplied_epoch: '9',
          active_owner_id: 'agent-b-run-1',
          active_epoch: '10',
        },
      },
    },
  });
  assert.equal(result.transcript[4].stdout.result.committed_revision, afterRevision);
  assert.deepEqual(result.final.durable.ledgers, [{
    ledger_namespace: namespaceA,
    item_id: itemId,
    revision: afterRevision,
    source_base64: afterSource,
  }]);
  assert.deepEqual(result.final.durable.publication_outcomes.map((outcome) => ({
    operation_id: outcome.operation_id,
    state: outcome.envelope.stdout.state,
  })), [
    { operation_id: 'pub_agent_a_1', state: 'unchanged' },
    { operation_id: 'pub_agent_b_1', state: 'committed' },
  ]);
});

test('reference model rejects each fence dimension with deterministic precedence', () => {
  const active = {
    owner_id: 'agent-a-run-1',
    epoch: '3',
    issued_at: '2030-01-11T09:00:00.000Z',
    expires_at: '2030-01-11T09:10:00.000Z',
  };
  const wrongNamespace = publicationRequest('pub_wrong_namespace', active.owner_id, active.epoch);
  wrongNamespace.claim_fence.ledger_namespace = namespaceB;
  const wrongItem = publicationRequest('pub_wrong_item', active.owner_id, active.epoch);
  wrongItem.claim_fence.item_id = 'wb_01Q4837BM01W70T30B184GG1R7';
  const wrongOwner = publicationRequest('pub_wrong_owner', 'agent-b-run-1', active.epoch);
  const wrongEpoch = publicationRequest('pub_wrong_epoch', active.owner_id, '2');
  const requests = [wrongNamespace, wrongItem, wrongOwner, wrongEpoch];
  const vector = {
    initial: {
      backend: safeBackend(),
      durable: {
        clock_floors: [{ ledger_namespace: namespaceA, observed_at: active.issued_at }],
        claims: [{ ledger_namespace: namespaceA, item_id: itemId, last_epoch: '3', active }],
        ledgers: [{
          ledger_namespace: namespaceA,
          item_id: itemId,
          revision: beforeRevision,
          source_base64: beforeSource,
        }],
        publication_outcomes: [],
      },
      process: { preflights: [] },
    },
    actions: requests.flatMap((request, index) => [
      { operation: 'ledger-publication.preflight', request },
      {
        operation: 'ledger-publication.commit',
        physical_now: `2030-01-11T09:00:0${index + 1}.000Z`,
        operation_id: request.operation_id,
        request,
      },
    ]),
  };

  const result = runReferenceVector(vector);
  assert.deepEqual(result.transcript.filter((_, index) => index % 2 === 1).map((entry) => ({
    code: entry.stdout.error.code,
    reason: entry.stdout.error.details.reason,
  })), [
    { code: 'claim-fence-rejected', reason: 'ledger-namespace-mismatch' },
    { code: 'claim-fence-rejected', reason: 'item-id-mismatch' },
    { code: 'claim-fence-rejected', reason: 'owner-mismatch' },
    { code: 'claim-fence-rejected', reason: 'epoch-mismatch' },
  ]);
  assert.deepEqual(result.final.durable.ledgers, [{
    ledger_namespace: namespaceA,
    item_id: itemId,
    revision: beforeRevision,
    source_base64: beforeSource,
  }]);
});

test('reference model retains the durable clock floor across rejection, backward clock, and restart', () => {
  const active = {
    owner_id: 'agent-a-run-1',
    epoch: '4',
    issued_at: '2030-01-11T09:00:00.000Z',
    expires_at: '2030-01-11T09:12:00.000Z',
  };
  const rejectedAcquire = {
    operation: 'work-claim.acquire',
    physical_now: '2030-01-11T09:10:00.000Z',
    request: {
      ledger_namespace: namespaceA,
      item_id: itemId,
      owner_id: 'agent-b-run-1',
      lease_duration_ms: 60000,
      expected: { last_epoch: '4', active },
    },
  };
  const vector = {
    initial: {
      backend: safeBackend(),
      durable: {
        clock_floors: [{ ledger_namespace: namespaceA, observed_at: active.issued_at }],
        claims: [{ ledger_namespace: namespaceA, item_id: itemId, last_epoch: '4', active }],
        ledgers: [],
        publication_outcomes: [],
      },
      process: { preflights: [] },
    },
    actions: [
      rejectedAcquire,
      { operation: 'control.restart' },
      { ...rejectedAcquire, physical_now: '2030-01-11T08:00:00.000Z' },
    ],
  };

  const result = runReferenceVector(vector);
  assert.deepEqual([
    result.transcript[0].stdout.error.details.observed_at,
    result.transcript[2].stdout.error.details.observed_at,
  ], [
    '2030-01-11T09:10:00.000Z',
    '2030-01-11T09:10:00.000Z',
  ]);
  assert.equal(result.final.durable.clock_floors[0].observed_at, '2030-01-11T09:10:00.000Z');
  assert.deepEqual(result.final.durable.claims[0].active, active);
});

test('reference model fails closed when the clock floor cannot be persisted', () => {
  const active = {
    owner_id: 'agent-a-run-1',
    epoch: '5',
    issued_at: '2030-01-11T09:00:00.000Z',
    expires_at: '2030-01-11T09:05:00.000Z',
  };
  const vector = {
    initial: {
      backend: safeBackend(),
      faults: { clock_floor_persist: true },
      durable: {
        clock_floors: [{ ledger_namespace: namespaceA, observed_at: active.issued_at }],
        claims: [{ ledger_namespace: namespaceA, item_id: itemId, last_epoch: '5', active }],
        ledgers: [],
        publication_outcomes: [],
      },
      process: { preflights: [] },
    },
    actions: [{
      operation: 'work-claim.release',
      physical_now: '2030-01-11T09:01:00.000Z',
      request: {
        ledger_namespace: namespaceA,
        item_id: itemId,
        owner_id: active.owner_id,
        epoch: active.epoch,
        expected_expires_at: active.expires_at,
      },
    }],
  };

  const result = runReferenceVector(vector);
  assert.deepEqual(result.transcript, [{
    exit: 6,
    stdout: {
      ok: false,
      namespace: 'work-claim',
      command: 'release',
      contract_version: 1,
      state: 'unchanged',
      error: {
        code: 'clock-floor-persistence-failed',
        message: 'The authoritative clock floor could not be persisted.',
        details: {
          ledger_namespace: namespaceA,
          item_id: itemId,
        },
      },
    },
  }]);
  assert.deepEqual(result.final.durable.claims[0].active, active);
  assert.equal(result.final.durable.clock_floors[0].observed_at, active.issued_at);
});

test('reference model closes legacy transition and create write bypasses', () => {
  const active = {
    owner_id: 'agent-a-run-1',
    epoch: '6',
    issued_at: '2030-01-11T09:00:00.000Z',
    expires_at: '2030-01-11T09:05:00.000Z',
  };
  const vector = {
    initial: {
      backend: safeBackend(),
      durable: {
        clock_floors: [{ ledger_namespace: namespaceA, observed_at: active.issued_at }],
        claims: [{ ledger_namespace: namespaceA, item_id: itemId, last_epoch: '6', active }],
        ledgers: [{
          ledger_namespace: namespaceA,
          item_id: itemId,
          revision: beforeRevision,
          source_base64: beforeSource,
        }],
        publication_outcomes: [],
      },
      process: { preflights: [] },
    },
    actions: [
      {
        operation: 'legacy-transition-v1.commit',
        physical_now: '2030-01-11T09:00:01.000Z',
        request: { ledger_namespace: namespaceA, item_id: itemId },
      },
      {
        operation: 'legacy-create-v1.commit',
        physical_now: '2030-01-11T09:00:02.000Z',
        request: { ledger_namespace: namespaceA, item_id: itemId },
      },
    ],
  };

  const result = runReferenceVector(vector);
  assert.deepEqual(result.transcript.map((entry) => ({
    command: entry.stdout.command,
    code: entry.stdout.error.code,
    exit: entry.exit,
  })), [
    { command: 'transition-v1', code: 'active-claim-write-refused', exit: 4 },
    { command: 'create-v1', code: 'claimed-item-write-refused', exit: 4 },
  ]);
  assert.equal(result.final.durable.clock_floors[0].observed_at, '2030-01-11T09:00:02.000Z');
  assert.equal(result.final.durable.ledgers[0].revision, beforeRevision);
});

test('reference model recovers an atomically committed publication after response loss', () => {
  const active = {
    owner_id: 'agent-a-run-1',
    epoch: '11',
    issued_at: '2030-01-11T09:00:00.000Z',
    expires_at: '2030-01-11T09:05:00.000Z',
  };
  const request = publicationRequest('pub_response_lost', active.owner_id, active.epoch);
  const vector = {
    initial: {
      backend: safeBackend(),
      durable: {
        clock_floors: [{ ledger_namespace: namespaceA, observed_at: active.issued_at }],
        claims: [{ ledger_namespace: namespaceA, item_id: itemId, last_epoch: '11', active }],
        ledgers: [{
          ledger_namespace: namespaceA,
          item_id: itemId,
          revision: beforeRevision,
          source_base64: beforeSource,
        }],
        publication_outcomes: [],
      },
      faults: {},
      process: { preflights: [] },
    },
    actions: [
      { operation: 'ledger-publication.preflight', request },
      { operation: 'control.inject-fault', target: 'publication-response-loss' },
      {
        operation: 'ledger-publication.commit',
        physical_now: '2030-01-11T09:00:01.000Z',
        operation_id: request.operation_id,
        request,
      },
      { operation: 'control.restart' },
      {
        operation: 'ledger-publication.commit',
        physical_now: '2030-01-11T08:00:00.000Z',
        operation_id: request.operation_id,
        request,
      },
    ],
  };

  const result = runReferenceVector(vector);
  assert.deepEqual(result.transcript[1], { event: 'fault-injected', target: 'publication-response-loss' });
  assert.deepEqual(result.transcript[2], { event: 'response-lost', operation_id: request.operation_id });
  assert.equal(result.transcript[4].stdout.state, 'committed');
  assert.equal(result.transcript[4].stdout.operation_id, request.operation_id);
  assert.equal(result.final.durable.ledgers[0].revision, afterRevision);
  assert.equal(result.final.durable.publication_outcomes.length, 1);
});

test('reference model cannot publish or record an outcome when clock-floor persistence fails', () => {
  const active = {
    owner_id: 'agent-a-run-1',
    epoch: '12',
    issued_at: '2030-01-11T09:00:00.000Z',
    expires_at: '2030-01-11T09:05:00.000Z',
  };
  const request = publicationRequest('pub_clock_failure', active.owner_id, active.epoch);
  const vector = {
    initial: {
      backend: safeBackend(),
      faults: { clock_floor_persist: true },
      durable: {
        clock_floors: [{ ledger_namespace: namespaceA, observed_at: active.issued_at }],
        claims: [{ ledger_namespace: namespaceA, item_id: itemId, last_epoch: '12', active }],
        ledgers: [{
          ledger_namespace: namespaceA,
          item_id: itemId,
          revision: beforeRevision,
          source_base64: beforeSource,
        }],
        publication_outcomes: [],
      },
      process: { preflights: [] },
    },
    actions: [
      { operation: 'ledger-publication.preflight', request },
      {
        operation: 'ledger-publication.commit',
        physical_now: '2030-01-11T09:00:01.000Z',
        operation_id: request.operation_id,
        request,
      },
    ],
  };

  const result = runReferenceVector(vector);
  assert.equal(result.transcript[1].exit, 6);
  assert.equal(result.transcript[1].stdout.error.code, 'clock-floor-persistence-failed');
  assert.equal(result.final.durable.ledgers[0].revision, beforeRevision);
  assert.deepEqual(result.final.durable.publication_outcomes, []);
});

function safeBackend() {
  return {
    name: 'reference-backend',
    coordination_scope: 'shared-transactional-coordinator',
    durability: 'durable-coordinator',
    ledger_binding: {
      mode: 'explicit-allowlist',
      namespaces: [namespaceA, namespaceB],
    },
    write_paths: {
      alternate: 'none',
      claimed_publication_v1: 'atomic-fence',
      legacy_create_v1: 'reject-claimed-id',
      legacy_transition_v1: 'reject-active-claim',
    },
  };
}

function acquireAction(ledgerNamespace, ownerId, lastEpoch, physicalNow) {
  return {
    operation: 'work-claim.acquire',
    physical_now: physicalNow,
    request: {
      ledger_namespace: ledgerNamespace,
      item_id: itemId,
      owner_id: ownerId,
      lease_duration_ms: 60000,
      expected: { last_epoch: lastEpoch, active: null },
    },
  };
}

function publicationRequest(operationId, ownerId, epoch) {
  return {
    operation_id: operationId,
    ledger_namespace: namespaceA,
    item_id: itemId,
    expected_revision: beforeRevision,
    candidate_source_base64: afterSource,
    candidate_sha256: afterRevision,
    claim_fence: {
      ledger_namespace: namespaceA,
      item_id: itemId,
      owner_id: ownerId,
      epoch,
    },
  };
}
