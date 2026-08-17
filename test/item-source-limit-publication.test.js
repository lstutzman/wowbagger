import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runReferenceVector } from './work-claim-reference.js';

const CLI = fileURLToPath(new URL('../bin/wowbagger.js', import.meta.url));

// Written as literals, never imported from src.
const LIMIT = 8388608;
const MAX_PUBLICATION_REQUEST_BYTES = 11534336;
const ITEM_ID = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';

function digestOf(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function run(root, ...argumentsList) {
  const result = spawnSync(process.execPath, [CLI, ...argumentsList], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
  assert.equal(result.stderr, '');
  return { exit: result.status, envelope: JSON.parse(result.stdout) };
}

function itemSource(body) {
  return Buffer.from(`---
schema_version: 2
id: ${ITEM_ID}
number: 1
title: "Before"
kind: task
status: backlog
created: 2026-08-06
updated: 2026-08-11
provenance:
  source: "test"
  recorded_at: "2026-08-11T00:00:00Z"
depends_on: []
related: []
decisions: []
---

${body}`);
}

// A provisioned ledger holding one committed item and one active claim, ready
// for a publish-claimed request whose candidate the caller chooses.
async function publicationFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-publish-limit-'));
  const ledger = path.join(root, 'ledger');
  assert.equal(spawnSync('git', ['init', '--quiet', root]).status, 0);
  await mkdir(ledger);
  const before = itemSource('before\n');
  await writeFile(path.join(ledger, 'item.md'), before);

  const provisioned = run(root, 'provision', '--ledger', ledger, '--json');
  const namespace = provisioned.envelope.result.ledger_namespace;
  const acquirePath = path.join(root, 'acquire.json');
  await writeFile(acquirePath, JSON.stringify({
    ledger_namespace: namespace,
    item_id: ITEM_ID,
    owner_id: 'agent-a',
    lease_duration_ms: 300000,
    expected: { last_epoch: '0', active: null },
  }));
  const acquired = run(root, 'claim', 'acquire', '--ledger', ledger, '--input', acquirePath, '--json');

  const publishRequest = (candidateBase64, candidateDigest) => ({
    operation_id: 'pub_agent-a_0001',
    ledger_namespace: namespace,
    item_id: ITEM_ID,
    expected_revision: digestOf(before),
    candidate_source_base64: candidateBase64,
    candidate_sha256: candidateDigest,
    claim_fence: {
      ledger_namespace: namespace,
      item_id: ITEM_ID,
      owner_id: 'agent-a',
      epoch: acquired.envelope.result.claim.epoch,
    },
  });

  return {
    before,
    itemPath: path.join(ledger, 'item.md'),
    ledger,
    root,
    requestFor(candidate) {
      const base64 = Buffer.isBuffer(candidate) ? candidate.toString('base64') : candidate;
      const digest = Buffer.isBuffer(candidate) ? digestOf(candidate) : digestOf(Buffer.from(''));
      return publishRequest(base64, digest);
    },
    async publishSerialized(serialized) {
      const requestPath = path.join(root, 'publish.json');
      await writeFile(requestPath, serialized);
      return run(root, 'publish-claimed', '--ledger', ledger, '--input', requestPath, '--json');
    },
    async publish(candidate) {
      return this.publishSerialized(JSON.stringify(this.requestFor(candidate)));
    },
  };
}

// The one measurement every candidate size below is built from.
function candidateOfExactly(bytes) {
  const probe = itemSource('');
  const candidate = itemSource('x'.repeat(bytes - probe.length));
  assert.equal(candidate.length, bytes);
  return candidate;
}

test('publish-claimed accepts a candidate of exactly the byte limit', async () => {
  const fixture = await publicationFixture();
  const candidate = candidateOfExactly(LIMIT);

  const published = await fixture.publish(candidate);

  assert.equal(published.exit, 0, JSON.stringify(published.envelope.error ?? {}));
  assert.equal(published.envelope.state, 'committed');
  assert.deepEqual(await readFile(fixture.itemPath), candidate);
});

test('publish-claimed names an oversized candidate instead of blaming base64', async () => {
  const fixture = await publicationFixture();
  const candidate = candidateOfExactly(LIMIT + 1);

  const refused = await fixture.publish(candidate);

  assert.equal(refused.exit, 2);
  assert.deepEqual(refused.envelope, {
    ok: false,
    namespace: 'ledger-publication',
    command: 'publish-claimed',
    contract_version: 1,
    state: 'unchanged',
    operation_id: 'pub_agent-a_0001',
    error: {
      code: 'item-source-too-large',
      message: 'The proposed item source exceeds the supported byte limit.',
      details: { item_id: ITEM_ID, size_bytes: LIMIT + 1, limit_bytes: LIMIT },
    },
  });
  assert.deepEqual(await readFile(fixture.itemPath), fixture.before);
});

test('publish-claimed keeps the canonical-base64 refusal for malformed input', async () => {
  const fixture = await publicationFixture();

  const refused = await fixture.publish('not canonical base64!!');

  assert.equal(refused.exit, 2);
  assert.equal(refused.envelope.error.code, 'invalid-request');
  assert.equal(refused.envelope.error.message, 'The candidate source is not canonical base64.');
  assert.deepEqual(refused.envelope.error.details, { field: 'candidate_source_base64' });
});

// Without canonical base64 there is no item source to measure, so the spelling
// refusal wins even when the bytes it would decode to are oversized.
test('publish-claimed reports noncanonical base64 before size on an oversized candidate', async () => {
  const fixture = await publicationFixture();
  const oversized = candidateOfExactly(LIMIT + 3).toString('base64');

  const refused = await fixture.publish(`${oversized} `);

  assert.equal(refused.exit, 2);
  assert.equal(refused.envelope.error.code, 'invalid-request');
  assert.equal(refused.envelope.error.message, 'The candidate source is not canonical base64.');
});

// The serialized-request bound and the item-source bound measure different
// objects. A request sitting exactly on the transport bound still reaches the
// item-source decision.
test('the publication transport bound admits an exactly-bounded request', async () => {
  const fixture = await publicationFixture();
  const compact = JSON.stringify(fixture.requestFor(candidateOfExactly(LIMIT + 1)));
  const padding = MAX_PUBLICATION_REQUEST_BYTES - Buffer.byteLength(compact, 'utf8');
  assert.ok(padding > 0, 'the padded request must reach the transport bound from below');
  const serialized = `{${' '.repeat(padding)}${compact.slice(1)}`;
  assert.equal(Buffer.byteLength(serialized, 'utf8'), MAX_PUBLICATION_REQUEST_BYTES);

  const refused = await fixture.publishSerialized(serialized);

  assert.equal(refused.exit, 2);
  assert.equal(refused.envelope.error.code, 'item-source-too-large', JSON.stringify(refused.envelope.error));
  assert.equal(refused.envelope.error.details.size_bytes, LIMIT + 1);
});

test('the publication transport bound refuses one byte past it', async () => {
  const fixture = await publicationFixture();
  const requestPath = path.join(fixture.root, 'publish.json');
  await writeFile(requestPath, Buffer.alloc(MAX_PUBLICATION_REQUEST_BYTES + 1, 0x20));

  const refused = run(
    fixture.root, 'publish-claimed', '--ledger', fixture.ledger, '--input', requestPath, '--json',
  );

  assert.equal(refused.exit, 2);
  assert.equal(refused.envelope.error.code, 'invalid-request');
  assert.equal(refused.envelope.error.message, 'The request does not match publish-claimed version 1.');
});

// The oversized-candidate response replaced the version 1 error the work-claim
// contract pinned for that input, so version 1 consumers must fail closed.
test('the work-claim API negotiates version 2', async () => {
  const fixture = await publicationFixture();

  const capabilities = run(fixture.root, 'claim', 'capabilities', '--ledger', fixture.ledger, '--json');

  assert.equal(capabilities.exit, 0);
  assert.equal(capabilities.envelope.result.operations.work_claim.api_version, 2);
});

test('core capabilities negotiates the same work-claim API version', () => {
  const capabilities = run(process.cwd(), 'capabilities', '--json');

  assert.equal(capabilities.exit, 0);
  assert.equal(capabilities.envelope.result.operations.work_claim.api_version, 2);
});

test('publish-claimed measures the candidate before validating it as a ledger', async () => {
  const fixture = await publicationFixture();
  const notAnItem = Buffer.alloc(LIMIT + 1, 0x78);

  const refused = await fixture.publish(notAnItem);

  assert.equal(refused.exit, 2);
  assert.equal(refused.envelope.error.code, 'item-source-too-large');
  assert.equal(refused.envelope.error.details.size_bytes, LIMIT + 1);
  assert.deepEqual(await readFile(fixture.itemPath), fixture.before);
});

// The independent work-claim model answers the same two questions from its own
// code. Neither engine may drift alone.
const NAMESPACE = 'wbns_11111111111111111111111111111111';

function referenceInitialState(before) {
  return {
    backend: {
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
    },
    durable: {
      clock_floors: [],
      claims: [],
      ledgers: [{
        ledger_namespace: NAMESPACE,
        item_id: ITEM_ID,
        revision: digestOf(before),
        source_base64: before.toString('base64'),
      }],
      publication_outcomes: [],
    },
    process: { preflights: [] },
  };
}

function referencePublicationRequest(before, candidate) {
  return {
    operation_id: 'pub_agent-a_0001',
    ledger_namespace: NAMESPACE,
    item_id: ITEM_ID,
    expected_revision: digestOf(before),
    candidate_source_base64: candidate.toString('base64'),
    candidate_sha256: digestOf(candidate),
    claim_fence: {
      ledger_namespace: NAMESPACE,
      item_id: ITEM_ID,
      owner_id: 'agent-a',
      epoch: '1',
    },
  };
}

for (const operation of ['ledger-publication.preflight', 'ledger-publication.commit']) {
  test(`the work-claim model names an oversized candidate at ${operation}`, () => {
    const before = itemSource('before\n');
    const request = referencePublicationRequest(before, candidateOfExactly(LIMIT + 1));

    const result = runReferenceVector({
      initial: referenceInitialState(before),
      actions: [{
        operation,
        request,
        operation_id: request.operation_id,
        physical_now: '2030-01-11T08:01:00.000Z',
      }],
    });

    assert.deepEqual(result.transcript[0].stdout, {
      ok: false,
      namespace: 'ledger-publication',
      command: 'publish-claimed',
      contract_version: 1,
      state: 'unchanged',
      operation_id: 'pub_agent-a_0001',
      error: {
        code: 'item-source-too-large',
        message: 'The proposed item source exceeds the supported byte limit.',
        details: { item_id: ITEM_ID, size_bytes: LIMIT + 1, limit_bytes: LIMIT },
      },
    });
    assert.deepEqual(result.final.durable.publication_outcomes, []);
  });

  test(`the work-claim model accepts an exactly-bounded candidate at ${operation}`, () => {
    const before = itemSource('before\n');
    const request = referencePublicationRequest(before, candidateOfExactly(LIMIT));

    const result = runReferenceVector({
      initial: referenceInitialState(before),
      actions: [{
        operation,
        request,
        operation_id: request.operation_id,
        physical_now: '2030-01-11T08:01:00.000Z',
      }],
    });

    assert.notEqual(result.transcript[0].stdout?.error?.code, 'item-source-too-large');
  });
}
