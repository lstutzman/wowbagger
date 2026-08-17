// The normative auto-commit envelopes.
//
// Each case in spec/fixtures/mutation-autocommit is compared byte-for-byte
// against what the real CLI emits, after substituting only the placeholders the
// manifest declares. A member name, a fixed subject, an ordered commit set, a
// failure_stage, or a reason that drifts fails here.
import assert from 'node:assert/strict';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { readRegularFixture } from './work-claim-fixture-loader.js';
import {
  ITEM_ID,
  git,
  ledgerFile,
  provisionedLedger,
  requestFile,
  run,
  sha256,
  transitionRequest,
} from './auto-commit-fixture.js';

const fixtureRoot = fileURLToPath(new URL('../spec/fixtures/mutation-autocommit/', import.meta.url));

function manifest(name) {
  return JSON.parse(readRegularFixture(fixtureRoot, `${name}/manifest.json`).toString('utf8'));
}

function substitute(expected, values) {
  let source = JSON.stringify(expected);
  for (const [placeholder, value] of Object.entries(values)) {
    source = source.replaceAll(`{{${placeholder}}}`, () => JSON.stringify(value).slice(1, -1));
  }
  return JSON.parse(source);
}

// `{{ITEM}}` stands for the whole inspected item object, which is pinned by the
// mutation contract's own fixtures. Substituting it here still pins the exact
// member set of `result`.
function substituteItem(expected, item) {
  return JSON.parse(JSON.stringify(expected).replace('"{{ITEM}}"', JSON.stringify(item)));
}

async function refusingHook(fixture) {
  const directory = path.join(fixture.base, 'hooks');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'pre-commit'), '#!/bin/sh\nexit 1\n');
  await chmod(path.join(directory, 'pre-commit'), 0o755);
  git(fixture.root, 'config', 'core.hooksPath', directory);
}

test('the provisioned-success manifest is the exact success envelope', async () => {
  const fixture = await provisionedLedger();
  const pinned = manifest('provisioned-success');
  const request = await requestFile(fixture, 'transition.json', transitionRequest(fixture));

  const result = run(fixture.root, 'transition', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit');

  const commit = git(fixture.root, 'rev-parse', 'HEAD');
  const expected = substituteItem(
    substitute(pinned.expected, { LOG_PATH: fixture.logPath, GIT_COMMIT: commit }),
    result.envelope.result.item,
  );
  assert.deepEqual(result.envelope, expected.stdout);
  assert.equal(result.exit, expected.exit);
  assert.equal(git(fixture.root, 'log', '-1', '--format=%s'), pinned.expected_commit_subject);
  assert.deepEqual(
    result.envelope.result.commit_paths,
    substitute(pinned.expected_commit_paths, { LOG_PATH: fixture.logPath }),
  );
});

test('the git-commit-failed manifest is the exact commit-failed envelope', async () => {
  const fixture = await provisionedLedger();
  const pinned = manifest('git-commit-failed');
  await refusingHook(fixture);
  const head = git(fixture.root, 'rev-parse', 'HEAD');
  const request = await requestFile(fixture, 'transition.json', transitionRequest(fixture));

  const result = run(fixture.root, 'transition', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit');

  const expected = substitute(pinned.expected, {
    LOG_PATH: fixture.logPath,
    LOG_REVISION: sha256(await ledgerFile(fixture, fixture.logPath)),
    ITEM_REVISION: sha256(await ledgerFile(fixture, `items/${ITEM_ID}.md`)),
    PRE_COMMIT_HEAD: head,
    RECOVERY_TOKEN: result.envelope.error.details.recovery_token,
  });
  assert.deepEqual(result.envelope, expected.stdout);
  assert.equal(result.exit, expected.exit);
  assert.equal(git(fixture.root, 'rev-parse', 'HEAD'), head);
});

test('the mutation-finalize-recovery manifest is the exact recovery envelope and is idempotent', async () => {
  const fixture = await provisionedLedger();
  const pinned = manifest('mutation-finalize-recovery');
  await refusingHook(fixture);
  const request = await requestFile(fixture, 'transition.json', transitionRequest(fixture));
  const failed = run(fixture.root, 'transition', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit');
  assert.equal(failed.exit, 6, failed.stdout);
  const token = failed.envelope.error.details.recovery_token;
  git(fixture.root, 'config', '--unset', 'core.hooksPath');

  const result = run(fixture.root, 'mutation-finalize', '--ledger', fixture.ledger, '--recovery-token', token, '--json');

  const commit = git(fixture.root, 'rev-parse', 'HEAD');
  const expected = substitute(pinned.expected, {
    NAMESPACE: fixture.namespace,
    LOG_PATH: fixture.logPath,
    ITEM_REVISION: sha256(await ledgerFile(fixture, `items/${ITEM_ID}.md`)),
    GIT_COMMIT: commit,
  });
  assert.deepEqual(result.envelope, expected.stdout);
  assert.equal(result.exit, expected.exit);
  assert.equal(git(fixture.root, 'log', '-1', '--format=%s'), pinned.expected_commit_subject);

  const commits = git(fixture.root, 'log', '--format=%H');
  const repeated = run(fixture.root, 'mutation-finalize', '--ledger', fixture.ledger, '--recovery-token', token, '--json');
  assert.deepEqual(repeated.envelope, expected.stdout);
  assert.equal(git(fixture.root, 'log', '--format=%H'), commits);
});
