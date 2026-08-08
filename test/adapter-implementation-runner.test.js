import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runImplementationVectors } from '../spec/run-adapter-implementation.js';

const fixtureRoot = fileURLToPath(new URL('../spec/fixtures/adapters/', import.meta.url));

// Copies one committed case into a temporary root and rewrites its manifest.
// Dropping the assertions Plans 2 and 3 own turns the remaining case green
// only if every assertion this plan evidences agrees with the fixture, which
// the real run's `fail` status cannot show on its own.
async function isolateCase(t, name, keepAssertion) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-isolate-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const directory = path.join(root, name);
  await cp(path.join(fixtureRoot, name), directory, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  manifest.assertions = manifest.assertions.filter(keepAssertion);
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
  return { root, kept: manifest.assertions.length };
}

async function writeTempFixture(t, manifest, extraFiles = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-vectors-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const directory = path.join(root, '01-synthetic');
  await mkdir(directory);
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
  for (const [name, content] of Object.entries(extraFiles)) {
    await writeFile(path.join(directory, name), JSON.stringify(content));
  }
  return root;
}

const stableSnapshot = {
  '.': { kind: 'directory', identity: 'package-1' },
  bin: { kind: 'directory', identity: 'bin-1' },
  'bin/adapter': { kind: 'regular-file', identity: 'adapter-1' },
};

const replacedSnapshot = {
  '.': { kind: 'directory', identity: 'package-1' },
  bin: { kind: 'directory', identity: 'bin-1' },
  'bin/adapter': { kind: 'regular-file', identity: 'adapter-2' },
};

// A one-assertion synthetic case whose only variable is the expected error
// code. The runner must agree with the shipped engine and disagree with a
// wrong expectation: a runner that cannot report `fail` certifies nothing.
function syntheticEntrypointFixture(expected) {
  return {
    manifest: {
      adapter_vector_version: 1,
      case: 'synthetic',
      coverage: ['capabilities'],
      targets: ['claude-code'],
      mode: 'protocol',
      assertions: [{ id: 'synthetic-1', type: 'entrypoint-path', scenario: 'replaced' }],
      artifacts: [],
    },
    files: {
      'scenarios.json': {
        entrypoint_paths: [{
          id: 'replaced',
          package_root: '/installed/adapter',
          executable: 'bin/adapter',
          before: stableSnapshot,
          after: replacedSnapshot,
          expected,
        }],
      },
    },
  };
}

// A scenario that omits `expected` reduces `result.error_code ===
// scenario.expected` to `undefined === undefined` whenever the engine
// accepts, so the assertion reports `ok` on the strength of a fixture typo.
// The snapshots below are identical, so resolveEntrypointPath accepts and
// returns no error code — the exact input that makes the comparison
// fail open.
test('refuses a scenario that omits its expected error code', async (t) => {
  const { manifest, files } = syntheticEntrypointFixture(undefined);
  files['scenarios.json'].entrypoint_paths[0].after = stableSnapshot;
  assert.equal(
    Object.hasOwn(JSON.parse(JSON.stringify(files['scenarios.json'])).entrypoint_paths[0], 'expected'),
    false,
    'the scenario must reach the runner with no expected key at all',
  );
  const root = await writeTempFixture(t, manifest, files);

  await assert.rejects(
    () => runImplementationVectors({ fixtureRoot: root, platform: 'darwin' }),
    /expected/,
  );
});

test('reports fail with every committed claude-code assertion executed', async () => {
  const result = await runImplementationVectors({ platform: 'darwin' });

  assert.equal(result.status, 'fail');
  assert.equal(result.implementations['claude-code'], 'fail');
  assert.equal(result.evidence_platform, 'darwin');
  assert.equal(result.cases.length, 15);

  const executed = result.cases.flatMap((entry) => entry.executed_assertions);
  assert.equal(executed.length, 183);
});

test('reports the codex target with every codex-targeted assertion executed', async () => {
  const result = await runImplementationVectors({ platform: 'darwin', target: 'codex' });

  assert.equal(result.status, 'fail');
  assert.equal(result.implementations.codex, 'fail');
  assert.equal(Object.hasOwn(result.implementations, 'claude-code'), false);
  assert.equal(result.cases.length, 15);

  const executed = result.cases.flatMap((entry) => entry.executed_assertions);
  assert.equal(executed.length, 183);
});

test('a trailing --target with no value fails fast instead of reporting no cases', async () => {
  const { execFile } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const runner = fileURLToPath(new URL('../spec/run-adapter-implementation.js', import.meta.url));

  const outcome = await new Promise((resolve) => {
    execFile(process.execPath, [runner, '--target'], { encoding: 'utf8' }, (error, stdout, stderr) => {
      resolve({ code: error?.code ?? 0, stderr });
    });
  });

  assert.equal(outcome.code, 1);
  assert.match(outcome.stderr, /--target requires a value/);
});

test('reports the opencode target with every opencode-targeted assertion executed', async () => {
  const result = await runImplementationVectors({ platform: 'darwin', target: 'opencode' });

  assert.equal(result.status, 'fail');
  assert.equal(result.implementations.opencode, 'fail');
  assert.equal(result.cases.length, 15);
  assert.equal(result.cases.flatMap((entry) => entry.executed_assertions).length, 183);
});

test('fails closed on an unknown assertion type', async (t) => {
  const fixtureRoot = await writeTempFixture(t, {
    adapter_vector_version: 1,
    case: 'synthetic',
    coverage: ['capabilities'],
    targets: ['claude-code'],
    mode: 'protocol',
    assertions: [{ id: 'synthetic-1', type: 'not-a-real-type' }],
    artifacts: [],
  });

  await assert.rejects(
    () => runImplementationVectors({ fixtureRoot, platform: 'darwin' }),
    /unknown assertion type/,
  );
});

test('evaluates the negotiation cases against the shipped engine', async () => {
  const result = await runImplementationVectors({ platform: process.platform });

  const byName = new Map(result.cases.map((entry) => [entry.case, entry]));

  assert.equal(byName.get('platform-declaration').status, 'pass');
  assert.equal(result.evidence_platform, process.platform);

  const negotiation = byName.get('negotiation-mismatch');
  assert.equal(negotiation.executed_assertions.length, 78);
  assert.equal(negotiation.status, 'fail');

  const unimplemented = negotiation.assertion_evidence
    .filter(({ evidence }) => evidence === 'unimplemented')
    .map(({ id }) => id);
  assert.deepEqual(unimplemented, ['future-invoke-version-is-refused']);

  const implemented = negotiation.assertion_evidence
    .filter(({ evidence }) => evidence !== 'unimplemented');
  assert.ok(implemented.every(({ evidence }) => evidence.startsWith('src/adapter/')));
  assert.ok(negotiation.observed_error_codes.includes('unsupported-adapter-contract-version'));
});

test('labels each evidenced assertion with the shipped module that produced it', async () => {
  const result = await runImplementationVectors({ platform: 'darwin' });
  const byName = new Map(result.cases.map((entry) => [entry.case, entry]));
  const evidenceOf = (caseName, id) => byName.get(caseName).assertion_evidence
    .find((entry) => entry.id === id).evidence;

  assert.equal(evidenceOf('negotiation-mismatch', 'request-missing-is-refused'), 'src/adapter/describe.js');
  assert.equal(evidenceOf('negotiation-mismatch', 'entrypoint-link-is-refused'), 'src/adapter/entrypoint-path.js');
  assert.equal(evidenceOf('negotiation-mismatch', 'missing-core-probe-member-is-refused'), 'src/adapter/core-probe.js');
  assert.equal(evidenceOf('negotiation-mismatch', 'core-probe-mismatch-is-refused'), 'src/adapter/core-probe.js');
  assert.equal(evidenceOf('platform-declaration', 'platform-status-is-evidence-based'), 'src/adapter/manifest.js');
  // An assertion that produced no refusal contributes no error code.
  assert.deepEqual(byName.get('platform-declaration').observed_error_codes, []);
  assert.equal(evidenceOf('capability-separation', 'optional-features-are-absent'), 'src/adapter/describe.js');
});

test('holds the assertions that Plans 2 and 3 own at unimplemented', async () => {
  const result = await runImplementationVectors({ platform: 'darwin' });
  const byName = new Map(result.cases.map((entry) => [entry.case, entry]));
  const evidenceOf = (caseName, id) => byName.get(caseName).assertion_evidence
    .find((entry) => entry.id === id).evidence;

  // Plan 2 owns invokeAdapter; without it neither the invoke-version
  // assertion nor either invoke-time capability assertion can be evidenced.
  assert.equal(evidenceOf('negotiation-mismatch', 'future-invoke-version-is-refused'), 'unimplemented');
  assert.equal(evidenceOf('capability-separation', 'api-transport-is-not-tooling'), 'unimplemented');
  assert.equal(evidenceOf('capabilities-forwarding', 'preserve-core-capability-truth'), 'unimplemented');
  assert.equal(byName.get('capability-separation').status, 'fail');

  const evidenced = result.cases
    .flatMap((entry) => entry.assertion_evidence)
    .filter(({ evidence }) => evidence !== 'unimplemented');
  assert.equal(evidenced.length, 79);
  assert.equal(result.status, 'fail');
  assert.equal(result.implementations['claude-code'], 'fail');
});

test('every negotiation assertion it evidences agrees with the fixture expectation', async (t) => {
  const { root, kept } = await isolateCase(
    t,
    '13-negotiation-mismatch',
    ({ type }) => type !== 'invoke-version',
  );
  assert.equal(kept, 77);

  const result = await runImplementationVectors({ fixtureRoot: root, platform: 'darwin' });

  assert.equal(result.cases[0].status, 'pass');
  assert.equal(result.status, 'pass');
  // Every refusal the contract's negotiation section names is observed, so
  // the case does not pass by refusing everything the same way.
  assert.deepEqual(result.cases[0].observed_error_codes, [
    'adapter-identity-mismatch',
    'adapter-platform-mismatch',
    'adapter-version-mismatch',
    'core-contract-version-mismatch',
    'core-protocol-error',
    'invalid-adapter-manifest',
    'invalid-describe-request',
    'invalid-describe-result',
    'path-rejected',
    'path-replaced',
    'required-core-contract-version-mismatch',
    'unsupported-adapter-contract-version',
    'unsupported-bootstrap-wire-version',
  ]);
});

test('the capability assertion it evidences agrees with the committed artifact', async (t) => {
  const { root, kept } = await isolateCase(
    t,
    '01-capability-separation',
    ({ expect }) => expect === 'claims-and-policy-false',
  );
  assert.equal(kept, 1);

  const result = await runImplementationVectors({ fixtureRoot: root, platform: 'darwin' });

  assert.equal(result.cases[0].status, 'pass');
});

test('reports a case as passing when the shipped engine matches the fixture expectation', async (t) => {
  const { manifest, files } = syntheticEntrypointFixture('path-replaced');
  const fixtureRoot = await writeTempFixture(t, manifest, files);

  const result = await runImplementationVectors({ fixtureRoot, platform: 'darwin' });

  assert.equal(result.cases[0].status, 'pass');
  assert.equal(result.cases[0].assertion_evidence[0].evidence, 'src/adapter/entrypoint-path.js');
  assert.deepEqual(result.cases[0].observed_error_codes, ['path-replaced']);
  assert.equal(result.status, 'pass');
  assert.equal(result.implementations['claude-code'], 'pass');
  assert.deepEqual(result.observed_error_codes, ['path-replaced']);
});

test('reports a case as failing when the shipped engine disagrees with the fixture expectation', async (t) => {
  const { manifest, files } = syntheticEntrypointFixture('path-rejected');
  const fixtureRoot = await writeTempFixture(t, manifest, files);

  const result = await runImplementationVectors({ fixtureRoot, platform: 'darwin' });

  assert.equal(result.cases[0].status, 'fail');
  // The evidence label still names the module that ran: a disagreement is a
  // reported verdict, not a missing one.
  assert.equal(result.cases[0].assertion_evidence[0].evidence, 'src/adapter/entrypoint-path.js');
  assert.deepEqual(result.cases[0].observed_error_codes, ['path-replaced']);
  assert.equal(result.status, 'fail');
});

// Rewrites one artifact of a copied case so a single sub-expression of an
// evaluator's verdict changes, and reports the case status that results.
async function statusAfterEditing(t, name, keepAssertion, artifact, edit) {
  const { root } = await isolateCase(t, name, keepAssertion);
  const file = path.join(root, name, artifact);
  const content = JSON.parse(await readFile(file, 'utf8'));
  await writeFile(file, JSON.stringify(edit(content) ?? content));
  const result = await runImplementationVectors({ fixtureRoot: root, platform: 'darwin' });
  return result.cases[0].status;
}

const keepOptionalFeatures = ({ expect }) => expect === 'claims-and-policy-false';

test('reports fail when the negotiation evaluator disagrees with the fixture', async (t) => {
  const status = await statusAfterEditing(
    t,
    '13-negotiation-mismatch', ({ id }) => id === 'request-missing-is-refused', 'scenarios.json',
    (data) => {
      data.cases.find(({ id }) => id === 'request-missing').expected = 'invalid-describe-result';
    },
  );
  assert.equal(status, 'fail');
});

test('reports fail when the core-probe evaluator disagrees with the fixture', async (t) => {
  const status = await statusAfterEditing(
    t,
    '13-negotiation-mismatch', ({ id }) => id === 'missing-core-probe-member-is-refused', 'scenarios.json',
    (data) => {
      data.core_probe_cases.find(({ id }) => id === 'probe-missing').expected = 'core-contract-version-mismatch';
    },
  );
  assert.equal(status, 'fail');
});

test('reports fail when the core-version evaluator disagrees with the fixture', async (t) => {
  const status = await statusAfterEditing(
    t,
    '13-negotiation-mismatch', ({ id }) => id === 'core-probe-mismatch-is-refused', 'scenarios.json',
    (data) => {
      data.cases.find(({ id }) => id === 'required-core-version').expected = 'core-protocol-error';
    },
  );
  assert.equal(status, 'fail');
});

test('refuses the capability assertion when the shipped negotiator rejects the artifact', async (t) => {
  const status = await statusAfterEditing(
    t,
    '01-capability-separation', keepOptionalFeatures, 'adapter-capabilities.json',
    (capabilities) => { capabilities.ok = false; },
  );
  assert.equal(status, 'fail');
});

test('refuses the capability assertion when the artifact elevates claims', async (t) => {
  const status = await statusAfterEditing(
    t,
    '01-capability-separation', keepOptionalFeatures, 'adapter-capabilities.json',
    (capabilities) => { capabilities.optional_features.claims = true; },
  );
  assert.equal(status, 'fail');
});

test('refuses the capability assertion when the artifact elevates policy', async (t) => {
  const status = await statusAfterEditing(
    t,
    '01-capability-separation', keepOptionalFeatures, 'adapter-capabilities.json',
    (capabilities) => { capabilities.optional_features.policy = true; },
  );
  assert.equal(status, 'fail');
});

test('refuses the platform assertion when the package manifest is invalid', async (t) => {
  const status = await statusAfterEditing(
    t,
    '09-platform-declaration', () => true, 'package-manifest.json',
    (manifest) => { manifest.extra = true; },
  );
  assert.equal(status, 'fail');
});

test('refuses the platform assertion when the interpretation does not match', async (t) => {
  const status = await statusAfterEditing(
    t,
    '09-platform-declaration', () => true, 'expected-interpretation.json',
    (expected) => { expected.supported_platforms = ['linux']; },
  );
  assert.equal(status, 'fail');
});

test('refuses the platform assertion when a platform is declared supported', async (t) => {
  const status = await statusAfterEditing(
    t,
    '09-platform-declaration', () => true, 'package-manifest.json',
    (manifest) => { manifest.platforms.linux = 'supported'; },
  );
  assert.equal(status, 'fail');
});

test('fails closed on a scenario naming a mutation target that does not exist', async (t) => {
  const root = await writeTempFixture(t, {
    adapter_vector_version: 1,
    case: 'synthetic',
    coverage: ['capabilities'],
    targets: ['claude-code'],
    mode: 'protocol',
    assertions: [{ id: 'synthetic-1', type: 'negotiation', scenario: 'bad-target' }],
    artifacts: [],
  }, {
    'scenarios.json': {
      base_request: {},
      base_manifest: {},
      base_dynamic: { core: {}, platforms: {} },
      cases: [{
        id: 'bad-target',
        target: 'probe',
        set: { path: 'extra', value: true },
        expected: 'invalid-describe-request',
      }],
    },
  });

  await assert.rejects(
    () => runImplementationVectors({ fixtureRoot: root, platform: 'darwin' }),
    /unknown mutation target probe/,
  );
});

test('fails closed on a fixture root holding no cases at all', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-empty-'));

  await assert.rejects(
    () => runImplementationVectors({ fixtureRoot: root, platform: 'darwin' }),
    /no claude-code cases/,
  );
});

test('fails closed on a fixture root whose cases all target another adapter', async (t) => {
  const root = await writeTempFixture(t, {
    adapter_vector_version: 1,
    case: 'synthetic',
    coverage: ['capabilities'],
    targets: ['codex'],
    mode: 'protocol',
    assertions: [{ id: 'synthetic-1', type: 'negotiation', scenario: 'absent' }],
    artifacts: [],
  });

  await assert.rejects(
    () => runImplementationVectors({ fixtureRoot: root, platform: 'darwin' }),
    /no claude-code cases/,
  );
});

test('fails closed on a case that declares no assertions', async (t) => {
  const root = await writeTempFixture(t, {
    adapter_vector_version: 1,
    case: 'synthetic',
    coverage: ['capabilities'],
    targets: ['claude-code'],
    mode: 'protocol',
    assertions: [],
    artifacts: [],
  });

  await assert.rejects(
    () => runImplementationVectors({ fixtureRoot: root, platform: 'darwin' }),
    /no assertions in 01-synthetic/,
  );
});

test('fails closed on a vector manifest that is not strict JSON', async (t) => {
  const { manifest, files } = syntheticEntrypointFixture('path-replaced');
  const root = await writeTempFixture(t, manifest, files);
  await writeFile(
    path.join(root, '01-synthetic', 'manifest.json'),
    '{"adapter_vector_version": 1, "adapter_vector_version": 2}',
  );

  await assert.rejects(
    () => runImplementationVectors({ fixtureRoot: root, platform: 'darwin' }),
    /invalid strict JSON/,
  );
});

// `adapter_vector_version` is compared against the raw JSON source text, so a
// numerically-equal spelling is still a different declared version.
for (const version of ['2', '1.0', '1e0', '"1"', 'null']) {
  test(`fails closed on adapter_vector_version ${version}`, async (t) => {
    const { manifest, files } = syntheticEntrypointFixture('path-replaced');
    const root = await writeTempFixture(t, manifest, files);
    const file = path.join(root, '01-synthetic', 'manifest.json');
    const raw = JSON.parse(await readFile(file, 'utf8'));
    delete raw.adapter_vector_version;
    await writeFile(file, `{"adapter_vector_version": ${version}, ${JSON.stringify(raw).slice(1)}`);

    await assert.rejects(
      () => runImplementationVectors({ fixtureRoot: root, platform: 'darwin' }),
      /unsupported adapter_vector_version in 01-synthetic/,
    );
  });
}

test('accepts adapter_vector_version 1', async (t) => {
  const { manifest, files } = syntheticEntrypointFixture('path-replaced');
  const root = await writeTempFixture(t, manifest, files);

  const result = await runImplementationVectors({ fixtureRoot: root, platform: 'darwin' });

  assert.equal(result.cases.length, 1);
});

test('fails closed on an assertion naming a scenario the fixture does not define', async (t) => {
  const { manifest, files } = syntheticEntrypointFixture('path-replaced');
  manifest.assertions[0].scenario = 'absent';
  const fixtureRoot = await writeTempFixture(t, manifest, files);

  await assert.rejects(
    () => runImplementationVectors({ fixtureRoot, platform: 'darwin' }),
    /unknown scenario absent/,
  );
});

test('fails closed on a scenarios file that is not strict JSON', async (t) => {
  const { manifest, files } = syntheticEntrypointFixture('path-replaced');
  const fixtureRoot = await writeTempFixture(t, manifest, files);
  await writeFile(
    path.join(fixtureRoot, '01-synthetic', 'scenarios.json'),
    '{"entrypoint_paths": [], "entrypoint_paths": []}',
  );

  await assert.rejects(
    () => runImplementationVectors({ fixtureRoot, platform: 'darwin' }),
    /invalid strict JSON/,
  );
});
