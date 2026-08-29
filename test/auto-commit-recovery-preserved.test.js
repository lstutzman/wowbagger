// An original ok:false with state committed still gets its Git commit.
//
// state committed already proves the published item bytes, so auto mode
// continues to Git finalization. The original error, exit, and recovery
// artifacts must survive; the Git evidence is added inside error.details, never
// in place of what was already there.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  committedPaths,
  createRequest,
  git,
  provisionedLedger,
  requestFile,
  run,
} from './auto-commit-fixture.js';

const RUNNER = fileURLToPath(new URL('./mutation-runner.js', import.meta.url));
const CREATED_ID = 'wb_01KZBMBEZKPE7D15HKW9Q3GT77';

function runScenario(fixture, scenario, ...argumentsList) {
  const result = spawnSync(process.execPath, [RUNNER, ...argumentsList], {
    cwd: fixture.root,
    encoding: 'utf8',
    env: { ...process.env, WOWBAGGER_TEST_SCENARIO: scenario },
  });
  return { envelope: JSON.parse(result.stdout), exit: result.status, stdout: result.stdout };
}

test('a committed create whose cleanup needs recovery keeps its error and gains Git evidence', async () => {
  const fixture = await provisionedLedger();
  const request = await requestFile(fixture, 'create.json', createRequest(CREATED_ID));

  // Without the flag, this scenario is exit 6 post-commit-recovery-required
  // with state committed: the item is published, a temporary file could not be
  // removed. The flag must not change any of that.
  const plain = runScenario(fixture, 'temporary-unlink-fails-after-publication',
    'create', '--ledger', fixture.ledger, '--input', request, '--json');
  assert.equal(plain.exit, 6, plain.stdout);
  assert.equal(plain.envelope.state, 'committed');
  assert.equal(plain.envelope.error.code, 'post-commit-recovery-required');

  const clean = await provisionedLedger();
  const cleanRequest = await requestFile(clean, 'create.json', createRequest(CREATED_ID));
  const flagged = runScenario(clean, 'temporary-unlink-fails-after-publication',
    'create', '--ledger', clean.ledger, '--input', cleanRequest, '--json', '--auto-commit');

  assert.equal(flagged.exit, 6, flagged.stdout);
  assert.equal(flagged.envelope.state, 'committed');
  assert.equal(flagged.envelope.error.code, 'post-commit-recovery-required');
  assert.equal(flagged.envelope.error.message, plain.envelope.error.message);
  // The original recovery artifacts survive untouched.
  assert.equal(flagged.envelope.error.details.id, CREATED_ID);
  assert.equal(flagged.envelope.error.details.revision, plain.envelope.error.details.revision);
  assert.deepEqual(
    flagged.envelope.error.details.recovery_artifacts.map((artifact) => artifact.kind),
    plain.envelope.error.details.recovery_artifacts.map((artifact) => artifact.kind),
  );
  assert.equal(flagged.envelope.error.details.recovery_artifacts_truncated, false);

  // The Git evidence is added beside them, and the commit really exists.
  const commit = git(clean.root, 'rev-parse', 'HEAD');
  assert.equal(flagged.envelope.error.details.git_commit, commit);
  assert.deepEqual(
    flagged.envelope.error.details.commit_paths,
    [clean.logPath, `items/${CREATED_ID}.md`],
  );
  assert.equal(flagged.envelope.error.details.claim_verified, true);
  assert.equal(git(clean.root, 'log', '-1', '--format=%s'), 'wowbagger: create item #2');
  assert.deepEqual(committedPaths(clean, commit), [clean.logPath, `items/${CREATED_ID}.md`]);

  // The stale temporary file is outside the commit and still on disk for the
  // operator, exactly as the original error said.
  const stale = flagged.envelope.error.details.recovery_artifacts[0].path;
  assert.equal(committedPaths(clean, commit).includes(stale), false);
  assert.equal(
    git(clean.root, 'status', '--porcelain=v1', '--untracked-files=all').includes(path.basename(stale)),
    true,
  );
});

test('a mutation whose state is unknown performs no Git action under the flag', async () => {
  const fixture = await provisionedLedger();
  const request = await requestFile(fixture, 'create.json', createRequest(CREATED_ID));
  const head = git(fixture.root, 'rev-parse', 'HEAD');

  const flagged = runScenario(fixture, 'final-mismatch-and-temporary-unlink-fail',
    'create', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit');

  assert.equal(flagged.envelope.state, 'unknown', flagged.stdout);
  assert.equal(flagged.envelope.error.code, 'write-outcome-unknown');
  assert.equal(flagged.exit, 6);
  assert.equal(Object.hasOwn(flagged.envelope.error.details, 'git_commit'), false);
  assert.equal(git(fixture.root, 'rev-parse', 'HEAD'), head);
  assert.equal(git(fixture.root, 'diff', '--cached', '--name-only'), '');
});

test('the unflagged and flagged envelopes differ only by the additive Git members', async () => {
  const plain = await provisionedLedger();
  const plainRequest = await requestFile(plain, 'create.json', createRequest(CREATED_ID));
  const withoutFlag = run(plain.root, 'create', '--ledger', plain.ledger, '--input', plainRequest, '--json');
  assert.equal(withoutFlag.exit, 0, withoutFlag.stdout);

  const flaggedFixture = await provisionedLedger();
  const flaggedRequest = await requestFile(flaggedFixture, 'create.json', createRequest(CREATED_ID));
  const withFlag = run(
    flaggedFixture.root,
    'create', '--ledger', flaggedFixture.ledger, '--input', flaggedRequest, '--json', '--auto-commit',
  );
  assert.equal(withFlag.exit, 0, withFlag.stdout);

  assert.deepEqual(Object.keys(withoutFlag.envelope).sort(), Object.keys(withFlag.envelope).sort());
  assert.deepEqual(Object.keys(withoutFlag.envelope.result), ['item', 'changed_paths']);
  assert.deepEqual(
    Object.keys(withFlag.envelope.result),
    ['item', 'changed_paths', 'git_commit', 'commit_paths', 'claim_verified'],
  );
  assert.deepEqual(withFlag.envelope.result.item, withoutFlag.envelope.result.item);
});
