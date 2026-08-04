import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runCli, withLedger } from './support.js';

const runner = fileURLToPath(new URL('./mutation-runner.js', import.meta.url));
const id = 'wb_01Q4G4Q3G004HMASW9NF6YY093';

test('create classifies an applied-then-error link from the final bytes', async () => {
  await withLedger({}, async (ledger) => {
    const requestPath = await writeCreateRequest(ledger);
    const result = runScenario('create-link-applied-then-error',
      'create', '--ledger', ledger, '--input', requestPath, '--json');
    const output = JSON.parse(result.stdout);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(output.state, 'committed');
    assert.equal(output.result.item.id, id);
    assert.equal(await exists(path.join(ledger, '.wowbagger-test-publication-fault')), true);
    assert.deepEqual((await readdir(ledger)).filter((entry) => entry.startsWith('.wowbagger-tmp-')), []);
  });
});

test('nested transition uses a same-directory temporary, rename, and parent sync after applied error', async () => {
  await withLedger({ [`nested/deeper/${id}.md`]: triageSource() }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'transition.json');
    await writeFile(requestPath, JSON.stringify(transitionRequest(revision)));

    const result = runScenario('transition-rename-applied-then-error',
      'transition', '--ledger', ledger, '--input', requestPath, '--json');
    const output = JSON.parse(result.stdout);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(output.state, 'committed');
    assert.equal(output.result.item.path, `nested/deeper/${id}.md`);
    const observation = JSON.parse(await readFile(path.join(ledger, '.wowbagger-test-transition-paths.json'), 'utf8'));
    assert.equal(observation.temporary_directory, 'nested/deeper');
    assert.equal(observation.final_directory, 'nested/deeper');
    assert.equal(observation.synced_directory, 'nested/deeper');
    assert.equal((await readFile(path.join(ledger, 'nested/deeper', `${id}.md`), 'utf8')).includes('status: backlog'), true);
  });
});

test('pre-publication lock and temporary failures clean every owned artifact', async () => {
  const cases = [
    ['lock-metadata-write-fails', 'lock-closure'],
    ['lock-metadata-sync-fails', 'lock-closure'],
    ['lock-metadata-close-fails', 'lock-closure'],
    ['temporary-close-fails', 'sync-temporary'],
  ];
  for (const [scenario, operation] of cases) {
    await withLedger({}, async (ledger) => {
      const requestPath = await writeCreateRequest(ledger);
      const result = runScenario(scenario,
        'create', '--ledger', ledger, '--input', requestPath, '--json');
      const output = JSON.parse(result.stdout);

      assert.equal(result.status, 6, `${scenario}: ${result.stderr}`);
      assert.equal(output.state, 'unchanged', scenario);
      assert.equal(output.error.code, 'operation-failed', scenario);
      assert.equal(output.error.details.operation, operation, scenario);
      assert.deepEqual(output.error.details.recovery_artifacts, [], scenario);
      await assertNoMutationArtifacts(ledger);
    });
  }
});

test('failed cleanup reports bounded lock and temporary artifacts truthfully', async () => {
  const cases = [
    ['lock-metadata-write-and-unlink-fail', 'unchanged', 'operation-failed', 'lock-file'],
    ['temporary-close-and-unlink-fail', 'unchanged', 'operation-failed', 'temporary-file'],
    ['temporary-unlink-fails-after-publication', 'committed', 'post-commit-recovery-required', 'temporary-file'],
    ['lock-unlink-fails-after-publication', 'committed', 'post-commit-recovery-required', 'lock-file'],
  ];
  for (const [scenario, state, code, kind] of cases) {
    await withLedger({}, async (ledger) => {
      const requestPath = await writeCreateRequest(ledger);
      const result = runScenario(scenario,
        'create', '--ledger', ledger, '--input', requestPath, '--json');
      const output = JSON.parse(result.stdout);

      assert.equal(result.status, 6, `${scenario}: ${result.stderr}`);
      assert.equal(output.state, state, scenario);
      assert.equal(output.error.code, code, scenario);
      assert.equal(output.error.details.recovery_artifacts.length, 1, scenario);
      assert.equal(output.error.details.recovery_artifacts[0].kind, kind, scenario);
      assert.match(output.error.details.recovery_artifacts[0].sha256, /^sha256:[0-9a-f]{64}$/);
      assert.equal(output.error.details.recovery_artifacts_truncated, false);
    });
  }
});

test('create observes final mismatch and absence before reporting temporary cleanup failure', async () => {
  const cases = [
    {
      scenario: 'final-mismatch-and-temporary-unlink-fail',
      state: 'unknown',
      code: 'write-outcome-unknown',
      finalExists: true,
      artifactKinds: ['final-item', 'temporary-file'],
    },
    {
      scenario: 'final-absence-and-temporary-unlink-fail',
      state: 'unchanged',
      code: 'operation-failed',
      finalExists: false,
      artifactKinds: ['temporary-file'],
    },
  ];

  for (const scenario of cases) {
    await withLedger({}, async (ledger) => {
      const requestPath = await writeCreateRequest(ledger);
      const result = runScenario(scenario.scenario,
        'create', '--ledger', ledger, '--input', requestPath, '--json');
      const output = JSON.parse(result.stdout);

      assert.equal(result.status, 6, `${scenario.scenario}: ${result.stderr}`);
      assert.equal(output.state, scenario.state, scenario.scenario);
      assert.equal(output.error.code, scenario.code, scenario.scenario);
      assert.deepEqual(output.error.details.recovery_artifacts
        .map((artifact) => artifact.kind).sort(), scenario.artifactKinds, scenario.scenario);
      assert.equal(await exists(path.join(ledger, `${id}.md`)), scenario.finalExists, scenario.scenario);
      if (scenario.state === 'unchanged') {
        assert.equal(output.error.details.operation, 'verify-publication');
        assert.equal(output.error.details.reason, 'verification-failed');
      }
    });
  }
});

function runScenario(scenario, ...argumentsList) {
  return spawnSync(process.execPath, [runner, ...argumentsList], {
    encoding: 'utf8',
    env: { ...process.env, WOWBAGGER_TEST_SCENARIO: scenario },
  });
}

async function writeCreateRequest(ledger) {
  const requestPath = path.join(path.dirname(ledger), 'create.json');
  await writeFile(requestPath, JSON.stringify({
    id,
    item: {
      title: 'Exercise publication recovery',
      kind: 'task',
      provenance: {
        source: 'test/mutation-recovery',
        recorded_at: '2030-01-14T12:00:00Z',
      },
      depends_on: [],
    },
    body: '',
  }));
  return requestPath;
}

function transitionRequest(revision) {
  return {
    id,
    expected_revision: revision,
    to_status: 'backlog',
    date: '2030-01-16',
    decision: {
      summary: 'Accept the nested recovery item.',
      rationale: 'The publication boundary is the target parent directory.',
    },
  };
}

function triageSource() {
  return `---
schema_version: 1
id: ${id}
title: "Exercise nested transition recovery"
kind: task
status: triage
created: 2030-01-14
updated: 2030-01-14
provenance:
  source: "test/mutation-recovery"
  recorded_at: "2030-01-14T12:00:00Z"
depends_on: []
related: []
---
`;
}

async function assertNoMutationArtifacts(ledger) {
  assert.deepEqual((await readdir(ledger)).filter((entry) => entry.startsWith('.wowbagger-tmp-')), []);
  const lockDirectory = path.join(ledger, '.wowbagger-locks');
  if (await exists(lockDirectory)) {
    assert.deepEqual(await readdir(lockDirectory), []);
  }
}

async function exists(file) {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    assert.equal(error.code, 'ENOENT');
    return false;
  }
}
