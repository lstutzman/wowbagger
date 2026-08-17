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

test('the ownership table gives extension members a named home rather than a silence', () => {
  const row = ownership.split('\n').find((line) => line.startsWith('| extension members'));
  assert.ok(row, 'the table must carry a row for extension members');
  assert.match(row, /tags/, 'the row must name the consumer examples');
  assert.match(row, /tier/, 'the row must name the consumer examples');
  assert.match(row, /Consumer-owned, not patchable/, 'the row must state their exact status');
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

test('the contract records why extension members stay out and what a path would need', () => {
  assert.match(
    ownership,
    phrase('candidate validation constrains no extension value'),
    'the contract must say the premise that extension validation already exists is false',
  );
  assert.match(
    ownership,
    phrase('no observable surface'),
    'the contract must name the oracle-correlation obstacle',
  );
  assert.match(
    ownership,
    /extension-member patch/,
    'the contract must name the widening it is deferring, not gesture at it',
  );
});

test('the installed skill teaches the same three-way boundary', () => {
  const writing = subsection(skill, '### Patch edits fields, never lifecycle', 'the installed skill');
  assert.match(writing, phrase('Core-owned'), 'the skill must name the core-owned class');
  assert.match(writing, phrase('Create-once'), 'the skill must name the create-once class');
  assert.match(
    writing,
    phrase('Extension members are not patchable'),
    'the skill must state the extension-member status rather than leave it to a refusal',
  );
  assert.match(
    writing,
    /docs\/mutation-contract\.md/,
    'the skill must point at the table that carries the whole boundary',
  );
});
