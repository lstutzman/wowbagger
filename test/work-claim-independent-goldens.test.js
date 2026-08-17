import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { runReferenceVector } from './work-claim-reference.js';

const fixtureRoot = new URL('../spec/fixtures/work-claims/', import.meta.url);
const namespace = 'wbns_11111111111111111111111111111111';
const itemId = 'wb_01Q4837BM01W70T30B184GG1R6';
const maxEpoch = '18446744073709551615';

// The two committed fixture ledger revisions, quoted literally.
const beforeRevision = 'sha256:7bd247bb82b1e56f5c0fc30feda8bafd82af72962d78deadd75ee0136d3d1be5';
const afterRevision = 'sha256:d8ba5e2458478da0c17d96623d609561bfcf67d607a1b6cd842ae77328691fd8';

// operation_digest values for the two publish-claimed requests below, derived
// independently from docs/work-claim-contract.md section 6 (sha256 of canonical
// UTF-8 JSON, keys sorted lexicographically, no insignificant whitespace) with a
// separate Python implementation. They are NOT obtained from digestRequest().
const committedOperationDigest = 'sha256:45f66c4c79523c7b83ed5b0c73594c6da708408fde72b16edadf0b8aba45e0cc';
const retriedOperationDigest = 'sha256:75c476624e9aa2e984d45f51f12c312ca957331f5e23a5b4916957a366d78324';

function manifest(name) {
  return JSON.parse(readFileSync(new URL(`${name}/manifest.json`, fixtureRoot), 'utf8'));
}

// Build publish-claimed requests from the public contract operations only.
function publicationRequest(operationId, expectedRevision, candidate, epoch = '9') {
  return {
    operation_id: operationId,
    ledger_namespace: namespace,
    item_id: itemId,
    expected_revision: expectedRevision,
    candidate_source_base64: candidate.source_base64,
    candidate_sha256: candidate.sha256,
    claim_fence: {
      ledger_namespace: namespace,
      item_id: itemId,
      owner_id: 'agent-a-run-1',
      epoch,
    },
  };
}

function sourceFile(source, path) {
  const file = source.source_files.find((entry) => entry.path === path);
  if (!file) throw new Error(`missing fixture source: ${path}`);
  return file;
}

test('manual epoch-exhaustion golden rejects overflow and preserves the claim', () => {
  const source = manifest('epoch-exhaustion');
  const expected = {
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
          ledger_namespace: namespace,
          item_id: itemId,
          observed_at: '2030-01-11T09:00:01.000Z',
          last_epoch: maxEpoch,
          active: null,
        },
      },
    },
  };

  const actual = runReferenceVector({ initial: source.initial, actions: source.actions });
  assert.deepEqual(actual.transcript, [expected]);
  assert.deepEqual(actual.final.durable.claims, [{
    ledger_namespace: namespace,
    item_id: itemId,
    last_epoch: maxEpoch,
    active: null,
  }]);
});

test('manual advisory golden rejects publication without a durable outcome', () => {
  const source = manifest('advisory-publication-rejection');
  const expected = {
    exit: 2,
    stdout: {
      ok: false,
      namespace: 'ledger-publication',
      command: 'publish-claimed',
      contract_version: 1,
      state: 'unchanged',
      operation_id: 'pub_advisory_rejected',
      error: {
        code: 'capability-unavailable',
        message: 'Claim-protected publication is unavailable on an advisory backend.',
        details: { reason: 'advisory-capability' },
      },
    },
  };

  const actual = runReferenceVector({ initial: source.initial, actions: source.actions });
  assert.deepEqual(actual.transcript, [expected]);
  assert.deepEqual(actual.final.durable.publication_outcomes, []);
});

test('tampering an independent golden is detected instead of self-confirming', () => {
  const source = manifest('epoch-exhaustion');
  const actual = runReferenceVector({ initial: source.initial, actions: source.actions });
  const tampered = structuredClone(actual.transcript[0]);
  tampered.stdout.error.code = 'claim-held';
  assert.notDeepEqual(actual.transcript, [tampered]);
});

test('tampering candidate bytes is rejected before publication state changes', () => {
  const source = manifest('publication-response-loss');
  const tampered = structuredClone(source);
  tampered.actions[0].request.candidate_source_base64 = source.source_files[0].source_base64;
  const actual = runReferenceVector({ initial: tampered.initial, actions: tampered.actions.slice(0, 1) });
  assert.equal(actual.transcript[0].stdout.error.code, 'candidate-digest-mismatch');
  assert.deepEqual(actual.final.durable.publication_outcomes, []);
});

test('independent publication refusal envelopes reject tampered code and details', () => {
  const source = manifest('publication-clock-floor-failure');
  const expected = { exit: 6, stdout: { ok: false, namespace: 'ledger-publication', command: 'publish-claimed', contract_version: 1, state: 'unchanged', operation_id: 'pub_clock_failure', error: { code: 'clock-floor-persistence-failed', message: 'The authoritative clock floor could not be persisted.', details: { ledger_namespace: namespace, item_id: itemId } } } };
  const actual = runReferenceVector({ initial: source.initial, actions: source.actions });
  assert.deepEqual(actual.transcript[1], expected);
  const wrong = structuredClone(expected); wrong.stdout.error.code = 'ledger-revision-conflict';
  assert.notDeepEqual(actual.transcript[1], wrong);
});

test('hand-authored fence-dimension envelopes are literal and tamper checked', () => {
  const source = manifest('fence-dimension-rejections');

  // One complete hand-authored envelope per ordered fence dimension. Each is
  // written out in full rather than derived from the model's own output, so a
  // wrong field anywhere in the envelope fails instead of self-confirming.
  const namespaceMismatch = {
    exit: 4,
    stdout: {
      ok: false,
      namespace: 'ledger-publication',
      command: 'publish-claimed',
      contract_version: 1,
      state: 'unchanged',
      operation_id: 'pub_wrong_namespace',
      error: {
        code: 'claim-fence-rejected',
        message: 'The supplied claim fence is not the active owner generation.',
        details: {
          ledger_namespace: namespace,
          item_id: itemId,
          observed_at: '2030-01-11T09:00:01.000Z',
          reason: 'ledger-namespace-mismatch',
          supplied_owner_id: 'agent-a-run-1',
          supplied_epoch: '3',
          active_owner_id: 'agent-a-run-1',
          active_epoch: '3',
        },
      },
    },
  };
  const itemMismatch = {
    exit: 4,
    stdout: {
      ok: false,
      namespace: 'ledger-publication',
      command: 'publish-claimed',
      contract_version: 1,
      state: 'unchanged',
      operation_id: 'pub_wrong_item',
      error: {
        code: 'claim-fence-rejected',
        message: 'The supplied claim fence is not the active owner generation.',
        details: {
          ledger_namespace: namespace,
          item_id: itemId,
          observed_at: '2030-01-11T09:00:02.000Z',
          reason: 'item-id-mismatch',
          supplied_owner_id: 'agent-a-run-1',
          supplied_epoch: '3',
          active_owner_id: 'agent-a-run-1',
          active_epoch: '3',
        },
      },
    },
  };
  const ownerMismatch = {
    exit: 4,
    stdout: {
      ok: false,
      namespace: 'ledger-publication',
      command: 'publish-claimed',
      contract_version: 1,
      state: 'unchanged',
      operation_id: 'pub_wrong_owner',
      error: {
        code: 'claim-fence-rejected',
        message: 'The supplied claim fence is not the active owner generation.',
        details: {
          ledger_namespace: namespace,
          item_id: itemId,
          observed_at: '2030-01-11T09:00:03.000Z',
          reason: 'owner-mismatch',
          supplied_owner_id: 'agent-b-run-1',
          supplied_epoch: '3',
          active_owner_id: 'agent-a-run-1',
          active_epoch: '3',
        },
      },
    },
  };
  const epochMismatch = {
    exit: 4,
    stdout: {
      ok: false,
      namespace: 'ledger-publication',
      command: 'publish-claimed',
      contract_version: 1,
      state: 'unchanged',
      operation_id: 'pub_wrong_epoch',
      error: {
        code: 'claim-fence-rejected',
        message: 'The supplied claim fence is not the active owner generation.',
        details: {
          ledger_namespace: namespace,
          item_id: itemId,
          observed_at: '2030-01-11T09:00:04.000Z',
          reason: 'epoch-mismatch',
          supplied_owner_id: 'agent-a-run-1',
          supplied_epoch: '2',
          active_owner_id: 'agent-a-run-1',
          active_epoch: '3',
        },
      },
    },
  };

  const actual = runReferenceVector({ initial: source.initial, actions: source.actions });
  assert.deepEqual(actual.transcript[1], namespaceMismatch);
  assert.deepEqual(actual.transcript[3], itemMismatch);
  assert.deepEqual(actual.transcript[5], ownerMismatch);
  assert.deepEqual(actual.transcript[7], epochMismatch);

  // Tamper the literal expected artifacts, not a clone of the model output.
  const wrongReason = structuredClone(namespaceMismatch);
  wrongReason.stdout.error.details.reason = 'item-id-mismatch';
  assert.notDeepEqual(actual.transcript[1], wrongReason);

  const wrongSuppliedOwner = structuredClone(ownerMismatch);
  wrongSuppliedOwner.stdout.error.details.supplied_owner_id = 'agent-a-run-1';
  assert.notDeepEqual(actual.transcript[5], wrongSuppliedOwner);

  const wrongSuppliedEpoch = structuredClone(epochMismatch);
  wrongSuppliedEpoch.stdout.error.details.supplied_epoch = '3';
  assert.notDeepEqual(actual.transcript[7], wrongSuppliedEpoch);

  const wrongCode = structuredClone(itemMismatch);
  wrongCode.stdout.error.code = 'ledger-revision-conflict';
  assert.notDeepEqual(actual.transcript[3], wrongCode);

  // No fence rejection may advance the durable ledger.
  assert.equal(actual.final.durable.ledgers[0].revision, beforeRevision);
});

test('hand-authored claim-expired envelope is literal and tamper checked', () => {
  const source = manifest('fence-dimension-rejections');
  const initial = structuredClone(source.initial);
  initial.durable.claims[0].active.expires_at = '2030-01-11T09:00:00.000Z';
  const request = { ledger_namespace: namespace, item_id: itemId, owner_id: 'agent-a-run-1', epoch: '3', expected_expires_at: '2030-01-11T09:00:00.000Z', lease_duration_ms: 60000 };
  const expected = { exit: 4, stdout: { ok: false, namespace: 'work-claim', command: 'renew', contract_version: 1, state: 'unchanged', error: { code: 'claim-expired', message: 'The matching claim has expired.', details: { ledger_namespace: namespace, item_id: itemId, observed_at: '2030-01-11T09:00:01.000Z', last_epoch: '3', active: { owner_id: 'agent-a-run-1', epoch: '3', issued_at: '2030-01-11T09:00:00.000Z', expires_at: '2030-01-11T09:00:00.000Z' } } } } };
  const actual = runReferenceVector({ initial, actions: [{ operation: 'work-claim.renew', physical_now: '2030-01-11T09:00:01.000Z', request }] }).transcript[0];
  assert.deepEqual(actual, expected);
  const tampered = structuredClone(expected); tampered.stdout.error.details.last_epoch = '2'; assert.notDeepEqual(actual, tampered);
});

test('hand-authored idempotency-conflict envelope is literal and tamper checked', () => {
  // Minimal valid sequence: preflight and commit one publication, then reuse the
  // same operation identity with a different request. Contract step 4 decides
  // before any revision, clock, fence, or candidate decision.
  const source = manifest('paused-writer-commit-boundary');
  const after = sourceFile(source, 'ledger/after.md');
  const committedRequest = publicationRequest('pub_agent_a_1', beforeRevision, after);
  const retriedRequest = publicationRequest('pub_agent_a_1', afterRevision, after);

  const committedEnvelope = {
    exit: 0,
    stdout: {
      ok: true,
      namespace: 'ledger-publication',
      command: 'publish-claimed',
      contract_version: 1,
      state: 'committed',
      operation_id: 'pub_agent_a_1',
      result: {
        ledger_namespace: namespace,
        item_id: itemId,
        committed_revision: afterRevision,
        claim_fence: {
          ledger_namespace: namespace,
          item_id: itemId,
          owner_id: 'agent-a-run-1',
          epoch: '9',
        },
        claim_read_back: {
          ledger_namespace: namespace,
          item_id: itemId,
          observed_at: '2030-01-11T09:00:30.000Z',
          last_epoch: '9',
          active: {
            owner_id: 'agent-a-run-1',
            epoch: '9',
            issued_at: '2030-01-11T09:00:00.000Z',
            expires_at: '2030-01-11T09:01:00.000Z',
          },
        },
      },
    },
  };
  const conflictEnvelope = {
    exit: 4,
    stdout: {
      ok: false,
      namespace: 'ledger-publication',
      command: 'publish-claimed',
      contract_version: 1,
      state: 'unchanged',
      operation_id: 'pub_agent_a_1',
      error: {
        code: 'idempotency-conflict',
        message: 'The operation identity is already bound to a different request.',
        details: {
          operation_id: 'pub_agent_a_1',
          expected_operation_digest: committedOperationDigest,
          actual_operation_digest: retriedOperationDigest,
        },
      },
    },
  };

  const actual = runReferenceVector({
    initial: source.initial,
    actions: [
      { operation: 'ledger-publication.preflight', request: committedRequest },
      {
        operation: 'ledger-publication.commit',
        operation_id: 'pub_agent_a_1',
        physical_now: '2030-01-11T09:00:30.000Z',
        request: committedRequest,
      },
      {
        operation: 'ledger-publication.commit',
        operation_id: 'pub_agent_a_1',
        physical_now: '2030-01-11T09:00:31.000Z',
        request: retriedRequest,
      },
    ],
  });

  assert.deepEqual(actual.transcript, [
    { event: 'preflight-complete', operation_id: 'pub_agent_a_1' },
    committedEnvelope,
    conflictEnvelope,
  ]);

  // The refused retry writes neither the ledger nor a second outcome.
  assert.equal(actual.final.durable.ledgers[0].revision, afterRevision);
  assert.equal(actual.final.durable.ledgers[0].source_base64, after.source_base64);
  assert.equal(actual.final.durable.publication_outcomes.length, 1);

  const wrongExpectedDigest = structuredClone(conflictEnvelope);
  wrongExpectedDigest.stdout.error.details.expected_operation_digest = retriedOperationDigest;
  assert.notDeepEqual(actual.transcript[2], wrongExpectedDigest);

  const wrongCode = structuredClone(conflictEnvelope);
  wrongCode.stdout.error.code = 'ledger-revision-conflict';
  assert.notDeepEqual(actual.transcript[2], wrongCode);
});

test('hand-authored ledger-revision-conflict envelope is literal and tamper checked', () => {
  // Both writers preflight at revision N. The first commit advances the ledger to
  // N+1, so the second reaches contract step 8 with a stale expected_revision.
  // Preflighting the second request after the commit cannot reach this state:
  // preflight rejects the stale revision itself and stores no plan.
  const source = manifest('paused-writer-commit-boundary');
  const after = sourceFile(source, 'ledger/after.md');
  const firstRequest = publicationRequest('pub_agent_a_1', beforeRevision, after);
  const staleRequest = publicationRequest('pub_agent_a_2', beforeRevision, after);

  const committedEnvelope = {
    exit: 0,
    stdout: {
      ok: true,
      namespace: 'ledger-publication',
      command: 'publish-claimed',
      contract_version: 1,
      state: 'committed',
      operation_id: 'pub_agent_a_1',
      result: {
        ledger_namespace: namespace,
        item_id: itemId,
        committed_revision: afterRevision,
        claim_fence: {
          ledger_namespace: namespace,
          item_id: itemId,
          owner_id: 'agent-a-run-1',
          epoch: '9',
        },
        claim_read_back: {
          ledger_namespace: namespace,
          item_id: itemId,
          observed_at: '2030-01-11T09:00:30.000Z',
          last_epoch: '9',
          active: {
            owner_id: 'agent-a-run-1',
            epoch: '9',
            issued_at: '2030-01-11T09:00:00.000Z',
            expires_at: '2030-01-11T09:01:00.000Z',
          },
        },
      },
    },
  };
  const revisionConflictEnvelope = {
    exit: 4,
    stdout: {
      ok: false,
      namespace: 'ledger-publication',
      command: 'publish-claimed',
      contract_version: 1,
      state: 'unchanged',
      operation_id: 'pub_agent_a_2',
      error: {
        code: 'ledger-revision-conflict',
        message: 'The durable ledger revision no longer matches this publication.',
        details: {
          ledger_namespace: namespace,
          item_id: itemId,
          expected_revision: beforeRevision,
          actual_revision: afterRevision,
        },
      },
    },
  };

  const actual = runReferenceVector({
    initial: source.initial,
    actions: [
      { operation: 'ledger-publication.preflight', request: firstRequest },
      { operation: 'ledger-publication.preflight', request: staleRequest },
      {
        operation: 'ledger-publication.commit',
        operation_id: 'pub_agent_a_1',
        physical_now: '2030-01-11T09:00:30.000Z',
        request: firstRequest,
      },
      {
        operation: 'ledger-publication.commit',
        operation_id: 'pub_agent_a_2',
        physical_now: '2030-01-11T09:00:31.000Z',
        request: staleRequest,
      },
    ],
  });

  assert.deepEqual(actual.transcript, [
    { event: 'preflight-complete', operation_id: 'pub_agent_a_1' },
    { event: 'preflight-complete', operation_id: 'pub_agent_a_2' },
    committedEnvelope,
    revisionConflictEnvelope,
  ]);

  // The stale publication leaves the first writer's bytes in place.
  assert.equal(actual.final.durable.ledgers[0].revision, afterRevision);
  assert.equal(actual.final.durable.ledgers[0].source_base64, after.source_base64);

  const wrongActual = structuredClone(revisionConflictEnvelope);
  wrongActual.stdout.error.details.actual_revision = beforeRevision;
  assert.notDeepEqual(actual.transcript[3], wrongActual);

  const wrongCode = structuredClone(revisionConflictEnvelope);
  wrongCode.stdout.error.code = 'claim-fence-rejected';
  assert.notDeepEqual(actual.transcript[3], wrongCode);
});

test('hand-authored revision-adoption envelopes are literal and tamper checked', () => {
  // Authored from docs/work-claim-contract.md section 3.3 alone, not from the
  // committed transcript: the adoption success result names the item, both
  // revisions, the operator, and the authoritative instant, and the replay
  // refuses because the witness no longer names the authorized revision.
  const source = manifest('revision-adoption');
  const request = {
    ledger_namespace: namespace,
    item_id: itemId,
    from_revision: beforeRevision,
    to_revision: afterRevision,
    adopted_by: 'operator-a',
  };
  const committed = {
    exit: 0,
    stdout: {
      ok: true,
      namespace: 'work-claim',
      command: 'claim-adopt',
      contract_version: 1,
      state: 'committed',
      result: {
        ledger_namespace: namespace,
        item_id: itemId,
        from_revision: beforeRevision,
        to_revision: afterRevision,
        adopted_by: 'operator-a',
        adopted_at: '2030-01-11T09:00:05.000Z',
      },
    },
  };
  const replayed = {
    exit: 4,
    stdout: {
      ok: false,
      namespace: 'work-claim',
      command: 'claim-adopt',
      contract_version: 1,
      state: 'unchanged',
      error: {
        code: 'adoption-witness-mismatch',
        message: 'The adoption witness no longer names the authorized revision.',
        details: {
          ledger_namespace: namespace,
          item_id: itemId,
          authorized_revision: afterRevision,
          requested_from_revision: beforeRevision,
        },
      },
    },
  };

  const initial = structuredClone(source.initial);
  initial.durable.claims[0].active = null;
  const actual = runReferenceVector({
    initial,
    actions: [
      { operation: 'work-claim.claim-adopt', physical_now: '2030-01-11T09:00:05.000Z', request },
      { operation: 'work-claim.claim-adopt', physical_now: '2030-01-11T09:00:06.000Z', request },
    ],
  });

  assert.deepEqual(actual.transcript[0], committed);
  assert.deepEqual(actual.transcript[1], replayed);
  // The adoption re-baselines the authorized revision and leaves the bytes.
  assert.equal(actual.final.durable.ledgers[0].authorized_revision, afterRevision);
  assert.equal(actual.final.durable.ledgers[0].revision, afterRevision);
  assert.deepEqual(actual.final.durable.ledgers[0].adoptions, [{
    from_revision: beforeRevision,
    to_revision: afterRevision,
    adopted_by: 'operator-a',
    adopted_at: '2030-01-11T09:00:05.000Z',
  }]);

  const clientClock = structuredClone(committed);
  clientClock.stdout.result.adopted_at = '2030-01-11T09:00:04.000Z';
  assert.notDeepEqual(actual.transcript[0], clientClock);

  const swapped = structuredClone(replayed);
  swapped.stdout.error.details.authorized_revision = beforeRevision;
  assert.notDeepEqual(actual.transcript[1], swapped);
});
