// The supported commands' own commit sets and subjects.
//
// Every supported command commits the changed item plus exactly one
// reconciliation log, create included: a create is journal-visible from the
// item's birth, so its allocation evidence rides in the same commit.
// Claimed publication also proves that the internal claim-verify ran before
// the envelope returned: its finalization row names the commit it created.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  ITEM_ID,
  committedPaths,
  createRequest,
  git,
  itemSource,
  ledgerFile,
  patchRequest,
  provisionedLedger,
  requestFile,
  run,
  sha256,
} from './auto-commit-fixture.js';

const CREATED_ID = 'wb_01KZBMBEZKPE7D15HKW9Q3GT55';

test('create --auto-commit commits the created item and its reconciliation log', async () => {
  const fixture = await provisionedLedger();
  const request = await requestFile(fixture, 'create.json', createRequest(CREATED_ID));

  const result = run(fixture.root, 'create', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit');

  assert.equal(result.exit, 0, result.stdout);
  assert.equal(result.envelope.state, 'committed');
  const commit = git(fixture.root, 'rev-parse', 'HEAD');
  assert.equal(git(fixture.root, 'rev-parse', 'HEAD^'), fixture.head);
  assert.equal(git(fixture.root, 'log', '-1', '--format=%s'), 'wowbagger: create item #2');
  assert.deepEqual(result.envelope.result.commit_paths, [fixture.logPath, `items/${CREATED_ID}.md`]);
  assert.deepEqual(committedPaths(fixture, commit), [fixture.logPath, `items/${CREATED_ID}.md`]);
  assert.equal(result.envelope.result.git_commit, commit);
  assert.equal(result.envelope.result.claim_verified, true);
  assert.equal(git(fixture.root, 'status', '--porcelain=v1', '--untracked-files=all'), '');
});

test('patch --auto-commit commits the item and its log with the patch subject', async () => {
  const fixture = await provisionedLedger();
  const request = await requestFile(fixture, 'patch.json', patchRequest(fixture));

  const result = run(fixture.root, 'patch', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit');

  assert.equal(result.exit, 0, result.stdout);
  assert.equal(git(fixture.root, 'log', '-1', '--format=%s'), 'wowbagger: patch item #1');
  assert.deepEqual(result.envelope.result.commit_paths, [fixture.logPath, `items/${ITEM_ID}.md`]);
  assert.deepEqual(
    committedPaths(fixture, git(fixture.root, 'rev-parse', 'HEAD')),
    [fixture.logPath, `items/${ITEM_ID}.md`],
  );
  assert.match(await ledgerFile(fixture, `items/${ITEM_ID}.md`), /priority: 40/);
  assert.equal(git(fixture.root, 'status', '--porcelain=v1', '--untracked-files=all'), '');
});

test('parent-migrate --auto-commit commits the item and reconciliation log', async () => {
  const fixture = await provisionedLedger();
  const request = await requestFile(fixture, 'parent-migrate.json', {
    id: ITEM_ID,
    expected_revision: sha256(fixture.sources.get(ITEM_ID)),
    expected_parent: null,
    parent: null,
    date: '2026-08-17',
  });

  const result = run(
    fixture.root,
    'parent-migrate', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit',
  );

  assert.equal(result.exit, 0, result.stdout);
  assert.equal(git(fixture.root, 'log', '-1', '--format=%s'), 'wowbagger: parent-migrate item #1');
  assert.deepEqual(result.envelope.result.commit_paths, [fixture.logPath, `items/${ITEM_ID}.md`]);
  assert.match(await ledgerFile(fixture, `items/${ITEM_ID}.md`), /updated: 2026-08-17/);
  assert.equal(git(fixture.root, 'status', '--porcelain=v1', '--untracked-files=all'), '');
});

test('snooze --auto-commit commits the item and reconciliation log', async () => {
  const fixture = await provisionedLedger();
  const request = await requestFile(fixture, 'snooze.json', {
    id: ITEM_ID,
    expected_revision: sha256(fixture.sources.get(ITEM_ID)),
    snoozed_until: '2026-08-18',
    date: '2026-08-17',
  });

  const result = run(
    fixture.root,
    'snooze', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit',
  );

  assert.equal(result.exit, 0, result.stdout);
  assert.equal(git(fixture.root, 'log', '-1', '--format=%s'), 'wowbagger: snooze item #1');
  assert.deepEqual(result.envelope.result.commit_paths, [fixture.logPath, `items/${ITEM_ID}.md`]);
  assert.match(await ledgerFile(fixture, `items/${ITEM_ID}.md`), /snoozed_until: 2026-08-18/);
  assert.equal(git(fixture.root, 'status', '--porcelain=v1', '--untracked-files=all'), '');
});

test('a byte-identical patch commits only its reconciliation log', async () => {
  const fixture = await provisionedLedger();
  const first = await requestFile(fixture, 'first-patch.json', patchRequest(fixture));
  const initial = run(
    fixture.root,
    'patch', '--ledger', fixture.ledger, '--input', first, '--json', '--auto-commit',
  );
  assert.equal(initial.exit, 0, initial.stdout);

  const repeated = await requestFile(fixture, 'repeated-patch.json', {
    id: ITEM_ID,
    expected_revision: initial.envelope.result.item.revision,
    date: '2026-08-17',
    set: { priority: 40 },
  });
  const result = run(
    fixture.root,
    'patch', '--ledger', fixture.ledger, '--input', repeated, '--json', '--auto-commit',
  );

  assert.equal(result.exit, 0, result.stdout);
  assert.deepEqual(result.envelope.result.commit_paths, [fixture.logPath]);
  assert.equal(git(fixture.root, 'status', '--porcelain=v1', '--untracked-files=all'), '');
});

test('publish-claimed --auto-commit commits the item and its log and finalizes the publication', async () => {
  const fixture = await provisionedLedger();
  const acquire = await requestFile(fixture, 'acquire.json', {
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
    owner_id: 'agent-a',
    lease_duration_ms: 300000,
    expected: { last_epoch: '0', active: null },
  });
  const acquired = run(fixture.root, 'claim', 'acquire', '--ledger', fixture.ledger, '--input', acquire, '--json');
  assert.equal(acquired.exit, 0, acquired.stdout);
  git(fixture.root, 'add', '.');
  git(fixture.root, 'commit', '-qm', 'Commit the claim');
  const candidate = Buffer.from(itemSource(ITEM_ID, { number: 1, title: 'Published', body: 'Published' }), 'utf8');
  const publish = await requestFile(fixture, 'publish.json', {
    operation_id: 'pub_autocommit_0001',
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
    claim_fence: {
      ledger_namespace: fixture.namespace,
      item_id: ITEM_ID,
      owner_id: 'agent-a',
      epoch: acquired.envelope.result.claim.epoch,
    },
    expected_revision: sha256(fixture.sources.get(ITEM_ID)),
    candidate_sha256: sha256(candidate),
    candidate_source_base64: candidate.toString('base64'),
  });

  const result = run(fixture.root, 'publish-claimed', '--ledger', fixture.ledger, '--input', publish, '--json', '--auto-commit');

  assert.equal(result.exit, 0, result.stdout);
  assert.equal(result.envelope.namespace, 'ledger-publication');
  assert.equal(result.envelope.operation_id, 'pub_autocommit_0001');
  assert.equal(result.envelope.state, 'committed');
  const commit = git(fixture.root, 'rev-parse', 'HEAD');
  assert.equal(git(fixture.root, 'log', '-1', '--format=%s'), 'wowbagger: publish claimed item #1');
  assert.deepEqual(result.envelope.result.commit_paths, [fixture.logPath, `items/${ITEM_ID}.md`]);
  assert.deepEqual(committedPaths(fixture, commit), [fixture.logPath, `items/${ITEM_ID}.md`]);
  assert.equal(result.envelope.result.git_commit, commit);
  assert.equal(result.envelope.result.claim_verified, true);
  assert.equal(result.envelope.result.committed_revision, sha256(candidate));
  assert.equal(await ledgerFile(fixture, `items/${ITEM_ID}.md`), candidate.toString('utf8'));

  // The finalization row exists already. No extra claim-verify ran between the
  // commit and this read, so the internal one must have produced it.
  const journal = await readFile(
    path.join(git(fixture.root, 'rev-parse', '--path-format=absolute', '--git-common-dir'), 'wowbagger', fixture.namespace, 'journal.ndjson'),
    'utf8',
  );
  const finalizations = journal.split('\n').filter(Boolean).map((line) => JSON.parse(line))
    .filter((entry) => entry.type === 'publish-finalization');
  assert.equal(finalizations.length, 1);
  assert.equal(finalizations[0].operation_id, 'pub_autocommit_0001');
  assert.equal(finalizations[0].git_commit, commit);
  assert.equal(git(fixture.root, 'status', '--porcelain=v1', '--untracked-files=all'), '');
});

test('a schema-1 item without a number uses its canonical id in the commit subject', async () => {
  // Schema versions must not be mixed, so the whole fixture ledger is schema 1:
  // the generation that predates the human handle.
  const fixture = await provisionedLedger({ items: [[ITEM_ID, 1]], schemaVersion: 1 });
  const request = await requestFile(fixture, 'patch.json', patchRequest(fixture));

  const result = run(fixture.root, 'patch', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit');

  assert.equal(result.exit, 0, result.stdout);
  assert.equal(git(fixture.root, 'log', '-1', '--format=%s'), `wowbagger: patch item ${ITEM_ID}`);
  assert.deepEqual(result.envelope.result.commit_paths, [fixture.logPath, `items/${ITEM_ID}.md`]);
});
