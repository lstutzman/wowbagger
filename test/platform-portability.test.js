// Portability guards for the platforms this repository intends to claim.
//
// Fixtures here are byte-exact: the conformance vectors compare exact core
// bytes, and several goldens are pinned by SHA-256. A checkout that rewrote
// line endings would change those bytes before any test ran, so the checkout
// itself is a gate concern, not a developer preference.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

// Which runner image can produce native evidence for which platform claim.
// A manifest key with no image here is a claim nothing in CI could earn.
const RUNNER_IMAGES = Object.freeze({
  darwin: 'macos-latest',
  linux: 'ubuntu-latest',
  win32: 'windows-latest',
});

const workflow = parseYaml(
  readFileSync(path.join(projectRoot, '.github', 'workflows', 'ci.yml'), 'utf8'),
);
const gateJob = workflow.jobs.gate;
const gateSteps = gateJob.steps.map((step) => step.run ?? '').join('\n');

function shippedAdapters() {
  const root = path.join(projectRoot, 'adapters');
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      target: entry.name,
      manifest: JSON.parse(
        readFileSync(path.join(root, entry.name, 'wowbagger-adapter.json'), 'utf8'),
      ),
    }));
}

function git(...argumentsList) {
  const result = spawnSync('git', argumentsList, {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('checkout rewrites no tracked byte: every tracked path has text unset', () => {
  const tracked = git('ls-files', '-z').split('\0').filter(Boolean);
  assert.ok(tracked.length > 100, `expected a tracked file list, saw ${tracked.length}`);

  const checked = spawnSync('git', ['check-attr', '--stdin', '-z', 'text'], {
    cwd: projectRoot,
    encoding: 'utf8',
    input: tracked.join('\0'),
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(checked.status, 0, checked.stderr);

  // `check-attr -z` emits path, attribute, value as three NUL-terminated
  // fields per input path.
  const fields = checked.stdout.split('\0');
  const converted = [];
  for (let index = 0; index + 2 < fields.length; index += 3) {
    if (fields[index + 2] !== 'unset') converted.push(`${fields[index]}: ${fields[index + 2]}`);
  }

  assert.deepEqual(converted, [], 'these paths would be end-of-line converted on checkout');
});

// A `supported` platform status is an evidence claim (adapter contract §3.1),
// and the evidence is the implementation runner passing natively on that
// platform. These guards do not assert that the evidence exists — they assert
// that the mechanism which produces it covers every platform the shipped
// manifests speak about, so no claim can be made about a platform CI never
// runs.
test('CI runs a native job for every platform the shipped manifests declare', () => {
  const declared = new Set(shippedAdapters().flatMap(({ manifest }) => Object.keys(manifest.platforms)));
  const covered = new Map(gateJob.strategy.matrix.include.map((entry) => [entry.platform, entry.os]));

  for (const platform of [...declared].sort()) {
    assert.equal(
      covered.get(platform),
      RUNNER_IMAGES[platform],
      `${platform} is declared in a shipped manifest with no native ${RUNNER_IMAGES[platform]} job`,
    );
  }
});

// The tie between a claim and its evidence. Adding `supported` to a manifest
// whose vectors no job runs natively is the exact dishonesty §3.1 forbids, so
// the claim and the step that can earn it move together or the suite refuses.
test('every supported platform claim has a native vector step behind it', () => {
  const jobs = new Map(gateJob.strategy.matrix.include.map((entry) => [entry.platform, entry.os]));

  for (const { target, manifest } of shippedAdapters()) {
    for (const [platform, status] of Object.entries(manifest.platforms)) {
      if (status !== 'supported') continue;
      assert.ok(
        jobs.has(platform),
        `${target} claims ${platform} supported with no native ${platform} job`,
      );
      assert.match(
        gateSteps,
        new RegExp(`spec/run-adapter-implementation\\.js --target ${target}\\b`),
        `${target} claims ${platform} supported with no native vector step for that adapter`,
      );
    }
  }
});

// The runner reports `pass` or `fail` in its JSON and exits 0 either way, so a
// step that only checked the exit code would report success on a failing run.
test('the vector step reads the report rather than trusting the exit code', () => {
  assert.match(gateSteps, /run-adapter-implementation\.js --target \S+ \| node \.github\/check-vector-report\.mjs/);
});

test('every native job runs the documented gate beside the vectors', () => {
  assert.match(gateSteps, /node --test test\/\*\.test\.js/);
  assert.match(gateSteps, /bin\/wowbagger\.js validate --ledger ledger --json/);
});

// The documented test command globs its files. Neither cmd.exe, PowerShell nor
// Node 20's own `--test` expands a glob, so the win32 job depends on the step
// shell being bash and would run no tests at all without it.
test('the gate steps run under a shell that expands the documented glob', () => {
  assert.equal(workflow.defaults.run.shell, 'bash');
});

// One platform's refusal must not cancel the job that would have earned
// another platform's claim: the jobs are independent pieces of evidence.
test('a failing platform does not cancel the other platforms evidence', () => {
  assert.equal(gateJob.strategy['fail-fast'], false);
});

// Node reads TMPDIR on POSIX and TEMP/TMP on win32, so one pinned variable
// cannot steer both. The macOS default temporary root is long enough to
// overflow a unix socket path, which is why it is pinned rather than inherited.
test('the temporary root is pinned per platform, not inherited', () => {
  assert.match(gateSteps, /TMPDIR=\/tmp/);
  assert.match(gateSteps, /TEMP=\$RUNNER_TEMP/);
  assert.match(gateSteps, /TMP=\$RUNNER_TEMP/);
});

// The POSIX-only fixture constructs are declared in one place so the win32
// coverage gap is a list rather than a scatter of inline platform checks. On a
// platform that has FIFOs and filesystem-path sockets, that declaration must
// cost nothing: a guard that quietly skipped cases here would turn a real
// refusal into a silent pass on the platform the gate can actually verify.
test('the POSIX-only fixture guard skips nothing on a platform that has FIFOs', { skip: process.platform === 'win32' && 'win32 has no FIFO to verify against' }, async () => {
  const { posixSpecialFilesOnly } = await import('./support.js');
  assert.deepEqual(posixSpecialFilesOnly, {});
});
