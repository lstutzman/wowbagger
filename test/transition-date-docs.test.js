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
const surfaces = [['the mutation contract', contract], ['the installed skill', skill]];

// Prose wraps and carries Markdown emphasis, so a required phrase is matched
// word by word: any run of whitespace or backticks may separate the words.
function phrase(text) {
  return new RegExp(text.split(' ').map(escape).join('[\\s`*]+'));
}

function escape(word) {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function section(source, heading, name, from = 0) {
  const start = source.indexOf(heading, from);
  assert.notEqual(start, -1, `missing heading ${heading} in ${name}`);
  const boundaries = ['\n### ', '\n## ']
    .map((marker) => source.indexOf(marker, start + heading.length))
    .filter((index) => index !== -1)
    .sort((left, right) => left - right);
  return source.slice(start, boundaries[0] ?? source.length);
}

function transitionSection(heading) {
  const start = contract.indexOf('## 8. Transition');
  assert.notEqual(start, -1, 'missing the transition chapter');
  return section(contract, heading, 'the mutation contract', start);
}

test('every surface explaining transition dates states the UTC ULID derivation', () => {
  for (const [name, source] of surfaces) {
    assert.match(
      source,
      phrase('derives from the ULID timestamp, which is UTC'),
      `${name} must state where created comes from`,
    );
  }
});

test('every surface explaining transition dates documents the across-midnight footgun', () => {
  for (const [name, source] of surfaces) {
    assert.match(source, phrase('created just after midnight UTC'), `${name} must name the case`);
    assert.match(
      source,
      /date-before-created/,
      `${name} must name the refusal the across-midnight case produces`,
    );
  }
});

test('the contract states the derivation where the transition date member is ruled', () => {
  const request = transitionSection('### Request');
  assert.match(request, phrase('created just after midnight UTC'));
  assert.match(request, phrase("the operator's local calendar date"));
});

test('the contract pins the item dates carried by a date refusal', () => {
  const issues = transitionSection('### Deterministic precondition issues');
  assert.match(issues, /"item_created"/);
  assert.match(issues, /"item_updated"/);
  assert.match(
    issues,
    phrase('date-before-created and date-before-updated carry item_created and item_updated'),
    'the contract must state which codes carry the item dates',
  );
});

test('the installed skill tells an agent to read the dates from the refusal', () => {
  assert.match(skill, /item_created/, 'the skill must name the enriched member');
  assert.match(skill, /item_updated/, 'the skill must name the enriched member');
  assert.match(
    skill,
    phrase('Do not run inspect to find them'),
    'the skill must forbid the round-trip the enrichment removes',
  );
});
