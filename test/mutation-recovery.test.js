import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runCli, withLedger } from './support.js';

const runner = fileURLToPath(new URL('./mutation-runner.js', import.meta.url));
const candidateFaultLoader = fileURLToPath(new URL('./candidate-fault-loader.js', import.meta.url));
const id = 'wb_01Q4G4Q3G004HMASW9NF6YY093';

test('patch reports a serializer programming error as operation-failed', async () => {
  const source = triageSource();
  await withLedger({ [`${id}.md`]: source }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'patch.json');
    await writeFile(requestPath, JSON.stringify({
      id,
      expected_revision: revision,
      patch: { title: 'Exercise the serializer failure boundary' },
      date: '2030-01-16',
      decision: {
        summary: 'Exercise the serializer failure boundary.',
        rationale: 'Programming errors must not be reported as ledger data defects.',
      },
    }));

    const result = runScenario('patch-serialization-fails',
      'patch', '--ledger', ledger, '--input', requestPath, '--json');
    const output = JSON.parse(result.stdout);

    assert.equal(result.status, 6, result.stderr);
    assert.equal(output.state, 'unchanged');
    assert.equal(output.error.code, 'operation-failed');
    assert.deepEqual(output.error.details, {
      id,
      operation: 'serialize-candidate',
      reason: 'internal-error',
      recovery_artifacts: [],
      recovery_artifacts_truncated: false,
    });
    assert.equal(await readFile(path.join(ledger, `${id}.md`), 'utf8'), source);
    await assertNoMutationArtifacts(ledger);
  });
});

test('transition reports a serializer programming error as operation-failed', async () => {
  const source = triageSource();
  await withLedger({ [`${id}.md`]: source }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'transition.json');
    await writeFile(requestPath, JSON.stringify({
      id,
      expected_revision: revision,
      to_status: 'backlog',
      date: '2030-01-16',
      decision: {
        summary: 'Exercise the transition serializer failure boundary.',
        rationale: 'Programming errors must not be reported as ledger data defects.',
      },
    }));

    const result = runScenario('transition-serialization-fails',
      'transition', '--ledger', ledger, '--input', requestPath, '--json');
    const output = JSON.parse(result.stdout);

    assert.equal(result.status, 6, result.stderr);
    assert.equal(output.state, 'unchanged');
    assert.equal(output.error.code, 'operation-failed');
    assert.deepEqual(output.error.details, {
      id,
      operation: 'serialize-candidate',
      reason: 'internal-error',
      recovery_artifacts: [],
      recovery_artifacts_truncated: false,
    });
    assert.equal(await readFile(path.join(ledger, `${id}.md`), 'utf8'), source);
    await assertNoMutationArtifacts(ledger);
  });
});

test('patch and transition refuse a serialized candidate that rewrites extension bytes', async () => {
  for (const command of ['patch', 'transition']) {
    const source = triageSource().replace('related: []\n', 'related: []\noperator_note: "stable"\n');
    await withLedger({ [`${id}.md`]: source }, async (ledger) => {
      const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
      const revision = JSON.parse(inspected.stdout).result.item.revision;
      const requestPath = path.join(path.dirname(ledger), `${command}.json`);
      const request = command === 'patch'
        ? {
            id,
            expected_revision: revision,
            patch: { title: 'Keep extension bytes exact' },
            date: '2030-01-16',
            decision: {
              summary: 'Exercise the patch candidate guard.',
              rationale: 'A presentation-only extension rewrite must refuse publication.',
            },
          }
        : transitionRequest(revision);
      await writeFile(requestPath, JSON.stringify(request));

      const result = runCandidateFault('candidate-rewrites-extension',
        command, '--ledger', ledger, '--input', requestPath, '--json');
      const output = JSON.parse(result.stdout);

      assert.equal(result.status, 2, `${command}: ${result.stderr}\n${result.stdout}`);
      assert.equal(output.state, 'unchanged', command);
      assert.equal(output.error.code, 'candidate-invalid', command);
      assert.deepEqual(output.error.details.validation_errors, [{
        path: `ledger/${id}.md`,
        field: 'frontmatter',
        code: 'mutation-successor-mismatch',
        message: 'Serialized frontmatter does not exactly match the requested successor.',
      }], command);
      assert.equal(await readFile(path.join(ledger, `${id}.md`), 'utf8'), source, command);
      await assertNoMutationArtifacts(ledger);
    });
  }
});

test('candidate guard rejects wrong successor data for patch and transition', async () => {
  for (const command of ['patch', 'transition']) {
    await assertCandidateGuardRefusal('candidate-wrong-successor-data', triageSource(), command);
  }
});

test('candidate guard rejects an unchanged controlled-field presentation rewrite', async () => {
  const source = triageSource().replace('related: []', 'related: [ ]');
  for (const command of ['patch', 'transition']) {
    await assertCandidateGuardRefusal('candidate-rewrites-unchanged-root', source, command);
  }
});

test('candidate guard rejects a provenance extension rewrite in a misclassified range', async () => {
  const source = triageSource().replace(
    '  recorded_at: "2030-01-14T12:00:00Z"',
    '  recorded_at: "2030-01-14T12:00:00Z"\n  operator_detail: "stable"',
  );
  for (const command of ['patch', 'transition']) {
    await assertCandidateGuardRefusal('candidate-rewrites-provenance-extension', source, command);
  }
});

test('candidate guard rejects a changed leading comment outside a provenance extension pair slice', async () => {
  const source = triageSource().replace(
    '  recorded_at: "2030-01-14T12:00:00Z"',
    [
      '  recorded_at: "2030-01-14T12:00:00Z"',
      '  # operator comment: stable',
      '  operator_detail: "stable"',
    ].join('\n'),
  );
  await assertCandidateGuardRefusal(
    'candidate-rewrites-provenance-leading-comment',
    source,
    'patch',
  );
});

test('candidate guard rejects bytes changed outside every YAML node range', async () => {
  const source = triageSource().replace('related: []\n---', 'related: []\n\n---');
  for (const command of ['patch', 'transition']) {
    await assertCandidateGuardRefusal('candidate-rewrites-unclaimed-bytes', source, command);
  }
});

test('candidate guard refuses a replacement when the serializer edit list is missing', async () => {
  await assertCandidateGuardRefusal(
    'missing-edit-list',
    triageSource(),
    'patch',
    runCandidateFault,
  );
});

test('candidate guard refuses edit evidence whose replacement bytes are false', async () => {
  await assertCandidateGuardRefusal(
    'candidate-edit-replacement-mismatch',
    triageSource().replace('related: []', 'related: [ ]'),
    'patch',
  );
});

test('candidate guard refuses when candidate and source identity parses both fail', async () => {
  await assertCandidateGuardRefusal(
    'identity-parse-failures',
    triageSource(),
    'patch',
  );
});

test('candidate validation parses candidate and source frontmatter once each', async () => {
  const source = triageSource();
  await withLedger({ [`${id}.md`]: source }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'identity-two-parse-budget.json');
    await writeFile(requestPath, JSON.stringify({
      id,
      expected_revision: revision,
      patch: { title: 'Parse each identity document once' },
      date: '2030-01-16',
      decision: {
        summary: 'Share each identity parse.',
        rationale: 'Both identity comparisons consume the same parsed documents.',
      },
    }));

    const result = runCandidateFault(
      'identity-two-parse-budget',
      'patch', '--ledger', ledger, '--input', requestPath, '--json',
    );

    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    assert.equal(JSON.parse(result.stdout).state, 'committed');
  });
});

test('transition uses one field set for safety and serialized identity checks', async () => {
  const source = triageSource();
  await withLedger({ [`${id}.md`]: source }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'transition-field-set.json');
    await writeFile(requestPath, JSON.stringify(transitionRequest(revision)));

    const result = runCandidateFault(
      'transition-second-field-list-drift',
      'transition', '--ledger', ledger, '--input', requestPath, '--json',
    );

    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    assert.equal(JSON.parse(result.stdout).state, 'committed');
  });
});

test('candidate-corruption scenario names cannot alter the production replacement path', async () => {
  const scenarios = [
    'candidate-rewrites-extension',
    'candidate-wrong-successor-data',
    'candidate-rewrites-unchanged-root',
    'candidate-rewrites-provenance-extension',
    'candidate-rewrites-unclaimed-bytes',
  ];
  const source = triageSource()
    .replace('  recorded_at: "2030-01-14T12:00:00Z"', [
      '  recorded_at: "2030-01-14T12:00:00Z"',
      '  operator_detail: "stable"',
    ].join('\n'))
    .replace('related: []\n---', 'related: [ ]\noperator_note: "stable"\n\n---');

  for (const scenario of scenarios) {
    await withLedger({ [`${id}.md`]: source }, async (ledger) => {
      const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
      const revision = JSON.parse(inspected.stdout).result.item.revision;
      const requestPath = path.join(path.dirname(ledger), `${scenario}.json`);
      await writeFile(requestPath, JSON.stringify({
        id,
        expected_revision: revision,
        patch: { title: 'Production ignores test-owned corruption names' },
        date: '2030-01-16',
        decision: {
          summary: 'Use the production replacement path.',
          rationale: 'Test-only fault names must not change shipped control flow.',
        },
      }));

      const result = runScenario(
        scenario,
        'patch', '--ledger', ledger, '--input', requestPath, '--json',
      );
      const output = JSON.parse(result.stdout);

      assert.equal(result.status, 0, `${scenario}: ${result.stderr}\n${result.stdout}`);
      assert.equal(output.state, 'committed', scenario);
    });
  }
});

test('create classifies an applied-then-error link from the final bytes', async () => {
  await withLedger({}, async (ledger) => {
    const requestPath = await writeCreateRequest(ledger);
    const result = runScenario('create-link-applied-then-error',
      'create', '--ledger', ledger, '--input', requestPath, '--json');
    const output = JSON.parse(result.stdout);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(output.state, 'committed');
    assert.equal(output.result.item.core.id, id);
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

function runCandidateFault(fault, ...argumentsList) {
  return spawnSync(process.execPath, [
    '--no-warnings',
    '--experimental-loader',
    candidateFaultLoader,
    runner,
    ...argumentsList,
  ], {
    encoding: 'utf8',
    env: { ...process.env, WOWBAGGER_CANDIDATE_FAULT: fault },
  });
}

async function assertCandidateGuardRefusal(scenario, source, command, execute = runCandidateFault) {
  await withLedger({ [`${id}.md`]: source }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), `${scenario}-${command}.json`);
    const request = command === 'patch'
      ? {
          id,
          expected_revision: revision,
          patch: { title: 'Guard target title' },
          date: '2030-01-16',
          decision: {
            summary: 'Exercise the candidate guard.',
            rationale: 'A corrupted serialized candidate must remain unpublished.',
          },
        }
      : transitionRequest(revision);
    await writeFile(requestPath, JSON.stringify(request));

    const result = execute(scenario,
      command, '--ledger', ledger, '--input', requestPath, '--json');
    const output = JSON.parse(result.stdout);

    assert.equal(result.status, 2, `${command}: ${result.stderr}\n${result.stdout}`);
    assert.equal(output.state, 'unchanged', command);
    assert.equal(output.error.code, 'candidate-invalid', command);
    assert.equal(output.error.details.validation_errors[0].code, 'mutation-successor-mismatch', command);
    assert.equal(await readFile(path.join(ledger, `${id}.md`), 'utf8'), source, command);
    await assertNoMutationArtifacts(ledger);
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
