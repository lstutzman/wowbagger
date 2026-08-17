import assert from 'node:assert/strict';
import test from 'node:test';

import { rewriteChangelog } from '../scripts/lib/release-changelog.js';

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
