import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { runReferenceVector } from './work-claim-reference.js';

const fixtureRoot = new URL('../spec/fixtures/work-claims/', import.meta.url);
const namespace = 'wbns_11111111111111111111111111111111';
const itemId = 'wb_01Q4837BM01W70T30B184GG1R6';
const maxEpoch = '18446744073709551615';

function manifest(name) {
  return JSON.parse(readFileSync(new URL(`${name}/manifest.json`, fixtureRoot), 'utf8'));
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

test('hand-authored refusal goldens execute and reject tampering', () => {
  const source = manifest('fence-dimension-rejections');
  const actual = runReferenceVector({ initial: source.initial, actions: source.actions });
  const expected = [
    { index: 1, code: 'claim-fence-rejected', message: 'The supplied claim fence is not the active owner generation.' },
    { index: 3, code: 'claim-fence-rejected', message: 'The supplied claim fence is not the active owner generation.' },
    { index: 5, code: 'claim-fence-rejected', message: 'The supplied claim fence is not the active owner generation.' },
    { index: 7, code: 'claim-fence-rejected', message: 'The supplied claim fence is not the active owner generation.' },
  ];
  for (const gold of expected) {
    const envelope = actual.transcript[gold.index];
    assert.equal(envelope.exit, 4);
    assert.equal(envelope.stdout.namespace, 'ledger-publication');
    assert.equal(envelope.stdout.command, 'publish-claimed');
    assert.equal(envelope.stdout.state, 'unchanged');
    assert.deepEqual({ code: envelope.stdout.error.code, message: envelope.stdout.error.message }, { code: gold.code, message: gold.message });
    assert.ok(Object.keys(envelope.stdout.error.details).length > 0);
    const tampered = structuredClone(envelope); tampered.stdout.error.code = 'ledger-revision-conflict';
    assert.notDeepEqual(tampered, envelope);
  }
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
