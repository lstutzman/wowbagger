// mutation-finalize: the one idempotent recovery verb.
//
// Every fixture here starts from a real git-commit-failed envelope, so the token
// it uses is the token the CLI actually emitted. The command re-derives every
// path from the ledger and namespace: the token is a witness, never authority to
// select paths.
import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  ITEM_ID,
  SECOND_ITEM_ID,
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
  transitionRequest,
} from './auto-commit-fixture.js';

async function twoItems() {
  return provisionedLedger({ items: [[ITEM_ID, 1], [SECOND_ITEM_ID, 2]] });
}

function decodeToken(token) {
  return JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
}

// A pre-commit hook that refuses is the cheapest honest way to reach
// git-commit-failed: the item is published and the commit is proven absent.
async function refusedByHook(fixture, argumentsList) {
  const directory = path.join(fixture.base, 'hooks');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'pre-commit'), '#!/bin/sh\nexit 1\n');
  await chmod(path.join(directory, 'pre-commit'), 0o755);
  git(fixture.root, 'config', 'core.hooksPath', directory);
  const failed = run(fixture.root, ...argumentsList);
  assert.equal(failed.exit, 6, failed.stdout);
  assert.equal(failed.envelope.error.code, 'git-commit-failed');
  // The hook is gone by the time recovery runs; only the failure it caused
  // remains.
  git(fixture.root, 'config', '--unset', 'core.hooksPath');
  return failed.envelope.error.details.recovery_token;
}

async function transitionRefused(fixture) {
  const request = await requestFile(fixture, 'transition.json', transitionRequest(fixture));
  return refusedByHook(fixture, [
    'transition', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit',
  ]);
}

const CREATED_ID = 'wb_01KZBMBEZKPE7D15HKW9Q3GT02';

async function createRefused(fixture) {
  const request = await requestFile(fixture, 'create.json', createRequest(CREATED_ID));
  return refusedByHook(fixture, [
    'create', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit',
  ]);
}

test('mutation-finalize completes the commit and claim-verify in one invocation', async () => {
  const fixture = await twoItems();
  const head = git(fixture.root, 'rev-parse', 'HEAD');
  const token = await transitionRefused(fixture);

  const result = run(fixture.root, 'mutation-finalize', '--ledger', fixture.ledger, '--recovery-token', token, '--json');

  assert.equal(result.exit, 0, result.stdout);
  assert.equal(result.envelope.ok, true);
  assert.equal(result.envelope.namespace, 'work-claim');
  assert.equal(result.envelope.command, 'mutation-finalize');
  assert.equal(result.envelope.contract_version, 1);
  assert.equal(result.envelope.state, 'committed');
  const commit = git(fixture.root, 'rev-parse', 'HEAD');
  assert.equal(git(fixture.root, 'rev-parse', 'HEAD^'), head);
  assert.equal(git(fixture.root, 'log', '-1', '--format=%s'), 'wowbagger: transition item #1');
  assert.equal(result.envelope.result.git_commit, commit);
  assert.equal(result.envelope.result.item_id, ITEM_ID);
  assert.equal(result.envelope.result.ledger_namespace, fixture.namespace);
  assert.deepEqual(result.envelope.result.commit_paths, [fixture.logPath, `items/${ITEM_ID}.md`]);
  assert.equal(result.envelope.result.claim_verified, true);
  assert.deepEqual(committedPaths(fixture, commit), [fixture.logPath, `items/${ITEM_ID}.md`]);
  assert.equal(git(fixture.root, 'status', '--porcelain=v1', '--untracked-files=all'), '');
});

// A create is journal-visible, so its interrupted auto-commit hands recovery the
// same two-path token every other mutation does, and recovery commits both.
test('mutation-finalize completes an interrupted journaled create', async () => {
  const fixture = await twoItems();
  const head = git(fixture.root, 'rev-parse', 'HEAD');
  const token = await createRefused(fixture);
  assert.deepEqual(
    decodeToken(token).commit_set.map((entry) => entry.path).sort(),
    [fixture.logPath, `items/${CREATED_ID}.md`],
  );

  const result = run(fixture.root, 'mutation-finalize', '--ledger', fixture.ledger, '--recovery-token', token, '--json');

  assert.equal(result.exit, 0, result.stdout);
  assert.equal(result.envelope.state, 'committed');
  const commit = git(fixture.root, 'rev-parse', 'HEAD');
  assert.equal(git(fixture.root, 'rev-parse', 'HEAD^'), head);
  assert.equal(git(fixture.root, 'log', '-1', '--format=%s'), 'wowbagger: create item #3');
  assert.equal(result.envelope.result.item_id, CREATED_ID);
  assert.deepEqual(result.envelope.result.commit_paths, [fixture.logPath, `items/${CREATED_ID}.md`]);
  assert.equal(result.envelope.result.claim_verified, true);
  assert.deepEqual(committedPaths(fixture, commit), [fixture.logPath, `items/${CREATED_ID}.md`]);
  assert.equal(git(fixture.root, 'status', '--porcelain=v1', '--untracked-files=all'), '');
});

test('mutation-finalize preserves a claim-store lock refusal after committing', async () => {
  const fixture = await twoItems();
  const token = await transitionRefused(fixture);
  const gitCommonDir = git(fixture.root, 'rev-parse', '--path-format=absolute', '--git-common-dir');
  const lockPath = path.join(
    gitCommonDir,
    'wowbagger',
    `claims-${fixture.namespace}.json.lock`,
  );
  await mkdir(path.dirname(lockPath), { recursive: true });
  await writeFile(lockPath, '');
  let result;
  try {
    result = run(fixture.root, 'mutation-finalize', '--ledger', fixture.ledger, '--recovery-token', token, '--json');
  } finally {
    await rm(lockPath, { force: true });
  }

  assert.equal(result.exit, 6, result.stdout);
  assert.equal(result.envelope.state, 'committed');
  assert.equal(result.envelope.error.code, 'post-commit-reconciliation-failed');
  assert.equal(result.envelope.error.details.reason, 'claim-verify-refused');
  assert.equal(result.envelope.error.details.claim_verify_code, 'claim-store-unavailable');
  assert.equal(result.envelope.error.details.claim_verify_reason, 'claim-store-locked');
  assert.equal(Object.hasOwn(result.envelope.error.details, 'findings'), false);
  assert.equal(result.envelope.error.details.git_commit, git(fixture.root, 'rev-parse', 'HEAD'));
  assert.deepEqual(result.envelope.error.details.commit_paths, [fixture.logPath, `items/${ITEM_ID}.md`]);
});

test('repeating mutation-finalize is idempotent and creates no second commit', async () => {
  const fixture = await twoItems();
  const token = await transitionRefused(fixture);
  const first = run(fixture.root, 'mutation-finalize', '--ledger', fixture.ledger, '--recovery-token', token, '--json');
  assert.equal(first.exit, 0, first.stdout);
  const commits = git(fixture.root, 'log', '--format=%H');

  // The response-loss case: the commit exists, the caller never saw the answer.
  const second = run(fixture.root, 'mutation-finalize', '--ledger', fixture.ledger, '--recovery-token', token, '--json');

  assert.equal(second.exit, 0, second.stdout);
  assert.equal(second.envelope.result.git_commit, first.envelope.result.git_commit);
  assert.equal(second.envelope.result.claim_verified, true);
  assert.equal(git(fixture.root, 'log', '--format=%H'), commits);
});

test('mutation-finalize is idempotent after an intervening claim-verify', async () => {
  const fixture = await twoItems();
  const token = await transitionRefused(fixture);
  const first = run(fixture.root, 'mutation-finalize', '--ledger', fixture.ledger, '--recovery-token', token, '--json');
  assert.equal(first.exit, 0, first.stdout);
  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');
  assert.equal(verified.exit, 0, verified.stdout);
  const commits = git(fixture.root, 'log', '--format=%H');

  const again = run(fixture.root, 'mutation-finalize', '--ledger', fixture.ledger, '--recovery-token', token, '--json');

  assert.equal(again.exit, 0, again.stdout);
  assert.equal(again.envelope.result.git_commit, first.envelope.result.git_commit);
  assert.equal(git(fixture.root, 'log', '--format=%H'), commits);
});

test('mutation-finalize recovers a byte-identical mutation after its commit lands', async () => {
  const fixture = await twoItems();
  const firstRequest = await requestFile(fixture, 'first-patch.json', patchRequest(fixture));
  const first = run(
    fixture.root,
    'patch', '--ledger', fixture.ledger, '--input', firstRequest, '--json', '--auto-commit',
  );
  assert.equal(first.exit, 0, first.stdout);

  const repeatedRequest = await requestFile(fixture, 'repeated-patch.json', {
    id: ITEM_ID,
    expected_revision: first.envelope.result.item.revision,
    date: '2026-08-17',
    set: { priority: 40 },
  });
  const token = await refusedByHook(fixture, [
    'patch', '--ledger', fixture.ledger, '--input', repeatedRequest, '--json', '--auto-commit',
  ]);
  git(fixture.root, 'commit', '-qm', 'wowbagger: patch item #1');
  const committed = git(fixture.root, 'rev-parse', 'HEAD');

  const recovered = run(
    fixture.root,
    'mutation-finalize', '--ledger', fixture.ledger, '--recovery-token', token, '--json',
  );

  assert.equal(recovered.exit, 0, recovered.stdout);
  assert.equal(recovered.envelope.result.git_commit, git(fixture.root, 'rev-parse', 'HEAD'));
  assert.equal(recovered.envelope.result.git_commit, committed);
  assert.deepEqual(recovered.envelope.result.commit_paths, [fixture.logPath]);
  assert.equal(recovered.envelope.result.claim_verified, true);
});

test('mutation-finalize rejects an item-only token for a journal-owned mutation', async () => {
  const fixture = await twoItems();
  const token = await transitionRefused(fixture);
  const payload = decodeToken(token);
  payload.commit_set = payload.commit_set.filter((entry) => entry.path === `items/${ITEM_ID}.md`);
  const tampered = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  git(fixture.root, 'commit', '-qm', 'wowbagger: transition item #1');

  const result = run(
    fixture.root,
    'mutation-finalize', '--ledger', fixture.ledger, '--recovery-token', tampered, '--json',
  );

  assert.equal(result.exit, 4, result.stdout);
  assert.equal(result.envelope.error.details.reason, 'commit-set-mismatch');
  assert.equal(git(fixture.root, 'rev-parse', 'HEAD^'), fixture.head);
});

test('a changed item refuses mutation-finalize without any Git mutation', async () => {
  const fixture = await twoItems();
  const token = await transitionRefused(fixture);
  const head = git(fixture.root, 'rev-parse', 'HEAD');
  // The failed attempt left its own commit set staged and, by design, never
  // unstaged it. Recovery must leave exactly that residue behind.
  const stagedResidue = git(fixture.root, 'diff', '--cached', '--name-only');
  const published = await ledgerFile(fixture, `items/${ITEM_ID}.md`);
  await writeFile(
    path.join(fixture.ledger, 'items', `${ITEM_ID}.md`),
    published.replace('title: "Before"', 'title: "Edited after the failure"'),
  );

  const result = run(fixture.root, 'mutation-finalize', '--ledger', fixture.ledger, '--recovery-token', token, '--json');

  assert.equal(result.exit, 4, result.stdout);
  assert.equal(result.envelope.namespace, 'work-claim');
  assert.equal(result.envelope.state, 'unchanged');
  assert.equal(result.envelope.error.code, 'mutation-finalize-refused');
  assert.equal(result.envelope.error.details.reason, 'item-changed');
  assert.equal(git(fixture.root, 'rev-parse', 'HEAD'), head);
  assert.equal(git(fixture.root, 'diff', '--cached', '--name-only'), stagedResidue);
});

test('a reconciliation log without this invocation terminal refuses mutation-finalize', async () => {
  const fixture = await twoItems();
  const token = await transitionRefused(fixture);
  const head = git(fixture.root, 'rev-parse', 'HEAD');
  await writeFile(path.join(fixture.ledger, fixture.logPath), '# Wowbagger reconciliation log\n\n```jsonl\n```\n');

  const result = run(fixture.root, 'mutation-finalize', '--ledger', fixture.ledger, '--recovery-token', token, '--json');

  assert.equal(result.exit, 4, result.stdout);
  assert.equal(result.envelope.error.details.reason, 'log-unavailable');
  assert.equal(git(fixture.root, 'rev-parse', 'HEAD'), head);
});

test('a moved HEAD refuses mutation-finalize', async () => {
  const fixture = await twoItems();
  const token = await transitionRefused(fixture);
  await writeFile(path.join(fixture.root, 'outside.txt'), 'foreign\n');
  git(fixture.root, 'add', 'outside.txt');
  git(fixture.root, 'commit', '-qm', 'A foreign commit');
  const head = git(fixture.root, 'rev-parse', 'HEAD');

  const result = run(fixture.root, 'mutation-finalize', '--ledger', fixture.ledger, '--recovery-token', token, '--json');

  assert.equal(result.exit, 4, result.stdout);
  assert.equal(result.envelope.error.details.reason, 'head-changed');
  assert.equal(git(fixture.root, 'rev-parse', 'HEAD'), head);
});

test('a foreign dirty ledger path refuses mutation-finalize', async () => {
  const fixture = await twoItems();
  const token = await transitionRefused(fixture);
  const head = git(fixture.root, 'rev-parse', 'HEAD');
  await writeFile(
    path.join(fixture.ledger, 'items', `${SECOND_ITEM_ID}.md`),
    itemSource(SECOND_ITEM_ID, { number: 2, title: 'Foreign' }),
  );

  const result = run(fixture.root, 'mutation-finalize', '--ledger', fixture.ledger, '--recovery-token', token, '--json');

  assert.equal(result.exit, 4, result.stdout);
  assert.equal(result.envelope.error.details.reason, 'ledger-not-clean');
  assert.deepEqual(result.envelope.error.details.dirty_paths, [`items/${SECOND_ITEM_ID}.md`]);
  assert.equal(git(fixture.root, 'rev-parse', 'HEAD'), head);
});

test('a staged path refuses mutation-finalize', async () => {
  const fixture = await twoItems();
  const token = await transitionRefused(fixture);
  const head = git(fixture.root, 'rev-parse', 'HEAD');
  await writeFile(path.join(fixture.root, 'outside.txt'), 'staged\n');
  git(fixture.root, 'add', 'outside.txt');

  const result = run(fixture.root, 'mutation-finalize', '--ledger', fixture.ledger, '--recovery-token', token, '--json');

  assert.equal(result.exit, 4, result.stdout);
  assert.equal(result.envelope.error.details.reason, 'staged-paths-present');
  assert.equal(git(fixture.root, 'rev-parse', 'HEAD'), head);
});

test('a malformed or unbound recovery token refuses mutation-finalize', async () => {
  const fixture = await twoItems();
  const token = await transitionRefused(fixture);

  const malformed = run(fixture.root, 'mutation-finalize', '--ledger', fixture.ledger, '--recovery-token', 'not-a-token', '--json');
  assert.equal(malformed.exit, 2, malformed.stdout);
  assert.equal(malformed.envelope.namespace, 'work-claim');
  assert.equal(malformed.envelope.command, 'mutation-finalize');
  assert.equal(malformed.envelope.error.code, 'invalid-request');
  assert.equal(malformed.envelope.state, 'unchanged');

  // A token bound to another namespace names a ledger this endpoint does not
  // serve, whatever its paths say.
  const payload = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  const foreign = Buffer.from(JSON.stringify({
    ...payload,
    ledger_namespace: 'wbns_00000000000000000000000000000000',
  }), 'utf8').toString('base64url');
  const unbound = run(fixture.root, 'mutation-finalize', '--ledger', fixture.ledger, '--recovery-token', foreign, '--json');
  assert.equal(unbound.exit, 2, unbound.stdout);
  assert.equal(unbound.envelope.error.code, 'ledger-namespace-unbound');
  assert.equal(unbound.envelope.state, 'unchanged');
});

test('a token whose commit set no longer matches the ledger refuses mutation-finalize', async () => {
  const fixture = await twoItems();
  const token = await transitionRefused(fixture);
  const head = git(fixture.root, 'rev-parse', 'HEAD');
  const payload = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  const tampered = Buffer.from(JSON.stringify({
    ...payload,
    item_path: `items/${SECOND_ITEM_ID}.md`,
    commit_set: payload.commit_set.map((entry) => (
      entry.path === `items/${ITEM_ID}.md` ? { ...entry, path: `items/${SECOND_ITEM_ID}.md` } : entry
    )),
  }), 'utf8').toString('base64url');

  const result = run(fixture.root, 'mutation-finalize', '--ledger', fixture.ledger, '--recovery-token', tampered, '--json');

  assert.equal(result.exit, 4, result.stdout);
  assert.equal(result.envelope.error.details.reason, 'commit-set-mismatch');
  assert.equal(git(fixture.root, 'rev-parse', 'HEAD'), head);
});

test('mutation-finalize finalizes a refused claimed publication', async () => {
  const fixture = await twoItems();
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
    operation_id: 'pub_finalize_0001',
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
  const token = await refusedByHook(fixture, [
    'publish-claimed', '--ledger', fixture.ledger, '--input', publish, '--json', '--auto-commit',
  ]);

  const result = run(fixture.root, 'mutation-finalize', '--ledger', fixture.ledger, '--recovery-token', token, '--json');

  assert.equal(result.exit, 0, result.stdout);
  assert.equal(result.envelope.state, 'committed');
  assert.equal(git(fixture.root, 'log', '-1', '--format=%s'), 'wowbagger: publish claimed item #1');
  assert.equal(result.envelope.result.operation_id, 'pub_finalize_0001');
  assert.equal(result.envelope.result.claim_verified, true);
  const commit = result.envelope.result.git_commit;
  // Read the journal directly: no claim-verify has run since the commit, so the
  // finalization row can only come from the one inside this invocation.
  const journal = await readFile(
    path.join(
      git(fixture.root, 'rev-parse', '--path-format=absolute', '--git-common-dir'),
      'wowbagger', fixture.namespace, 'journal.ndjson',
    ),
    'utf8',
  );
  const finalizations = journal.split('\n').filter(Boolean).map((line) => JSON.parse(line))
    .filter((entry) => entry.type === 'publish-finalization');
  assert.equal(finalizations.length, 1);
  assert.equal(finalizations[0].operation_id, 'pub_finalize_0001');
  assert.equal(finalizations[0].git_commit, commit);
});

test('mutation-finalize refuses an unprovisioned ledger', async () => {
  const fixture = await twoItems();
  const token = await transitionRefused(fixture);
  await rm(path.join(fixture.ledger, '.wowbagger', 'namespace'));

  const result = run(fixture.root, 'mutation-finalize', '--ledger', fixture.ledger, '--recovery-token', token, '--json');

  assert.equal(result.exit, 6, result.stdout);
  assert.equal(result.envelope.error.code, 'claim-store-unavailable');
  assert.equal(result.envelope.error.details.reason, 'ledger-namespace-unbound');
  assert.equal(result.envelope.state, 'unchanged');
});
