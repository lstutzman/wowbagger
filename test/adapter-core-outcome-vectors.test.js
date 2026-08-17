// Guard proofs for the end-to-end core-outcome vectors. Every guard the new
// scenario machinery adds is broken here on purpose and asserted red: a guard
// nobody has seen fail is a guard nobody has evidence for.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runImplementationVectors } from '../spec/run-adapter-implementation.js';
import { runReferenceVector } from '../spec/run-adapter-vectors.js';
import {
  assertClockHorizonUnreached,
  assertJournalAppendShape,
  verifyDerivedFrom,
  withAbsoluteLedger,
} from '../spec/core-outcome-scenario.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const caseName = '16-core-outcome-e2e';
const caseSource = path.join(projectRoot, 'spec', 'fixtures', 'adapters', caseName);
const gitScenario = '08-patch-active-claim-write-refused';

function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

async function copiedCase(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-core-outcome-tamper-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, caseName);
  await cp(caseSource, directory, { recursive: true });
  return { fixtureRoot: root, directory };
}

// A private copy of the case, with one byte string replaced and its manifest
// hash corrected. Leaving the hash stale would prove only that the artifact
// check works, which it already does.
async function tamperedCase(t, ...rewrites) {
  const { fixtureRoot: root, directory } = await copiedCase(t);
  const manifestPath = path.join(directory, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  for (const [relative, rewrite] of rewrites) {
    const target = path.join(directory, relative);
    const rewritten = Buffer.from(rewrite(await readFile(target, 'utf8')));
    await writeFile(target, rewritten);
    const artifact = manifest.artifacts.find(({ path: entry }) => entry === relative);
    assert.ok(artifact, `${relative} is not a hashed artifact`);
    artifact.sha256 = digest(rewritten);
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { fixtureRoot: root, directory };
}

async function failingScenarios(fixtureRoot) {
  const result = await runImplementationVectors({ fixtureRoot, platform: 'darwin' });
  const [only] = result.cases;
  return {
    status: result.status,
    differing: only.assertion_evidence
      .filter(({ evidence }) => evidence.includes('differs in'))
      .map(({ evidence }) => evidence),
  };
}

test('the unmodified core-outcome case passes on its own fixture root', async (t) => {
  const { fixtureRoot } = await copiedCase(t);

  const outcome = await failingScenarios(fixtureRoot);

  assert.equal(outcome.status, 'pass');
  assert.deepEqual(outcome.differing, []);
});

test('a committed adapter result whose stdout envelope contradicts the committed core bytes is refused', async (t) => {
  const { fixtureRoot } = await tamperedCase(t, [
    'scenarios/02-create-committed/expected-adapter-result.json',
    (text) => {
      const expected = JSON.parse(text);
      expected.result.stdout.byte_length += 1;
      return `${JSON.stringify(expected, null, 2)}\n`;
    },
  ]);

  await assert.rejects(
    runImplementationVectors({ fixtureRoot, platform: 'darwin' }),
    /does not carry the committed core streams/,
  );
});

test('a scenario whose declared after state no longer matches the core is refused', async (t) => {
  // The reconciliation log is ledger state the fence rewrites, and no
  // derived_from entry pins it, so the ledger comparison is the guard that
  // has to catch a drifted copy.
  const owner = (text) => text.replace(/agent-core-outcome-run-1/g, 'agent-core-outcome-run-2');
  const reconcile = 'scenarios/07-create-claimed-item-write-refused/before/reconcile.md';
  const rewritten = owner(await readFile(path.join(caseSource, reconcile), 'utf8'));
  const { fixtureRoot } = await tamperedCase(
    t,
    [reconcile, owner],
    // The scenario's own digest pin has to move with it, or the earlier
    // materialization guard answers before the ledger comparison can.
    ['scenarios/07-create-claimed-item-write-refused/scenario.json', (text) => {
      const declaration = JSON.parse(text);
      for (const side of [declaration.ledger.before, declaration.ledger.after]) {
        const entry = side.find(({ source_file: file }) => file === 'before/reconcile.md');
        entry.sha256 = digest(Buffer.from(rewritten));
      }
      return `${JSON.stringify(declaration, null, 2)}\n`;
    }],
  );

  await assert.rejects(
    runImplementationVectors({ fixtureRoot, platform: 'darwin' }),
    /the direct core left a different ledger/,
  );
});

test('a scenario whose committed core stdout no longer matches the core is refused', async (t) => {
  const reason = (text) => text.replace('git-verification-failed', 'git-verification-refused');
  const stdout = 'scenarios/09-transition-claim-store-unavailable/expected-core-stdout.jsonl';
  const rewritten = Buffer.from(reason(await readFile(path.join(caseSource, stdout), 'utf8')));
  const { fixtureRoot } = await tamperedCase(
    t,
    [stdout, reason],
    // The adapter result carries the same bytes, so it has to move with them
    // or the envelope-consistency guard answers first.
    ['scenarios/09-transition-claim-store-unavailable/expected-adapter-result.json', (text) => {
      const expected = JSON.parse(text);
      expected.result.stdout.data = rewritten.toString('base64');
      expected.result.stdout.sha256 = digest(rewritten);
      expected.result.stdout.byte_length = rewritten.length;
      return `${JSON.stringify(expected, null, 2)}\n`;
    }],
  );

  await assert.rejects(
    runImplementationVectors({ fixtureRoot, platform: 'darwin' }),
    /direct core stdout differs/,
  );
});

// The reference model runs the same nine vectors through its own engine, so a
// drifted expectation has to be refused on that side too.
test('the reference runner refuses a scenario whose committed adapter result drifted', async (t) => {
  const { directory } = await tamperedCase(t, [
    'scenarios/06-transition-date-refused/expected-adapter-result.json',
    (text) => text.replace('"core_exit_code": 2', '"core_exit_code": 3'),
  ]);

  await assert.rejects(runReferenceVector(directory), /06-transition-date-refused/);
});

test('a local copy that drifted from its pinned normative source is refused', async (t) => {
  const { directory } = await tamperedCase(t, [
    'scenarios/02-create-committed/mutation-input.json',
    (text) => text.replace('nebula-7', 'nebula-8'),
  ]);
  const scenarioPath = path.join(directory, 'scenarios', '02-create-committed');
  const declaration = JSON.parse(await readFile(path.join(scenarioPath, 'scenario.json'), 'utf8'));

  await assert.rejects(
    verifyDerivedFrom(projectRoot, scenarioPath, declaration),
    /mutation-input\.json diverged from/,
  );
});

test('a pinned normative source that changed under the copy is refused', async (t) => {
  const { directory } = await tamperedCase(t, [
    'scenarios/02-create-committed/scenario.json',
    (text) => {
      const declaration = JSON.parse(text);
      declaration.derived_from[0].sha256 = `sha256:${'b'.repeat(64)}`;
      return `${JSON.stringify(declaration, null, 2)}\n`;
    },
  ]);
  const scenarioPath = path.join(directory, 'scenarios', '02-create-committed');
  const declaration = JSON.parse(await readFile(path.join(scenarioPath, 'scenario.json'), 'utf8'));

  await assert.rejects(verifyDerivedFrom(projectRoot, scenarioPath, declaration), /changed/);
});

// The seeded clock floor is the whole reason a real claim-fence refusal has
// fixed bytes. Once wall time reaches it the vectors stop being deterministic,
// and the failure has to say so rather than look like an adapter defect.
test('the seeded clock floor fails loudly and names its expiry once it passes', () => {
  const declaration = {
    scenario: gitScenario,
    workspace: { clock_horizon: '2031-01-15T12:01:00.000Z' },
  };

  assert.doesNotThrow(() => assertClockHorizonUnreached(declaration, '2030-06-01T00:00:00.000Z'));
  assert.throws(
    () => assertClockHorizonUnreached(declaration, '2031-01-15T12:01:00.000Z'),
    /the seeded clock floor expired on 2031-01-15T12:01:00\.000Z/,
  );
});

test('the seeded clock floor is still in the future for every git-backed scenario', async () => {
  const manifest = JSON.parse(await readFile(path.join(caseSource, 'manifest.json'), 'utf8'));
  const scenarios = manifest.assertions.map(({ scenario }) => scenario);
  assert.ok(scenarios.length > 0);
  for (const scenario of scenarios) {
    const declaration = JSON.parse(await readFile(
      path.join(caseSource, 'scenarios', scenario, 'scenario.json'),
      'utf8',
    ));
    assert.doesNotThrow(() => assertClockHorizonUnreached(declaration));
  }
});

// The coordinator persists a clock floor for every authoritative lease
// decision, so the journal legitimately grows on a refusal. What it may not do
// is rewrite the seeded prefix or record a floor the vector did not pin.
test('the claim journal append shape refuses a rewritten seed and a non-clock append', async (t) => {
  const scenarioPath = path.join(caseSource, 'scenarios', gitScenario);
  const declaration = JSON.parse(await readFile(path.join(scenarioPath, 'scenario.json'), 'utf8'));
  const seeded = await readFile(path.join(scenarioPath, declaration.workspace.journal), 'utf8');
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-core-outcome-journal-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const journal = path.join(
    workspace, '.git', 'wowbagger', declaration.workspace.namespace, 'journal.ndjson',
  );
  const write = async (text) => {
    await cp(path.dirname(journal), path.dirname(journal), { recursive: true }).catch(() => {});
    await (await import('node:fs/promises')).mkdir(path.dirname(journal), { recursive: true });
    await writeFile(journal, text);
  };

  await write(seeded);
  await assert.doesNotReject(assertJournalAppendShape(workspace, scenarioPath, declaration));

  await write(`${seeded}{"seq":3,"type":"clock","now":"2031-01-15T12:02:00.000Z","floor":"2031-01-15T12:02:00.000Z"}\n`);
  await assert.rejects(
    assertJournalAppendShape(workspace, scenarioPath, declaration),
    /appended clock floor is 2031-01-15T12:02:00\.000Z/,
  );

  await write(`${seeded}{"seq":3,"type":"legacy-mutation-abort","attempt_id":"a","ledger_namespace":"${declaration.workspace.namespace}","item_id":"wb_01Q4ZK3DG020ANANANANANANAM","observed_revision":"sha256:${'0'.repeat(64)}","observed_at":"2031-01-15T12:01:00.000Z"}\n`);
  await assert.rejects(
    assertJournalAppendShape(workspace, scenarioPath, declaration),
    /appended a legacy-mutation-abort entry, not a clock record/,
  );

  await write(seeded.replace('agent-core-outcome-run-1', 'agent-somebody-else'));
  await assert.rejects(
    assertJournalAppendShape(workspace, scenarioPath, declaration),
    /claim journal entry 1 was rewritten/,
  );
});

test('a core invocation that names no ledger argument is refused rather than run against the wrong one', () => {
  assert.deepEqual(
    withAbsoluteLedger(['inspect', '--ledger', 'ledger', '--json'], '/tmp/x/ledger'),
    ['inspect', '--ledger', '/tmp/x/ledger', '--json'],
  );
  assert.throws(() => withAbsoluteLedger(['capabilities', '--json'], '/tmp/x/ledger'), /names no --ledger/);
});
