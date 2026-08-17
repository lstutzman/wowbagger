// test/frontmatter-ownership-docs.test.js
//
// Item #114: the ownership boundary must stop being try-and-see. Before this
// guard the only way to learn whether a frontmatter member was yours to edit
// was to send a patch and read the refusal. These tests pin the table that
// answers the question in prose, and pin the skill teaching the same answer.
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
  return new RegExp(text.split(' ').map(escape).join('[\\s`*,|]+'));
}

function escape(word) {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function subsection(source, heading, name) {
  const start = source.indexOf(heading);
  assert.notEqual(start, -1, `missing heading ${heading} in ${name}`);
  const next = source.indexOf('\n#', start + heading.length);
  return source.slice(start, next === -1 ? source.length : next);
}

const ownership = subsection(contract, '### Frontmatter ownership', 'the mutation contract');

// One row per member, so a member that is silently dropped from the table
// fails here rather than being rediscovered by a consumer's refused patch.
const CORE_OWNED = [
  'schema_version', 'id', 'number', 'status', 'created', 'updated',
  'completed', 'killed', 'archived', 'deferred', 'decisions',
];
// `extensions` is deliberately absent: it is the set container, not a
// frontmatter member, so it has no row of its own. The two extension rows
// below carry it.
const PATCHABLE = ['title', 'priority', 'depends_on', 'related', 'body'];
const CREATE_ONCE = ['kind', 'provenance', 'parent', 'snoozed_until'];

test('the ownership table gives every core-owned member a row that says so', () => {
  for (const member of CORE_OWNED) {
    const row = ownership.split('\n').find((line) => line.startsWith(`| \`${member}\``));
    assert.ok(row, `the table must carry a row for ${member}`);
    assert.match(row, /Core-owned/, `${member} must be marked core-owned`);
  }
});

test('the ownership table gives every patchable member a row naming patch', () => {
  for (const member of PATCHABLE) {
    const row = ownership.split('\n').find((line) => line.startsWith(`| \`${member}\``));
    assert.ok(row, `the table must carry a row for ${member}`);
    assert.match(row, /Consumer-editable through `patch`/, `${member} must be marked patchable`);
    assert.match(row, new RegExp(`set\\.${member}`), `${member} must name its set member`);
  }
});

test('the ownership table gives every create-once member a row that says so', () => {
  for (const member of CREATE_ONCE) {
    const row = ownership.split('\n').find((line) => line.startsWith(`| \`${member}\``));
    assert.ok(row, `the table must carry a row for ${member}`);
    assert.match(row, /Create-once/, `${member} must be marked create-once`);
  }
});

// Item #118 split the one extension row in two. Both halves are pinned,
// because "which side of the boundary is my field on" now has two answers and
// a consumer must be able to read either without sending a patch.
test('the ownership table gives declared extension members the shipped mechanism', () => {
  const row = ownership.split('\n').find((line) => line.startsWith('| declared extension members'));
  assert.ok(row, 'the table must carry a row for declared extension members');
  assert.match(row, /tags/, 'the row must name the consumer examples');
  assert.match(row, /tier/, 'the row must name the consumer examples');
  assert.match(row, /Consumer-owned, patchable through `set\.extensions`/, 'the row must state their exact status');
  assert.match(row, /extensions\.json/, 'the row must name the declaration that permits the write');
});

test('the ownership table keeps undeclared extension members out, and says so', () => {
  const row = ownership.split('\n').find((line) => line.startsWith('| undeclared extension members'));
  assert.ok(row, 'the table must carry a row for undeclared extension members');
  assert.match(row, /Consumer-owned, not patchable/, 'the row must state their exact status');
  assert.match(
    row,
    phrase('no patchable extension member at all'),
    'the row must state that a ledger without a declaration is fail-closed',
  );
});

test('the contract states the structural reason kind is refused', () => {
  assert.match(ownership, phrase('kind is refused'), 'the refusal must be stated, not implicit');
  assert.match(
    ownership,
    phrase('parent and children rules'),
    'the reason must name the structural consequence of a task and epic flip',
  );
  assert.match(
    ownership,
    phrase('allowed lifecycle edges'),
    'the reason must name the lifecycle consequence',
  );
});

// The four obstacles #114 recorded are still the structure of this prose. Each
// one must now be answered by a named piece of the shipped path, not waived.
test('the contract answers each recorded extension obstacle with the shipped mechanism', () => {
  assert.match(
    ownership,
    phrase('candidate validation constrains no extension value'),
    'the contract must keep the premise that extension validation already exists false',
  );
  assert.match(
    ownership,
    phrase('set.extensions container'),
    'the contract must name the request shape that keeps the fail-closed set rule',
  );
  assert.match(
    ownership,
    phrase('committed per-ledger declaration'),
    'the contract must name the value schema the path added',
  );
  assert.match(
    ownership,
    /extension-anchored/,
    'the contract must name the refusal that keeps the node-identity guard intact',
  );
  assert.match(
    ownership,
    phrase('correlating through source_base64'),
    'the contract must name how the oracle correlation obstacle was answered',
  );
});

test('the contract states what an extension patch still cannot reach', () => {
  assert.match(
    ownership,
    phrase('What is still out'),
    'the contract must name the remaining hand-edit cases rather than imply completeness',
  );
  for (const excluded of ['undeclared member', 'no declaration', 'nested list', 'anchor or an alias']) {
    assert.match(ownership, phrase(excluded), `the contract must name the excluded case: ${excluded}`);
  }
});

test('the contract states that the declaration authorizes a write and never describes the ledger', () => {
  const declaration = subsection(contract, '### The extension declaration', 'the mutation contract');
  assert.match(
    declaration,
    phrase('A declaration authorizes a write; it does not describe the ledger.'),
    'the contract must state the enforcement boundary, not leave it to be inferred',
  );
  assert.match(
    declaration,
    phrase('validate is therefore unchanged by this file'),
    'the contract must say the declaration changes no ledger validity',
  );
  assert.match(
    declaration,
    phrase('has no patchable extension member'),
    'the contract must state that absence is fail-closed and total',
  );
});

test('the installed skill teaches the same three-way boundary', () => {
  const writing = subsection(skill, '### Patch edits fields, never lifecycle', 'the installed skill');
  assert.match(writing, phrase('Core-owned'), 'the skill must name the core-owned class');
  assert.match(writing, phrase('Create-once'), 'the skill must name the create-once class');
  assert.match(
    writing,
    phrase('Extension members are patchable only where the ledger declares them.'),
    'the skill must state the extension-member status rather than leave it to a refusal',
  );
  assert.match(
    writing,
    /set\.extensions/,
    'the skill must name the container a consumer actually sends',
  );
  assert.match(
    writing,
    phrase('no patchable extension member at all'),
    'the skill must state that a ledger without a declaration is fail-closed',
  );
  assert.match(
    writing,
    /docs\/mutation-contract\.md/,
    'the skill must point at the table that carries the whole boundary',
  );
});
