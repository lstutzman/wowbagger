import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runCli } from './support.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const pluginManifest = JSON.parse(
  readFileSync(path.join(projectRoot, '.claude-plugin', 'plugin.json'), 'utf8'),
);
const marketplaceManifest = JSON.parse(
  readFileSync(path.join(projectRoot, '.claude-plugin', 'marketplace.json'), 'utf8'),
);
const installedSkill = readFileSync(path.join(projectRoot, 'skills', 'wowbagger', 'SKILL.md'), 'utf8');
const installedWorkClaimContract = readFileSync(
  path.join(projectRoot, 'docs', 'work-claim-contract.md'),
  'utf8',
);

test('the npm package is public and installable under the wowbagger name', () => {
  assert.equal(manifest.name, 'wowbagger');
  assert.notEqual(manifest.private, true, 'a public distribution must not be private');
  assert.equal(manifest.bin.wowbagger, 'bin/wowbagger.js');
  assert.ok(manifest.files.includes('bin'), 'bin must ship');
  assert.ok(manifest.files.includes('src'), 'src must ship');
  assert.equal(typeof manifest.dependencies.yaml, 'string', 'yaml runtime dependency required');
});

test('the published binary prints the distribution version', () => {
  const result = runCli('--version');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `${manifest.version}\n`);
});

test('the npm package, plugin, and marketplace publish one distribution version', () => {
  const marketplacePlugin = marketplaceManifest.plugins.find(({ name }) => name === manifest.name);

  assert.equal(pluginManifest.version, manifest.version);
  assert.equal(marketplaceManifest.metadata.version, manifest.version);
  assert.equal(marketplacePlugin?.version, manifest.version);
});

test('the marketplace installs the plugin from its immutable release tag', () => {
  const marketplacePlugin = marketplaceManifest.plugins.find(({ name }) => name === manifest.name);

  assert.equal(marketplacePlugin?.source.ref, `v${manifest.version}`);
});

test('the installed skill defines the lifecycle signal for claimed work', () => {
  assert.match(installedSkill, /active claim is the work-in-flight signal/i);
  assert.match(installedSkill, /item stays in `backlog` while claimed work runs/i);
});

test('the npm package ships every contract document referenced by the installed skill', () => {
  for (const contract of ['docs/mutation-contract.md', 'docs/work-claim-contract.md']) {
    assert.match(installedSkill, new RegExp(contract.replaceAll('.', '\\.')));
    assert.ok(manifest.files.includes(contract), `${contract} must ship`);
  }
});

test('the npm package ships the documented schema version 2 migration entrypoint', () => {
  assert.ok(
    manifest.files.includes('scripts/migrate-schema-2.js'),
    'scripts/migrate-schema-2.js must ship',
  );
  assert.notEqual(
    statSync(path.join(projectRoot, 'scripts', 'migrate-schema-2.js')).mode & 0o111,
    0,
    'scripts/migrate-schema-2.js must be executable',
  );
});

test('the installed contract distinguishes reconciliation from Git finalization', () => {
  assert.match(
    installedWorkClaimContract,
    /top-level `state: "committed"` describes durable reconciliation state/i,
  );
  assert.match(
    installedWorkClaimContract,
    /gate Git\s+completion on.*`git_finalized`.*`git_commit`/is,
  );
});

test('the release gate rejects plugin bytes that differ from the version tag', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'wb-release-gate-'));
  mkdirSync(path.join(root, '.claude-plugin'));
  mkdirSync(path.join(root, 'skills', 'wowbagger'), { recursive: true });
  writeFileSync(path.join(root, 'package.json'), '{"name":"wowbagger","version":"1.2.3"}\n');
  writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), '{"name":"wowbagger","version":"1.2.3"}\n');
  writeFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), JSON.stringify({
    name: 'wowbagger',
    owner: { name: 'Test' },
    metadata: { version: '1.2.3' },
    plugins: [{
      name: 'wowbagger',
      source: {
        source: 'url',
        url: 'https://example.com/wowbagger.git',
        ref: 'v1.2.3',
      },
      version: '1.2.3',
    }],
  }));
  writeFileSync(path.join(root, 'skills', 'wowbagger', 'SKILL.md'), 'released\n');
  for (const argumentsList of [
    ['init', '-q'],
    ['config', 'user.email', 'test@example.com'],
    ['config', 'user.name', 'Wowbagger Test'],
    ['add', '.'],
    ['commit', '-qm', 'Release'],
    ['tag', 'v1.2.3'],
  ]) {
    const result = spawnSync('git', argumentsList, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  const script = path.join(projectRoot, 'scripts', 'verify-release-tag.js');
  const matching = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
  assert.equal(matching.status, 0, matching.stderr);

  writeFileSync(path.join(root, 'skills', 'wowbagger', 'SKILL.md'), 'changed\n');
  const drifted = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });

  assert.equal(drifted.status, 1);
  assert.match(drifted.stderr, /Release checkout differs from v1\.2\.3/);
});

test('a broken package cannot ship: prepublishOnly refuses a failed validation', () => {
  assert.ok(manifest.scripts.prepublishOnly, 'prepublishOnly guard must exist');
  assert.match(manifest.scripts.prepublishOnly, /validate --ledger ledger --json/);
  assert.match(manifest.scripts.prepublishOnly, /verify-release-tag\.js/);
});

test('the package manifest does not admit unpublished or internal directories', () => {
  for (const forbidden of ['test', 'spec', 'ledger', 'docs', '.claude']) {
    assert.ok(!manifest.files.includes(forbidden), `files must not include ${forbidden}`);
  }
  assert.ok(!manifest.private, 'no private flag');
});
