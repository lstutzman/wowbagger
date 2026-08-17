import assert from 'node:assert/strict';
import test from 'node:test';

import { planVersionSites, verifyExactSets } from '../scripts/lib/release-sites.js';

const OLD = '9.9.0-alpha.6';
const NEW = '9.9.0-alpha.7';

function manifest(sites) {
  return { manifest_version: 1, sites };
}

test('planning refuses a tracked file that carries the old version with no manifest locator', () => {
  const plan = planVersionSites({
    manifest: manifest([
      {
        file: 'package.json',
        kind: 'json-pointer',
        pointer: '/version',
        classification: 'mutable',
        occurrences: 1,
      },
    ]),
    files: new Map([
      ['package.json', `{\n  "version": "${OLD}"\n}\n`],
      ['docs/new-note.md', `Pinned at ${OLD} by hand.\n`],
    ]),
    oldVersion: OLD,
    newVersion: NEW,
  });

  assert.equal(plan.ok, false);
  assert.deepEqual(
    plan.problems.map(({ code, file }) => [code, file]),
    [['unmanifested-occurrence', 'docs/new-note.md']],
  );
});

const README = [
  `Install \`wowbagger@${OLD}\` today.`,
  '',
  `    npm install -g github:lstutzman/wowbagger#v${OLD}`,
  '',
].join('\n');

const README_SITE = {
  file: 'README.md',
  kind: 'anchored-text',
  anchor: 'Install `wowbagger@{version}` today.',
  classification: 'mutable',
  occurrences: 1,
};

const README_REF_SITE = {
  file: 'README.md',
  kind: 'anchored-text',
  anchor: 'github:lstutzman/wowbagger#v{version}',
  classification: 'mutable',
  occurrences: 1,
};

function readmeFiles() {
  return new Map([['README.md', README]]);
}

test('a locator that matches fewer occurrences than it declares refuses the plan', () => {
  const plan = planVersionSites({
    manifest: manifest([README_SITE, { ...README_REF_SITE, occurrences: 2 }]),
    files: readmeFiles(),
    oldVersion: OLD,
    newVersion: NEW,
  });

  assert.equal(plan.ok, false);
  assert.deepEqual(plan.problems.map(({ code }) => code), ['locator-count-mismatch']);
});

test('a locator whose anchor no longer appears refuses the plan', () => {
  const plan = planVersionSites({
    manifest: manifest([
      README_SITE,
      README_REF_SITE,
      {
        file: 'README.md',
        kind: 'anchored-text',
        anchor: 'reworded sentence about {version}',
        classification: 'mutable',
        occurrences: 1,
      },
    ]),
    files: readmeFiles(),
    oldVersion: OLD,
    newVersion: NEW,
  });

  assert.equal(plan.ok, false);
  assert.deepEqual(plan.problems.map(({ code }) => code), ['locator-count-mismatch']);
});

test('an over-broad locator that swallows another site refuses the plan', () => {
  const plan = planVersionSites({
    manifest: manifest([
      README_SITE,
      README_REF_SITE,
      { file: 'README.md', kind: 'anchored-text', anchor: '{version}', classification: 'mutable', occurrences: 2 },
    ]),
    files: readmeFiles(),
    oldVersion: OLD,
    newVersion: NEW,
  });

  assert.equal(plan.ok, false);
  assert.deepEqual(plan.problems.map(({ code }) => code), ['overlapping-locators', 'overlapping-locators']);
});

test('two locators that claim the same JSON pointer refuse the plan', () => {
  const site = {
    file: 'package.json',
    kind: 'json-pointer',
    pointer: '/version',
    classification: 'mutable',
    occurrences: 1,
  };
  const plan = planVersionSites({
    manifest: manifest([site, { ...site }]),
    files: new Map([['package.json', `{\n  "version": "${OLD}"\n}\n`]]),
    oldVersion: OLD,
    newVersion: NEW,
  });

  assert.equal(plan.ok, false);
  assert.deepEqual(plan.problems.map(({ code }) => code), ['overlapping-locators']);
});

test('a JSON pointer that resolves to a different occurrence count refuses the plan', () => {
  const plan = planVersionSites({
    manifest: manifest([{
      file: 'package.json',
      kind: 'json-pointer',
      pointer: '/version',
      classification: 'mutable',
      occurrences: 2,
    }]),
    files: new Map([['package.json', `{\n  "version": "${OLD}"\n}\n`]]),
    oldVersion: OLD,
    newVersion: NEW,
  });

  assert.equal(plan.ok, false);
  assert.deepEqual(plan.problems.map(({ code }) => code), ['locator-count-mismatch']);
});

test('a JSON pointer that resolves to nothing refuses the plan', () => {
  const plan = planVersionSites({
    manifest: manifest([{
      file: 'package.json',
      kind: 'json-pointer',
      pointer: '/renamed',
      classification: 'mutable',
      occurrences: 1,
    }]),
    files: new Map([['package.json', `{\n  "version": "${OLD}"\n}\n`]]),
    oldVersion: OLD,
    newVersion: NEW,
  });

  assert.equal(plan.ok, false);
  assert.deepEqual(plan.problems.map(({ code }) => code).sort(), ['locator-count-mismatch']);
});

test('an occurrence the manifest misses inside a covered file refuses the plan', () => {
  const plan = planVersionSites({
    manifest: manifest([README_SITE, README_REF_SITE]),
    files: new Map([['README.md', `${README}\nAlso pinned at ${OLD} by hand.\n`]]),
    oldVersion: OLD,
    newVersion: NEW,
  });

  assert.equal(plan.ok, false);
  assert.deepEqual(
    plan.problems.map(({ code, file }) => [code, file]),
    [['unmanifested-occurrence', 'README.md']],
  );
});

test('a JSON value that names the outgoing version with no pointer refuses the plan', () => {
  const plan = planVersionSites({
    manifest: manifest([{
      file: '.claude-plugin/marketplace.json',
      kind: 'json-pointer',
      pointer: '/metadata/version',
      classification: 'mutable',
      occurrences: 1,
    }]),
    files: new Map([[
      '.claude-plugin/marketplace.json',
      `${JSON.stringify({ metadata: { version: OLD }, plugins: [{ ref: `v${OLD}` }] }, null, 2)}\n`,
    ]]),
    oldVersion: OLD,
    newVersion: NEW,
  });

  assert.equal(plan.ok, false);
  assert.deepEqual(
    plan.problems.map(({ code, detail }) => [code, detail.includes('/plugins/0/ref')]),
    [['unmanifested-occurrence', true]],
  );
});

test('a version literal in a JSON key, which no pointer can claim, refuses the plan', () => {
  const document = { [`notes-${OLD}`]: 'historical', version: OLD };
  const plan = planVersionSites({
    manifest: manifest([{
      file: 'package.json',
      kind: 'json-pointer',
      pointer: '/version',
      classification: 'mutable',
      occurrences: 1,
    }]),
    files: new Map([['package.json', `${JSON.stringify(document, null, 2)}\n`]]),
    oldVersion: OLD,
    newVersion: NEW,
  });

  assert.equal(plan.ok, false);
  assert.deepEqual(plan.problems.map(({ code }) => code), ['unmanifested-occurrence']);
  assert.match(plan.problems[0].detail, /outside string values/);
});

test('a JSON release site that is not canonical two-space JSON refuses the plan', () => {
  const plan = planVersionSites({
    manifest: manifest([{
      file: 'package.json',
      kind: 'json-pointer',
      pointer: '/version',
      classification: 'mutable',
      occurrences: 1,
    }]),
    files: new Map([['package.json', `{"version":"${OLD}"}\n`]]),
    oldVersion: OLD,
    newVersion: NEW,
  });

  assert.equal(plan.ok, false);
  assert.deepEqual(plan.problems.map(({ code }) => code), ['json-not-canonical']);
});

test('a manifest locator naming a file the tree does not track refuses the plan', () => {
  const plan = planVersionSites({
    manifest: manifest([README_SITE, README_REF_SITE, {
      file: 'gone.md',
      kind: 'anchored-text',
      anchor: 'pinned {version}',
      classification: 'retained',
      occurrences: 1,
    }]),
    files: readmeFiles(),
    oldVersion: OLD,
    newVersion: NEW,
  });

  assert.equal(plan.ok, false);
  assert.deepEqual(plan.problems.map(({ code, file }) => [code, file]), [['missing-site-file', 'gone.md']]);
});

test('a site pinned to another version is dormant and covers nothing', () => {
  const files = new Map([
    ['README.md', README],
    ['docs/ideation/note.md', `Recorded against 9.9.0-alpha.5 on the day.\n`],
  ]);
  const sites = [README_SITE, README_REF_SITE, {
    file: 'docs/ideation/note.md',
    kind: 'anchored-text',
    anchor: 'Recorded against {version} on the day.',
    classification: 'retained',
    occurrences: 1,
    applies_to_version: '9.9.0-alpha.5',
  }];

  const dormant = planVersionSites({ manifest: manifest(sites), files, oldVersion: OLD, newVersion: NEW });
  assert.equal(dormant.ok, true, JSON.stringify(dormant.problems));
  assert.equal(dormant.retainedOccurrences, 0);

  const active = planVersionSites({
    manifest: manifest(sites),
    files,
    oldVersion: '9.9.0-alpha.5',
    newVersion: OLD,
  });
  assert.deepEqual(active.problems.map(({ code, file }) => [code, file]), [
    ['locator-count-mismatch', 'README.md'],
    ['locator-count-mismatch', 'README.md'],
  ]);
  assert.equal(active.retainedOccurrences, 1);
});

test('a covered tree plans exactly the mutable bytes and leaves retained text alone', () => {
  const changelog = `## Unreleased\n\n## ${OLD} - 2026-08-17\n\n- shipped\n`;
  const plan = planVersionSites({
    manifest: manifest([
      README_SITE,
      README_REF_SITE,
      {
        file: 'package.json',
        kind: 'json-pointer',
        pointer: '/version',
        classification: 'mutable',
        occurrences: 1,
      },
      {
        file: 'CHANGELOG.md',
        kind: 'anchored-text',
        anchor: '## {version} - ',
        classification: 'retained',
        occurrences: 1,
      },
    ]),
    files: new Map([
      ['README.md', README],
      ['package.json', `{\n  "version": "${OLD}"\n}\n`],
      ['CHANGELOG.md', changelog],
    ]),
    oldVersion: OLD,
    newVersion: NEW,
  });

  assert.equal(plan.ok, true, JSON.stringify(plan.problems));
  assert.equal(plan.mutableOccurrences, 3);
  assert.equal(plan.retainedOccurrences, 1);
  assert.equal(plan.updates.get('README.md'), README.replaceAll(OLD, NEW));
  assert.equal(plan.updates.get('package.json'), `{\n  "version": "${NEW}"\n}\n`);
  assert.equal(plan.updates.has('CHANGELOG.md'), false, 'a retained-only file is never rewritten');
});

test('exact-set verification refuses a survivor of the outgoing version', () => {
  const passing = verifyExactSets({
    files: new Map([['a.md', `${NEW} and ${OLD}\n`]]),
    oldVersion: OLD,
    newVersion: NEW,
    expectedOld: 1,
    expectedNew: 1,
  });
  assert.equal(passing.ok, true);

  const stale = verifyExactSets({
    files: new Map([['a.md', `${NEW} and ${OLD}\n`], ['b.md', `${OLD}\n`]]),
    oldVersion: OLD,
    newVersion: NEW,
    expectedOld: 1,
    expectedNew: 1,
  });
  assert.equal(stale.ok, false);
  assert.deepEqual(stale.problems.map(({ code }) => code), ['retained-set-mismatch']);

  const short = verifyExactSets({
    files: new Map([['a.md', `${OLD}\n`]]),
    oldVersion: OLD,
    newVersion: NEW,
    expectedOld: 1,
    expectedNew: 1,
  });
  assert.deepEqual(short.problems.map(({ code }) => code), ['mutable-set-mismatch']);
});

test('a malformed manifest refuses before any file is read', () => {
  const plan = planVersionSites({
    manifest: manifest([{
      file: 'README.md',
      kind: 'anchored-text',
      anchor: 'no placeholder here',
      classification: 'mutable',
      occurrences: 1,
    }]),
    files: readmeFiles(),
    oldVersion: OLD,
    newVersion: NEW,
  });

  assert.equal(plan.ok, false);
  assert.deepEqual(plan.problems.map(({ code }) => code), ['manifest-invalid']);
});
