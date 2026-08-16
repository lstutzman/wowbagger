import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// The report inlines a third-party build. Pinning the digest here, in the
// test rather than only beside the file, is what makes the manifest a claim
// somebody can falsify: a swapped bundle and a rewritten manifest both go red.
const PINNED_PACKAGE = '3d-force-graph';
const PINNED_VERSION = '1.80.0';
const PINNED_SHA256 = 'd96e738edcca580edd524730c1c6b05ed2efce028c23ca95db1bf43033a72e42';

const vendorDirectory = new URL('../vendor/3d-force-graph/', import.meta.url);

async function readManifest() {
  return JSON.parse(await readFile(new URL('VERSIONS.json', vendorDirectory), 'utf8'));
}

test('the vendored bundle records the exact upstream package and version', async () => {
  const manifest = await readManifest();

  assert.equal(manifest.package, PINNED_PACKAGE);
  assert.equal(manifest.version, PINNED_VERSION);
  assert.equal(manifest.file, '3d-force-graph.min.js');
});

test('the vendored bundle bytes match the recorded sha256', async () => {
  const manifest = await readManifest();
  const bytes = await readFile(new URL(manifest.file, vendorDirectory));

  assert.equal(createHash('sha256').update(bytes).digest('hex'), PINNED_SHA256);
  assert.equal(manifest.sha256, PINNED_SHA256);
});

test('the vendored bundle names the Three.js build it carries', async () => {
  const manifest = await readManifest();
  const three = manifest.includes.find((entry) => entry.package === 'three');

  assert.equal(three?.revision, '183');
  assert.equal(manifest.license, 'MIT');
});

test('the vendored bundle fetches nothing at view time', async () => {
  const manifest = await readManifest();
  const source = await readFile(new URL(manifest.file, vendorDirectory), 'utf8');

  assert.doesNotMatch(source, /XMLHttpRequest|new Worker\(|import\(|importScripts/);
  assert.doesNotMatch(source, /<\/script/i, 'an inlined bundle must not close its own script element');
});

test('the vendored bundle ships in the npm distribution', async () => {
  const manifest = JSON.parse(await readFile(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));

  assert.ok(manifest.files.includes('vendor'), 'vendor must ship or report breaks when installed');
});

test('the report contract and the skill both document the graph the report carries', async () => {
  const root = new URL('../', import.meta.url);
  const readme = await readFile(new URL('README.md', root), 'utf8');
  const skill = await readFile(new URL('skills/wowbagger/SKILL.md', root), 'utf8');

  for (const [name, source] of [['README', readme], ['SKILL', skill]]) {
    assert.match(source, /3d-force-graph/, `${name} must name the vendored renderer`);
    assert.match(source, /vendor\/3d-force-graph/, `${name} must point at the vendored build`);
    assert.match(source, /WebGL/, `${name} must state what happens without WebGL`);
  }
  assert.match(readme, /1\.80\.0/, 'README must pin the vendored version it documents');
});
