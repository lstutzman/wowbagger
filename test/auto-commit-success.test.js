// The provisioned success path of --auto-commit: one commit, the fixed subject,
// the exact commit set, and internal claim-verify before the envelope returns.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ITEM_ID,
  committedPaths,
  git,
  ledgerFile,
  provisionedLedger,
  requestFile,
  run,
  sha256,
  transitionRequest,
} from './auto-commit-fixture.js';

test('a provisioned transition --auto-commit creates one commit of the item and its log', async () => {
  const fixture = await provisionedLedger();
  const request = await requestFile(fixture, 'transition.json', transitionRequest(fixture));

  const result = run(
    fixture.root,
    'transition', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit',
  );

  assert.equal(result.exit, 0, result.stdout);
  assert.equal(result.envelope.ok, true);
  assert.equal(result.envelope.command, 'transition');
  assert.equal(result.envelope.contract_version, 4);
  assert.equal(result.envelope.state, 'committed');

  const commit = git(fixture.root, 'rev-parse', 'HEAD');
  assert.notEqual(commit, fixture.head);
  assert.equal(git(fixture.root, 'rev-parse', 'HEAD^'), fixture.head);
  assert.equal(git(fixture.root, 'log', '-1', '--format=%s'), 'wowbagger: transition item #1');

  assert.equal(result.envelope.result.git_commit, commit);
  assert.deepEqual(result.envelope.result.commit_paths, [fixture.logPath, `items/${ITEM_ID}.md`]);
  assert.equal(result.envelope.result.claim_verified, true);
  assert.equal(result.envelope.result.item.revision, sha256(await ledgerFile(fixture, `items/${ITEM_ID}.md`)));

  assert.deepEqual(committedPaths(fixture, commit), [fixture.logPath, `items/${ITEM_ID}.md`]);
  assert.equal(git(fixture.root, 'status', '--porcelain=v1', '--untracked-files=all'), '');
  assert.equal(git(fixture.root, 'diff', '--cached', '--name-only'), '');

  // The committed item blob is exactly the published revision.
  assert.equal(
    sha256(git(fixture.root, 'show', `${commit}:ledger/items/${ITEM_ID}.md`) + '\n'),
    result.envelope.result.item.revision,
  );

  // Internal claim-verify ran and left the journal reconciled, so a following
  // mutation needs no ceremony of its own.
  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');
  assert.equal(verified.exit, 0, verified.stdout);
  assert.deepEqual(verified.envelope.result.findings, []);
  assert.equal(git(fixture.root, 'status', '--porcelain=v1', '--untracked-files=all'), '');
});
