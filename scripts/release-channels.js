#!/usr/bin/env node
//
// `npm run release:channels -- check|repair <version> [--dry-run]`
//
// While every release is a `0.1.0-alpha.*` prerelease the registry still
// requires a `latest` dist-tag — npm rejects deleting it with E400, verified
// live on 2026-08-17 — so the fallback policy is that `latest` mirrors `next`:
// a bare `npm install wowbagger` resolves to the current prerelease instead of
// dead first-alpha bytes, and `wowbagger@next` stays the documented install.
// The policy is exactly `{ latest: <published version>, next: <published
// version> }` with `0.1.0-alpha.1` deprecated.
//
// `check` is read-only and is the post-publish verification step. `repair` is
// idempotent and performs authenticated registry writes; run it in an
// interactive terminal, because the account authenticates with a WebAuthn
// passkey. It never unpublishes anything.
//
// Every prerelease publication must use `npm publish --tag next`, then
// `repair` (or `npm dist-tag add`) moves `latest` alongside it. A plain
// `npm publish` would move `latest` without `next`; `prepublishOnly` cannot
// see that flag, which is why the post-publish check exists.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ALPHA_1 = '0.1.0-alpha.1';

export const DEPRECATION_MESSAGE = 'Unsupported: this build predates the current core contract.'
  + ' Install the current prerelease with `npm install -g wowbagger@next`.'
  + ' The bundled skill pins one exact core distribution version and refuses any other,'
  + ' so upgrade the skill and the core together.';

/**
 * @param {{packageName: string, version: string, distTags: object, deprecated: string|null}} state
 * @returns {{ok: boolean, problems: Array<{code: string, detail: string}>}}
 */
export function checkChannels({ packageName, version, distTags, deprecated }) {
  const problems = [];
  if (!Object.hasOwn(distTags, 'latest')) {
    problems.push({
      code: 'latest-missing',
      detail: `${packageName} has no latest dist-tag; the registry always keeps one,`
        + ' so an absent read means the lookup failed',
    });
  } else if (distTags.latest !== version) {
    problems.push({
      code: 'latest-stale',
      detail: `latest names ${distTags.latest}, not the published ${version};`
        + ' the registry refuses to delete latest, so it must mirror next',
    });
  }
  if (!Object.hasOwn(distTags, 'next')) {
    problems.push({ code: 'next-missing', detail: `${packageName} has no next dist-tag` });
  } else if (distTags.next !== version) {
    problems.push({
      code: 'next-stale',
      detail: `next names ${distTags.next}, not the published ${version}`,
    });
  }
  if (deprecated !== DEPRECATION_MESSAGE) {
    problems.push({
      code: 'alpha-1-not-deprecated',
      detail: `${packageName}@${ALPHA_1} does not carry the approved deprecation message`,
    });
  }
  return { ok: problems.length === 0, problems };
}

/**
 * The idempotent write plan. Each entry is an `npm` invocation; an already
 * correct registry plans nothing.
 */
export function planRepair({ packageName, version, distTags, deprecated }) {
  const commands = [];
  if (distTags.next !== version) {
    commands.push({
      reason: `point next at ${version}`,
      args: ['dist-tag', 'add', `${packageName}@${version}`, 'next'],
    });
  }
  if (distTags.latest !== version) {
    commands.push({
      reason: `point latest at ${version}; the registry refuses to delete the latest tag`,
      args: ['dist-tag', 'add', `${packageName}@${version}`, 'latest'],
    });
  }
  if (deprecated !== DEPRECATION_MESSAGE) {
    commands.push({
      reason: `deprecate ${ALPHA_1} without unpublishing it`,
      args: ['deprecate', `${packageName}@${ALPHA_1}`, DEPRECATION_MESSAGE],
    });
  }
  return commands;
}

export function readLiveRegistry(packageName) {
  const distTags = npmJson(['view', packageName, 'dist-tags', '--json']);
  const deprecated = npmJson(['view', `${packageName}@${ALPHA_1}`, 'deprecated', '--json']);
  return {
    packageName,
    distTags: distTags === undefined ? {} : distTags,
    deprecated: typeof deprecated === 'string' ? deprecated : null,
  };
}

function npmJson(argumentsList) {
  const result = spawnSync('npm', argumentsList, { encoding: 'utf8' });
  if (result.status !== 0) {
    if (/E404/.test(result.stderr)) return undefined;
    throw new Error(`npm ${argumentsList.join(' ')} failed: ${result.stderr.trim()}`);
  }
  const text = result.stdout.trim();
  return text === '' ? undefined : JSON.parse(text);
}

/**
 * @returns {number} process exit status
 */
export function runChannels({
  argumentsList,
  readRegistry = readLiveRegistry,
  execute = runNpm,
  write = (line) => process.stdout.write(`${line}\n`),
  packageName = readPackageName(),
}) {
  const dryRun = argumentsList.includes('--dry-run');
  const positional = argumentsList.filter((argument) => !argument.startsWith('-'));
  const [mode, version] = positional;
  if (!['check', 'repair'].includes(mode) || version === undefined) {
    write('usage: release-channels.js check|repair <version> [--dry-run]');
    return 2;
  }

  let live;
  try {
    live = readRegistry(packageName);
  } catch (error) {
    write(`registry-unreachable: ${error.message}`);
    return 1;
  }
  const state = { ...live, packageName: live.packageName ?? packageName, version };

  if (mode === 'check') {
    const result = checkChannels(state);
    if (result.ok) {
      write(`ok: ${state.packageName} carries latest and next at ${version} and ${ALPHA_1} is deprecated`);
      return 0;
    }
    for (const { code, detail } of result.problems) write(`${code}: ${detail}`);
    return 1;
  }

  const commands = planRepair(state);
  if (commands.length === 0) {
    write(`ok: nothing to repair; ${state.packageName} already matches the prerelease channel policy`);
    return 0;
  }
  for (const { reason, args } of commands) {
    write(`# ${reason}`);
    write(`npm ${args.map(quote).join(' ')}`);
  }
  if (dryRun) {
    write(`dry run: ${commands.length} authenticated registry write(s) planned and none performed`);
    return 0;
  }
  for (const { args } of commands) {
    const result = execute(args);
    if (!result.ok) {
      write(`repair-failed: npm ${args[0]} ${args[1]}: ${result.detail}`);
      return 1;
    }
  }
  write(`repaired: ${commands.length} registry write(s) applied; rerun check to confirm`);
  return 0;
}

function quote(argument) {
  return /[\s"']/.test(argument) ? JSON.stringify(argument) : argument;
}

function runNpm(args) {
  const result = spawnSync('npm', args, { encoding: 'utf8', stdio: ['inherit', 'inherit', 'pipe'] });
  return { ok: result.status === 0, detail: (result.stderr ?? '').trim() };
}

function readPackageName() {
  const manifestPath = path.join(process.cwd(), 'package.json');
  return JSON.parse(readFileSync(manifestPath, 'utf8')).name;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(runChannels({ argumentsList: process.argv.slice(2) }));
}
