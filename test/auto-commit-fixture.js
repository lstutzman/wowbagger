// A provisioned merge-coordinated ledger inside its own Git checkout, in the
// state the commit-per-mutation loop leaves behind: item, namespace, and
// reconciliation log all committed, working tree and index clean.
//
// Shared by the auto-commit test files. It drives the real CLI and real git
// only; nothing here imports src/.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLI = fileURLToPath(new URL('../bin/wowbagger.js', import.meta.url));
const RUNNER = fileURLToPath(new URL('./mutation-runner.js', import.meta.url));
export const ITEM_ID = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';
export const SECOND_ITEM_ID = 'wb_01KZBMBEZKPE7D15HKW9Q3GT01';

export function run(cwd, ...argumentsList) {
  const result = spawnSync(process.execPath, [CLI, ...argumentsList], { cwd, encoding: 'utf8' });
  return {
    envelope: result.stdout.trim() === '' ? null : JSON.parse(result.stdout),
    exit: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

// Runs the CLI through the test runner with the auto-commit pause scenario. The
// returned `published` promise settles once the item is published and the
// command is waiting; `release()` lets it continue and resolves with the
// envelope. It is the only way a fixture can act between publication and
// staging.
export function pausedRun(fixture, suffix, argumentsList) {
  const child = spawn(process.execPath, [RUNNER, ...argumentsList], {
    cwd: fixture.root,
    env: { ...process.env, WOWBAGGER_TEST_SCENARIO: `pause-before-auto-commit-stage:${suffix}` },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  const exited = new Promise((resolve) => {
    child.on('close', (code) => resolve(code));
  });
  const marker = path.join(fixture.root, `.wowbagger-test-${suffix}-published`);
  const published = (async () => {
    const deadline = Date.now() + 20_000;
    for (;;) {
      try {
        await lstat(marker);
        return;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      if (Date.now() >= deadline) throw new Error('the paused command never published');
      await new Promise((resolve) => { setTimeout(resolve, 5); });
    }
  })();
  return {
    published,
    release: async () => {
      await writeFile(path.join(fixture.root, `.wowbagger-test-${suffix}-continue`), 'go\n');
      const exit = await exited;
      return { envelope: stdout.trim() === '' ? null : JSON.parse(stdout), exit, stdout, stderr };
    },
  };
}

export function git(root, ...argumentsList) {
  const result = spawnSync('git', argumentsList, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${argumentsList.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

export function tryGit(root, ...argumentsList) {
  const result = spawnSync('git', argumentsList, { cwd: root, encoding: 'utf8' });
  return { exit: result.status, stdout: result.stdout.trim(), stderr: result.stderr };
}

export function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function itemSource(id, { number, title = 'Before', status = 'backlog', body = 'Before' } = {}) {
  return `---
schema_version: 2
id: ${id}
number: ${number}
title: "${title}"
kind: task
status: ${status}
created: 2026-08-06
updated: 2026-08-11
provenance:
  source: "fixture/auto-commit"
  recorded_at: "2026-08-11T00:00:00Z"
depends_on: []
related: []
decisions: []
---
${body}
`;
}

export async function provisionedLedger({ items = [[ITEM_ID, 1]] } = {}) {
  const base = await mkdtemp(path.join(tmpdir(), 'wb-autocommit-'));
  const root = path.join(base, 'repo');
  await mkdir(root);
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Wowbagger Test');
  const ledger = path.join(root, 'ledger');
  await mkdir(path.join(ledger, 'items'), { recursive: true });
  const sources = new Map();
  for (const [id, number] of items) {
    const source = itemSource(id, { number });
    sources.set(id, source);
    await writeFile(path.join(ledger, 'items', `${id}.md`), source);
  }
  const provisioned = run(root, 'provision', '--ledger', ledger, '--json');
  assert.equal(provisioned.exit, 0, provisioned.stdout);
  const namespace = provisioned.envelope.result.ledger_namespace;
  // One claim-verify materializes the tracked reconciliation log, exactly as
  // the documented loop does before the first mutation.
  const verified = run(root, 'claim-verify', '--ledger', ledger, '--json');
  assert.equal(verified.exit, 0, verified.stdout);
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'Provision the ledger');
  assert.equal(git(root, 'status', '--porcelain=v1', '--untracked-files=all'), '');
  return {
    base,
    head: git(root, 'rev-parse', 'HEAD'),
    ledger,
    logPath: `.wowbagger/reconcile-${namespace}.md`,
    namespace,
    root,
    sources,
  };
}

export async function requestFile(fixture, name, value) {
  const file = path.join(fixture.base, name);
  await writeFile(file, JSON.stringify(value));
  return file;
}

export function transitionRequest(fixture, id = ITEM_ID, overrides = {}) {
  return {
    id,
    expected_revision: sha256(fixture.sources.get(id)),
    to_status: 'in-progress',
    date: '2026-08-17',
    ...overrides,
  };
}

export function patchRequest(fixture, id = ITEM_ID, overrides = {}) {
  return {
    id,
    expected_revision: sha256(fixture.sources.get(id)),
    date: '2026-08-17',
    set: { priority: 40 },
    ...overrides,
  };
}

export function createRequest(id, overrides = {}) {
  return {
    id,
    title: 'Created by auto-commit',
    kind: 'task',
    body: 'Created.\n',
    date: '2026-08-17',
    provenance: { source: 'fixture/auto-commit', recorded_at: '2026-08-17T00:00:00Z' },
    ...overrides,
  };
}

// The paths a commit touched, ledger-relative and sorted, for one commit.
export function committedPaths(fixture, commit) {
  const names = git(fixture.root, 'diff-tree', '--no-commit-id', '--name-only', '-r', commit);
  return names === '' ? [] : names.split('\n').map((name) => name.replace(/^ledger\//u, '')).sort();
}

export async function ledgerFile(fixture, relativePath) {
  return readFile(path.join(fixture.ledger, relativePath), 'utf8');
}
