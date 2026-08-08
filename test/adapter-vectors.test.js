import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseJsonRequest } from '../src/request.js';
import { runReferenceVector, runReferenceVectors } from '../spec/run-adapter-vectors.js';
import { validateInvocationLimits } from '../spec/adapter-reference.js';
import { runCli, withLedger } from './support.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const fixtureRoot = fileURLToPath(new URL('../spec/fixtures/adapters/', import.meta.url));
const readyLedger = fileURLToPath(new URL('../spec/fixtures/ready-selection/ledger/', import.meta.url));
const adapterTargets = [
  'claude-code',
  'codex',
  'kimi',
  'openai-compatible-harness',
  'opencode',
];
const requiredCoverage = [
  'authority',
  'bounded-io',
  'capabilities',
  'core-forwarding',
  'handoff',
  'instructions',
  'path-safety',
  'platforms',
];

test('adapter conformance vectors use strict JSON, exact hashes, and applicable targets', async () => {
  const entries = await readdir(fixtureRoot, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory()).sort(compareByName);
  assert.ok(directories.length > 0, 'adapter vectors must contain at least one case');
  const coverage = new Set();

  for (const entry of directories) {
    const directory = path.join(fixtureRoot, entry.name);
    const manifest = await strictJson(path.join(directory, 'manifest.json'));
    assert.equal(manifest.adapter_vector_version, 1);
    assert.equal(typeof manifest.case, 'string');
    const expectedTargets = manifest.mode === 'equivalence'
      ? [...adapterTargets, 'direct-core'].sort()
      : adapterTargets;
    assert.deepEqual([...manifest.targets].sort(), expectedTargets);
    assert.ok(Array.isArray(manifest.coverage));
    for (const area of manifest.coverage) {
      assert.equal(typeof area, 'string');
      coverage.add(area);
    }
    assert.ok(Array.isArray(manifest.artifacts));
    assert.ok(manifest.artifacts.length > 0);

    const artifactPaths = manifest.artifacts.map((artifact) => artifact.path);
    assert.deepEqual([...artifactPaths].sort(), artifactPaths);
    assert.equal(new Set(artifactPaths).size, artifactPaths.length);

    for (const artifact of manifest.artifacts) {
      assert.equal(typeof artifact.path, 'string');
      assert.equal(typeof artifact.sha256, 'string');
      assert.match(artifact.sha256, /^sha256:[a-f0-9]{64}$/);
      assert.notEqual(
        artifact.sha256,
        'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      );
      assert.ok(isSafeRelativePath(artifact.path));
      const bytes = await readFile(path.join(directory, artifact.path));
      assert.equal(digest(bytes), artifact.sha256, `${entry.name}/${artifact.path}`);
      if (artifact.path.endsWith('.json')) {
        await strictJson(path.join(directory, artifact.path));
      }
    }

    const files = await readdir(directory, { withFileTypes: true });
    for (const file of files.filter((candidate) => candidate.isFile())) {
      if (file.name === 'manifest.json' || file.name === 'README.md') {
        continue;
      }
      assert.ok(artifactPaths.includes(file.name), `${entry.name}/${file.name} must be hashed`);
      if (file.name.endsWith('.json')) {
        await strictJson(path.join(directory, file.name));
      }
    }

    await assertTransferredStreams(directory, artifactPaths);
    await assertInstructionDigests(directory, artifactPaths);
    await assertInvocationLimits(directory, artifactPaths);
  }

  assert.deepEqual([...coverage].sort(), requiredCoverage);
});

test('reference runner evaluates every declared adapter-vector assertion', async () => {
  const result = await runReferenceVectors(fixtureRoot);
  assert.equal(result.status, 'reference-pass');
  assert.deepEqual(result.implementations, {
    'claude-code': 'unverified',
    codex: 'unverified',
    kimi: 'unverified',
    'openai-compatible-harness': 'unverified',
  });

  for (const vector of result.cases) {
    const directory = [...(await readdir(fixtureRoot, { withFileTypes: true }))]
      .find((entry) => entry.isDirectory() && entry.name.endsWith(vector.case));
    assert.ok(directory, vector.case);
    const manifest = await strictJson(path.join(fixtureRoot, directory.name, 'manifest.json'));
    assert.equal(vector.status, 'reference-pass');
    assert.equal(vector.executed_mode, manifest.mode);
    assert.deepEqual(vector.executed_assertions, manifest.assertions.map(({ id }) => id));
    assert.deepEqual(vector.assertion_evidence.map(({ id }) => id), vector.executed_assertions);
    assert.ok(vector.assertion_evidence.every(({ evidence }) => typeof evidence === 'string'));
  }
});

test('reference runner rejects a rehashed expectation-only mutation', async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-vector-tamper-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const source = path.join(fixtureRoot, '11-process-outcomes');
  const target = path.join(temporary, '11-process-outcomes');
  await cp(source, target, { recursive: true });
  const scenariosPath = path.join(target, 'scenarios.json');
  const scenarios = JSON.parse(await readFile(scenariosPath, 'utf8'));
  scenarios.scenarios.find(({ id }) => id === 'mutation-timeout-complete').expected_code = 'core-timeout';
  const scenarioBytes = Buffer.from(`${JSON.stringify(scenarios, null, 2)}\n`);
  await writeFile(scenariosPath, scenarioBytes);
  const manifestPath = path.join(target, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.artifacts.find(({ path: artifactPath }) => artifactPath === 'scenarios.json').sha256 = digest(scenarioBytes);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  await assert.rejects(runReferenceVector(target), /mutation-outcome-unknown/);
});

test('standalone reference runner rejects a non-v1 vector before artifact evaluation', async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-vector-version-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const source = path.join(fixtureRoot, '11-process-outcomes');
  const target = path.join(temporary, '11-process-outcomes');
  await cp(source, target, { recursive: true });
  const manifestPath = path.join(target, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.adapter_vector_version = 2;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  await assert.rejects(runReferenceVector(target), /adapter_vector_version/);
});

test('reference runner rejects rehashed wrong discovery expectations semantically', async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-vector-discovery-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const source = path.join(fixtureRoot, '02-instruction-input');
  const target = path.join(temporary, '02-instruction-input');
  await cp(source, target, { recursive: true });
  const expectedPath = path.join(target, 'expected-discovery.json');
  const expected = JSON.parse(await readFile(expectedPath, 'utf8'));
  expected.source_ids = ['harness-safety', 'repository-rules'];
  expected.discovery_mode = 'configured-relative-paths';
  expected.total_bytes += 1;
  const expectedBytes = Buffer.from(`${JSON.stringify(expected, null, 2)}\n`);
  await writeFile(expectedPath, expectedBytes);
  const manifestPath = path.join(target, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.artifacts.find(({ path: artifactPath }) => artifactPath === 'expected-discovery.json').sha256 = digest(expectedBytes);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  await assert.rejects(runReferenceVector(target), /expected-discovery/);
});

test('reference runner rejects rehashed wrong platform expectations semantically', async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-vector-platform-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const source = path.join(fixtureRoot, '09-platform-declaration');
  const target = path.join(temporary, '09-platform-declaration');
  await cp(source, target, { recursive: true });
  const expectedPath = path.join(target, 'expected-interpretation.json');
  const expected = JSON.parse(await readFile(expectedPath, 'utf8'));
  expected.required_before_support_claim = 'documentation-only';
  const expectedBytes = Buffer.from(`${JSON.stringify(expected, null, 2)}\n`);
  await writeFile(expectedPath, expectedBytes);
  const manifestPath = path.join(target, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.artifacts.find(({ path: artifactPath }) => artifactPath === 'expected-interpretation.json').sha256 = digest(expectedBytes);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  await assert.rejects(runReferenceVector(target), /expected-interpretation/);
});

test('reference runner semantically rejects every rehashed expectation artifact', async (t) => {
  const expectations = [
    ['01-capability-separation', 'expected-refusal.json'],
    ['02-instruction-input', 'expected-discovery.json'],
    ['03-ready-forwarding', 'expected-adapter-result.json'],
    ['03-ready-forwarding', 'expected-core-stdout.jsonl'],
    ['04-validation-failure-forwarding', 'expected-adapter-result.json'],
    ['04-validation-failure-forwarding', 'expected-core-stdout.jsonl'],
    ['05-path-no-follow', 'expected-refusal.json'],
    ['06-bounded-output', 'expected-refusal.json'],
    ['07-mutation-approval', 'expected-refusal.json'],
    ['08-handoff-resume', 'expected-resume-plan.json'],
    ['09-platform-declaration', 'expected-interpretation.json'],
    ['10-capabilities-forwarding', 'expected-adapter-result.json'],
    ['10-capabilities-forwarding', 'expected-core-stdout.jsonl'],
  ];
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-vector-expectations-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));

  for (const [caseName, artifact] of expectations) {
    const source = path.join(fixtureRoot, caseName);
    const target = path.join(temporary, caseName);
    await cp(source, target, { recursive: true });
    const artifactPath = path.join(target, artifact);
    const changed = tamperedExpectation(artifact, await readFile(artifactPath));
    await writeFile(artifactPath, changed);
    await rehashArtifact(target, artifact, changed);

    await assert.rejects(runReferenceVector(target), undefined, `${caseName}/${artifact}`);
  }
});

test('standalone reference runner rejects duplicate-member artifact JSON', async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-vector-duplicate-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const source = path.join(fixtureRoot, '11-process-outcomes');
  const target = path.join(temporary, '11-process-outcomes');
  await cp(source, target, { recursive: true });
  const scenariosPath = path.join(target, 'scenarios.json');
  const original = await readFile(scenariosPath, 'utf8');
  const duplicate = Buffer.from(original.replace('"scenarios": [', '"scenarios": [],\n  "scenarios": ['));
  await writeFile(scenariosPath, duplicate);
  const manifestPath = path.join(target, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.artifacts.find(({ path: artifactPath }) => artifactPath === 'scenarios.json').sha256 = digest(duplicate);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  await assert.rejects(runReferenceVector(target), /invalid strict JSON/);
});

test('reference runner rejects a valid hashed artifact that no assertion consumes', async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-vector-unused-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const source = path.join(fixtureRoot, '11-process-outcomes');
  const target = path.join(temporary, '11-process-outcomes');
  await cp(source, target, { recursive: true });
  const unusedBytes = Buffer.from('{"unused":true}\n');
  await writeFile(path.join(target, 'unused.json'), unusedBytes);
  const manifestPath = path.join(target, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.artifacts.push({ path: 'unused.json', sha256: digest(unusedBytes) });
  manifest.artifacts.sort((left, right) => left.path.localeCompare(right.path));
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  await assert.rejects(runReferenceVector(target), /every hashed artifact must be consumed/);
});

test('adapter forwarding baselines match the direct core CLI', async () => {
  const capabilities = spawnSync(process.execPath, [
    './bin/wowbagger.js',
    'capabilities',
    '--json',
  ], { cwd: projectRoot, encoding: 'utf8' });
  assert.equal(capabilities.status, 0, capabilities.stderr);
  assert.equal(capabilities.stderr, '');
  assert.equal(
    capabilities.stdout,
    await readFile(path.join(fixtureRoot, '10-capabilities-forwarding', 'expected-core-stdout.jsonl'), 'utf8'),
  );

  const ready = spawnSync(process.execPath, [
    './bin/wowbagger.js',
    'ready',
    '--ledger',
    readyLedger,
    '--as-of',
    '2030-01-15',
    '--json',
  ], { cwd: projectRoot, encoding: 'utf8' });
  assert.equal(ready.status, 0, ready.stderr);
  assert.equal(ready.stderr, '');
  assert.equal(
    ready.stdout,
    await readFile(path.join(fixtureRoot, '03-ready-forwarding', 'expected-core-stdout.jsonl'), 'utf8'),
  );

  const invalidSource = await readFile(path.join(
    fixtureRoot,
    '04-validation-failure-forwarding',
    'ledger-bad.md',
  ));
  await withLedger({ 'bad.md': invalidSource }, async (ledger) => {
    const invalid = runCli('validate', '--ledger', ledger, '--json');
    assert.equal(invalid.status, 1, invalid.stderr);
    assert.equal(invalid.stderr, '');
    assert.equal(
      invalid.stdout,
      await readFile(path.join(fixtureRoot, '04-validation-failure-forwarding', 'expected-core-stdout.jsonl'), 'utf8'),
    );
  });
});

async function strictJson(file) {
  const bytes = await readFile(file);
  const parsed = parseJsonRequest(bytes);
  assert.equal(parsed.issues.length, 0, `${file}: ${JSON.stringify(parsed.issues)}`);
  return JSON.parse(bytes.toString('utf8'));
}

function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function tamperedExpectation(name, bytes) {
  if (name === 'expected-core-stdout.jsonl') {
    return Buffer.concat([bytes, Buffer.from(' ')]);
  }
  const value = JSON.parse(bytes.toString('utf8'));
  if (name === 'expected-refusal.json') {
    value.error.code = 'tampered-expectation';
  } else if (name === 'expected-discovery.json') {
    value.total_bytes += 1;
  } else if (name === 'expected-adapter-result.json') {
    value.result.core_command = 'tampered-expectation';
  } else if (name === 'expected-resume-plan.json') {
    value.must_invoke = ['tampered-expectation'];
  } else if (name === 'expected-interpretation.json') {
    value.required_before_support_claim = 'tampered-expectation';
  } else {
    throw new Error(`unknown expectation artifact ${name}`);
  }
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

async function rehashArtifact(directory, artifact, bytes) {
  const manifestPath = path.join(directory, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const entry = manifest.artifacts.find(({ path: artifactPath }) => artifactPath === artifact);
  assert.ok(entry, `${artifact} must be manifest-hashed`);
  entry.sha256 = digest(bytes);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function isSafeRelativePath(value) {
  return value.length > 0
    && !value.startsWith('/')
    && !value.includes('\\')
    && !value.includes('\0')
    && value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

async function assertTransferredStreams(directory, artifactPaths) {
  if (!artifactPaths.includes('expected-adapter-result.json')
    || !artifactPaths.includes('expected-core-stdout.jsonl')) {
    return;
  }
  const result = await strictJson(path.join(directory, 'expected-adapter-result.json'));
  const expectedStdout = await readFile(path.join(directory, 'expected-core-stdout.jsonl'));
  assertStreamMatches(result.result.stdout, expectedStdout, `${directory}/stdout`);
  assertStreamMatches(result.result.stderr, Buffer.alloc(0), `${directory}/stderr`);
}

async function assertInstructionDigests(directory, artifactPaths) {
  if (!artifactPaths.includes('instruction-input.json')) {
    return;
  }
  const input = await strictJson(path.join(directory, 'instruction-input.json'));
  for (const source of input.sources) {
    const bytes = Buffer.from(source.content_base64, 'base64');
    assert.equal(bytes.toString('base64'), source.content_base64, `${directory}/${source.source_id}`);
    assert.equal(bytes.length, source.byte_length, `${directory}/${source.source_id} byte length`);
    assert.equal(digest(bytes), source.sha256, `${directory}/${source.source_id} digest`);
  }
}

async function assertInvocationLimits(directory, artifactPaths) {
  if (!artifactPaths.includes('invocation.json')) return;
  const invocation = await strictJson(path.join(directory, 'invocation.json'));
  assert.deepEqual(validateInvocationLimits(invocation.limits, {
    max_context_bytes: 65536,
    max_stdout_bytes: 1048576,
    max_stderr_bytes: 65536,
    max_timeout_ms: 30000,
  }), { ok: true });
}

function assertStreamMatches(stream, expected, label) {
  assert.equal(stream.encoding, 'base64', label);
  const bytes = Buffer.from(stream.data, 'base64');
  assert.equal(bytes.toString('base64'), stream.data, label);
  assert.deepEqual(bytes, expected, label);
  assert.equal(stream.byte_length, expected.length, label);
  assert.equal(stream.sha256, digest(expected), label);
}

function compareByName(left, right) {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}
