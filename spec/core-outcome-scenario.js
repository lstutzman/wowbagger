// Scenario shaping for the end-to-end core-outcome vectors (case
// 16-core-outcome-e2e). Both the reference runner and the implementation
// runner need the same sandboxes: two isolated workspaces per assertion, a
// seeded Git common directory for the claim-fence scenarios, and a byte
// snapshot of the resulting ledger.
//
// Shaping only. This module imports nothing from `src/` and nothing from
// `spec/adapter-reference.js`, it never decides what a vector should produce,
// and it never writes into a fixture directory. Everything here is one of the
// three things the enrichment lets implementation code supply: temp absolute
// paths, copied sandboxes and Git plumbing, and the SHA-256 of bytes that were
// hand-authored somewhere else.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const CORE_OUTCOME_CASE_DIRECTORY = '16-core-outcome-e2e';

const RFC3339_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function digestOf(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function scenarioDirectory(caseDirectory, scenario) {
  if (!/^[0-9a-z-]+$/.test(scenario)) {
    throw new Error(`unsafe core-outcome scenario name ${scenario}`);
  }
  return path.join(caseDirectory, 'scenarios', scenario);
}

// The absolute ledger path is a property of the sandbox, not of the vector, so
// it never appears in a committed expectation. Both the direct-core baseline
// and the adapter resolve `ledger` against their own workspace root; this puts
// the baseline on the same footing.
export function withAbsoluteLedger(argv, ledger) {
  const index = argv.indexOf('--ledger');
  if (index < 0) throw new Error('core invocation argv names no --ledger');
  const resolved = [...argv];
  resolved[index + 1] = ledger;
  return resolved;
}

// The seeded clock floor is a fixed future instant, so `observed_at` in a
// claim-fence read-back is `max(physical_now, floor)` = the floor, and the
// refusal bytes stay fixed without mocking the core clock. That holds only
// while wall time is before the floor. The failure names the date so a reader
// in 2031 is told what expired rather than being sent to debug the adapter.
export function assertClockHorizonUnreached(declaration, now = new Date().toISOString()) {
  const horizon = declaration.workspace?.clock_horizon;
  if (horizon === undefined) return;
  if (!(now < horizon)) {
    throw new Error(
      `${declaration.scenario}: the seeded clock floor expired on ${horizon}. `
      + 'These vectors are deterministic only while wall time is before that instant. '
      + 'Re-seed the journal and the committed read-back with a later floor.',
    );
  }
}

// Reused normative bytes are pinned to their source by digest, so a change on
// either side stops the vector and asks for a reviewed golden change instead of
// silently regenerating one. `compact-json-line` is the one permitted
// transform: the core emits one compact JSON object plus one LF, while the
// mutation fixtures store the same object indented.
export async function verifyDerivedFrom(projectRoot, directory, declaration) {
  for (const entry of declaration.derived_from ?? []) {
    const sourceBytes = await readFile(path.join(projectRoot, entry.source));
    if (digestOf(sourceBytes) !== entry.sha256) {
      throw new Error(
        `${declaration.scenario}/${entry.path}: ${entry.source} changed `
        + `(${digestOf(sourceBytes)} is not the pinned ${entry.sha256})`,
      );
    }
    const localBytes = await readFile(path.join(directory, entry.path));
    const expected = entry.form === 'compact-json-line'
      ? Buffer.from(`${JSON.stringify(JSON.parse(sourceBytes.toString('utf8')))}\n`)
      : sourceBytes;
    if (!localBytes.equals(expected)) {
      throw new Error(`${declaration.scenario}/${entry.path} diverged from ${entry.source}`);
    }
  }
}

async function materializeLedger(directory, workspaceRoot, entries) {
  await mkdir(path.join(workspaceRoot, 'ledger'), { recursive: true });
  for (const entry of entries) {
    const target = path.join(workspaceRoot, entry.path);
    await mkdir(path.dirname(target), { recursive: true });
    const bytes = await readFile(path.join(directory, entry.source_file));
    if (digestOf(bytes) !== entry.sha256) {
      throw new Error(`${entry.source_file}: ledger state digest mismatch`);
    }
    await writeFile(target, bytes);
  }
}

function git(cwd, ...argumentsList) {
  const result = spawnSync('git', argumentsList, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${argumentsList.join(' ')}: ${result.stderr ?? result.error?.message}`);
  }
}

// One workspace. Callers build two per assertion — the direct-core baseline
// mutates its ledger, so sharing one would destroy the adapter's precondition.
export async function materializeWorkspace(directory, declaration, prefix) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), prefix));
  const kind = declaration.workspace.kind;
  if (kind === 'git-provisioned') {
    git(workspaceRoot, 'init', '--quiet');
    // Exact bytes are the whole point of these vectors, so line-ending
    // rewriting and signing are turned off rather than inherited.
    for (const [name, value] of [
      ['user.email', 'fixture@example.invalid'],
      ['user.name', 'Wowbagger Fixture'],
      ['core.autocrlf', 'false'],
      ['core.safecrlf', 'false'],
      ['commit.gpgsign', 'false'],
    ]) git(workspaceRoot, 'config', name, value);
    const journal = path.join(
      workspaceRoot, '.git', 'wowbagger', declaration.workspace.namespace, 'journal.ndjson',
    );
    await mkdir(path.dirname(journal), { recursive: true });
    await cp(path.join(directory, declaration.workspace.journal), journal);
  } else if (kind === 'git-unverifiable') {
    // A `.git` marker the walker finds and `git rev-parse` cannot confirm.
    // The fence fails closed before it reads a namespace, which is the
    // deterministic way to reach `claim-store-unavailable`.
    await cp(
      path.join(directory, declaration.workspace.marker),
      path.join(workspaceRoot, '.git'),
    );
  } else if (kind !== 'plain') {
    throw new Error(`unknown core-outcome workspace kind ${kind}`);
  }
  await materializeLedger(directory, workspaceRoot, declaration.ledger.before);
  // posix.join mirrors the adapter's own resolution (src/adapter/paths.js), so
  // the baseline and the adapter name the same ledger string on every platform.
  return { root: workspaceRoot, ledger: path.posix.join(workspaceRoot, 'ledger') };
}

async function collectLedger(directory, display, snapshot) {
  const entries = (await readdir(directory, { withFileTypes: true }))
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    const shown = `${display}/${entry.name}`;
    if (entry.isDirectory()) {
      // The core's own mutation lock directory is a real artifact of a real
      // run and is empty once the run completes. An empty one is not ledger
      // state; anything left inside it is, and is reported.
      if (entry.name === '.wowbagger-locks' && (await readdir(file)).length === 0) continue;
      await collectLedger(file, shown, snapshot);
      continue;
    }
    if (!entry.isFile()) {
      snapshot.push({ type: 'other', path: shown });
      continue;
    }
    snapshot.push({ type: 'file', path: shown, sha256: digestOf(await readFile(file)) });
  }
  return snapshot;
}

function bySnapshotPath(left, right) {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

export async function snapshotLedger(workspaceRoot) {
  return (await collectLedger(path.join(workspaceRoot, 'ledger'), 'ledger', [])).sort(bySnapshotPath);
}

// The committed state list is already digest-pinned by `materializeLedger`,
// so this only reshapes it into what `snapshotLedger` reports.
export function declaredLedgerSnapshot(entries) {
  return entries
    .map((entry) => ({ type: 'file', path: entry.path, sha256: entry.sha256 }))
    .sort(bySnapshotPath);
}

// The coordinator persists a clock floor for every authoritative lease
// decision, including a refusal, so the journal legitimately grows. What it may
// not do is change the seeded prefix or record a floor other than the seeded
// one, either of which would mean `observed_at` was not what the vector pinned.
export async function assertJournalAppendShape(workspaceRoot, directory, declaration) {
  const seeded = (await readFile(path.join(directory, declaration.workspace.journal), 'utf8'))
    .split('\n').filter(Boolean);
  const journal = path.join(
    workspaceRoot, '.git', 'wowbagger', declaration.workspace.namespace, 'journal.ndjson',
  );
  const lines = (await readFile(journal, 'utf8')).split('\n').filter(Boolean);
  if (lines.length < seeded.length) throw new Error('the seeded claim journal lost entries');
  for (const [index, line] of seeded.entries()) {
    if (lines[index] !== line) throw new Error(`claim journal entry ${index + 1} was rewritten`);
  }
  for (const line of lines.slice(seeded.length)) {
    const entry = JSON.parse(line);
    if (entry.type !== 'clock') {
      throw new Error(`the refusal appended a ${entry.type} entry, not a clock record`);
    }
    if (entry.floor !== declaration.workspace.clock_horizon) {
      throw new Error(`the appended clock floor is ${entry.floor}, not the seeded floor`);
    }
    if (!RFC3339_MS.test(entry.now)) {
      throw new Error(`the appended clock record carries a non-canonical instant ${entry.now}`);
    }
  }
}
