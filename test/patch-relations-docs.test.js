import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

function read(relativePath) {
  return readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

const contract = read('docs/mutation-contract.md');
const skill = read('skills/wowbagger/SKILL.md');

// Prose wraps and carries Markdown emphasis, so a required phrase is matched
// word by word: any run of whitespace, backticks, emphasis, or list commas may
// separate the words.
function phrase(text) {
  return new RegExp(text.split(' ').map(escape).join('[\\s`*,]+'));
}

function escape(word) {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function section(source, heading, name) {
  const start = source.indexOf(heading);
  assert.notEqual(start, -1, `missing heading ${heading} in ${name}`);
  const next = source.indexOf('\n## ', start + heading.length);
  return source.slice(start, next === -1 ? source.length : next);
}

const writing = section(skill, '## Writing', 'the installed skill');

test('the installed skill names the exact patchable field set', () => {
  assert.match(
    writing,
    phrase('patchable field set is exactly title priority depends_on related body body_append and extensions'),
    'the skill must state the boundary rather than leave it to be discovered',
  );
  assert.match(
    contract,
    phrase('patchable field set is exactly title priority depends_on related body body_append and extensions'),
    'the contract must state the same boundary',
  );
});

test('the installed skill rules the whole-list replacement and its clearing values', () => {
  assert.match(
    writing,
    phrase('replaced whole'),
    'the skill must say a relations patch replaces the list rather than adding to it',
  );
  assert.match(
    writing,
    phrase('[] clears a list'),
    'the skill must name the clearing value',
  );
  assert.match(
    writing,
    phrase('null removes the field'),
    'the skill must say what null does',
  );
  assert.match(
    writing,
    phrase('depends_on and title are required'),
    'the skill must say why null is refused for the required fields',
  );
  assert.match(
    writing,
    /candidate-invalid/,
    'the skill must name the refusal a null depends_on produces',
  );
  assert.match(
    writing,
    phrase('Use []'),
    'the skill must give the working alternative',
  );
});

test('the installed skill states that patch refuses number', () => {
  assert.match(
    writing,
    phrase('number is refused'),
    'the skill must state the immutable-identity refusal where patch is taught',
  );
});

test('the installed skill teaches the in-band dependent-disposition escape', () => {
  assert.match(writing, /atomic-scope-required/, 'the skill must name the refusal');
  assert.match(writing, /dependent-disposition/, 'the skill must name the blocker code');
  assert.match(
    writing,
    /error\.details\.blockers/,
    'the skill must name where the blocker is read from',
  );
  assert.match(
    writing,
    phrase('out of depends_on and into related'),
    'the skill must name the re-scoping edit',
  );
  assert.match(
    writing,
    phrase('then retry the disposition'),
    'the skill must close the loop back to the refused transition',
  );
});

test('the installed skill shows the patch command shape', () => {
  assert.match(
    writing,
    /wowbagger patch\s+--ledger <dir> --input request\.json --json/,
    'the skill must show the exact command shape it teaches',
  );
});
