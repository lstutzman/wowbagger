// test/claim-publish-refusal.test.js
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, symlink, unlink, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { appendClaimEntry, claimJournalPath, replayClaimJournal } from '../src/claim-journal.js';
import { resolveGitCommonDir } from '../src/claim-store.js';


const CLI = fileURLToPath(new URL('../bin/wowbagger.js', import.meta.url));

async function capture(argumentsList, options = {}) {
  const result = spawnSync(process.execPath, [CLI, ...argumentsList], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: options.env ?? process.env,
  });
  return {
    envelope: JSON.parse(result.stdout),
    exit: result.status,
  };
}

async function advisoryLedger() {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-advisory-'));
  assert.equal(spawnSync('git', ['init', '--quiet', root]).status, 0);
  const ledger = path.join(root, 'ledger');
  await mkdir(ledger);
  return ledger;
}

// The comparison the spec promised: the CLI's refusal is held against the
// normative advisory-publication-rejection transcript, excluding only
// `operation_id` — the documented exclusion for a backend that refuses
// before reading any input (work-claim contract, advisory rejection).
test('the refusal matches the normative transcript except the documented operation_id exclusion', async () => {
  const ledger = await advisoryLedger();
  const manifest = JSON.parse(readFileSync(fileURLToPath(new URL(
    '../spec/fixtures/work-claims/advisory-publication-rejection/manifest.json',
    import.meta.url,
  )), 'utf8'));
  const [expected] = manifest.expected.transcript;
  const { operation_id, ...expectedEnvelope } = expected.stdout;
  assert.equal(typeof operation_id, 'string');

  const refused = await capture(['publish-claimed', '--ledger', ledger, '--input', '/dev/null', '--json']);

  assert.deepEqual(refused.envelope, expectedEnvelope);
  assert.equal(refused.exit, expected.exit);
});

test('publish-claimed refuses with the contract capability-unavailable envelope', async () => {
  const ledger = await advisoryLedger();
  const refused = await capture(['publish-claimed', '--ledger', ledger, '--input', '/dev/null', '--json']);
  const envelope = refused.envelope;
  assert.equal(envelope.ok, false);
  assert.equal(envelope.namespace, 'ledger-publication');
  assert.equal(envelope.command, 'publish-claimed');
  assert.equal(envelope.state, 'unchanged');
  assert.equal(envelope.error.code, 'capability-unavailable');
  assert.equal(envelope.error.message, 'Claim-protected publication is unavailable on an advisory backend.');
  assert.deepEqual(envelope.error.details, { reason: 'advisory-capability' });
  assert.equal(refused.exit, 2);
});

test('publish-claimed refuses without reading its input file', async () => {
  const ledger = await advisoryLedger();
  const missingDir = await mkdtemp(path.join(tmpdir(), 'wb-pub-'));
  const missingInput = path.join(missingDir, 'definitely-absent.json');
  const refused = await capture(['publish-claimed', '--ledger', ledger, '--input', missingInput, '--json']);
  const envelope = refused.envelope;
  assert.equal(envelope.ok, false);
  assert.equal(envelope.namespace, 'ledger-publication');
  assert.equal(envelope.command, 'publish-claimed');
  assert.equal(envelope.contract_version, 1);
  assert.equal(envelope.state, 'unchanged');
  assert.equal(envelope.error.code, 'capability-unavailable');
  assert.equal(envelope.error.message, 'Claim-protected publication is unavailable on an advisory backend.');
  assert.deepEqual(envelope.error.details, { reason: 'advisory-capability' });
  assert.equal(refused.exit, 2);
});

test('publish-claimed bounds stdin before end-of-stream', async () => {
  const fixture = await publicationFixture();
  const child = spawn(process.execPath, [
    CLI,
    'publish-claimed',
    '--ledger',
    fixture.ledger,
    '--input',
    '-',
    '--json',
  ], {
    cwd: fixture.root,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stdin.on('error', () => {});
  child.stdin.write(Buffer.alloc(12 * 1024 * 1024, 0x20));

  let timeout;
  const exited = await Promise.race([
    once(child, 'exit').then(([code]) => code),
    new Promise((resolve) => {
      timeout = setTimeout(() => resolve(null), 3000);
    }),
  ]);
  clearTimeout(timeout);
  if (exited === null) child.kill('SIGKILL');

  assert.equal(exited, 2, `process did not bound stdin; stdout=${stdout}`);
  assert.equal(JSON.parse(stdout).error.code, 'invalid-request');
});

async function publicationFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-publish-'));
  const ledger = path.join(root, 'ledger');
  assert.equal(spawnSync('git', ['init', '--quiet', root]).status, 0);
  await mkdir(ledger);
  const itemId = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';
  const itemPath = path.join(ledger, 'item.md');
  const before = Buffer.from(`---
schema_version: 2
id: ${itemId}
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

before
`);
  const candidate = Buffer.from(before.toString('utf8').replace('title: "Before"', 'title: "After"').replace('before\n', 'after\n'));
  await writeFile(itemPath, before);
  const provisioned = await capture(['provision', '--ledger', ledger, '--json']);
  const namespace = provisioned.envelope.result.ledger_namespace;
  const acquirePath = path.join(root, 'acquire.json');
  await writeFile(acquirePath, JSON.stringify({
    ledger_namespace: namespace,
    item_id: itemId,
    owner_id: 'agent-a',
    lease_duration_ms: 300000,
    expected: { last_epoch: '0', active: null },
  }));
  const acquired = await capture(['claim', 'acquire', '--ledger', ledger, '--input', acquirePath, '--json']);
  const requestPath = path.join(root, 'publish.json');
  await writeFile(requestPath, JSON.stringify({
    operation_id: 'pub_agent-a_0001',
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
  }));
  return {
    before,
    candidate,
    claim: acquired.envelope.result.claim,
    itemId,
    itemPath,
    ledger,
    namespace,
    requestPath,
    root,
  };
}

test('publish-claimed tells an operation-ID-only retry to resend the complete request', async () => {
  const fixture = await publicationFixture();
  const retryPath = path.join(fixture.root, 'operation-id-only.json');
  await writeFile(retryPath, JSON.stringify({ operation_id: 'pub_agent-a_retry_0001' }));

  const refused = await capture([
    'publish-claimed', '--ledger', fixture.ledger, '--input', retryPath, '--json',
  ]);

  assert.equal(refused.exit, 2);
  assert.equal(refused.envelope.state, 'unchanged');
  assert.equal(refused.envelope.error.code, 'invalid-request');
  assert.equal(
    refused.envelope.error.message,
    'The publish-claimed retry must include its complete request.',
  );
});

test('publish-claimed writes exact candidate bytes for the active claim fence', async () => {
  const fixture = await publicationFixture();

  const published = await capture([
    'publish-claimed', '--ledger', fixture.ledger, '--input', fixture.requestPath, '--json',
  ]);

  assert.equal(published.exit, 0, JSON.stringify(published.envelope));
  assert.equal(published.envelope.state, 'committed');
  assert.equal(
    published.envelope.result.committed_revision,
    `sha256:${createHash('sha256').update(fixture.candidate).digest('hex')}`,
  );
  assert.deepEqual(await readFile(fixture.itemPath), fixture.candidate);

  // The publication authorized a revision, so the journal names the worktree
  // that authorized it — on the intent it recorded before the write and on the
  // terminal it recorded after. The ID is read from the writer's own private
  // Git directory, never from the journal it is being compared against.
  const gitCommonDir = await resolveGitCommonDir(fixture.ledger);
  const worktreeId = (await readFile(
    path.join(gitCommonDir, 'wowbagger-worktree-id'), 'utf8',
  )).trimEnd();
  const { entries } = await replayClaimJournal(
    claimJournalPath(gitCommonDir, fixture.namespace), fixture.namespace,
  );
  const intent = entries.find((entry) => entry.type === 'publish-intent');
  const final = entries.find((entry) => entry.type === 'publish-final');
  assert.equal(intent.writer_worktree_id, worktreeId);
  assert.equal(final.writer_worktree_id, worktreeId);
});

test('publish-claimed rejects a request for another ledger namespace', async () => {
  const fixture = await publicationFixture();
  const request = JSON.parse(await readFile(fixture.requestPath, 'utf8'));
  request.ledger_namespace = 'wbns_ffffffffffffffffffffffffffffffff';
  request.claim_fence.ledger_namespace = request.ledger_namespace;
  await writeFile(fixture.requestPath, JSON.stringify(request));

  const published = await capture([
    'publish-claimed', '--ledger', fixture.ledger, '--input', fixture.requestPath, '--json',
  ]);

  assert.equal(published.exit, 2, JSON.stringify(published.envelope));
  assert.equal(published.envelope.error.code, 'ledger-namespace-unbound');
  assert.deepEqual(await readFile(fixture.itemPath), fixture.before);
});

test('publish-claimed reports clock persistence failure before publication when the journal is full', async () => {
  const fixture = await publicationFixture();
  const journalPath = path.join(fixture.root, '.git', 'wowbagger', fixture.namespace, 'journal.ndjson');
  const entries = Array.from({ length: 65536 }, (_, index) => JSON.stringify({
    seq: index + 1,
    type: 'clock',
    now: '2030-01-11T09:00:00.000Z',
    floor: '2030-01-11T09:00:00.000Z',
  })).join('\n');
  await writeFile(journalPath, `${entries}\n`);

  const published = await capture([
    'publish-claimed', '--ledger', fixture.ledger, '--input', fixture.requestPath, '--json',
  ]);

  assert.equal(published.exit, 6, JSON.stringify(published.envelope));
  assert.equal(published.envelope.error.code, 'clock-floor-persistence-failed');
  assert.deepEqual(await readFile(fixture.itemPath), fixture.before);
});

test('publish-claimed returns the stored terminal envelope for an identical retry', async () => {
  const fixture = await publicationFixture();
  const command = ['publish-claimed', '--ledger', fixture.ledger, '--input', fixture.requestPath, '--json'];
  const first = await capture(command);

  const retry = await capture(command);

  assert.equal(retry.exit, 0, JSON.stringify(retry.envelope));
  assert.deepEqual(retry.envelope, first.envelope);
});

test('publish-claimed returns a stored retry before unrelated reconciliation', async () => {
  const fixture = await publicationFixture();
  const command = ['publish-claimed', '--ledger', fixture.ledger, '--input', fixture.requestPath, '--json'];
  const first = await capture(command);
  assert.equal(first.exit, 0, JSON.stringify(first.envelope));
  await appendClaimEntry(claimJournalPath(path.join(fixture.root, '.git'), fixture.namespace), {
    type: 'publish-intent',
    operation_id: 'pub_unrelated_0001',
    operation_digest: `sha256:${'1'.repeat(64)}`,
    item_id: 'wb_01KZBMBEZKPE7D15HKW9Q3GT00',
    expected_revision: `sha256:${'2'.repeat(64)}`,
    candidate_sha256: `sha256:${'3'.repeat(64)}`,
    fence: {
      ledger_namespace: fixture.namespace,
      item_id: 'wb_01KZBMBEZKPE7D15HKW9Q3GT00',
      owner_id: 'agent-b',
      epoch: '1',
    },
  });

  const retry = await capture(command);

  assert.equal(retry.exit, 0, JSON.stringify(retry.envelope));
  assert.deepEqual(retry.envelope, first.envelope);
});

test('publish-claimed binds an operation identity across item IDs', async () => {
  const fixture = await publicationFixture();
  const command = ['publish-claimed', '--ledger', fixture.ledger, '--input', fixture.requestPath, '--json'];
  const first = await capture(command);
  assert.equal(first.exit, 0, JSON.stringify(first.envelope));
  const reused = JSON.parse(await readFile(fixture.requestPath, 'utf8'));
  reused.item_id = 'wb_01KZBMBEZKPE7D15HKW9Q3GT00';
  reused.claim_fence.item_id = reused.item_id;
  const reusedPath = path.join(fixture.root, 'publish-reused-operation.json');
  await writeFile(reusedPath, JSON.stringify(reused));

  const conflict = await capture([
    'publish-claimed', '--ledger', fixture.ledger, '--input', reusedPath, '--json',
  ]);

  assert.equal(conflict.exit, 4, JSON.stringify(conflict.envelope));
  assert.equal(conflict.envelope.error.code, 'idempotency-conflict');
  assert.deepEqual(await readFile(fixture.itemPath), fixture.candidate);
});

test('publish-claimed returns the stored terminal envelope before revalidating ledger state', async () => {
  const fixture = await publicationFixture();
  const command = ['publish-claimed', '--ledger', fixture.ledger, '--input', fixture.requestPath, '--json'];
  const first = await capture(command);
  assert.equal(first.exit, 0, JSON.stringify(first.envelope));
  await unlink(fixture.itemPath);

  const retry = await capture(command);

  assert.equal(retry.exit, 0, JSON.stringify(retry.envelope));
  assert.deepEqual(retry.envelope, first.envelope);
});

test('claim verify returns the durable publication outcome', async () => {
  const fixture = await publicationFixture();
  const published = await capture([
    'publish-claimed', '--ledger', fixture.ledger, '--input', fixture.requestPath, '--json',
  ]);
  const verifyPath = path.join(path.dirname(fixture.requestPath), 'verify.json');
  await writeFile(verifyPath, JSON.stringify({
    operation_id: published.envelope.operation_id,
    ledger_namespace: published.envelope.result.ledger_namespace,
    item_id: published.envelope.result.item_id,
  }));

  const verified = await capture([
    'claim', 'verify', '--ledger', fixture.ledger, '--input', verifyPath, '--json',
  ]);

  assert.equal(verified.exit, 0, JSON.stringify(verified.envelope));
  assert.equal(verified.envelope.command, 'read');
  assert.equal(verified.envelope.result.operation_id, published.envelope.operation_id);
  assert.match(verified.envelope.result.operation_digest, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(verified.envelope.result.outcome, {
    exit: published.exit,
    stdout: published.envelope,
  });
});

test('claim verify rejects a publication read for another ledger namespace', async () => {
  const fixture = await publicationFixture();
  const published = await capture([
    'publish-claimed', '--ledger', fixture.ledger, '--input', fixture.requestPath, '--json',
  ]);
  assert.equal(published.exit, 0, JSON.stringify(published.envelope));
  const verifyPath = path.join(fixture.root, 'verify-other-namespace.json');
  await writeFile(verifyPath, JSON.stringify({
    operation_id: published.envelope.operation_id,
    ledger_namespace: 'wbns_ffffffffffffffffffffffffffffffff',
    item_id: published.envelope.result.item_id,
  }));

  const verified = await capture([
    'claim', 'verify', '--ledger', fixture.ledger, '--input', verifyPath, '--json',
  ]);

  assert.equal(verified.exit, 2, JSON.stringify(verified.envelope));
  assert.equal(verified.envelope.error.code, 'ledger-namespace-unbound');
});

test('claim verify distinguishes a stale fenced write from an unknown revision regression', async () => {
  const fixture = await publicationFixture();
  const first = await capture(['publish-claimed', '--ledger', fixture.ledger, '--input', fixture.requestPath, '--json']);
  assert.equal(first.exit, 0, JSON.stringify(first.envelope));
  const releasePath = path.join(fixture.root, 'release.json');
  await writeFile(releasePath, JSON.stringify({
    ledger_namespace: fixture.namespace,
    item_id: fixture.itemId,
    owner_id: fixture.claim.owner_id,
    epoch: fixture.claim.epoch,
    expected_expires_at: fixture.claim.expires_at,
  }));
  const released = await capture(['claim', 'release', '--ledger', fixture.ledger, '--input', releasePath, '--json']);
  assert.equal(released.exit, 0, JSON.stringify(released.envelope));
  const acquirePath = path.join(fixture.root, 'acquire-2.json');
  await writeFile(acquirePath, JSON.stringify({
    ledger_namespace: fixture.namespace,
    item_id: fixture.itemId,
    owner_id: 'agent-b',
    lease_duration_ms: 300000,
    expected: { last_epoch: fixture.claim.epoch, active: null },
  }));
  const acquired = await capture(['claim', 'acquire', '--ledger', fixture.ledger, '--input', acquirePath, '--json']);
  assert.equal(acquired.exit, 0, JSON.stringify(acquired.envelope));
  const secondCandidate = Buffer.from(
    fixture.candidate.toString('utf8').replace('title: "After"', 'title: "Second"').replace('after\n', 'second\n'),
  );
  const secondRequestPath = path.join(fixture.root, 'publish-2.json');
  await writeFile(secondRequestPath, JSON.stringify({
    operation_id: 'pub_agent-b_0002',
    ledger_namespace: fixture.namespace,
    item_id: fixture.itemId,
    expected_revision: first.envelope.result.committed_revision,
    candidate_source_base64: secondCandidate.toString('base64'),
    candidate_sha256: `sha256:${createHash('sha256').update(secondCandidate).digest('hex')}`,
    claim_fence: {
      ledger_namespace: fixture.namespace,
      item_id: fixture.itemId,
      owner_id: 'agent-b',
      epoch: acquired.envelope.result.claim.epoch,
    },
  }));
  const second = await capture(['publish-claimed', '--ledger', fixture.ledger, '--input', secondRequestPath, '--json']);
  assert.equal(second.exit, 0, JSON.stringify(second.envelope));
  await writeFile(fixture.itemPath, fixture.candidate);

  const verified = await capture(['claim-verify', '--ledger', fixture.ledger, '--json']);

  assert.equal(verified.exit, 6, JSON.stringify(verified.envelope));
  assert.equal(verified.envelope.result.findings[0].code, 'stale-write-detected');
  assert.equal(verified.envelope.result.findings[0].active_fence.epoch, acquired.envelope.result.claim.epoch);
  assert.equal(verified.envelope.result.findings[0].stale_fence.epoch, fixture.claim.epoch);
  assert.equal(verified.envelope.result.findings[0].observed_surface, 'working-tree');
  assert.equal(verified.envelope.result.findings[0].reason, 'claimed-publication-pending');
  assert.equal(verified.envelope.result.findings[0].expected_path, 'item.md');
  assert.equal(
    verified.envelope.result.findings[0].remediation,
    'Inspect publication pub_agent-b_0002 for item.md, then complete its documented recovery.',
  );
});

test('publish-claimed rejects and records an old fence after release', async () => {
  const fixture = await publicationFixture();
  const releasePath = path.join(fixture.root, 'release-before-publish.json');
  await writeFile(releasePath, JSON.stringify({
    ledger_namespace: fixture.namespace,
    item_id: fixture.itemId,
    owner_id: fixture.claim.owner_id,
    epoch: fixture.claim.epoch,
    expected_expires_at: fixture.claim.expires_at,
  }));
  const released = await capture([
    'claim', 'release', '--ledger', fixture.ledger, '--input', releasePath, '--json',
  ]);
  assert.equal(released.exit, 0, JSON.stringify(released.envelope));

  const published = await capture([
    'publish-claimed', '--ledger', fixture.ledger, '--input', fixture.requestPath, '--json',
  ]);

  assert.equal(published.exit, 4, JSON.stringify(published.envelope));
  assert.equal(published.envelope.state, 'unchanged');
  assert.equal(published.envelope.error.code, 'claim-fence-rejected');
  assert.equal(published.envelope.error.details.reason, 'no-active-claim');
  assert.deepEqual(await readFile(fixture.itemPath), fixture.before);

  const verifyPath = path.join(fixture.root, 'verify-rejected-publication.json');
  await writeFile(verifyPath, JSON.stringify({
    operation_id: 'pub_agent-a_0001',
    ledger_namespace: fixture.namespace,
    item_id: fixture.itemId,
  }));
  const verified = await capture([
    'claim', 'verify', '--ledger', fixture.ledger, '--input', verifyPath, '--json',
  ]);
  assert.equal(verified.exit, 0, JSON.stringify(verified.envelope));
  assert.deepEqual(verified.envelope.result.outcome, {
    exit: published.exit,
    stdout: published.envelope,
  });
});

test('publish-claimed rejects a stale claim fence before changing ledger bytes', async () => {
  const fixture = await publicationFixture();
  const releasePath = path.join(fixture.root, 'release.json');
  await writeFile(releasePath, JSON.stringify({
    ledger_namespace: fixture.namespace,
    item_id: fixture.itemId,
    owner_id: fixture.claim.owner_id,
    epoch: fixture.claim.epoch,
    expected_expires_at: fixture.claim.expires_at,
  }));
  const released = await capture([
    'claim', 'release', '--ledger', fixture.ledger, '--input', releasePath, '--json',
  ]);
  assert.equal(released.exit, 0, JSON.stringify(released.envelope));
  const acquirePath = path.join(fixture.root, 'takeover.json');
  await writeFile(acquirePath, JSON.stringify({
    ledger_namespace: fixture.namespace,
    item_id: fixture.itemId,
    owner_id: 'agent-b',
    lease_duration_ms: 300000,
    expected: { last_epoch: fixture.claim.epoch, active: null },
  }));
  const acquired = await capture([
    'claim', 'acquire', '--ledger', fixture.ledger, '--input', acquirePath, '--json',
  ]);
  assert.equal(acquired.exit, 0, JSON.stringify(acquired.envelope));

  const refused = await capture([
    'publish-claimed', '--ledger', fixture.ledger, '--input', fixture.requestPath, '--json',
  ]);

  assert.equal(refused.exit, 4, JSON.stringify(refused.envelope));
  assert.equal(refused.envelope.error.code, 'claim-fence-rejected');
  assert.equal(refused.envelope.error.details.reason, 'owner-mismatch');
  assert.deepEqual(await readFile(fixture.itemPath), fixture.before);
});

test('legacy transition refuses an item with an active fenced claim', async () => {
  const fixture = await publicationFixture();
  const transitionPath = path.join(fixture.root, 'transition.json');
  await writeFile(transitionPath, JSON.stringify({
    id: fixture.itemId,
    expected_revision: `sha256:${createHash('sha256').update(fixture.before).digest('hex')}`,
    to_status: 'in-progress',
    date: '2026-08-11',
  }));

  const refused = await capture([
    'transition', '--ledger', fixture.ledger, '--input', transitionPath, '--json',
  ]);

  assert.equal(refused.exit, 4, JSON.stringify(refused.envelope));
  assert.equal(refused.envelope.error.code, 'active-claim-write-refused');
  assert.deepEqual(await readFile(fixture.itemPath), fixture.before);
});

test('legacy transition fails closed when Git verification cannot run', async () => {
  const fixture = await publicationFixture();
  const transitionPath = path.join(fixture.root, 'transition-git-failure.json');
  const emptyPath = path.join(fixture.root, 'empty-path');
  await mkdir(emptyPath);
  await writeFile(transitionPath, JSON.stringify({
    id: fixture.itemId,
    expected_revision: `sha256:${createHash('sha256').update(fixture.before).digest('hex')}`,
    to_status: 'in-progress',
    date: '2026-08-11',
  }));

  const refused = await capture(
    ['transition', '--ledger', fixture.ledger, '--input', transitionPath, '--json'],
    { env: { ...process.env, PATH: emptyPath } },
  );

  assert.equal(refused.exit, 6, JSON.stringify(refused.envelope));
  assert.equal(refused.envelope.error.code, 'claim-store-unavailable');
  assert.equal(refused.envelope.error.details.reason, 'git-verification-failed');
  assert.deepEqual(await readFile(fixture.itemPath), fixture.before);
});

test('legacy transition fails closed for a malformed Git directory marker', async () => {
  const fixture = await publicationFixture();
  const transitionPath = path.join(fixture.root, 'transition-malformed-git.json');
  await writeFile(transitionPath, JSON.stringify({
    id: fixture.itemId,
    expected_revision: `sha256:${createHash('sha256').update(fixture.before).digest('hex')}`,
    to_status: 'in-progress',
    date: '2026-08-11',
  }));
  await rename(path.join(fixture.root, '.git'), path.join(fixture.root, '.git-real'));
  await writeFile(path.join(fixture.root, '.git'), 'not a gitdir marker\n');

  const refused = await capture([
    'transition', '--ledger', fixture.ledger, '--input', transitionPath, '--json',
  ]);

  assert.equal(refused.exit, 6, JSON.stringify(refused.envelope));
  assert.equal(refused.envelope.error.code, 'claim-store-unavailable');
  assert.equal(refused.envelope.error.details.reason, 'git-verification-failed');
  assert.deepEqual(await readFile(fixture.itemPath), fixture.before);
});

test('legacy transition fails closed for a dangling Git directory marker', async () => {
  const fixture = await publicationFixture();
  const transitionPath = path.join(fixture.root, 'transition-dangling-git.json');
  await writeFile(transitionPath, JSON.stringify({
    id: fixture.itemId,
    expected_revision: `sha256:${createHash('sha256').update(fixture.before).digest('hex')}`,
    to_status: 'in_progress',
    date: '2026-08-11',
    decision: { summary: 'Start.', rationale: 'Exercise fail-closed Git discovery.' },
  }));
  await rename(path.join(fixture.root, '.git'), path.join(fixture.root, '.git-real'));
  await symlink('missing-git-directory', path.join(fixture.root, '.git'));

  const refused = await capture([
    'transition', '--ledger', fixture.ledger, '--input', transitionPath, '--json',
  ]);

  assert.equal(refused.exit, 6, JSON.stringify(refused.envelope));
  assert.equal(refused.envelope.error.code, 'claim-store-unavailable');
  assert.equal(refused.envelope.error.details.reason, 'git-verification-failed');
  assert.deepEqual(await readFile(fixture.itemPath), fixture.before);
});


test('legacy patch does not publish when its journal authorization cannot be reserved', async () => {
  const fixture = await publicationFixture();
  const journalPath = claimJournalPath(path.join(fixture.root, '.git'), fixture.namespace);
  const clock = '2020-01-01T00:00:00.000Z';
  const entries = Array.from({ length: 65535 }, (_entry, index) => JSON.stringify({
    seq: index + 1,
    type: 'clock',
    now: clock,
    floor: clock,
  }));
  await writeFile(journalPath, `${entries.join('\n')}\n`);
  const patchPath = path.join(fixture.root, 'patch-full-journal.json');
  await writeFile(patchPath, JSON.stringify({
    id: fixture.itemId,
    expected_revision: `sha256:${createHash('sha256').update(fixture.before).digest('hex')}`,
    date: '2026-08-11',
    set: { priority: 1 },
  }));

  const refused = await capture([
    'patch', '--ledger', fixture.ledger, '--input', patchPath, '--json',
  ]);

  assert.equal(refused.exit, 6, JSON.stringify(refused.envelope));
  assert.equal(refused.envelope.state, 'unchanged');
  assert.equal(refused.envelope.error.code, 'claim-store-unavailable');
  assert.deepEqual(await readFile(fixture.itemPath), fixture.before);
});

test('legacy patch reserves journal capacity for crash recovery before publishing', async () => {
  const fixture = await publicationFixture();
  const journalPath = claimJournalPath(path.join(fixture.root, '.git'), fixture.namespace);
  const entries = Array.from({ length: 65534 }, (_, index) => JSON.stringify({
    seq: index + 1,
    type: 'clock',
    now: '2030-01-11T09:00:00.000Z',
    floor: '2030-01-11T09:00:00.000Z',
  })).join('\n');
  await writeFile(journalPath, `${entries}\n`);
  const patchPath = path.join(fixture.root, 'legacy-capacity-reserve-patch.json');
  await writeFile(patchPath, JSON.stringify({
    id: fixture.itemId,
    expected_revision: `sha256:${createHash('sha256').update(fixture.before).digest('hex')}`,
    date: '2026-08-11',
    set: { priority: 2 },
  }));

  const refused = await capture([
    'patch', '--ledger', fixture.ledger, '--input', patchPath, '--json',
  ]);

  assert.equal(refused.exit, 6, JSON.stringify(refused.envelope));
  assert.equal(refused.envelope.state, 'unchanged');
  assert.equal(refused.envelope.error.code, 'claim-store-unavailable');
  assert.deepEqual(await readFile(fixture.itemPath), fixture.before);
});

test('legacy create refuses an item identity with fenced claim history', async () => {
  const fixture = await publicationFixture();
  await unlink(fixture.itemPath);
  const createPath = path.join(fixture.root, 'create.json');
  await writeFile(createPath, JSON.stringify({
    id: fixture.itemId,
    item: {
      title: 'Recreated',
      kind: 'task',
      provenance: {
        source: 'test',
        recorded_at: '2026-08-11T00:00:00Z',
      },
      depends_on: [],
    },
    body: 'recreated\n',
  }));

  const refused = await capture([
    'create', '--ledger', fixture.ledger, '--input', createPath, '--json',
  ]);

  assert.equal(refused.exit, 4, JSON.stringify(refused.envelope));
  assert.equal(refused.envelope.error.code, 'claimed-item-write-refused');
});

test('legacy patch refuses a body edit on an item with an active fenced claim', async () => {
  const fixture = await publicationFixture();
  const patchPath = path.join(fixture.root, 'patch-body.json');
  await writeFile(patchPath, JSON.stringify({
    id: fixture.itemId,
    expected_revision: `sha256:${createHash('sha256').update(fixture.before).digest('hex')}`,
    date: '2026-08-11',
    set: { body: 'The mirror moved on.\n' },
  }));

  const refused = await capture([
    'patch', '--ledger', fixture.ledger, '--input', patchPath, '--json',
  ]);

  assert.equal(refused.exit, 4, JSON.stringify(refused.envelope));
  assert.equal(refused.envelope.error.code, 'active-claim-write-refused');
  assert.equal(refused.envelope.command, 'patch-v1');
  assert.deepEqual(await readFile(fixture.itemPath), fixture.before);
});

test('legacy patch refuses a title edit on an item with an active fenced claim', async () => {
  const fixture = await publicationFixture();
  const patchPath = path.join(fixture.root, 'patch-title.json');
  await writeFile(patchPath, JSON.stringify({
    id: fixture.itemId,
    expected_revision: `sha256:${createHash('sha256').update(fixture.before).digest('hex')}`,
    date: '2026-08-11',
    set: { title: 'The corrected mirror title' },
  }));

  const refused = await capture([
    'patch', '--ledger', fixture.ledger, '--input', patchPath, '--json',
  ]);

  assert.equal(refused.exit, 4, JSON.stringify(refused.envelope));
  assert.equal(refused.envelope.error.code, 'active-claim-write-refused');
  assert.equal(refused.envelope.command, 'patch-v1');
  assert.deepEqual(await readFile(fixture.itemPath), fixture.before);
});

test('legacy patch refuses a relations edit on an item with an active fenced claim', async () => {
  const fixture = await publicationFixture();
  const patchPath = path.join(fixture.root, 'patch-relations.json');
  await writeFile(patchPath, JSON.stringify({
    id: fixture.itemId,
    expected_revision: `sha256:${createHash('sha256').update(fixture.before).digest('hex')}`,
    date: '2026-08-11',
    set: { depends_on: [], related: [] },
  }));

  const refused = await capture([
    'patch', '--ledger', fixture.ledger, '--input', patchPath, '--json',
  ]);

  assert.equal(refused.exit, 4, JSON.stringify(refused.envelope));
  assert.equal(refused.envelope.error.code, 'active-claim-write-refused');
  assert.equal(refused.envelope.command, 'patch-v1');
  assert.deepEqual(await readFile(fixture.itemPath), fixture.before);
});

test('legacy patch refuses an item with an active fenced claim', async () => {
  const fixture = await publicationFixture();
  const patchPath = path.join(fixture.root, 'patch.json');
  await writeFile(patchPath, JSON.stringify({
    id: fixture.itemId,
    expected_revision: `sha256:${createHash('sha256').update(fixture.before).digest('hex')}`,
    date: '2026-08-11',
    set: { priority: 0 },
  }));

  const refused = await capture([
    'patch', '--ledger', fixture.ledger, '--input', patchPath, '--json',
  ]);

  assert.equal(refused.exit, 4, JSON.stringify(refused.envelope));
  assert.equal(refused.envelope.error.code, 'active-claim-write-refused');
  assert.equal(refused.envelope.command, 'patch-v1');
  assert.deepEqual(await readFile(fixture.itemPath), fixture.before);
});