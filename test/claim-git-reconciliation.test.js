import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  appendClaimEntry,
  claimJournalPath,
  claimReconcileLogPath,
  replayClaimJournal,
} from '../src/claim-journal.js';
import { resolveGitCommonDir } from '../src/claim-store.js';
import { readGitHeadLedger, readGitTreeLedger } from '../src/git-reconciliation.js';

const CLI = fileURLToPath(new URL('../bin/wowbagger.js', import.meta.url));
const ITEM_ID = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';

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

async function repository() {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-git-reconcile-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Wowbagger Test');
  const ledger = path.join(root, 'ledger');
  await mkdir(ledger);
  const namespace = 'wbns_0123456789abcdef0123456789abcdef';
  await mkdir(path.join(ledger, '.wowbagger'));
  await writeFile(path.join(ledger, '.wowbagger', 'namespace'), `${namespace}\n`);
  const itemPath = path.join(ledger, 'item.md');
  const before = Buffer.from('---\nschema_version: 2\nid: wb_01KZBMBEZKPE7D15HKW9Q3GSZV\nnumber: 1\ntitle: "Before"\nkind: task\nstatus: backlog\ncreated: 2026-08-06\nupdated: 2026-08-11\nprovenance:\n  source: "repository-backlog"\n  recorded_at: "2026-08-11T00:00:00Z"\ndepends_on: []\nrelated: []\ndecisions: []\n---\nBefore\n');
  await writeFile(itemPath, before);
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'Initial item');
  return { before, itemPath, ledger, namespace, root };
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

test('claim-verify finalizes a committed publication observed in git HEAD', async () => {
  const fixture = await repository();
  const acquirePath = path.join(fixture.root, 'acquire.json');
  await writeFile(acquirePath, JSON.stringify({
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
    owner_id: 'agent-a',
    lease_duration_ms: 300000,
    expected: { last_epoch: '0', active: null },
  }));
  const acquired = run(fixture.root, 'claim', 'acquire', '--ledger', fixture.ledger, '--input', acquirePath, '--json');
  assert.equal(acquired.exit, 0, JSON.stringify(acquired.envelope));
  const candidate = Buffer.from(fixture.before.toString('utf8').replace('title: "Before"', 'title: "After"').replace('\nBefore\n', '\nAfter\n'));
  const publishPath = path.join(fixture.root, 'publish.json');
  await writeFile(publishPath, JSON.stringify({
    operation_id: 'pub_git_finalize_0001',
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
    claim_fence: {
      ledger_namespace: fixture.namespace,
      item_id: ITEM_ID,
      owner_id: 'agent-a',
      epoch: acquired.envelope.result.claim.epoch,
    },
    expected_revision: sha256(fixture.before),
    candidate_sha256: sha256(candidate),
    candidate_source_base64: candidate.toString('base64'),
  }));
  const published = run(fixture.root, 'publish-claimed', '--ledger', fixture.ledger, '--input', publishPath, '--json');
  assert.equal(published.exit, 0, JSON.stringify(published.envelope));
  git(fixture.root, 'add', 'ledger/item.md');
  git(fixture.root, 'commit', '-qm', 'Commit claimed publication');
  const commit = git(fixture.root, 'rev-parse', 'HEAD');
  const head = await readGitHeadLedger(fixture.ledger);
  assert.equal(head.commit, commit);
  assert.deepEqual([...head.items.keys()], ['item.md']);
  assert.equal(sha256(head.items.get('item.md')), sha256(candidate));

  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');

  assert.equal(verified.exit, 0, JSON.stringify(verified.envelope));
  const repeated = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');
  assert.equal(repeated.exit, 0, JSON.stringify(repeated.envelope));
  const gitCommonDir = await resolveGitCommonDir(fixture.ledger);
  const replayed = await replayClaimJournal(claimJournalPath(gitCommonDir, fixture.namespace), fixture.namespace);
  const finalizations = replayed.entries.filter((entry) => entry.type === 'publish-finalization');
  assert.equal(finalizations.length, 1);
  const finalized = finalizations[0];
  assert.equal(finalized.committed_revision, sha256(candidate));
  assert.equal(finalized.git_commit, commit);
  assert.equal(await readFile(fixture.itemPath, 'utf8'), candidate.toString('utf8'));
  const reconcileLog = await readFile(claimReconcileLogPath(fixture.ledger, fixture.namespace), 'utf8');
  assert.doesNotMatch(reconcileLog, /publish-finalization/);
});

test('claim-verify keeps pending publication precedence after an earlier Git finalization', async () => {
  const fixture = await repository();
  const acquirePath = path.join(fixture.root, 'acquire-finalized-first.json');
  await writeFile(acquirePath, JSON.stringify({
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
    owner_id: 'agent-finalized-first',
    lease_duration_ms: 300000,
    expected: { last_epoch: '0', active: null },
  }));
  const acquired = run(
    fixture.root,
    'claim', 'acquire', '--ledger', fixture.ledger, '--input', acquirePath, '--json',
  );
  assert.equal(acquired.exit, 0, JSON.stringify(acquired.envelope));
  const firstCandidate = Buffer.from(
    fixture.before.toString('utf8')
      .replace('title: "Before"', 'title: "First"')
      .replace('\nBefore\n', '\nFirst\n'),
  );
  const firstPublishPath = path.join(fixture.root, 'publish-finalized-first.json');
  await writeFile(firstPublishPath, JSON.stringify({
    operation_id: 'pub_finalized_first_0001',
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
    claim_fence: {
      ledger_namespace: fixture.namespace,
      item_id: ITEM_ID,
      owner_id: 'agent-finalized-first',
      epoch: acquired.envelope.result.claim.epoch,
    },
    expected_revision: sha256(fixture.before),
    candidate_sha256: sha256(firstCandidate),
    candidate_source_base64: firstCandidate.toString('base64'),
  }));
  const firstPublished = run(
    fixture.root,
    'publish-claimed', '--ledger', fixture.ledger, '--input', firstPublishPath, '--json',
  );
  assert.equal(firstPublished.exit, 0, JSON.stringify(firstPublished.envelope));
  git(fixture.root, 'add', 'ledger/item.md');
  git(fixture.root, 'commit', '-qm', 'Commit first claimed publication');
  const firstVerified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');
  assert.equal(firstVerified.exit, 0, JSON.stringify(firstVerified.envelope));

  const releasePath = path.join(fixture.root, 'release-finalized-first.json');
  await writeFile(releasePath, JSON.stringify({
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
    owner_id: 'agent-finalized-first',
    epoch: acquired.envelope.result.claim.epoch,
    expected_expires_at: acquired.envelope.result.claim.expires_at,
  }));
  const released = run(
    fixture.root,
    'claim', 'release', '--ledger', fixture.ledger, '--input', releasePath, '--json',
  );
  assert.equal(released.exit, 0, JSON.stringify(released.envelope));
  const secondAcquirePath = path.join(fixture.root, 'acquire-pending-second.json');
  await writeFile(secondAcquirePath, JSON.stringify({
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
    owner_id: 'agent-pending-second',
    lease_duration_ms: 300000,
    expected: { last_epoch: acquired.envelope.result.claim.epoch, active: null },
  }));
  const secondAcquired = run(
    fixture.root,
    'claim', 'acquire', '--ledger', fixture.ledger, '--input', secondAcquirePath, '--json',
  );
  assert.equal(secondAcquired.exit, 0, JSON.stringify(secondAcquired.envelope));
  const secondCandidate = Buffer.from(
    firstCandidate.toString('utf8')
      .replace('title: "First"', 'title: "Second"')
      .replace('\nFirst\n', '\nSecond\n'),
  );
  const secondPublishPath = path.join(fixture.root, 'publish-pending-second.json');
  await writeFile(secondPublishPath, JSON.stringify({
    operation_id: 'pub_pending_second_0002',
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
    claim_fence: {
      ledger_namespace: fixture.namespace,
      item_id: ITEM_ID,
      owner_id: 'agent-pending-second',
      epoch: secondAcquired.envelope.result.claim.epoch,
    },
    expected_revision: sha256(firstCandidate),
    candidate_sha256: sha256(secondCandidate),
    candidate_source_base64: secondCandidate.toString('base64'),
  }));
  const secondPublished = run(
    fixture.root,
    'publish-claimed', '--ledger', fixture.ledger, '--input', secondPublishPath, '--json',
  );
  assert.equal(secondPublished.exit, 0, JSON.stringify(secondPublished.envelope));
  await writeFile(fixture.itemPath, firstCandidate);

  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');

  assert.equal(verified.exit, 6, JSON.stringify(verified.envelope));
  assert.equal(verified.envelope.result.findings[0].code, 'stale-write-detected');
  assert.equal(
    verified.envelope.result.findings[0].active_fence.epoch,
    secondAcquired.envelope.result.claim.epoch,
  );
  assert.equal(
    verified.envelope.result.findings[0].stale_fence.epoch,
    acquired.envelope.result.claim.epoch,
  );
  assert.equal(verified.envelope.result.findings[0].reason, 'claimed-publication-pending');
  assert.equal(
    verified.envelope.result.findings[0].remediation,
    'Inspect publication pub_pending_second_0002 for item.md, then complete its documented recovery.',
  );
});

test('claim-verify accepts an authorized legacy patch after claim release', async () => {
  const fixture = await repository();
  const acquirePath = path.join(fixture.root, 'acquire-release.json');
  await writeFile(acquirePath, JSON.stringify({
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
    owner_id: 'agent-release-run',
    lease_duration_ms: 300000,
    expected: { last_epoch: '0', active: null },
  }));
  const acquired = run(
    fixture.root,
    'claim', 'acquire', '--ledger', fixture.ledger, '--input', acquirePath, '--json',
  );
  assert.equal(acquired.exit, 0, JSON.stringify(acquired.envelope));

  const candidate = Buffer.from(fixture.before.toString('utf8').replace('title: "Before"', 'title: "After"'));
  const publishPath = path.join(fixture.root, 'publish-release.json');
  await writeFile(publishPath, JSON.stringify({
    operation_id: 'pub_release_legacy_0001',
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
    claim_fence: {
      ledger_namespace: fixture.namespace,
      item_id: ITEM_ID,
      owner_id: 'agent-release-run',
      epoch: acquired.envelope.result.claim.epoch,
    },
    expected_revision: sha256(fixture.before),
    candidate_sha256: sha256(candidate),
    candidate_source_base64: candidate.toString('base64'),
  }));
  const published = run(
    fixture.root,
    'publish-claimed', '--ledger', fixture.ledger, '--input', publishPath, '--json',
  );
  assert.equal(published.exit, 0, JSON.stringify(published.envelope));
  git(fixture.root, 'add', 'ledger/item.md');
  git(fixture.root, 'commit', '-qm', 'Commit claimed publication before release');
  const initialVerify = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');
  assert.equal(initialVerify.exit, 0, JSON.stringify(initialVerify.envelope));

  const releasePath = path.join(fixture.root, 'release.json');
  await writeFile(releasePath, JSON.stringify({
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
    owner_id: 'agent-release-run',
    epoch: acquired.envelope.result.claim.epoch,
    expected_expires_at: acquired.envelope.result.claim.expires_at,
  }));
  const released = run(
    fixture.root,
    'claim', 'release', '--ledger', fixture.ledger, '--input', releasePath, '--json',
  );
  assert.equal(released.exit, 0, JSON.stringify(released.envelope));

  const patchPath = path.join(fixture.root, 'patch.json');
  await writeFile(patchPath, JSON.stringify({
    id: ITEM_ID,
    expected_revision: published.envelope.result.committed_revision,
    date: '2026-08-11',
    set: { priority: 1 },
  }));
  const patched = run(
    fixture.root,
    'patch', '--ledger', fixture.ledger, '--input', patchPath, '--json',
  );
  assert.equal(patched.exit, 0, JSON.stringify(patched.envelope));
  git(fixture.root, 'add', 'ledger/item.md');
  git(fixture.root, 'commit', '-qm', 'Commit authorized legacy patch');

  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');
  assert.equal(verified.exit, 0, JSON.stringify(verified.envelope));
  assert.deepEqual(verified.envelope.result.findings, []);

  const secondPatchPath = path.join(fixture.root, 'second-patch.json');
  await writeFile(secondPatchPath, JSON.stringify({
    id: ITEM_ID,
    expected_revision: patched.envelope.result.item.revision,
    date: '2026-08-11',
    set: { priority: 2 },
  }));
  const secondPatch = run(
    fixture.root,
    'patch', '--ledger', fixture.ledger, '--input', secondPatchPath, '--json',
  );
  assert.equal(secondPatch.exit, 0, JSON.stringify(secondPatch.envelope));

  const verifiedWithEarlierHead = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');
  assert.equal(verifiedWithEarlierHead.exit, 0, JSON.stringify(verifiedWithEarlierHead.envelope));
  assert.deepEqual(verifiedWithEarlierHead.envelope.result.findings, []);
});

test('claim-verify resolves a committed legacy mutation intent after response loss', async () => {
  const fixture = await repository();
  const candidate = Buffer.from(fixture.before.toString('utf8')
    .replace('title: "Before"', 'title: "Recovered"')
    .replace('\nBefore\n', '\nRecovered\n'));
  const gitCommonDir = await resolveGitCommonDir(fixture.ledger);
  const journalPath = claimJournalPath(gitCommonDir, fixture.namespace);
  await appendClaimEntry(journalPath, {
    type: 'legacy-mutation-intent',
    attempt_id: 'legacy_response_loss_0001',
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
    command: 'patch-v1',
    expected_revision: sha256(fixture.before),
    candidate_revision: sha256(candidate),
    observed_at: '2030-01-11T09:00:00.000Z',
  });
  await writeFile(fixture.itemPath, candidate);

  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');

  assert.equal(verified.exit, 0, JSON.stringify(verified.envelope));
  assert.deepEqual(verified.envelope.result.findings, []);
  const replayed = await replayClaimJournal(journalPath, fixture.namespace);
  assert.ok(replayed.entries.some((entry) => (
    entry.type === 'legacy-mutation'
      && entry.attempt_id === 'legacy_response_loss_0001'
      && entry.committed_revision === sha256(candidate)
  )));
});

test('an unknown legacy mutation outcome names the path to restore and claim-verify', async () => {
  const fixture = await repository();
  const candidate = Buffer.from(fixture.before.toString('utf8')
    .replace('title: "Before"', 'title: "Candidate"'));
  const third = Buffer.from(fixture.before.toString('utf8')
    .replace('title: "Before"', 'title: "Third"'));
  const gitCommonDir = await resolveGitCommonDir(fixture.ledger);
  const journalPath = claimJournalPath(gitCommonDir, fixture.namespace);
  await appendClaimEntry(journalPath, {
    type: 'legacy-mutation-intent',
    attempt_id: 'legacy_unknown_outcome_0001',
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
    command: 'patch-v1',
    expected_revision: sha256(fixture.before),
    candidate_revision: sha256(candidate),
    item_path: 'item.md',
    observed_at: '2030-01-11T09:00:00.000Z',
  });
  await writeFile(fixture.itemPath, third);

  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');

  assert.equal(verified.exit, 6, JSON.stringify(verified.envelope));
  assert.equal(verified.envelope.result.findings[0].code, 'legacy-mutation-outcome-unknown');
  assert.equal(verified.envelope.result.findings[0].expected_path, 'item.md');
  assert.equal(
    verified.envelope.result.findings[0].remediation,
    'Restore item.md to the expected or candidate revision recorded for attempt legacy_unknown_outcome_0001, then run claim-verify.',
  );
});

test('claim-verify rejects an unrecorded revision after a legacy-only mutation', async () => {
  const fixture = await repository();
  const acquirePath = path.join(fixture.root, 'acquire-legacy-only.json');
  await writeFile(acquirePath, JSON.stringify({
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
    owner_id: 'agent-legacy-only-run',
    lease_duration_ms: 300000,
    expected: { last_epoch: '0', active: null },
  }));
  const acquired = run(
    fixture.root,
    'claim', 'acquire', '--ledger', fixture.ledger, '--input', acquirePath, '--json',
  );
  assert.equal(acquired.exit, 0, JSON.stringify(acquired.envelope));
  const releasePath = path.join(fixture.root, 'release-legacy-only.json');
  await writeFile(releasePath, JSON.stringify({
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
    owner_id: 'agent-legacy-only-run',
    epoch: acquired.envelope.result.claim.epoch,
    expected_expires_at: acquired.envelope.result.claim.expires_at,
  }));
  const released = run(
    fixture.root,
    'claim', 'release', '--ledger', fixture.ledger, '--input', releasePath, '--json',
  );
  assert.equal(released.exit, 0, JSON.stringify(released.envelope));
  const patchPath = path.join(fixture.root, 'legacy-only-patch.json');
  await writeFile(patchPath, JSON.stringify({
    id: ITEM_ID,
    expected_revision: sha256(fixture.before),
    date: '2026-08-11',
    set: { priority: 2 },
  }));
  const patched = run(
    fixture.root,
    'patch', '--ledger', fixture.ledger, '--input', patchPath, '--json',
  );
  assert.equal(patched.exit, 0, JSON.stringify(patched.envelope));
  const direct = Buffer.from(Buffer.from(
    patched.envelope.result.item.source_base64,
    'base64',
  ).toString('utf8').replace('priority: 2', 'priority: 3'));
  await writeFile(fixture.itemPath, direct);

  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');

  assert.equal(verified.exit, 6, JSON.stringify(verified.envelope));
  assert.equal(verified.envelope.result.findings[0].code, 'stale-write-detected');
  assert.equal(verified.envelope.result.findings[0].actual_revision, sha256(direct));
  assert.equal(
    verified.envelope.result.findings[0].expected_revision,
    patched.envelope.result.item.revision,
  );
  assert.equal(verified.envelope.result.findings[0].reason, 'unauthorized-revision');
  assert.equal(verified.envelope.result.findings[0].expected_path, 'item.md');
  assert.equal(
    verified.envelope.result.findings[0].remediation,
    'Restore the authorized revision at item.md, then run claim-verify; that discards the edit. Or adopt the committed revision of item.md with claim-adopt, then run claim-verify; that keeps the edit.',
  );
});

test('claim-verify prefers the current configured path after an authorized item move', async () => {
  const fixture = await repository();
  const patchPath = path.join(fixture.root, 'authorized-before-move.json');
  await writeFile(patchPath, JSON.stringify({
    id: ITEM_ID,
    expected_revision: sha256(fixture.before),
    date: '2026-08-11',
    set: { priority: 1 },
  }));
  const patched = run(
    fixture.root,
    'patch', '--ledger', fixture.ledger, '--input', patchPath, '--json',
  );
  assert.equal(patched.exit, 0, JSON.stringify(patched.envelope));
  git(fixture.root, 'add', 'ledger/item.md');
  git(fixture.root, 'commit', '-qm', 'Patch item');
  await mkdir(path.join(fixture.ledger, 'items'));
  git(fixture.root, 'mv', 'ledger/item.md', 'ledger/items/item.md');
  await writeFile(
    path.join(fixture.ledger, '.wowbagger', 'layout.json'),
    '{"layout_version":1,"items_directory":"items"}\n',
  );
  git(fixture.root, 'add', 'ledger/.wowbagger/layout.json');
  git(fixture.root, 'commit', '-qm', 'Move item');
  const movedPath = path.join(fixture.ledger, 'items', 'item.md');
  const moved = await readFile(movedPath, 'utf8');
  const direct = moved.replace('priority: 1', 'priority: 2');
  await writeFile(movedPath, direct);

  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');

  assert.equal(verified.exit, 6, JSON.stringify(verified.envelope));
  assert.equal(verified.envelope.result.findings[0].reason, 'unauthorized-revision');
  assert.equal(verified.envelope.result.findings[0].expected_path, 'items/item.md');
  assert.equal(
    verified.envelope.result.findings[0].remediation,
    'Restore the authorized revision at items/item.md, then run claim-verify; that discards the edit. Or adopt the committed revision of items/item.md with claim-adopt, then run claim-verify; that keeps the edit.',
  );
});

test('claim-verify diagnoses a working-tree deletion as an unauthorized revision', async () => {
  const fixture = await repository();
  const patchPath = path.join(fixture.root, 'authorized-before-delete.json');
  await writeFile(patchPath, JSON.stringify({
    id: ITEM_ID,
    expected_revision: sha256(fixture.before),
    date: '2026-08-11',
    set: { priority: 1 },
  }));
  const patched = run(
    fixture.root,
    'patch', '--ledger', fixture.ledger, '--input', patchPath, '--json',
  );
  assert.equal(patched.exit, 0, JSON.stringify(patched.envelope));
  git(fixture.root, 'add', 'ledger/item.md');
  git(fixture.root, 'commit', '-qm', 'Patch item');
  await unlink(fixture.itemPath);

  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');

  assert.equal(verified.exit, 6, JSON.stringify(verified.envelope));
  assert.equal(verified.envelope.result.findings[0].code, 'stale-write-detected');
  assert.equal(verified.envelope.result.findings[0].actual_revision, null);
  assert.equal(
    verified.envelope.result.findings[0].expected_revision,
    patched.envelope.result.item.revision,
  );
  assert.equal(verified.envelope.result.findings[0].observed_surface, 'working-tree');
  assert.equal(verified.envelope.result.findings[0].reason, 'unauthorized-revision');
  assert.equal(verified.envelope.result.findings[0].expected_path, 'item.md');
  assert.equal(
    verified.envelope.result.findings[0].remediation,
    'Restore the authorized revision at item.md, then run claim-verify; that discards the edit. Or adopt the committed revision of item.md with claim-adopt, then run claim-verify; that keeps the edit.',
  );
});

test('claim-verify explains that a new authorized item still needs Git finalization', async () => {
  const fixture = await repository();
  const itemId = 'wb_01M01BFR000TXV22D7KZ6TQYH2';
  const createPath = path.join(fixture.root, 'legacy-uncommitted-create.json');
  await writeFile(createPath, JSON.stringify({
    id: itemId,
    item: {
      title: 'New item',
      kind: 'task',
      provenance: {
        source: 'test',
        recorded_at: '2026-08-15T00:00:00Z',
      },
      depends_on: [],
    },
    body: 'New item\n',
  }));
  const created = run(
    fixture.root,
    'create', '--ledger', fixture.ledger, '--input', createPath, '--json',
  );
  assert.equal(created.exit, 0, JSON.stringify(created.envelope));
  const transitionPath = path.join(fixture.root, 'legacy-uncommitted-transition.json');
  await writeFile(transitionPath, JSON.stringify({
    id: itemId,
    expected_revision: created.envelope.result.item.revision,
    to_status: 'backlog',
    date: '2026-08-15',
    decision: {
      summary: 'Accept the new item.',
      rationale: 'The new item is ready for work.',
    },
  }));
  const transitioned = run(
    fixture.root,
    'transition', '--ledger', fixture.ledger, '--input', transitionPath, '--json',
  );
  assert.equal(transitioned.exit, 0, JSON.stringify(transitioned.envelope));

  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');

  assert.equal(verified.exit, 6, JSON.stringify(verified.envelope));
  assert.deepEqual(verified.envelope.result.findings, [{
    code: 'stale-write-detected',
    item_id: itemId,
    actual_revision: null,
    expected_revision: transitioned.envelope.result.item.revision,
    observed_surface: 'git-head',
    reason: 'git-finalization-required',
    expected_path: `${itemId}.md`,
    remediation: `Commit ${itemId}.md in Git, then run claim-verify.`,
  }]);
});

test('claim-verify names the configured item path when another worktree needs synchronization', async () => {
  const fixture = await repository();
  await mkdir(path.join(fixture.ledger, 'items'));
  git(fixture.root, 'mv', 'ledger/item.md', 'ledger/items/item.md');
  await writeFile(
    path.join(fixture.ledger, '.wowbagger', 'layout.json'),
    '{"layout_version":1,"items_directory":"items"}\n',
  );
  git(fixture.root, 'add', 'ledger/.wowbagger/layout.json');
  git(fixture.root, 'commit', '-qm', 'Configure item directory');
  const workerRoot = `${fixture.root}-layout-worker`;
  git(fixture.root, 'worktree', 'add', '-qb', 'layout-worker', workerRoot);
  const itemId = 'wb_01M01BFR000TXV22D7KZ6TQYH2';
  const createPath = path.join(fixture.root, 'layout-create.json');
  await writeFile(createPath, JSON.stringify({
    id: itemId,
    item: {
      title: 'New item',
      kind: 'task',
      provenance: {
        source: 'test',
        recorded_at: '2026-08-15T00:00:00Z',
      },
      depends_on: [],
    },
    body: 'New item\n',
  }));
  const created = run(
    fixture.root,
    'create', '--ledger', fixture.ledger, '--input', createPath, '--json',
  );
  assert.equal(created.exit, 0, JSON.stringify(created.envelope));
  const transitionPath = path.join(fixture.root, 'layout-transition.json');
  await writeFile(transitionPath, JSON.stringify({
    id: itemId,
    expected_revision: created.envelope.result.item.revision,
    to_status: 'backlog',
    date: '2026-08-15',
    decision: {
      summary: 'Accept the new item.',
      rationale: 'The new item is ready for work.',
    },
  }));
  const transitioned = run(
    fixture.root,
    'transition', '--ledger', fixture.ledger, '--input', transitionPath, '--json',
  );
  assert.equal(transitioned.exit, 0, JSON.stringify(transitioned.envelope));

  const verified = run(
    workerRoot,
    'claim-verify', '--ledger', path.join(workerRoot, 'ledger'), '--json',
  );

  assert.equal(verified.exit, 6, JSON.stringify(verified.envelope));
  assert.deepEqual(verified.envelope.result.findings, [{
    code: 'stale-write-detected',
    item_id: itemId,
    actual_revision: null,
    expected_revision: transitioned.envelope.result.item.revision,
    observed_surface: 'working-tree',
    reason: 'worktree-synchronization-required',
    expected_path: `items/${itemId}.md`,
    owner_unavailable: true,
    remediation: `Ownership of items/${itemId}.md revision ${transitioned.envelope.result.item.revision} cannot be established from reachable refs; inspect reachable or dangling commits, restore or explicitly adopt reviewed bytes, then run claim-verify.`,
  }]);
});

test('Git HEAD reconciliation includes nested ledger items', async () => {
  const fixture = await repository();
  const nestedDirectory = path.join(fixture.ledger, 'nested');
  const nestedPath = path.join(nestedDirectory, 'item.md');
  const nestedSource = Buffer.from(fixture.before.toString('utf8')
    .replace(ITEM_ID, 'wb_01KZBMBEZKPE7D15HKW9Q3GSZW'));
  await mkdir(nestedDirectory);
  await writeFile(nestedPath, nestedSource);
  git(fixture.root, 'add', 'ledger/nested/item.md');
  git(fixture.root, 'commit', '-qm', 'Add nested item');

  const head = await readGitHeadLedger(fixture.ledger);

  assert.equal(sha256(head.items.get('nested/item.md')), sha256(nestedSource));
});

test('Git HEAD reconciliation ignores inherited repository selectors', async () => {
  const fixture = await repository();
  const other = await repository();
  const otherSource = Buffer.from(other.before.toString('utf8').replace('title: "Before"', 'title: "Other"'));
  await writeFile(other.itemPath, otherSource);
  git(other.root, 'add', 'ledger/item.md');
  git(other.root, 'commit', '-qm', 'Change other repository');
  const expectedCommit = git(fixture.root, 'rev-parse', 'HEAD');
  const priorGitDir = process.env.GIT_DIR;
  const priorGitWorkTree = process.env.GIT_WORK_TREE;
  process.env.GIT_DIR = path.join(other.root, '.git');
  process.env.GIT_WORK_TREE = fixture.root;
  try {
    const head = await readGitHeadLedger(fixture.ledger);
    assert.equal(head.commit, expectedCommit);
    assert.equal(sha256(head.items.get('item.md')), sha256(fixture.before));
  } finally {
    if (priorGitDir === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = priorGitDir;
    if (priorGitWorkTree === undefined) delete process.env.GIT_WORK_TREE;
    else process.env.GIT_WORK_TREE = priorGitWorkTree;
  }
});
test('claim-verify detects a direct git write after publication finalization', async () => {
  const fixture = await repository();
  const acquirePath = path.join(fixture.root, 'acquire-stale.json');
  await writeFile(acquirePath, JSON.stringify({
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
    owner_id: 'agent-a',
    lease_duration_ms: 300000,
    expected: { last_epoch: '0', active: null },
  }));
  const acquired = run(fixture.root, 'claim', 'acquire', '--ledger', fixture.ledger, '--input', acquirePath, '--json');
  assert.equal(acquired.exit, 0, JSON.stringify(acquired.envelope));
  const candidate = Buffer.from(fixture.before.toString('utf8').replace('title: "Before"', 'title: "After"').replace('\nBefore\n', '\nAfter\n'));
  const publishPath = path.join(fixture.root, 'publish-stale.json');
  await writeFile(publishPath, JSON.stringify({
    operation_id: 'pub_git_stale_0001',
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
    claim_fence: {
      ledger_namespace: fixture.namespace,
      item_id: ITEM_ID,
      owner_id: 'agent-a',
      epoch: acquired.envelope.result.claim.epoch,
    },
    expected_revision: sha256(fixture.before),
    candidate_sha256: sha256(candidate),
    candidate_source_base64: candidate.toString('base64'),
  }));
  const published = run(fixture.root, 'publish-claimed', '--ledger', fixture.ledger, '--input', publishPath, '--json');
  assert.equal(published.exit, 0, JSON.stringify(published.envelope));
  git(fixture.root, 'add', 'ledger/item.md');
  git(fixture.root, 'commit', '-qm', 'Commit claimed publication');
  const finalized = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');
  assert.equal(finalized.exit, 0, JSON.stringify(finalized.envelope));
  const direct = Buffer.from(candidate.toString('utf8').replace('title: "After"', 'title: "Direct"'));
  await writeFile(fixture.itemPath, direct);
  git(fixture.root, 'add', 'ledger/item.md');
  git(fixture.root, 'commit', '-qm', 'Commit direct write');

  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');

  assert.equal(verified.exit, 6, JSON.stringify(verified.envelope));
  assert.equal(verified.envelope.result.findings[0].code, 'stale-write-detected');
  assert.equal(verified.envelope.result.findings[0].expected_revision, sha256(candidate));
  assert.equal(verified.envelope.result.findings[0].actual_revision, sha256(direct));
});

test('claim-verify finalizes a publication after another worktree merges it', async () => {
  const fixture = await repository();
  const workerRoot = `${fixture.root}-worker`;
  const sourceBranch = git(fixture.root, 'branch', '--show-current');
  git(fixture.root, 'worktree', 'add', '-qb', 'worker-b', workerRoot);
  const workerLedger = path.join(workerRoot, 'ledger');
  const acquirePath = path.join(fixture.root, 'acquire-worktree.json');
  await writeFile(acquirePath, JSON.stringify({
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
    owner_id: 'agent-a',
    lease_duration_ms: 300000,
    expected: { last_epoch: '0', active: null },
  }));
  const acquired = run(fixture.root, 'claim', 'acquire', '--ledger', fixture.ledger, '--input', acquirePath, '--json');
  assert.equal(acquired.exit, 0, JSON.stringify(acquired.envelope));
  const readPath = path.join(fixture.root, 'read-worktree.json');
  await writeFile(readPath, JSON.stringify({
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
  }));
  const visible = run(workerRoot, 'claim', 'read', '--ledger', workerLedger, '--input', readPath, '--json');
  assert.equal(visible.exit, 0, JSON.stringify(visible.envelope));
  assert.equal(visible.envelope.result.read_back.active.owner_id, 'agent-a');
  const candidate = Buffer.from(fixture.before.toString('utf8').replace('title: "Before"', 'title: "Merged"'));
  const publishPath = path.join(fixture.root, 'publish-worktree.json');
  await writeFile(publishPath, JSON.stringify({
    operation_id: 'pub_git_worktree_0001',
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
    claim_fence: {
      ledger_namespace: fixture.namespace,
      item_id: ITEM_ID,
      owner_id: 'agent-a',
      epoch: acquired.envelope.result.claim.epoch,
    },
    expected_revision: sha256(fixture.before),
    candidate_sha256: sha256(candidate),
    candidate_source_base64: candidate.toString('base64'),
  }));
  const published = run(fixture.root, 'publish-claimed', '--ledger', fixture.ledger, '--input', publishPath, '--json');
  assert.equal(published.exit, 0, JSON.stringify(published.envelope));
  git(fixture.root, 'add', 'ledger/item.md');
  git(fixture.root, 'commit', '-qm', 'Commit worktree publication');
  git(workerRoot, 'merge', '--ff-only', sourceBranch);

  const verified = run(workerRoot, 'claim-verify', '--ledger', workerLedger, '--json');

  assert.equal(verified.exit, 0, JSON.stringify(verified.envelope));
  const gitCommonDir = await resolveGitCommonDir(workerLedger);
  const replayed = await replayClaimJournal(claimJournalPath(gitCommonDir, fixture.namespace), fixture.namespace);
  assert.equal(
    replayed.entries.filter((entry) => entry.type === 'publish-finalization').length,
    1,
  );
});


test('claim-verify refuses a reconciliation log symlink without changing its target', async () => {
  const fixture = await repository();
  const acquirePath = path.join(fixture.root, 'acquire.json');
  await writeFile(acquirePath, JSON.stringify({
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
    owner_id: 'agent-a',
    lease_duration_ms: 300000,
    expected: { last_epoch: '0', active: null },
  }));
  const acquired = run(fixture.root, 'claim', 'acquire', '--ledger', fixture.ledger, '--input', acquirePath, '--json');
  assert.equal(acquired.exit, 0, JSON.stringify(acquired.envelope));

  const victimPath = path.join(fixture.root, 'victim.txt');
  const victim = Buffer.from('must stay unchanged\n');
  await writeFile(victimPath, victim);
  const reconcilePath = claimReconcileLogPath(fixture.ledger, fixture.namespace);
  await unlink(reconcilePath);
  await symlink(victimPath, reconcilePath);

  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');

  assert.equal(verified.exit, 6, JSON.stringify(verified.envelope));
  assert.equal(verified.envelope.error.code, 'claim-store-unavailable');
  assert.deepEqual(await readFile(victimPath), victim);
});

test('a repository-root ledger provisions and verifies inside its own metadata directory', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-root-ledger-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Wowbagger Test');
  const provisioned = run(root, 'provision', '--ledger', root, '--json');
  assert.equal(provisioned.exit, 0, JSON.stringify(provisioned.envelope));
  git(root, 'add', '.wowbagger/namespace');
  git(root, 'commit', '-qm', 'Provision root ledger');

  const verified = run(root, 'claim-verify', '--ledger', root, '--json');

  assert.equal(verified.exit, 0, JSON.stringify(verified.envelope));
  const reconcilePath = claimReconcileLogPath(
    root,
    provisioned.envelope.result.ledger_namespace,
  );
  assert.match(await readFile(reconcilePath, 'utf8'), /# Wowbagger reconciliation log/);
});
test('Git HEAD reconciliation excludes ledger metadata and non-Markdown files', async () => {
  const fixture = await repository();
  await writeFile(path.join(fixture.ledger, '.wowbagger', 'layout.json'), '{"layout_version":1,"items_directory":"items"}\n');
  await writeFile(path.join(fixture.ledger, 'notes.txt'), 'not a ledger item\n');
  git(fixture.root, 'add', '.');
  git(fixture.root, 'commit', '-qm', 'Add metadata and a non-item file');

  const head = await readGitHeadLedger(fixture.ledger);

  assert.deepEqual([...head.items.keys()], ['item.md']);
});

test('Git HEAD reconciliation reports no commit before the first commit', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-git-unborn-'));
  git(root, 'init', '-q');
  const ledger = path.join(root, 'ledger');
  await mkdir(ledger);

  const head = await readGitHeadLedger(ledger);

  assert.equal(head.commit, null);
  assert.equal(head.items.size, 0);
});

test('Git HEAD reconciliation returns exact committed bytes for every item', async () => {
  const fixture = await repository();
  const sources = new Map();
  for (let index = 0; index < 12; index += 1) {
    const identifier = `wb_01KZBMBEZKPE7D15HKW9Q3G${String(index).padStart(2, '0')}`;
    // The last item ends without a newline, so an off-by-one in the reader's
    // record framing shows up as changed bytes rather than passing unnoticed.
    const trailer = index === 11 ? 'No trailing newline' : `Body ${index}\n`;
    const source = Buffer.from(fixture.before.toString('utf8')
      .replace(ITEM_ID, identifier)
      .replace('number: 1', `number: ${index + 2}`)
      .replace('\nBefore\n', `\n${trailer}`));
    const file = `batch-${String(index).padStart(2, '0')}.md`;
    await writeFile(path.join(fixture.ledger, file), source);
    sources.set(file, source);
  }
  git(fixture.root, 'add', '.');
  git(fixture.root, 'commit', '-qm', 'Add many items');

  const head = await readGitHeadLedger(fixture.ledger);

  assert.deepEqual([...head.items.keys()].sort(), [...sources.keys(), 'item.md'].sort());
  for (const [file, source] of sources) {
    assert.equal(sha256(head.items.get(file)), sha256(source), file);
  }
});

test('Git tree reconciliation reads a candidate tree without changing HEAD', async () => {
  const fixture = await repository();
  const head = git(fixture.root, 'rev-parse', 'HEAD');
  const tree = git(fixture.root, 'rev-parse', 'HEAD^{tree}');

  const candidate = await readGitTreeLedger(fixture.ledger, tree);

  assert.equal(candidate.commit, tree);
  assert.equal(sha256(candidate.items.get('item.md')), sha256(fixture.before));
  assert.equal(git(fixture.root, 'rev-parse', 'HEAD'), head);
});
