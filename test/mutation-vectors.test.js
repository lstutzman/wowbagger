import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const cli = fileURLToPath(new URL('../bin/wowbagger.js', import.meta.url));
const fixtureRoot = fileURLToPath(new URL('../spec/fixtures/mutations/', import.meta.url));

for (const vector of await loadVectors()) {
  test(`mutation vector: ${vector.manifest.case}`, async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-vector-'));
    const sandbox = path.join(temporaryDirectory, 'fixture');

    try {
      await cp(vector.directory, sandbox, { recursive: true });
      await rm(path.join(sandbox, 'ledger'), { force: true, recursive: true });
      await materializeSnapshot(sandbox, vector.directory, vector.manifest.expected.files.before);

      const argumentsList = materializeArguments(vector.manifest.argv, sandbox);
      const input = await inputBytes(vector.manifest, sandbox);
      const result = spawnSync(process.execPath, [cli, ...argumentsList], {
        cwd: projectRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_ENV: 'test',
          WOWBAGGER_TEST_SCENARIO: vector.manifest.scenario,
        },
        input,
      });

      assert.equal(result.error, undefined, result.error?.message);
      assert.equal(result.status, vector.manifest.expected.exit, result.stderr);
      assert.equal(result.stderr, vector.manifest.expected.stderr.exact);
      const expectedOutput = JSON.stringify(JSON.parse(await readFile(
        path.join(sandbox, vector.manifest.expected.stdout.json_file),
        'utf8',
      )));
      assert.equal(result.stdout, `${expectedOutput}\n`);
      assert.equal(result.stdout.endsWith('\n'), vector.manifest.expected.stdout.trailing_lf);
      assert.deepEqual(
        await snapshotLedger(sandbox),
        await expectedSnapshot(vector.directory, vector.manifest.expected.files.after),
      );
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });
}

async function loadVectors() {
  const directories = await readdir(fixtureRoot, { withFileTypes: true });
  const vectors = [];
  for (const entry of directories.filter((candidate) => candidate.isDirectory()).sort(compareTextByName)) {
    const directory = path.join(fixtureRoot, entry.name);
    const files = await readdir(directory);
    for (const file of files.filter((name) => name.startsWith('manifest') && name.endsWith('.json')).sort()) {
      vectors.push({
        directory,
        manifest: JSON.parse(await readFile(path.join(directory, file), 'utf8')),
      });
    }
  }
  return vectors;
}

function compareTextByName(left, right) {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

function materializeArguments(argv, sandbox) {
  return argv.map((argument, index) => {
    if (argument === 'ledger') {
      return path.join(sandbox, 'ledger');
    }
    if (argv[index - 1] === '--input' && argument !== '-') {
      return path.join(sandbox, argument);
    }
    return argument;
  });
}

async function inputBytes(manifest, sandbox) {
  if (manifest.input.transport !== 'stdin') {
    return undefined;
  }
  return readFile(path.join(sandbox, manifest.input.path));
}

async function materializeSnapshot(sandbox, sourceRoot, entries) {
  for (const entry of entries) {
    const destination = path.join(sandbox, entry.path);
    if (entry.type === 'directory') {
      await mkdir(destination, { recursive: true });
      continue;
    }
    await mkdir(path.dirname(destination), { recursive: true });
    const source = path.join(sourceRoot, entry.source_file ?? entry.path);
    await writeFile(destination, await readFile(source));
  }
  await mkdir(path.join(sandbox, 'ledger'), { recursive: true });
}

async function expectedSnapshot(sourceRoot, entries) {
  const snapshot = [];
  for (const entry of entries) {
    if (entry.type === 'directory') {
      snapshot.push({ type: 'directory', path: entry.path });
      continue;
    }
    const bytes = await readFile(path.join(sourceRoot, entry.source_file ?? entry.path));
    snapshot.push({
      type: 'file',
      path: entry.path,
      sha256: revisionFor(bytes),
    });
  }
  return snapshot.sort(compareSnapshot);
}

async function snapshotLedger(sandbox) {
  const root = path.join(sandbox, 'ledger');
  const snapshot = [];
  await collect(root, 'ledger', snapshot);
  return snapshot.sort(compareSnapshot);
}

async function collect(directory, displayPath, snapshot) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort(compareTextByName)) {
    const file = path.join(directory, entry.name);
    const display = `${displayPath}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === '.wowbagger-locks') {
        const contents = await readdir(file);
        if (contents.length === 0) {
          continue;
        }
      }
      if (entry.name.endsWith('.md')) {
        snapshot.push({ type: 'directory', path: display });
      }
      await collect(file, display, snapshot);
      continue;
    }
    if (entry.isFile()) {
      const bytes = await readFile(file);
      snapshot.push({ type: 'file', path: display, sha256: revisionFor(bytes) });
      continue;
    }
    const stat = await lstat(file);
    snapshot.push({ type: stat.isSymbolicLink() ? 'symlink' : 'other', path: display });
  }
}

function revisionFor(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function compareSnapshot(left, right) {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : left.type < right.type ? -1 : left.type > right.type ? 1 : 0;
}
