#!/usr/bin/env node
//
// `npm run release:cut -- <version> --date YYYY-MM-DD`
//
// One command turns a clean release-branch tip into a verified local cut: it
// proves every version site is accounted for, plans the new bytes in memory,
// runs the full release gate over them, then leaves exactly one `Cut <version>`
// commit and one annotated `v<version>` tag. It stops there. Push and
// `npm publish --tag next` remain separate, named, human steps, because a green
// local command cannot roll back a pushed tag or a publication.
//
// The command must run on the tip of the release branch. Cuts used to happen in
// a session worktree and merge afterwards, which is why the two most recent
// release tags name merge commits rather than their cut commits, and why the
// published HEAD could differ from the tag the prepublish guard checks. Merge
// session work to the release branch first; then cut. The topology decision and
// the commits it names are recorded in docs/adapter-release-path.md.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { rewriteChangelog } from './lib/release-changelog.js';
import { countOccurrences, planVersionSites, verifyExactSets } from './lib/release-sites.js';

export const MANIFEST_PATH = 'scripts/release-version-sites.json';
export const CHANGELOG_PATH = 'CHANGELOG.md';
export const DEFAULT_RELEASE_BRANCH = 'main';
export const DEFAULT_NODE20 = '/opt/homebrew/opt/node@20/bin/node';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
const verifyReleaseTagScript = fileURLToPath(new URL('./verify-release-tag.js', import.meta.url));

// ---------------------------------------------------------------- versions --

export function parseVersion(version) {
  const match = SEMVER.exec(version ?? '');
  if (match === null) return null;
  const [, major, minor, patch, prerelease] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prerelease === undefined ? [] : prerelease.split('.'),
  };
}

export function compareVersions(left, right) {
  for (const part of ['major', 'minor', 'patch']) {
    if (left[part] !== right[part]) return left[part] < right[part] ? -1 : 1;
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;
  for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index += 1) {
    const a = left.prerelease[index];
    const b = right.prerelease[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (a === b) continue;
    const numeric = /^\d+$/.test(a) && /^\d+$/.test(b);
    if (numeric) return Number(a) < Number(b) ? -1 : 1;
    return a < b ? -1 : 1;
  }
  return 0;
}

// -------------------------------------------------------------------- gate --

export function releaseGateSteps(cwd, { node20 = DEFAULT_NODE20 } = {}) {
  const env = { TMPDIR: '/tmp' };
  const tests = testFiles(cwd);
  return [
    { name: 'tests (current Node)', command: process.execPath, args: ['--test', ...tests], env },
    { name: 'tests (Node 20)', command: node20, args: ['--test', ...tests], env },
    ...['claude-code', 'codex', 'opencode'].map((target) => ({
      name: `adapter implementation vectors (${target})`,
      command: process.execPath,
      args: ['spec/run-adapter-implementation.js', '--target', target],
      env,
    })),
    {
      name: 'ledger validation',
      command: process.execPath,
      args: ['bin/wowbagger.js', 'validate', '--ledger', 'ledger', '--json'],
      env,
    },
    { name: 'production dependency audit', command: 'npm', args: ['audit', '--omit=dev'], env },
    { name: 'worktree whitespace check', command: 'git', args: ['diff', '--check'], env },
    { name: 'index whitespace check', command: 'git', args: ['diff', '--cached', '--check'], env },
  ];
}

function testFiles(cwd) {
  const directory = path.join(cwd, 'test');
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith('.test.js'))
    .sort()
    .map((name) => path.join('test', name));
}

function runReleaseGate({ cwd, node20, log }) {
  const failures = [];
  for (const step of releaseGateSteps(cwd, { node20 })) {
    log(`gate: ${step.name}`);
    const result = spawnSync(step.command, step.args, {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, ...step.env },
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.status !== 0) {
      failures.push({
        step: step.name,
        detail: (result.stderr || result.stdout || `exit ${result.status}`).slice(-4000),
      });
      break;
    }
  }
  return { ok: failures.length === 0, failures };
}

// --------------------------------------------------------------------- git --

function realPath(target) {
  try {
    return realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

function makeGit(cwd) {
  return function git(...argumentsList) {
    return spawnSync('git', argumentsList, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  };
}

function changedSetProblem(git, allowed, stage) {
  const changed = changedPaths(git);
  if (changed.join('\n') === allowed.join('\n')) return null;
  return {
    code: 'unexpected-change',
    detail: `${stage} left ${changed.join(', ') || 'nothing'} changed; the plan allows ${allowed.join(', ')}`,
  };
}

function changedPaths(git) {
  const result = git('status', '--porcelain', '-uall', '-z');
  if (result.status !== 0) throw new Error(`git status failed: ${result.stderr.trim()}`);
  return result.stdout.split('\0').filter(Boolean).map((entry) => entry.slice(3)).sort();
}

function gitOut(git, ...argumentsList) {
  const result = git(...argumentsList);
  if (result.status !== 0) {
    throw new Error(`git ${argumentsList.join(' ')} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function defaultPublishedVersions(name) {
  const result = spawnSync('npm', ['view', name, 'versions', '--json'], { encoding: 'utf8' });
  if (result.status !== 0) {
    if (/E404/.test(result.stderr)) return [];
    throw new Error(`npm view ${name} versions failed: ${result.stderr.trim()}`);
  }
  const parsed = JSON.parse(result.stdout);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function defaultRemoteTags(cwd) {
  const git = makeGit(cwd);
  const remotes = git('remote').stdout.split('\n').filter(Boolean);
  if (!remotes.includes('origin')) return null;
  const result = git('ls-remote', '--tags', 'origin');
  if (result.status !== 0) throw new Error(`git ls-remote failed: ${result.stderr.trim()}`);
  return new Set(
    result.stdout.split('\n').filter(Boolean)
      .map((line) => line.split('\t')[1]?.replace(/^refs\/tags\//, '').replace(/\^\{\}$/, ''))
      .filter(Boolean),
  );
}

// ------------------------------------------------------------------- files --

export function readTrackedTextFiles(cwd, git) {
  const listed = gitOut(git, 'ls-files', '-z');
  const files = new Map();
  for (const relativePath of listed.split('\0').filter(Boolean)) {
    if (relativePath === MANIFEST_PATH) continue; // the coverage declaration, not a release site
    const absolute = path.join(cwd, relativePath);
    if (!existsSync(absolute)) continue;
    const bytes = readFileSync(absolute);
    if (bytes.includes(0)) continue; // binary
    files.set(relativePath, bytes.toString('utf8'));
  }
  return files;
}

// -------------------------------------------------------------------- cut ---

/**
 * @returns {{ok: boolean, state: string, problems: Array, diff?: string,
 *            commitSubject?: string, tag?: string, changed?: string[]}}
 */
export function cutRelease({
  cwd,
  version,
  date,
  dryRun = false,
  releaseBranch = DEFAULT_RELEASE_BRANCH,
  node20 = DEFAULT_NODE20,
  publishedVersions = defaultPublishedVersions,
  remoteTags = () => defaultRemoteTags(cwd),
  runGate = (context) => runReleaseGate({ ...context, node20, log: context.log }),
  verifyTag = defaultVerifyTag,
  log = () => {},
}) {
  const git = makeGit(cwd);
  const refuse = (code, detail, extra = {}) => ({
    ok: false,
    state: 'refused',
    problems: [{ code, detail, ...extra }],
  });

  let root;
  try {
    root = gitOut(git, 'rev-parse', '--show-toplevel');
  } catch (error) {
    return refuse('not-a-repository', error.message);
  }
  if (realPath(root) !== realPath(cwd)) {
    return refuse('not-repository-root', `${cwd} is not the repository root ${root}`);
  }

  const branch = git('rev-parse', '--abbrev-ref', 'HEAD').stdout.trim();
  if (branch !== releaseBranch) {
    return refuse(
      'not-release-branch',
      `a cut runs on the tip of ${releaseBranch}; HEAD is on ${branch === 'HEAD' ? 'a detached HEAD' : branch}.`
        + ' Merge session work to the release branch first, then cut.',
    );
  }
  const head = gitOut(git, 'rev-parse', 'HEAD');
  if (gitOut(git, 'rev-parse', `refs/heads/${releaseBranch}`) !== head) {
    return refuse('not-release-branch', `HEAD is not the tip of ${releaseBranch}`);
  }
  const upstream = git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}');
  if (upstream.status === 0) {
    const behind = git('rev-list', '--count', `HEAD..${upstream.stdout.trim()}`).stdout.trim();
    if (behind !== '' && behind !== '0') {
      return refuse('behind-upstream', `HEAD is ${behind} commit(s) behind ${upstream.stdout.trim()}`);
    }
  }

  if (gitOut(git, 'status', '--porcelain') !== '') {
    return refuse('dirty-checkout', 'a cut needs a clean checkout; commit or discard the changes first');
  }

  const target = parseVersion(version);
  if (target === null) return refuse('version-invalid', `${version} is not a SemVer version`);
  if (date === undefined || date === null || date === '') {
    return refuse('date-required', '--date YYYY-MM-DD is required so the changelog never depends on the clock');
  }

  const packageManifest = JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf8'));
  const current = parseVersion(packageManifest.version);
  const tag = `v${version}`;

  if (packageManifest.version === version && inFlightCut(git, version)) {
    return resumeOrConfirm({ cwd, git, tag, version, head, verifyTag, log, refuse });
  }

  if (current === null || compareVersions(target, current) <= 0) {
    return refuse(
      'version-not-increasing',
      `${version} does not follow the current version ${packageManifest.version}`,
    );
  }

  if (git('rev-parse', '--verify', '--quiet', `refs/tags/${tag}`).status === 0) {
    return refuse('local-tag-present', `${tag} already exists in this checkout`);
  }
  let remote;
  try {
    remote = remoteTags();
  } catch (error) {
    return refuse('remote-unreachable', error.message);
  }
  if (remote !== null && remote.has(tag)) {
    return refuse('remote-tag-present', `${tag} already exists on the remote`);
  }
  let published;
  try {
    published = publishedVersions(packageManifest.name);
  } catch (error) {
    return refuse('registry-unreachable', error.message);
  }
  if (published.includes(version)) {
    return refuse('version-published', `${packageManifest.name}@${version} is already published`);
  }

  // ---- plan ---------------------------------------------------------------

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path.join(cwd, MANIFEST_PATH), 'utf8'));
  } catch (error) {
    return refuse('manifest-unreadable', `${MANIFEST_PATH}: ${error.message}`);
  }

  const files = readTrackedTextFiles(cwd, git);
  const plan = planVersionSites({
    manifest,
    files,
    oldVersion: packageManifest.version,
    newVersion: version,
  });
  if (!plan.ok) return { ok: false, state: 'refused', problems: plan.problems };

  const changelog = files.get(CHANGELOG_PATH);
  if (changelog === undefined) return refuse('missing-changelog', `${CHANGELOG_PATH} is not tracked`);
  const rewritten = rewriteChangelog({ text: plan.updates.get(CHANGELOG_PATH) ?? changelog, version, date });
  if (!rewritten.ok) return { ok: false, state: 'refused', problems: rewritten.problems };

  const updates = new Map(plan.updates);
  updates.set(CHANGELOG_PATH, rewritten.text);

  const planned = new Map(files);
  for (const [file, text] of updates) planned.set(file, text);
  const proof = verifyExactSets({
    files: planned,
    oldVersion: packageManifest.version,
    newVersion: version,
    expectedOld: plan.retainedOccurrences,
    expectedNew: plan.mutableOccurrences + countOccurrences(rewritten.text, version),
  });
  if (!proof.ok) return { ok: false, state: 'refused', problems: proof.problems };

  const allowed = [...updates.keys()].sort();

  // ---- dry run ------------------------------------------------------------

  if (dryRun) {
    return planInCopy({ cwd, git, head, updates, allowed, runGate, log, version, tag, refuse });
  }

  // ---- materialize --------------------------------------------------------

  const original = new Map();
  for (const file of allowed) original.set(file, readFileSync(path.join(cwd, file)));
  const restore = () => {
    for (const [file, bytes] of original) writeFileSync(path.join(cwd, file), bytes);
  };

  for (const [file, text] of updates) writeFileSync(path.join(cwd, file), text, 'utf8');

  const materialized = changedSetProblem(git, allowed, 'materialization');
  if (materialized !== null) {
    restore();
    return { ok: false, state: 'refused', problems: [materialized] };
  }

  const diff = git('diff').stdout;
  log(`gate: running the full release gate over ${allowed.length} planned file(s)`);
  const gate = runGate({ cwd, log });
  if (!gate.ok) {
    restore();
    const clean = gitOut(git, 'status', '--porcelain') === '';
    return {
      ok: false,
      state: 'refused',
      problems: [{
        code: 'gate-failed',
        detail: gate.failures.map(({ step, detail }) => `${step}: ${detail}`).join('\n'),
        restored: clean,
      }],
    };
  }

  // A gate step runs arbitrary project commands. If one of them wrote to the
  // worktree, the bytes about to be committed are no longer the bytes the gate
  // just proved, so the cut refuses rather than committing something unverified.
  const afterGate = changedSetProblem(git, allowed, 'the release gate');
  if (afterGate !== null) {
    restore();
    return { ok: false, state: 'refused', problems: [afterGate] };
  }

  // ---- commit and tag -----------------------------------------------------

  const add = git('add', '--', ...allowed);
  if (add.status !== 0) {
    restore();
    return refuse('stage-failed', add.stderr.trim());
  }
  const staged = gitOut(git, 'diff', '--cached', '--name-only').split('\n').filter(Boolean).sort();
  if (staged.join('\n') !== allowed.join('\n')) {
    git('reset', '-q');
    restore();
    return refuse('unexpected-change', `staged ${staged.join(', ')}; the plan allows ${allowed.join(', ')}`);
  }

  const commit = git('commit', '-q', '-m', `Cut ${version}`);
  if (commit.status !== 0) {
    if (gitOut(git, 'rev-parse', 'HEAD') === head) {
      git('reset', '-q');
      restore();
    }
    return refuse('commit-failed', commit.stderr.trim());
  }

  return tagAndVerify({ cwd, git, tag, version, date, verifyTag, log, diff, allowed, state: 'cut', refuse });
}

// Distinguishes a rerun of a cut from a request to re-cut the version already
// in the tree. Only the first has either the tag or a `Cut <version>` commit.
function inFlightCut(git, version) {
  const tagged = git('rev-parse', '--verify', '--quiet', `refs/tags/v${version}`);
  if (tagged.status === 0) return true;
  const found = git('rev-list', '--max-count=1', '--fixed-strings', `--grep=Cut ${version}`, 'HEAD');
  if (found.status !== 0 || found.stdout.trim() === '') return false;
  return git('log', '-1', '--pretty=%s', found.stdout.trim()).stdout.trim() === `Cut ${version}`;
}

function resumeOrConfirm({ cwd, git, tag, version, head, verifyTag, log, refuse }) {
  const tagged = git('rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`);
  if (tagged.status === 0) {
    if (tagged.stdout.trim() !== head) {
      return refuse('tag-elsewhere', `${tag} names ${tagged.stdout.trim()}, not HEAD ${head}`);
    }
    const verified = verifyTag({ cwd, log });
    if (!verified.ok) return refuse('tag-verification-failed', verified.detail);
    return { ok: true, state: 'already-cut', problems: [], tag, commitSubject: `Cut ${version}` };
  }

  const subject = git('log', '-1', '--pretty=%s').stdout.trim();
  if (subject !== `Cut ${version}`) {
    return refuse(
      'mixed-metadata',
      `the tree names ${version} but HEAD is "${subject}", not "Cut ${version}"; repair it by hand`,
    );
  }
  log(`resuming: HEAD is a complete cut of ${version} with no tag`);
  return tagAndVerify({
    cwd, git, tag, version, date: undefined, verifyTag, log, state: 'resumed-tag', refuse,
  });
}

function tagAndVerify({ cwd, git, tag, version, date, verifyTag, log, diff, allowed, state, refuse }) {
  const message = date === undefined ? `Release ${version}` : `Release ${version} (${date})`;
  const created = git('tag', '-a', tag, '-m', message);
  if (created.status !== 0) {
    return refuse('tag-failed', `${created.stderr.trim()}; the cut commit is complete, rerun to resume at tagging`);
  }
  const commit = gitOut(git, 'rev-parse', 'HEAD');

  const verified = verifyTag({ cwd, log });
  if (!verified.ok) {
    const tagged = git('rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`).stdout.trim();
    if (tagged === commit) git('tag', '-d', tag);
    return refuse(
      'tag-verification-failed',
      `${verified.detail}; the cut commit is retained for an inspectable retry`,
    );
  }

  log(`cut ${version} at ${commit} and tagged ${tag}`);
  return { ok: true, state, problems: [], tag, commitSubject: `Cut ${version}`, diff, changed: allowed };
}

function defaultVerifyTag({ cwd }) {
  const result = spawnSync(process.execPath, [verifyReleaseTagScript], { cwd, encoding: 'utf8' });
  return { ok: result.status === 0, detail: (result.stderr || result.stdout).trim() };
}

// ----------------------------------------------------------------- dry run --

function planInCopy({ cwd, git, head, updates, allowed, runGate, log, version, tag, refuse }) {
  const before = fingerprint(cwd, git);
  const copy = mkdtempSync(path.join(tmpdir(), 'wowbagger-dry-cut-'));
  try {
    const archive = path.join(copy, 'HEAD.tar');
    execFileSync('git', ['archive', '--format=tar', '-o', archive, head], { cwd });
    mkdirSync(path.join(copy, 'repo'));
    execFileSync('tar', ['-xf', archive, '-C', path.join(copy, 'repo')]);
    rmSync(archive);
    const workspace = path.join(copy, 'repo');
    if (existsSync(path.join(cwd, 'node_modules'))) {
      symlinkSync(path.join(cwd, 'node_modules'), path.join(workspace, 'node_modules'), 'dir');
    }

    const copyGit = makeGit(workspace);
    gitOut(copyGit, 'init', '-q');
    gitOut(copyGit, 'config', 'user.email', 'cut@example.invalid');
    gitOut(copyGit, 'config', 'user.name', 'Wowbagger dry run');
    gitOut(copyGit, 'add', '-A');
    gitOut(copyGit, 'commit', '-qm', 'Dry-run baseline');

    for (const [file, text] of updates) writeFileSync(path.join(workspace, file), text, 'utf8');
    const copyChanged = changedSetProblem(copyGit, allowed, 'the dry run');
    if (copyChanged !== null) return { ok: false, state: 'refused', problems: [copyChanged] };
    const diff = copyGit('diff').stdout;

    log('gate: running the full release gate against a copy');
    const gate = runGate({ cwd: workspace, log });
    if (!gate.ok) {
      return {
        ok: false,
        state: 'refused',
        problems: [{
          code: 'gate-failed',
          detail: gate.failures.map(({ step, detail }) => `${step}: ${detail}`).join('\n'),
        }],
      };
    }

    const after = fingerprint(cwd, git);
    if (after !== before) {
      return refuse('dry-run-mutated-repository', 'the dry run changed the repository; investigate before cutting');
    }

    return {
      ok: true,
      state: 'planned',
      problems: [],
      diff,
      commitSubject: `Cut ${version}`,
      tag,
      changed: allowed,
    };
  } finally {
    rmSync(copy, { force: true, recursive: true });
  }
}

export function fingerprint(cwd, git = makeGit(cwd)) {
  const digest = createHash('sha256');
  digest.update(gitOut(git, 'rev-parse', 'HEAD'));
  digest.update(git('show-ref').stdout);
  digest.update(gitOut(git, 'ls-files', '-s'));
  digest.update(git('status', '--porcelain', '-uall').stdout);
  for (const relativePath of gitOut(git, 'ls-files', '-z').split('\0').filter(Boolean)) {
    const absolute = path.join(cwd, relativePath);
    if (!existsSync(absolute)) continue;
    digest.update(relativePath);
    digest.update(readFileSync(absolute));
  }
  return digest.digest('hex');
}

// --------------------------------------------------------------------- cli --

export function parseArguments(argumentsList) {
  const options = { dryRun: false };
  const positional = [];
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--date') { index += 1; options.date = argumentsList[index]; }
    else if (argument.startsWith('--date=')) options.date = argument.slice('--date='.length);
    else if (argument === '--branch') { index += 1; options.releaseBranch = argumentsList[index]; }
    else if (argument.startsWith('--branch=')) options.releaseBranch = argument.slice('--branch='.length);
    else if (argument.startsWith('-')) return { error: `unknown option ${argument}` };
    else positional.push(argument);
  }
  if (positional.length !== 1) return { error: 'usage: cut-release.js <version> --date YYYY-MM-DD [--dry-run]' };
  return { ...options, version: positional[0] };
}

function main(argumentsList) {
  const options = parseArguments(argumentsList);
  if (options.error !== undefined) {
    process.stderr.write(`${options.error}\n`);
    return 2;
  }
  const result = cutRelease({
    cwd: process.cwd(),
    ...options,
    log: (message) => process.stdout.write(`${message}\n`),
  });
  if (!result.ok) {
    for (const problem of result.problems) {
      process.stderr.write(`${problem.code}${problem.file ? ` (${problem.file})` : ''}: ${problem.detail}\n`);
    }
    return 1;
  }
  process.stdout.write(`${result.state}: ${result.commitSubject} / ${result.tag}\n`);
  if (result.state === 'planned') {
    process.stdout.write(`${result.diff}\n`);
    process.stdout.write('dry run only: the repository is unchanged\n');
  } else {
    process.stdout.write('push the commit and tag, then `npm publish --tag next`, then'
      + ' `npm run release:channels -- check <version>`\n');
  }
  return 0;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
