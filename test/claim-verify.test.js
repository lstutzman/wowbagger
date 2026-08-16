import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { appendClaimEntry, claimJournalPath } from '../src/claim-journal.js';
import { operationDigest, publishClaimed } from '../src/claim-publication.js';
import { resolveGitCommonDir } from '../src/claim-store.js';
import { runReferenceVector } from './work-claim-reference.js';

const CLI = fileURLToPath(new URL('../bin/wowbagger.js', import.meta.url));

function capture(argumentsList) {
  const result = spawnSync(process.execPath, [CLI, ...argumentsList], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  return {
    envelope: JSON.parse(result.stdout),
    exit: result.status,
  };
}

async function pendingPublicationFixture({ durableCandidate = true, pending = true } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-verify-'));
  const ledger = path.join(root, 'ledger');
  assert.equal(spawnSync('git', ['init', '--quiet', root]).status, 0);
  await mkdir(ledger);
  const itemId = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';
  const itemPath = path.join(ledger, 'item.md');
  const before = Buffer.from(`---\nschema_version: 1\nid: ${itemId}\nnumber: 1\ntitle: "Before"\nkind: task\nstatus: backlog\ncreated: 2026-08-06\nupdated: 2026-08-11\nprovenance:\n  source: "test"\n  recorded_at: "2026-08-11T00:00:00Z"\ndepends_on: []\nrelated: []\ndecisions: []\n---\n\nbefore\n`);
  const candidate = Buffer.from(before.toString('utf8').replace('title: "Before"', 'title: "After"'));
  await writeFile(itemPath, before);
  const provisioned = capture(['provision', '--ledger', ledger, '--json']);
  const namespace = provisioned.envelope.result.ledger_namespace;
  const acquirePath = path.join(root, 'acquire.json');
  await writeFile(acquirePath, JSON.stringify({
    ledger_namespace: namespace,
    item_id: itemId,
    owner_id: 'agent-a',
    lease_duration_ms: 300000,
    expected: { last_epoch: '0', active: null },
  }));
  const acquired = capture(['claim', 'acquire', '--ledger', ledger, '--input', acquirePath, '--json']);
  const request = {
    operation_id: 'pub_pending_0001',
    ledger_namespace: namespace,
    item_id: itemId,
    expected_revision: `sha256:${createHash('sha256').update(before).digest('hex')}`,
    candidate_source_base64: candidate.toString('base64'),
    candidate_sha256: `sha256:${createHash('sha256').update(candidate).digest('hex')}`,
    claim_fence: {
      ledger_namespace: namespace,
      item_id: itemId,
      owner_id: 'agent-a',
      epoch: acquired.envelope.result.claim.epoch,
    },
  };
  const gitCommonDir = await resolveGitCommonDir(ledger);
  if (pending) {
    await appendClaimEntry(claimJournalPath(gitCommonDir, namespace), {
      type: 'publish-intent',
      operation_id: request.operation_id,
      operation_digest: operationDigest(request),
      ledger_namespace: namespace,
      item_id: request.item_id,
      fence: request.claim_fence,
      expected_revision: request.expected_revision,
      candidate_sha256: request.candidate_sha256,
      candidate_source_base64: request.candidate_source_base64,
      state: 'pending',
    });
  }
  await writeFile(itemPath, pending && durableCandidate ? candidate : before);
  return {
    before,
    candidate,
    claim: acquired.envelope.result.claim,
    gitCommonDir,
    itemPath,
    ledger,
    namespace,
    request,
    root,
  };
}

test('claim-verify rolls forward a pending publication whose candidate bytes are durable', async () => {
  const fixture = await pendingPublicationFixture();

  const verified = capture(['claim-verify', '--ledger', fixture.ledger, '--json']);

  assert.equal(verified.exit, 0, JSON.stringify(verified.envelope));
  assert.equal(verified.envelope.command, 'claim-verify');
  assert.equal(verified.envelope.state, 'committed');
  assert.deepEqual(verified.envelope.result.findings.map(({ code }) => code), ['pending-intent-resolved']);

  const readPath = path.join(fixture.root, 'read.json');
  await writeFile(readPath, JSON.stringify({
    operation_id: fixture.request.operation_id,
    ledger_namespace: fixture.request.ledger_namespace,
    item_id: fixture.request.item_id,
  }));
  const read = capture(['claim', 'verify', '--ledger', fixture.ledger, '--input', readPath, '--json']);
  assert.equal(read.exit, 0, JSON.stringify(read.envelope));
  assert.equal(read.envelope.result.outcome.stdout.state, 'committed');
});

test('claim-verify rolls back a pending publication whose candidate bytes were not written', async () => {
  const fixture = await pendingPublicationFixture({ durableCandidate: false });

  const verified = capture(['claim-verify', '--ledger', fixture.ledger, '--json']);

  assert.equal(verified.exit, 0, JSON.stringify(verified.envelope));
  assert.deepEqual(verified.envelope.result.findings.map(({ code }) => code), ['pending-intent-resolved']);
  const readPath = path.join(fixture.root, 'read-rolled-back.json');
  await writeFile(readPath, JSON.stringify({
    operation_id: fixture.request.operation_id,
    ledger_namespace: fixture.request.ledger_namespace,
    item_id: fixture.request.item_id,
  }));
  const read = capture(['claim', 'verify', '--ledger', fixture.ledger, '--input', readPath, '--json']);
  assert.equal(read.exit, 0, JSON.stringify(read.envelope));
  assert.equal(read.envelope.result.outcome.stdout.error.code, 'ledger-revision-conflict');
});

test('a fenced operation reconciles a pending publication before making its decision', async () => {
  const fixture = await pendingPublicationFixture();
  const renewPath = path.join(fixture.root, 'claim-renew-after-pending.json');
  await writeFile(renewPath, JSON.stringify({
    ledger_namespace: fixture.namespace,
    item_id: fixture.request.item_id,
    owner_id: fixture.claim.owner_id,
    epoch: fixture.claim.epoch,
    expected_expires_at: fixture.claim.expires_at,
    lease_duration_ms: 300000,
  }));

  const renewed = capture(['claim', 'renew', '--ledger', fixture.ledger, '--input', renewPath, '--json']);

  assert.equal(renewed.exit, 0, JSON.stringify(renewed.envelope));
  const publicationReadPath = path.join(fixture.root, 'publication-read-after-pending.json');
  await writeFile(publicationReadPath, JSON.stringify({
    operation_id: fixture.request.operation_id,
    ledger_namespace: fixture.namespace,
    item_id: fixture.request.item_id,
  }));
  const publicationRead = capture([
    'claim', 'verify', '--ledger', fixture.ledger, '--input', publicationReadPath, '--json',
  ]);
  assert.equal(publicationRead.exit, 0, JSON.stringify(publicationRead.envelope));
  assert.equal(publicationRead.envelope.result.outcome.stdout.state, 'committed');
});

test('publish-claimed reconciles its own pending intent before retrying', async () => {
  const fixture = await pendingPublicationFixture();
  const requestPath = path.join(fixture.root, 'retry-pending.json');
  await writeFile(requestPath, JSON.stringify(fixture.request));

  const retried = capture(['publish-claimed', '--ledger', fixture.ledger, '--input', requestPath, '--json']);

  assert.equal(retried.exit, 0, JSON.stringify(retried.envelope));
  assert.equal(retried.envelope.state, 'committed');
  assert.equal(retried.envelope.operation_id, fixture.request.operation_id);
});

test('claim-verify recovers a publication whose ledger write committed before response loss', async () => {
  const fixture = await pendingPublicationFixture({ pending: false });

  const interrupted = await publishClaimed({
    ledgerDirectory: fixture.ledger,
    gitCommonDir: fixture.gitCommonDir,
    namespace: fixture.namespace,
    request: fixture.request,
    scenario: 'fail:after-ledger-commit',
  });

  assert.equal(interrupted.exit, 6, JSON.stringify(interrupted));
  assert.equal(interrupted.stdout.error.code, 'publication-outcome-unknown');
  const verified = capture(['claim-verify', '--ledger', fixture.ledger, '--json']);
  assert.equal(verified.exit, 0, JSON.stringify(verified.envelope));
  assert.deepEqual(verified.envelope.result.findings.map(({ code }) => code), ['pending-intent-resolved']);
  const readPath = path.join(fixture.root, 'read-response-loss.json');
  await writeFile(readPath, JSON.stringify({
    operation_id: fixture.request.operation_id,
    ledger_namespace: fixture.namespace,
    item_id: fixture.request.item_id,
  }));
  const read = capture(['claim', 'verify', '--ledger', fixture.ledger, '--input', readPath, '--json']);
  assert.equal(read.exit, 0, JSON.stringify(read.envelope));
  assert.equal(read.envelope.result.outcome.stdout.state, 'committed');
});

test('publication replay survives an unrelated later Git commit and matches the reference read', async () => {
  const fixture = await pendingPublicationFixture({ pending: false });
  const interrupted = await publishClaimed({
    ledgerDirectory: fixture.ledger,
    gitCommonDir: fixture.gitCommonDir,
    namespace: fixture.namespace,
    request: fixture.request,
    scenario: 'fail:after-ledger-commit',
  });
  assert.equal(interrupted.exit, 6, JSON.stringify(interrupted));

  assert.equal(spawnSync('git', ['add', fixture.itemPath], { cwd: fixture.root }).status, 0);
  assert.equal(spawnSync('git', [
    '-c', 'user.name=Wowbagger Test',
    '-c', 'user.email=wowbagger@example.test',
    'commit', '--quiet', '-m', 'Commit claimed candidate',
  ], { cwd: fixture.root }).status, 0);
  await writeFile(path.join(fixture.root, 'unrelated.txt'), 'later\n');
  assert.equal(spawnSync('git', ['add', 'unrelated.txt'], { cwd: fixture.root }).status, 0);
  assert.equal(spawnSync('git', [
    '-c', 'user.name=Wowbagger Test',
    '-c', 'user.email=wowbagger@example.test',
    'commit', '--quiet', '-m', 'Commit unrelated file',
  ], { cwd: fixture.root }).status, 0);

  const requestPath = path.join(fixture.root, 'replay.json');
  await writeFile(requestPath, JSON.stringify(fixture.request));
  const replayed = capture([
    'publish-claimed', '--ledger', fixture.ledger, '--input', requestPath, '--json',
  ]);
  assert.equal(replayed.exit, 0, JSON.stringify(replayed.envelope));

  const readPath = path.join(fixture.root, 'read-replayed.json');
  await writeFile(readPath, JSON.stringify({
    operation_id: fixture.request.operation_id,
    ledger_namespace: fixture.namespace,
    item_id: fixture.request.item_id,
  }));
  const read = capture(['claim', 'verify', '--ledger', fixture.ledger, '--input', readPath, '--json']);
  const expected = runReferenceVector({
    initial: {
      backend: {
        name: 'reference-backend',
        coordination_scope: 'shared-transactional-coordinator',
        durability: 'durable-coordinator',
        ledger_binding: {
          mode: 'explicit-allowlist',
          namespaces: [fixture.namespace],
        },
        write_paths: {
          alternate: 'none',
          claimed_publication_v1: 'atomic-fence',
          legacy_create_v1: 'reject-claimed-id',
          legacy_transition_v1: 'reject-active-claim',
        },
      },
      durable: {
        clock_floors: [],
        claims: [{
          ledger_namespace: fixture.namespace,
          item_id: fixture.request.item_id,
          last_epoch: fixture.claim.epoch,
          active: fixture.claim,
        }],
        ledgers: [{
          ledger_namespace: fixture.namespace,
          item_id: fixture.request.item_id,
          revision: fixture.request.expected_revision,
          source_base64: fixture.before.toString('base64'),
        }],
        publication_outcomes: [],
      },
      process: { preflights: [] },
    },
    actions: [
      { operation: 'ledger-publication.preflight', request: fixture.request },
      {
        operation: 'ledger-publication.commit',
        operation_id: fixture.request.operation_id,
        physical_now: replayed.envelope.result.claim_read_back.observed_at,
        request: fixture.request,
      },
      {
        operation: 'ledger-publication.read',
        request: {
          operation_id: fixture.request.operation_id,
          ledger_namespace: fixture.namespace,
          item_id: fixture.request.item_id,
        },
      },
    ],
  });
  assert.equal(read.exit, 0, JSON.stringify(read.envelope));
  assert.deepEqual(read.envelope, expected.transcript[2].stdout);
});

test('claim-verify exposes whether each successful publication is finalized in Git', async () => {
  const fixture = await pendingPublicationFixture();
  const published = capture(['claim-verify', '--ledger', fixture.ledger, '--json']);

  assert.deepEqual(published.envelope.result.publications, [{
    operation_id: fixture.request.operation_id,
    item_id: fixture.request.item_id,
    committed_revision: fixture.request.candidate_sha256,
    git_finalized: false,
    git_commit: null,
  }]);

  assert.equal(spawnSync('git', ['add', fixture.itemPath], { cwd: fixture.root }).status, 0);
  assert.equal(spawnSync('git', [
    '-c', 'user.name=Wowbagger Test',
    '-c', 'user.email=wowbagger@example.test',
    'commit', '--quiet', '-m', 'Commit claimed publication',
  ], { cwd: fixture.root }).status, 0);

  const finalized = capture(['claim-verify', '--ledger', fixture.ledger, '--json']);
  assert.equal(finalized.envelope.result.publications.length, 1);
  assert.equal(finalized.envelope.result.publications[0].git_finalized, true);
  assert.match(finalized.envelope.result.publications[0].git_commit, /^[0-9a-f]{40}$/);
});

test('claim-verify reports a revision regression after a committed claimed publication', async () => {
  const fixture = await pendingPublicationFixture();
  const resolved = capture(['claim-verify', '--ledger', fixture.ledger, '--json']);
  assert.equal(resolved.exit, 0, JSON.stringify(resolved.envelope));
  await writeFile(fixture.itemPath, fixture.before);

  const verified = capture(['claim-verify', '--ledger', fixture.ledger, '--json']);

  assert.equal(verified.exit, 6, JSON.stringify(verified.envelope));
  assert.equal(verified.envelope.state, 'unknown');
  assert.deepEqual(verified.envelope.result.findings.map(({ code }) => code), ['revision-regression']);
  assert.equal(verified.envelope.result.findings[0].actual_revision, fixture.request.expected_revision);
  assert.equal(verified.envelope.result.findings[0].expected_revision, fixture.request.candidate_sha256);
  const readPath = path.join(fixture.root, 'claim-read.json');
  await writeFile(readPath, JSON.stringify({
    ledger_namespace: fixture.namespace,
    item_id: fixture.request.item_id,
  }));
  const claimRead = capture(['claim', 'read', '--ledger', fixture.ledger, '--input', readPath, '--json']);
  assert.equal(claimRead.exit, 0, JSON.stringify(claimRead.envelope));
  assert.equal(claimRead.envelope.result.read_back.item_id, fixture.request.item_id);
  const transitionPath = path.join(fixture.root, 'transition.json');
  await writeFile(transitionPath, JSON.stringify({
    id: fixture.request.item_id,
    expected_revision: fixture.request.expected_revision,
    to_status: 'in_progress',
    date: '2026-08-11',
    decision: {
      summary: 'Start work.',
      rationale: 'Exercise legacy mutation reconciliation.',
    },
  }));
  const transition = capture(['transition', '--ledger', fixture.ledger, '--input', transitionPath, '--json']);
  assert.equal(transition.exit, 6, JSON.stringify(transition.envelope));
  assert.equal(transition.envelope.error.details.reason, 'publication-reconciliation-required');
});

test('an unknown publication outcome names the publication, the path, and claim-verify', async () => {
  const fixture = await pendingPublicationFixture();
  const third = Buffer.from(fixture.before.toString('utf8').replace('title: "Before"', 'title: "Third"'));
  await writeFile(fixture.itemPath, third);

  const verified = capture(['claim-verify', '--ledger', fixture.ledger, '--json']);

  assert.equal(verified.exit, 6, JSON.stringify(verified.envelope));
  assert.equal(verified.envelope.result.findings[0].code, 'publication-outcome-unknown');
  assert.equal(verified.envelope.result.findings[0].expected_path, 'item.md');
  assert.equal(
    verified.envelope.result.findings[0].remediation,
    `Inspect publication ${fixture.request.operation_id} for item.md, complete its documented recovery, then run claim-verify.`,
  );
});

test('a revision regression names the path to restore and claim-verify', async () => {
  const fixture = await pendingPublicationFixture();
  const resolved = capture(['claim-verify', '--ledger', fixture.ledger, '--json']);
  assert.equal(resolved.exit, 0, JSON.stringify(resolved.envelope));
  await writeFile(fixture.itemPath, fixture.before);

  const verified = capture(['claim-verify', '--ledger', fixture.ledger, '--json']);

  assert.equal(verified.exit, 6, JSON.stringify(verified.envelope));
  assert.equal(verified.envelope.result.findings[0].code, 'revision-regression');
  assert.equal(verified.envelope.result.findings[0].expected_path, 'item.md');
  assert.equal(
    verified.envelope.result.findings[0].remediation,
    'Restore the authorized revision at item.md, then run claim-verify.',
  );
});
