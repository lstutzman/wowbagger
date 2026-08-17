// mutation-finalize against the independent reference model.
//
// The reference in test/work-claim-reference.js imports nothing from src/. Its
// mutation-finalize is derived from the mutation contract section 13 alone: the
// command writes no item byte, so the only durable change it can make is moving
// the ledger record's committed surface onto bytes the writer's own surface
// already holds.
//
// The expected envelopes below are written out by hand from the contract. The
// last test is the differential: the real CLI and the reference must agree.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { runReferenceVector } from './work-claim-reference.js';
import {
  ITEM_ID,
  chmodHook,
  git,
  ledgerFile,
  provisionedLedger,
  requestFile,
  run,
  sha256,
  transitionRequest,
} from './auto-commit-fixture.js';

const NAMESPACE = 'wbns_11111111111111111111111111111111';
const REFERENCE_ITEM = 'wb_01Q4837BM01W70T30B184GG1R6';
const PUBLISHED = `sha256:${'a'.repeat(64)}`;
const STALE = `sha256:${'b'.repeat(64)}`;
const COMMIT = 'f'.repeat(40);
const PATHS = ['.wowbagger/reconcile-wbns_11111111111111111111111111111111.md', 'items/x.md'];

function backend() {
  return {
    name: 'reference-backend',
    coordination_scope: 'shared-transactional-coordinator',
    durability: 'durable-coordinator',
    ledger_binding: { mode: 'explicit-allowlist', namespaces: [NAMESPACE] },
    write_paths: {
      alternate: 'none',
      claimed_publication_v1: 'atomic-fence',
      legacy_create_v1: 'reject-claimed-id',
      legacy_transition_v1: 'reject-active-claim',
    },
  };
}

function initial(ledgers) {
  return {
    backend: backend(),
    faults: {},
    durable: { clock_floors: [], claims: [], ledgers, publication_outcomes: [] },
    process: { preflights: [] },
  };
}

function finalizeAction(overrides = {}) {
  return {
    operation: 'work-claim.mutation-finalize',
    physical_now: '2030-01-11T09:00:00.000Z',
    request: {
      ledger_namespace: NAMESPACE,
      item_id: REFERENCE_ITEM,
      published_revision: PUBLISHED,
      git_commit: COMMIT,
      commit_paths: PATHS,
      ...overrides,
    },
  };
}

function ledgerRecord(overrides = {}) {
  return {
    ledger_namespace: NAMESPACE,
    item_id: REFERENCE_ITEM,
    revision: PUBLISHED,
    ...overrides,
  };
}

test('the reference model finalizes an uncommitted published revision once', () => {
  const result = runReferenceVector({
    initial: initial([ledgerRecord({ committed_revision: STALE })]),
    actions: [finalizeAction()],
  });

  assert.deepEqual(result.transcript, [{
    exit: 0,
    stdout: {
      ok: true,
      namespace: 'work-claim',
      command: 'mutation-finalize',
      contract_version: 1,
      state: 'committed',
      result: {
        ledger_namespace: NAMESPACE,
        item_id: REFERENCE_ITEM,
        published_revision: PUBLISHED,
        git_commit: COMMIT,
        commit_paths: PATHS,
        claim_verified: true,
      },
    },
  }]);
  assert.equal(result.final.durable.ledgers[0].committed_revision, PUBLISHED);
});

test('the reference model changes nothing when the committed surface already matches', () => {
  const once = runReferenceVector({
    initial: initial([ledgerRecord({ committed_revision: STALE })]),
    actions: [finalizeAction()],
  });
  const repeated = runReferenceVector({ initial: once.final, actions: [finalizeAction()] });

  assert.deepEqual(repeated.transcript, once.transcript);
  assert.deepEqual(repeated.final, once.final);
});

test('the reference model refuses a changed item and an absent record without changing state', () => {
  const changed = runReferenceVector({
    initial: initial([ledgerRecord({ revision: STALE, committed_revision: STALE })]),
    actions: [finalizeAction()],
  });
  assert.deepEqual(changed.transcript, [{
    exit: 4,
    stdout: {
      ok: false,
      namespace: 'work-claim',
      command: 'mutation-finalize',
      contract_version: 1,
      state: 'unchanged',
      error: {
        code: 'mutation-finalize-refused',
        message: 'Recovery refused before any Git write.',
        details: { reason: 'item-changed', published_revision: PUBLISHED },
      },
    },
  }]);
  assert.deepEqual(changed.final, initial([ledgerRecord({ revision: STALE, committed_revision: STALE })]));

  const absent = runReferenceVector({ initial: initial([]), actions: [finalizeAction()] });
  assert.equal(absent.transcript[0].stdout.error.details.reason, 'item-not-readable');
  assert.equal(absent.transcript[0].exit, 4);
});

test('the reference model refuses an unbound namespace and a malformed request', () => {
  const unbound = runReferenceVector({
    initial: initial([ledgerRecord()]),
    actions: [finalizeAction({ ledger_namespace: 'wbns_22222222222222222222222222222222' })],
  });
  assert.equal(unbound.transcript[0].stdout.error.code, 'ledger-namespace-unbound');

  const malformed = runReferenceVector({
    initial: initial([ledgerRecord()]),
    actions: [finalizeAction({ commit_paths: [] })],
  });
  assert.equal(malformed.transcript[0].stdout.error.code, 'invalid-request');
  assert.equal(malformed.transcript[0].stdout.command, 'mutation-finalize');
});

async function refusedThenRecoverable() {
  const fixture = await provisionedLedger();
  await chmodHook(fixture, 'pre-commit', '#!/bin/sh\nexit 1\n');
  const request = await requestFile(fixture, 'transition.json', transitionRequest(fixture));
  const failed = run(fixture.root, 'transition', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit');
  assert.equal(failed.exit, 6, failed.stdout);
  git(fixture.root, 'config', '--unset', 'core.hooksPath');
  return { fixture, token: failed.envelope.error.details.recovery_token };
}

test('the CLI and the reference agree on mutation-finalize success', async () => {
  const { fixture, token } = await refusedThenRecoverable();
  const published = sha256(await ledgerFile(fixture, `items/${ITEM_ID}.md`));

  const recovered = run(fixture.root, 'mutation-finalize', '--ledger', fixture.ledger, '--recovery-token', token, '--json');

  assert.equal(recovered.exit, 0, recovered.stdout);
  // The same logical case in the reference: a bound namespace whose ledger
  // record holds the published bytes on the writer's surface and not yet on the
  // committed one.
  const modelled = runReferenceVector({
    initial: initial([{
      ledger_namespace: NAMESPACE,
      item_id: REFERENCE_ITEM,
      revision: published,
      committed_revision: STALE,
    }]),
    actions: [finalizeAction({
      published_revision: published,
      git_commit: recovered.envelope.result.git_commit,
      commit_paths: recovered.envelope.result.commit_paths,
    })],
  });

  assert.deepEqual(rename(recovered.envelope), rename(modelled.transcript[0].stdout));
  assert.equal(recovered.exit, modelled.transcript[0].exit);
});

test('the CLI and the reference agree that a changed item refuses recovery', async () => {
  const { fixture, token } = await refusedThenRecoverable();
  const published = sha256(await ledgerFile(fixture, `items/${ITEM_ID}.md`));
  await writeFile(
    path.join(fixture.ledger, 'items', `${ITEM_ID}.md`),
    `${await ledgerFile(fixture, `items/${ITEM_ID}.md`)}edited\n`,
  );

  const refused = run(fixture.root, 'mutation-finalize', '--ledger', fixture.ledger, '--recovery-token', token, '--json');

  const modelled = runReferenceVector({
    initial: initial([{
      ledger_namespace: NAMESPACE,
      item_id: REFERENCE_ITEM,
      revision: STALE,
      committed_revision: STALE,
    }]),
    actions: [finalizeAction({ published_revision: published })],
  });

  assert.deepEqual(rename(refused.envelope), rename(modelled.transcript[0].stdout));
  assert.equal(refused.exit, modelled.transcript[0].exit);
});

// The reference names its own synthetic namespace and item. Comparing the two
// envelopes means comparing everything except those two identifiers.
function rename(envelope) {
  return JSON.parse(JSON.stringify(envelope)
    .replaceAll(ITEM_ID, REFERENCE_ITEM)
    .replaceAll(/wbns_[a-f0-9]{32}/gu, NAMESPACE));
}
