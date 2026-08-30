import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));

// One installed consumer serves every launch assertion below. Packing and
// installing the real tarball is the only honest proof that a host can resolve
// the core through a published seam: a repository-relative import proves
// nothing about what npm actually ships.
let installed;

function npmRun(args, cwd, message) {
  const result = spawnSync('npm', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === 'win32',
  });
  assert.equal(result.status, 0, `${message}\n${result.stderr}`);
  return result;
}

function packTarball(target, destination, message) {
  const packed = npmRun(
    ['pack', target, '--ignore-scripts', '--pack-destination', destination, '--json'],
    projectRoot,
    message,
  );
  return path.join(destination, JSON.parse(packed.stdout)[0].filename);
}

function installConsumer() {
  if (installed) return installed;
  const root = mkdtempSync(path.join(tmpdir(), 'wb-host-launch-'));
  const tarball = packTarball('.', root, 'packing the distribution tarball failed');

  // Every declared runtime dependency is packed straight out of the project's
  // own `node_modules`, so the nested install resolves a local file for each
  // one and never needs registry metadata. `npm ci` caches package tarballs
  // but not their packuments, so resolving `yaml@^2.9.0` by range under
  // `--offline` fails with ENOTCACHED on a machine — or a CI runner — whose
  // cache only ever saw `npm ci`.
  const dependencyTarballs = Object.keys(manifest.dependencies).map((name) => {
    const installedDependency = path.join(projectRoot, 'node_modules', name);
    assert.ok(
      existsSync(installedDependency),
      `${name} is a declared runtime dependency but is not installed; run \`npm install\` at the project root first`,
    );
    return packTarball(`./node_modules/${name}`, root, `packing ${name} failed`);
  });

  const consumer = path.join(root, 'consumer');
  mkdirSync(consumer);
  writeFileSync(
    path.join(consumer, 'package.json'),
    `${JSON.stringify({ name: 'wb-host-consumer', version: '0.0.0', private: true, type: 'module' }, null, 2)}\n`,
  );
  // `--offline` and not `--prefer-offline`: the install must complete from
  // local files alone. A network fallback would make this test pass or fail on
  // connectivity, which is not what it exists to prove.
  npmRun(
    ['install', '--offline', '--no-audit', '--no-fund', ...dependencyTarballs, tarball],
    consumer,
    'the offline consumer install failed; run `npm install` at the project root first',
  );
  installed = { root, consumer };
  return installed;
}

// Every probe runs inside the installed consumer so that resolution goes
// through the package's own `exports`, exactly as a host plugin's would.
function runInConsumer(source) {
  const { consumer } = installConsumer();
  const script = path.join(consumer, `probe-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(script, source);
  const result = spawnSync(process.execPath, [script], {
    cwd: consumer,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

test('the package publishes a documented launch seam and keeps deep imports resolvable', () => {
  assert.ok(manifest.exports, 'package.json must publish an exports map');
  assert.equal(manifest.exports['.'], './src/launch.js');
  assert.equal(manifest.exports['./launch'], './src/launch.js');
  assert.equal(manifest.exports['./wowbagger.js'], './bin/wowbagger.js');
  assert.equal(manifest.exports['./package.json'], './package.json');
  // The catch-all keeps every path a consumer could already deep-import
  // resolvable; adding `exports` without it would silently break them.
  assert.equal(manifest.exports['./*'], './*');
});

test('an installed consumer resolves the core script and its own package.json', () => {
  const observed = runInConsumer(`
    import { CORE_SCRIPT_PATH } from 'wowbagger';
    import { existsSync } from 'node:fs';
    import { fileURLToPath } from 'node:url';
    import { isAbsolute } from 'node:path';
    const resolved = fileURLToPath(import.meta.resolve('wowbagger/wowbagger.js'));
    const manifestUrl = import.meta.resolve('wowbagger/package.json');
    const { default: pkg } = await import(manifestUrl, { with: { type: 'json' } });
    process.stdout.write(JSON.stringify({
      script: CORE_SCRIPT_PATH,
      absolute: isAbsolute(CORE_SCRIPT_PATH),
      exists: existsSync(CORE_SCRIPT_PATH),
      sameAsSubpath: resolved === CORE_SCRIPT_PATH,
      name: pkg.name,
      engines: pkg.engines.node,
    }));
  `);

  assert.equal(observed.absolute, true);
  assert.equal(observed.exists, true);
  assert.equal(observed.sameAsSubpath, true);
  assert.equal(observed.name, 'wowbagger');
  assert.equal(observed.engines, '>=24');
});

test('the resolved launch tuple runs the core without a shell', () => {
  const observed = runInConsumer(`
    import { resolveCoreLaunch } from 'wowbagger';
    import { spawnSync } from 'node:child_process';
    import { isAbsolute } from 'node:path';
    const launch = resolveCoreLaunch(['capabilities', '--json']);
    const run = spawnSync(launch.executable, launch.args, {
      shell: launch.shell,
      encoding: 'utf8',
      input: '',
    });
    process.stdout.write(JSON.stringify({
      executableAbsolute: isAbsolute(launch.executable),
      executableIsThisNode: launch.executable === process.execPath,
      shell: launch.shell,
      argvHead: launch.args[0],
      argvTail: launch.args.slice(1),
      status: run.status,
      response: JSON.parse(run.stdout),
    }));
  `);

  assert.equal(observed.executableAbsolute, true);
  assert.equal(observed.executableIsThisNode, true);
  assert.equal(observed.shell, false);
  assert.match(observed.argvHead, /wowbagger\.js$/);
  assert.deepEqual(observed.argvTail, ['capabilities', '--json']);
  assert.equal(observed.status, 0);
  assert.equal(observed.response.ok, true);
  assert.equal(observed.response.command, 'capabilities');
  assert.equal(observed.response.contract_version, 5);
});

test('the launch seam refuses a Node executable the host has not resolved to an absolute path', () => {
  const observed = runInConsumer(`
    import { resolveCoreLaunch } from 'wowbagger';
    let message = null;
    try {
      resolveCoreLaunch(['capabilities', '--json'], { nodeExecutable: 'node' });
    } catch (error) {
      message = error.message;
    }
    process.stdout.write(JSON.stringify({ message }));
  `);

  assert.match(observed.message, /absolute/i);
});

test('the installed package still answers a deep import', () => {
  const observed = runInConsumer(`
    const limits = await import('wowbagger/src/limits.js');
    process.stdout.write(JSON.stringify({
      list: limits.MAX_LIST_RESPONSE_BYTES,
      workbench: limits.MAX_WORKBENCH_RESPONSE_BYTES,
    }));
  `);

  assert.equal(observed.list, 131072);
  assert.equal(observed.workbench, 65536);
});

// The offline install has to resolve the whole runtime closure from the cache,
// so the installed tree is the honest place to assert what a host actually
// pays for: every declared runtime dependency present, and no devDependency
// dragged along behind it.
test('the installed consumer tree is the declared runtime closure and nothing more', () => {
  const { consumer } = installConsumer();
  const installedPackages = readdirSync(path.join(consumer, 'node_modules'))
    .filter((entry) => !entry.startsWith('.'))
    .sort();

  assert.deepEqual(installedPackages, ['wowbagger', ...Object.keys(manifest.dependencies)].sort());
  for (const devDependency of Object.keys(manifest.devDependencies)) {
    assert.ok(
      !installedPackages.includes(devDependency),
      `${devDependency} is a devDependency and must not reach a consumer install`,
    );
  }
});
