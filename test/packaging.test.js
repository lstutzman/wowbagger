import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runCli } from './support.js';
import { readTrackedTextFiles } from '../scripts/cut-release.js';
import { countOccurrences, planVersionSites, verifyExactSets } from '../scripts/lib/release-sites.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const pluginManifest = JSON.parse(
  readFileSync(path.join(projectRoot, '.claude-plugin', 'plugin.json'), 'utf8'),
);
const marketplaceManifest = JSON.parse(
  readFileSync(path.join(projectRoot, '.claude-plugin', 'marketplace.json'), 'utf8'),
);
const readme = readFileSync(path.join(projectRoot, 'README.md'), 'utf8');
const installedSkill = readFileSync(path.join(projectRoot, 'skills', 'wowbagger', 'SKILL.md'), 'utf8');
const installedWorkClaimContract = readFileSync(
  path.join(projectRoot, 'docs', 'work-claim-contract.md'),
  'utf8',
);
const installedMutationContract = readFileSync(
  path.join(projectRoot, 'docs', 'mutation-contract.md'),
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

test('published README points prerelease consumers at the current tag and channel', () => {
  const channel = manifest.version.includes('-') ? 'next' : 'latest';
  const releaseTagVersions = [...readme.matchAll(
    /github:lstutzman\/wowbagger#v([0-9A-Za-z.-]+)/g,
  )].map((match) => match[1]);

  assert.deepEqual(new Set(releaseTagVersions), new Set([manifest.version]));
  assert.match(readme, new RegExp(`npm install -g wowbagger@${channel}\\s+# public npm registry`));
});

test('the installed skill defines the lifecycle signal for claimed work', () => {
  assert.match(installedSkill, /active claim is the work-in-flight signal/i);
  assert.match(installedSkill, /item stays in `backlog` while claimed work runs/i);
});

test('the installed mutation contract derives the create path from layout and prescribes no rename', () => {
  const create = installedMutationContract.slice(
    installedMutationContract.indexOf('## 7. Create'),
    installedMutationContract.indexOf('## 8. Transition'),
  );

  assert.match(create, /`?<ledger>\/\.wowbagger\/layout\.json`?/);
  assert.match(create, /"layout_version":\s*1/);
  assert.match(create, /"items_directory"/);
  assert.match(create, /<ledger>\/<items_directory>\/<id>\.md/);
  assert.match(create, /<ledger>\/<id>\.md/);
  assert.doesNotMatch(installedMutationContract, /rename the (file|item) .*after/i);
  assert.doesNotMatch(installedMutationContract, /naming convention is applied by Git rename/i);
});

test('the published README states the layout binding as ledger setup, before the first create', () => {
  const setup = readme.slice(readme.indexOf('## Start here'), readme.indexOf('## Why the name?'));

  assert.match(setup, /`?<ledger>\/\.wowbagger\/layout\.json`?/);
  assert.match(setup, /"layout_version":\s*1/);
  assert.match(setup, /"items_directory":\s*"items"/);
  assert.match(setup, /<items_directory>\/<id>\.md/);
  assert.match(setup, /before .*first `?create`?/i);
  assert.match(setup, /`?0\.1\.0-alpha\.4`? and earlier ignore/i);
});

test('the installed skill states the layout binding that decides where create publishes', () => {
  assert.match(installedSkill, /`<ledger>\/\.wowbagger\/layout\.json`/);
  assert.match(installedSkill, /layout_version/);
  assert.match(installedSkill, /items_directory/);
  assert.match(installedSkill, /<items_directory>\/<id>\.md/);
  assert.match(installedSkill, /`?0\.1\.0-alpha\.4`? and earlier ignore/i);
});

// Field trap 7a: four of five PropertyCompass2 creates landed at the ledger
// root because `git mv` refused the untracked file create had just written and
// the unchecked `git add -A` behind it committed the item where it lay.
for (const [surface, text] of [
  ['published README', () => readme],
  ['installed skill', () => installedSkill],
]) {
  test(`the ${surface} warns that git mv refuses a freshly created item`, () => {
    const source = text();
    const trap = source.slice(source.indexOf('0.1.0-alpha.4` and earlier ignore'));

    assert.match(trap, /`git mv`/);
    assert.match(trap, /untracked/i);
    assert.match(trap, /`git add -A`/);
    assert.match(trap, /commits? .*at the ledger root/i);
    assert.match(trap, /`mv`.*then.*`git add`/is);
    assert.match(trap, /exit\s+code/i);
  });
}

// The README carried "196 assertions across all 15 cases" for three releases
// after the vectors grew to 200. Nothing counted, so nothing noticed. The
// evidence claim is now read from the vectors it claims to describe.
test('the published README states the conformance evidence the vectors actually carry', () => {
  const vectorRoot = path.join(projectRoot, 'spec', 'fixtures', 'adapters');
  const cases = readdirSync(vectorRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => JSON.parse(
      readFileSync(path.join(vectorRoot, entry.name, 'manifest.json'), 'utf8'),
    ));
  const assertions = cases.reduce((total, { assertions: list }) => total + list.length, 0);
  const claimed = [...readme.matchAll(/(\d+)\s+(?:native\s+)?assertions/g)].map(([, count]) => count);

  assert.match(readme, new RegExp(`all ${assertions} assertions across all ${cases.length}\\s+cases`));
  assert.ok(claimed.length > 0, 'the README must state the conformance evidence');
  assert.deepEqual(
    new Set(claimed),
    new Set([String(assertions)]),
    'every assertion count in the README must be the count the vectors carry',
  );
});

test('the npm package ships every contract document referenced by the installed skill', () => {
  for (const contract of ['docs/mutation-contract.md', 'docs/work-claim-contract.md']) {
    assert.match(installedSkill, new RegExp(contract.replaceAll('.', '\\.')));
    assert.ok(manifest.files.includes(contract), `${contract} must ship`);
  }
});

test('the npm tarball ships all public contracts with every adapter executable', () => {
  const packed = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: projectRoot,
    encoding: 'utf8',
    // On win32 `npm` is a `.cmd`, and since Node 20.12 a batch file cannot be
    // spawned without a shell at all. The arguments are fixed literals, so
    // there is nothing here for a shell to reinterpret.
    shell: process.platform === 'win32',
  });
  assert.equal(packed.status, 0, packed.stderr);
  const files = new Set(JSON.parse(packed.stdout)[0].files.map(({ path: file }) => file));

  for (const contract of [
    'docs/adapter-contract.md',
    'docs/mutation-contract.md',
    'docs/work-claim-contract.md',
  ]) {
    assert.ok(files.has(contract), `${contract} must ship`);
  }
  for (const adapter of ['claude-code', 'codex', 'opencode']) {
    assert.ok(files.has(`adapters/${adapter}/entrypoint.js`), `${adapter} entrypoint must ship`);
  }
  // A published schema a consumer cannot resolve from the installed package is
  // prose, so the index and every file it names have to be in the tarball.
  const index = JSON.parse(readFileSync(path.join(projectRoot, 'schemas', 'index.json'), 'utf8'));
  assert.ok(files.has('schemas/index.json'), 'the schema index must ship');
  for (const { file } of index.schemas) {
    assert.ok(files.has(`schemas/${file}`), `schemas/${file} must ship`);
  }
});

// A named view exists only in installed guidance: nothing in the artifact or the
// result tells a consumer that `--view` is available. The surfaces that state
// the contract therefore have to be shipped paths, not repository-only files.
test('the npm package ships the named report view contract', () => {
  for (const [file, text] of [
    ['README.md', readme],
    ['skills/wowbagger/SKILL.md', installedSkill],
    ['docs/mutation-contract.md', installedMutationContract],
  ]) {
    assert.ok(
      text.includes('report --ledger <dir> --view <name> --as-of YYYY-MM-DD --json'),
      `${file} must state the named view command`,
    );
    assert.match(text, /report_version: 2/, file);
    assert.ok(
      manifest.files.some((entry) => entry === file || file.startsWith(`${entry}/`)),
      `${file} must ship`,
    );
  }
});

test('the installed skill requires the core distribution that shipped with it', () => {
  const version = manifest.version.replaceAll('.', '\\.');

  assert.match(installedSkill, /wowbagger --version/);
  assert.match(installedSkill, new RegExp(`requires distribution version\\s+\`${version}\``));
  assert.match(installedSkill, /distribution version.*missing or.*different.*stop/is);
});

test('the npm package ships the documented schema version 2 migration entrypoint', () => {
  assert.ok(
    manifest.files.includes('scripts/migrate-schema-2.js'),
    'scripts/migrate-schema-2.js must ship',
  );
  // The executable bit is read from the Git index, not from the checkout.
  // Windows cannot express the bit in a file mode at all, so a stat there
  // reports no execute bit for a file the repository does record as executable.
  // The index is also the fact that travels: it is what a clone restores.
  const indexed = spawnSync('git', ['ls-files', '-s', '--', 'scripts/migrate-schema-2.js'], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  assert.equal(indexed.status, 0, indexed.stderr);
  assert.match(
    indexed.stdout,
    /^100755\s/,
    'scripts/migrate-schema-2.js must be recorded executable',
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

// Alpha.13 is immutable, so the only place an operator can learn what its
// generic unreadable-store refusal means is a shipped alpha.14 surface. Every
// installed surface therefore carries the literal envelope and the upgrade
// instruction, and the skill carries them before it teaches `create`.
// Hard-wrapped prose is matched against a whitespace-flattened copy so an
// assertion pins the sentence rather than the column the sentence broke at.
function flatten(text) {
  return text.replace(/\s+/gu, ' ');
}

const LEGACY_WRITER_EVIDENCE = [
  'claim-store-unavailable',
  'The durable claim store is unavailable.',
  'claim-store-unreadable',
  'upgrade every writer',
  'before the first alpha.14 create',
];

for (const [surface, text] of [
  ['installed skill', () => flatten(installedSkill)],
  ['installed work-claim contract', () => flatten(installedWorkClaimContract)],
  ['installed mutation contract', () => flatten(installedMutationContract)],
]) {
  test(`the ${surface} maps the alpha.13 refusal to the upgrade it needs`, () => {
    const source = text();

    for (const literal of LEGACY_WRITER_EVIDENCE) {
      assert.ok(source.includes(literal), `${surface} must state ${JSON.stringify(literal)}`);
    }
    assert.match(source, /exit 6/i);
    assert.match(source, /written by a newer Wowbagger/i);
  });
}

test('the installed skill states the hard cutover before it teaches create', () => {
  const source = flatten(installedSkill);
  const cutover = source.indexOf('before the first alpha.14 create');
  const writing = source.indexOf(' ## Writing ');

  assert.ok(cutover > 0, 'the skill must state the cutover');
  assert.ok(writing > 0, 'the skill must keep its writing section');
  assert.ok(
    cutover < writing,
    'the cutover requirement must precede the create workflow it gates',
  );
});

test('the installed skill teaches the supported bulk create pattern', () => {
  const source = flatten(installedSkill);

  assert.match(source, /no batch (?:mutation|operation)/i);
  assert.match(source, /create-then-commit loop/i);
  assert.match(source, /item #186/);
});

test('the installed skill routes an existing duplicate number to item #182', () => {
  const source = flatten(installedSkill);

  assert.match(source, /duplicate numbers?[^.]*item #182/u);
  assert.match(source, /no item file/i);
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

// The release-site manifest is the coverage proof for a cut. It is maintained
// by hand and the cut command never edits it, so its accuracy against the real
// tree is a standing packaging assertion rather than something a cut discovers.
test('the checked-in manifest classifies every occurrence of the current version exactly', () => {
  const sites = JSON.parse(
    readFileSync(path.join(projectRoot, 'scripts', 'release-version-sites.json'), 'utf8'),
  );
  const files = readTrackedTextFiles(projectRoot, (...argumentsList) => spawnSync(
    'git',
    argumentsList,
    { cwd: projectRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  ));
  let occurrences = 0;
  for (const text of files.values()) occurrences += countOccurrences(text, manifest.version);
  assert.ok(occurrences > 0, 'the tree must name its own version somewhere');

  // Assembled, not written literally: this file is one of the files scanned.
  const next = ['0.0.0', 'manifest', 'inventory'].join('-');
  const plan = planVersionSites({
    manifest: sites,
    files,
    oldVersion: manifest.version,
    newVersion: next,
  });

  assert.deepEqual(plan.problems, [], 'every occurrence must match exactly one locator');
  assert.equal(
    plan.mutableOccurrences + plan.retainedOccurrences,
    occurrences,
    'the manifest must account for every literal occurrence in the tree',
  );

  const planned = new Map(files);
  for (const [file, text] of plan.updates) planned.set(file, text);
  const proof = verifyExactSets({
    files: planned,
    oldVersion: manifest.version,
    newVersion: next,
    expectedOld: plan.retainedOccurrences,
    expectedNew: plan.mutableOccurrences,
  });

  assert.deepEqual(proof.problems, [], 'a planned cut must leave no second stale occurrence');
});


test('the cut and channel commands are wired as release scripts', () => {
  assert.match(manifest.scripts['release:cut'], /scripts\/cut-release\.js/);
  assert.match(manifest.scripts['release:channels'], /scripts\/release-channels\.js/);
});

test('the release gate rejects an absent tag and a tag on another commit', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'wb-release-tag-'));
  mkdirSync(path.join(root, '.claude-plugin'));
  writeFileSync(path.join(root, 'package.json'), '{"name":"wowbagger","version":"1.2.3"}\n');
  writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), '{"name":"wowbagger","version":"1.2.3"}\n');
  writeFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), JSON.stringify({
    name: 'wowbagger',
    metadata: { version: '1.2.3' },
    plugins: [{
      name: 'wowbagger',
      source: { source: 'url', url: 'https://example.com/wowbagger.git', ref: 'v1.2.3' },
      version: '1.2.3',
    }],
  }));
  for (const argumentsList of [
    ['init', '-q'],
    ['config', 'user.email', 'test@example.com'],
    ['config', 'user.name', 'Wowbagger Test'],
    ['add', '.'],
    ['commit', '-qm', 'First'],
    ['commit', '-q', '--allow-empty', '-m', 'Second'],
  ]) {
    const result = spawnSync('git', argumentsList, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  const script = path.join(projectRoot, 'scripts', 'verify-release-tag.js');

  const absent = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
  assert.equal(absent.status, 1);
  assert.match(absent.stderr, /Release tag v1\.2\.3 does not exist/);

  spawnSync('git', ['tag', 'v1.2.3', 'HEAD~1'], { cwd: root, encoding: 'utf8' });
  const misplaced = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
  assert.equal(misplaced.status, 1);
  assert.match(misplaced.stderr, /Release checkout differs from v1\.2\.3/);
});
