// The commit-per-mutation invariant binds every mutating command, and a
// claimed publication is a mutating command. The legacy fence reconciles
// before it authorizes a write; this file pins that `publish-claimed` does the
// same, so an uncommitted prior mutation refuses both paths alike.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { appendClaimEntry, claimJournalPath } from '../src/claim-journal.js';

const CLI = fileURLToPath(new URL('../bin/wowbagger.js', import.meta.url));
const PRIOR_ID = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';
const CLAIMED_ID = 'wb_01KZBMBEZKPE7D15HKW9Q3GT00';

function run(root, ...argumentsList) {
  const result = spawnSync(process.execPath, [CLI, ...argumentsList], {
    cwd: root,
    encoding: 'utf8',
  });
  return { envelope: JSON.parse(result.stdout), exit: result.status };
}

function git(root, ...argumentsList) {
  const result = spawnSync('git', argumentsList, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function requestFile(root, name, request) {
  const file = path.join(root, name);
  await writeFile(file, JSON.stringify(request));
  return file;
}

function createRequest(id, title) {
  return {
    id,
    item: {
      title,
      kind: 'task',
      provenance: { source: 'test/publication-reconciliation-fence', recorded_at: '2026-08-17T00:00:00Z' },
      depends_on: [],
    },
    body: `${title}\n`,
  };
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

// A provisioned ledger whose committed baseline holds one claimed item, and
// whose working tree then gains an uncommitted legacy create and transition on
// a second item. The claim is acquired while reconciliation is still clean,
// because every claim lifecycle subcommand already reconciles unconditionally.
async function unreconciledLedger() {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-publication-fence-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Wowbagger Test');
  const ledger = path.join(root, 'ledger');
  await mkdir(ledger);
  const provisioned = run(root, 'provision', '--ledger', ledger, '--json');
  assert.equal(provisioned.exit, 0, JSON.stringify(provisioned.envelope));
  const namespace = provisioned.envelope.result.ledger_namespace;
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'Provision the ledger');

  const claimed = run(root, 'create', '--ledger', ledger, '--input',
    await requestFile(root, 'create-claimed.json', createRequest(CLAIMED_ID, 'Claimed item')), '--json');
  assert.equal(claimed.exit, 0, JSON.stringify(claimed.envelope));
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'Commit the claimed item');

  const acquired = run(root, 'claim', 'acquire', '--ledger', ledger, '--input',
    await requestFile(root, 'acquire.json', {
      ledger_namespace: namespace,
      item_id: CLAIMED_ID,
      owner_id: 'agent-a',
      lease_duration_ms: 300000,
      expected: { last_epoch: '0', active: null },
    }), '--json');
  assert.equal(acquired.exit, 0, JSON.stringify(acquired.envelope));

  const prior = run(root, 'create', '--ledger', ledger, '--input',
    await requestFile(root, 'create-prior.json', createRequest(PRIOR_ID, 'Prior item')), '--json');
  assert.equal(prior.exit, 0, JSON.stringify(prior.envelope));
  const transitioned = run(root, 'transition', '--ledger', ledger, '--input',
    await requestFile(root, 'transition-prior.json', {
      id: PRIOR_ID,
      expected_revision: prior.envelope.result.item.revision,
      to_status: 'backlog',
      date: '2026-08-17',
      decision: { summary: 'Accept the prior item.', rationale: 'The prior item is ready for work.' },
    }), '--json');
  assert.equal(transitioned.exit, 0, JSON.stringify(transitioned.envelope));

  const itemPath = path.join(ledger, claimed.envelope.result.item.path);
  const before = await readFile(itemPath);
  const candidate = Buffer.from(before.toString('utf8').replace('title: "Claimed item"', 'title: "Published item"'));
  const publishPath = await requestFile(root, 'publish.json', {
    operation_id: 'pub_agent-a_0001',
    ledger_namespace: namespace,
    item_id: CLAIMED_ID,
    expected_revision: sha256(before),
    candidate_source_base64: candidate.toString('base64'),
    candidate_sha256: sha256(candidate),
    claim_fence: {
      ledger_namespace: namespace,
      item_id: CLAIMED_ID,
      owner_id: 'agent-a',
      epoch: acquired.envelope.result.claim.epoch,
    },
  });
  return {
    before,
    candidate,
    itemPath,
    ledger,
    namespace,
    priorPath: prior.envelope.result.item.path,
    priorRevision: transitioned.envelope.result.item.revision,
    publishPath,
    root,
  };
}

test('publish-claimed refuses while a prior legacy mutation is uncommitted', async () => {
  const fixture = await unreconciledLedger();

  const refused = run(fixture.root, 'publish-claimed', '--ledger', fixture.ledger,
    '--input', fixture.publishPath, '--json');

  assert.equal(refused.exit, 6, JSON.stringify(refused.envelope));
  assert.equal(refused.envelope.ok, false);
  assert.equal(refused.envelope.namespace, 'ledger-publication');
  assert.equal(refused.envelope.command, 'publish-claimed');
  assert.equal(refused.envelope.contract_version, 1);
  assert.equal(refused.envelope.state, 'unchanged');
  assert.equal(refused.envelope.operation_id, 'pub_agent-a_0001');
  assert.equal(refused.envelope.error.code, 'claim-store-unavailable');
  assert.equal(refused.envelope.error.message, 'The durable claim store is unavailable.');
  assert.equal(refused.envelope.error.details.reason, 'publication-reconciliation-required');
  assert.deepEqual(refused.envelope.error.details.findings, [{
    code: 'stale-write-detected',
    item_id: PRIOR_ID,
    actual_revision: null,
    expected_revision: fixture.priorRevision,
    observed_surface: 'git-head',
    reason: 'git-finalization-required',
    expected_path: fixture.priorPath,
    remediation: `Commit ${fixture.priorPath} in Git, then run claim-verify.`,
  }]);
  assert.deepEqual(await readFile(fixture.itemPath), fixture.before);
});

test('committing the prior mutation and running claim-verify clears the publish-claimed refusal', async () => {
  const fixture = await unreconciledLedger();
  const refused = run(fixture.root, 'publish-claimed', '--ledger', fixture.ledger,
    '--input', fixture.publishPath, '--json');
  assert.equal(refused.exit, 6, JSON.stringify(refused.envelope));

  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Commit the prior mutation');
  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');
  assert.equal(verified.exit, 0, JSON.stringify(verified.envelope));

  const published = run(fixture.root, 'publish-claimed', '--ledger', fixture.ledger,
    '--input', fixture.publishPath, '--json');

  assert.equal(published.exit, 0, JSON.stringify(published.envelope));
  assert.equal(published.envelope.state, 'committed');
  assert.equal(published.envelope.result.committed_revision, sha256(fixture.candidate));
  assert.deepEqual(await readFile(fixture.itemPath), fixture.candidate);
});

// Reconciliation behind an unresolved intent already refused this publication.
// It refused as `publication-outcome-unknown`, which named the state of a
// publication that never ran. One reconciliation refusal now answers for both
// causes, and it names the state truthfully: nothing changed, and
// `claim-verify` is the procedure.
test('publish-claimed refuses an unresolvable prior intent as a reconciliation refusal', async () => {
  const fixture = await unreconciledLedger();
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Commit the prior mutation');
  await appendClaimEntry(claimJournalPath(path.join(fixture.root, '.git'), fixture.namespace), {
    type: 'publish-intent',
    operation_id: 'pub_agent-a_stranded',
    operation_digest: `sha256:${'1'.repeat(64)}`,
    ledger_namespace: fixture.namespace,
    item_id: CLAIMED_ID,
    expected_revision: `sha256:${'2'.repeat(64)}`,
    candidate_sha256: `sha256:${'3'.repeat(64)}`,
    fence: {
      ledger_namespace: fixture.namespace,
      item_id: CLAIMED_ID,
      owner_id: 'agent-a',
      epoch: '1',
    },
    state: 'pending',
  });

  const refused = run(fixture.root, 'publish-claimed', '--ledger', fixture.ledger,
    '--input', fixture.publishPath, '--json');

  assert.equal(refused.exit, 6, JSON.stringify(refused.envelope));
  assert.equal(refused.envelope.state, 'unchanged');
  assert.equal(refused.envelope.error.code, 'claim-store-unavailable');
  assert.equal(refused.envelope.error.details.reason, 'publication-reconciliation-required');
  assert.deepEqual(
    refused.envelope.error.details.findings.map((finding) => finding.code),
    ['publication-outcome-unknown'],
  );
  assert.deepEqual(await readFile(fixture.itemPath), fixture.before);
});
