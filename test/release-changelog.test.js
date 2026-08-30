import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { rewriteChangelog } from '../scripts/lib/release-changelog.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

// Every shipped surface hard-wraps its prose, so these surfaces are read
// whitespace-flattened: the assertions pin sentences, never wrap columns.
function shipped(...segments) {
  return readFileSync(path.join(projectRoot, ...segments), 'utf8').replace(/\s+/gu, ' ');
}

const changelogText = shipped('CHANGELOG.md');
const workClaimContract = shipped('docs', 'work-claim-contract.md');
const mutationContract = shipped('docs', 'mutation-contract.md');
const installedSkill = shipped('skills', 'wowbagger', 'SKILL.md');
const distributionVersion = JSON.parse(
  readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
).version;

const PREAMBLE = '# Changelog\n\nBehaviour changes land here when they ship.\n\n';
const PREVIOUS = '## 9.9.0-alpha.6 - 2026-08-17\n\n### Added\n\n- the previous release\n';

function changelog(unreleasedBody) {
  return `${PREAMBLE}## Unreleased\n${unreleasedBody}\n${PREVIOUS}`;
}

test('a cut opens a fresh empty Unreleased above the released section', () => {
  const result = rewriteChangelog({
    text: changelog('\n### Added\n\n- the thing that is shipping\n'),
    version: '9.9.0-alpha.7',
    date: '2026-08-18',
  });

  assert.equal(result.ok, true, JSON.stringify(result.problems));
  assert.equal(
    result.text,
    `${PREAMBLE}## Unreleased\n\n## 9.9.0-alpha.7 - 2026-08-18\n\n`
      + `### Added\n\n- the thing that is shipping\n\n${PREVIOUS}`,
  );
});

test('the rewrite is not a rename: the released notes keep their body and Unreleased empties', () => {
  const result = rewriteChangelog({
    text: changelog('\n- a shipped behaviour change\n'),
    version: '9.9.0-alpha.7',
    date: '2026-08-18',
  });

  const sections = result.text.split(/^## /m).slice(1);
  assert.equal(sections[0].trim(), 'Unreleased');
  assert.match(sections[1], /^9\.9\.0-alpha\.7 - 2026-08-18\n\n- a shipped behaviour change\n\n$/);
  assert.match(sections[2], /^9\.9\.0-alpha\.6 - 2026-08-17\n/);
});

test('an empty Unreleased section refuses the cut', () => {
  const result = rewriteChangelog({
    text: changelog('\n'),
    version: '9.9.0-alpha.7',
    date: '2026-08-18',
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.problems.map(({ code }) => code), ['unreleased-empty']);
});

test('a missing Unreleased section refuses the cut', () => {
  const result = rewriteChangelog({
    text: `${PREAMBLE}${PREVIOUS}`,
    version: '9.9.0-alpha.7',
    date: '2026-08-18',
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.problems.map(({ code }) => code), ['unreleased-missing']);
});

test('two Unreleased sections refuse the cut', () => {
  const result = rewriteChangelog({
    text: `${PREAMBLE}## Unreleased\n\n- one\n\n## Unreleased\n\n- two\n\n${PREVIOUS}`,
    version: '9.9.0-alpha.7',
    date: '2026-08-18',
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.problems.map(({ code }) => code), ['unreleased-duplicate']);
});

test('a section already carrying the target version refuses the cut', () => {
  const result = rewriteChangelog({
    text: `${PREAMBLE}## Unreleased\n\n- one\n\n## 9.9.0-alpha.7 - 2026-08-18\n\n- already\n\n${PREVIOUS}`,
    version: '9.9.0-alpha.7',
    date: '2026-08-18',
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.problems.map(({ code }) => code), ['release-section-present']);
});

test('a date that is not an ISO calendar day refuses the cut', () => {
  for (const date of ['2026-8-18', '18-08-2026', '2026-02-30', 'today']) {
    const result = rewriteChangelog({ text: changelog('\n- one\n'), version: '9.9.0-alpha.7', date });
    assert.equal(result.ok, false, date);
    assert.deepEqual(result.problems.map(({ code }) => code), ['date-invalid'], date);
  }
});

// The bounded guarantee is the sentence a reader acts on. It is worthless if
// one surface promises more than another, so every surface that states it must
// state the reported failure it closes before the topologies it leaves open.
const GUARANTEE = /cooperating alpha\.14 worktrees of one clone that share one Git common directory/i;
const OUTSIDE = /separate clones, separate machines, alpha\.13 writers before the hard cutover, and noncooperating writes/i;

for (const [surface, text] of [
  ['CHANGELOG', () => changelogText],
  ['work-claim contract', () => workClaimContract],
  ['mutation contract', () => mutationContract],
  ['installed skill', () => installedSkill],
]) {
  test(`the ${surface} bounds the alpha.14 guarantee in one order`, () => {
    const source = text();

    assert.match(source, /reported PropertyCompass2 collision/i);
    assert.match(source, GUARANTEE);
    assert.match(source, OUTSIDE);
    assert.match(source, /branch integration plus `validate`/i);
    assert.ok(
      source.search(GUARANTEE) < source.search(OUTSIDE),
      `${surface} must state what alpha.14 fixes before what stays outside the fence`,
    );
  });
}

// Before a cut, these checks read Unreleased. After the cut empties that
// section, they follow package.json to the release section those bytes entered.
// This keeps one assertion valid on both sides of the release transaction
// without planting another literal distribution version in the repository.
function changelogSection(heading) {
  const start = changelogText.indexOf(` ## ${heading} `);
  const end = changelogText.indexOf(' ## ', start + 1);
  assert.ok(start > 0 && end > start, `the changelog must carry ${heading}`);
  return changelogText.slice(start, end);
}

const unreleasedNotes = changelogSection('Unreleased');
const shippingNotes = unreleasedNotes.trim() === '## Unreleased'
  ? changelogSection(distributionVersion)
  : unreleasedNotes;

test('the changelog states the hard cutover with the evidence it rests on', () => {
  for (const literal of [
    'claim-store-unavailable',
    'The durable claim store is unavailable.',
    'claim-store-unreadable',
    'upgrade every writer',
    'before the first alpha.14 create',
  ]) {
    assert.ok(
      shippingNotes.includes(literal),
      `the release note must state ${JSON.stringify(literal)}`,
    );
  }
  assert.match(shippingNotes, /no automatic migration/i);
  assert.match(shippingNotes, /mixed-version grace period/i);
});

test('the changelog scopes batch creates and existing duplicates out of alpha.14', () => {
  assert.match(shippingNotes, /no batch (?:mutation|operation)/i);
  assert.match(shippingNotes, /create-then-commit loop/i);
  assert.match(shippingNotes, /item #186/);
  assert.match(shippingNotes, /item #182/);
});

test('the changelog records the measured create cost without promising a duration', () => {
  assert.match(shippingNotes, /no new Git roster or history traversal/i);
  assert.match(shippingNotes, /two extra .*journal appends/i);
  assert.match(shippingNotes, /65,536/);
});
