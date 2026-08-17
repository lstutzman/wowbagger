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

const patch = section(contract, '## 9. Patch', 'the mutation contract');
const versions = section(contract, '## Contract versions', 'the mutation contract');
const writing = section(skill, '## Writing', 'the installed skill');

// The near-miss this guards: a mirror consumer read the item, regenerated the
// body from its upstream source, and sent it through the sanctioned verb. Every
// check passed — revision current, body well formed, CAS satisfied — and the
// ledger-only annotation was gone. The merge burden has to be stated, not
// inferred from "replaces the whole body".
test('the mutation contract states that a body patch replaces and never merges', () => {
  assert.match(
    patch,
    phrase('replaces the whole body and never merges'),
    'section 9 must say the replacement is total, not a merge',
  );
});

test('the mutation contract rules the read-modify-write discipline for a mirror', () => {
  assert.match(
    patch,
    phrase('MUST read-modify-write from the current item body'),
    'section 9 must place the merge burden on the consumer explicitly',
  );
  assert.match(
    patch,
    phrase('never regenerate from the source alone'),
    'section 9 must name regeneration as the losing move',
  );
  assert.match(
    patch,
    phrase('discards every ledger-only byte'),
    'section 9 must name what regeneration destroys',
  );
});

test('the installed skill carries the same replace-not-merge rule in agent voice', () => {
  assert.match(
    writing,
    phrase('replaces the whole body and never merges'),
    'the skill must say the replacement is total, not a merge',
  );
  assert.match(
    writing,
    phrase('read-modify-write from the current item body'),
    'the skill must tell an agent to merge onto the body it just read',
  );
  assert.match(
    writing,
    phrase('never regenerate from the source alone'),
    'the skill must name regeneration as the losing move',
  );
});

test('the mutation contract rules the append and its exclusivity with a replacement', () => {
  assert.match(
    patch,
    phrase('body and body_append are mutually exclusive in one request'),
    'section 9 must state the exclusivity rather than leave it to be discovered',
  );
  assert.match(
    patch,
    phrase('every existing byte survives by construction'),
    'section 9 must say why an append cannot lose a ledger-only block',
  );
});

// Version 3 shipped in 0.1.0-alpha.5 without body_append, so the version field
// cannot answer "does this core support append?". Saying so is the whole point
// of the delta entry; a silent entry would invite a consumer to negotiate on a
// number that does not move.
test('the version delta admits that contract_version cannot answer whether append exists', () => {
  assert.match(
    versions,
    phrase('the appendable body'),
    'the version 3 delta list must carry the append entry',
  );
  assert.match(
    versions,
    phrase('cannot probe for append support by reading contract_version'),
    'the delta entry must admit the version field does not distinguish the two cores',
  );
  assert.match(
    versions,
    phrase('unknown-member issue at /set/body_append'),
    'the delta entry must name the probe that does work',
  );
});

test('the installed skill offers the append as the alternative to a merge', () => {
  assert.match(
    writing,
    phrase('use `set.body_append`'),
    'the skill must name the append',
  );
  assert.match(
    writing,
    phrase('mutually exclusive with `set.body`'),
    'the skill must state the exclusivity',
  );
});
