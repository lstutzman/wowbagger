import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadLedger } from '../src/ledger.js';
import { parseJsonRequest } from '../src/request.js';
import { validateLedger } from '../src/validate.js';
import { readRegularFixture } from './work-claim-fixture-loader.js';
import { runReferenceVector } from './work-claim-reference.js';
import { withLedger } from './support.js';

const fixtureRoot = fileURLToPath(new URL('../spec/fixtures/work-claims/', import.meta.url));
const expectedCases = [
  'acquire-contention',
  'advisory-publication-rejection',
  'advisory-unfenced',
  'backward-clock-rejection-restart',
  'capabilities-fenced',
  'capabilities-missing-write-path',
  'claim-response-loss-read',
  'clock-floor-persistence-failure',
  'epoch-exhaustion',
  'expiry-takeover',
  'fence-dimension-rejections',
  'legacy-write-refusals',
  'namespace-isolation',
  'paused-writer-commit-boundary',
  'publication-clock-floor-failure',
  'publication-outcome-unknown',
  'publication-response-loss',
  'renew-release-restart-aba',
];
const requiredCoverage = [
  'aba',
  'acquire',
  'advisory',
  'advisory-publication-rejection',
  'alternate-bypass',
  'atomic-publication',
  'backward-clock',
  'barrier',
  'capabilities',
  'capability-rejection',
  'claim-read',
  'clock-floor',
  'commit-boundary',
  'contention',
  'create-refusal',
  'epoch-exhausted',
  'epoch-fence',
  'epoch-monotonicity',
  'expiry-boundary',
  'fail-closed',
  'fault',
  'idempotency',
  'item-fence',
  'ledger-binding',
  'legacy-bypass',
  'missing-write-path',
  'namespace-fence',
  'namespace-isolation',
  'operation-read',
  'owner-fence',
  'paused-writer',
  'precedence',
  'publication-fail-closed',
  'publication-outcome-unknown',
  'publication-recovery',
  'reacquire',
  'read',
  'rejection-persistence',
  'release',
  'renew',
  'response-loss',
  'restart',
  'safe-exclusive-dispatch',
  'same-item-id',
  'stale-fence',
  'storage-failure',
  'takeover',
  'transition-refusal',
];

test('normative work-claim manifests execute to their exact envelopes and durable final states', () => {
  const directories = readdirSync(fixtureRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'ledger')
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(directories, expectedCases);

  const coverage = new Set();
  let actionCount = 0;
  for (const directory of directories) {
    const bytes = readRegularFixture(fixtureRoot, `${directory}/manifest.json`);
    const parsed = parseJsonRequest(bytes);
    assert.deepEqual(parsed.issues, [], `${directory} must be unique-key UTF-8 JSON`);
    const manifest = JSON.parse(bytes.toString('utf8'));
    assert.deepEqual(Object.keys(manifest).sort(), [
      'actions',
      'case',
      'clock',
      'coverage',
      'description',
      'expected',
      'fixture_version',
      'initial',
      'source_files',
      'status',
    ]);
    assert.equal(manifest.case, directory);
    assert.equal(manifest.fixture_version, 2);
    assert.equal(manifest.status, 'normative-reference-model');
    assert.deepEqual(manifest.clock, {
      authority: 'backend-effective-utc',
      client_timestamps_trusted: false,
      durable_floor_scope: 'ledger-namespace',
    });
    assert.ok(manifest.actions.length > 0);
    actionCount += manifest.actions.length;
    for (const label of manifest.coverage) coverage.add(label);

    const sources = assertBoundSources(manifest.source_files);
    assertDigestReferencesAreBound(manifest, sources);
    assert.deepEqual(
      runReferenceVector({ initial: manifest.initial, actions: manifest.actions }),
      manifest.expected,
      `${directory} reference-model result`,
    );
    assert.equal(manifest.expected.transcript.length, manifest.actions.length);
  }

  assert.deepEqual([...coverage].sort(), requiredCoverage);
  assert.equal(actionCount, 48);
});

test('work-claim ledger byte alternatives are individually valid', async () => {
  for (const sourcePath of ['ledger/before.md', 'ledger/after.md']) {
    const source = readRegularFixture(fixtureRoot, sourcePath).toString('utf8');
    await withLedger({ 'item.md': source }, async (ledger) => {
      assert.deepEqual(validateLedger(await loadLedger(ledger)), { valid: true, errors: [] });
    });
  }
});

function assertBoundSources(sourceFiles) {
  assert.ok(Array.isArray(sourceFiles));
  assert.deepEqual(sourceFiles.map((source) => source.path), ['ledger/before.md', 'ledger/after.md']);
  const sources = new Map();
  for (const source of sourceFiles) {
    assert.deepEqual(Object.keys(source).sort(), ['path', 'sha256', 'source_base64']);
    const bytes = readRegularFixture(fixtureRoot, source.path);
    const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    assert.equal(source.sha256, digest, `${source.path} digest`);
    assert.equal(source.source_base64, bytes.toString('base64'), `${source.path} base64`);
    sources.set(source.sha256, source.source_base64);
  }
  return sources;
}

function assertDigestReferencesAreBound(manifest, sources) {
  for (const ledger of manifest.initial.durable.ledgers) {
    assert.equal(sources.get(ledger.revision), ledger.source_base64, `${manifest.case} initial ledger`);
  }
  for (const action of manifest.actions) {
    if (action.operation !== 'ledger-publication.preflight') continue;
    assert.ok(sources.has(action.request.expected_revision), `${manifest.case} expected revision`);
    assert.equal(
      sources.get(action.request.candidate_sha256),
      action.request.candidate_source_base64,
      `${manifest.case} candidate bytes`,
    );
  }
}
