// test/extension-declaration-docs.test.js
//
// Item #118: the extension declaration is the first committed artifact that
// widens what a verb may write. The prose that bounds it — its shape, the
// three documents that must agree about it, and the version honesty a
// published contract version owes — is pinned here.
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
const configuration = read('docs/consumer-configuration.md');
const skill = read('skills/wowbagger/SKILL.md');

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

const declaration = subsection(contract, '### The extension declaration', 'the mutation contract');
const preconditions = subsection(contract, '### Extension preconditions', 'the mutation contract');

test('the contract fixes the declaration path, version, and value types', () => {
  assert.match(declaration, /<ledger>\/\.wowbagger\/extensions\.json/, 'the path must be exact');
  assert.match(declaration, /"extensions_version": 1/, 'the version must be exact');
  for (const type of ['string', 'integer', 'boolean', 'string-list']) {
    assert.match(declaration, new RegExp(`\`${escape(type)}\``), `the declared type ${type} must be named`);
  }
  assert.match(
    declaration,
    phrase('never one of the frontmatter members'),
    'the contract must state that a declaration cannot claim a core-owned member',
  );
});

// The nesting boundary is the one #114 warned would fight the serializer. It
// has to be recorded either way, so a later reader knows it was decided.
test('the contract records the nesting boundary rather than leaving it open', () => {
  assert.match(
    declaration,
    phrase('This is deliberately not a schema engine.'),
    'the contract must say what the declaration refuses to become',
  );
  assert.match(
    declaration,
    phrase('a map, a nested list, or a value with its own internal shape'),
    'the contract must name the shapes that have no patch path',
  );
  assert.match(
    declaration,
    phrase('they need their own declaration shape'),
    'the contract must say what a nested path would take, rather than implying this one covers it',
  );
});

test('the contract enumerates every extension precondition code with its field', () => {
  for (const [code, field] of [
    ['extension-declaration-missing', '`extensions`'],
    ['extension-declaration-invalid', '`extensions`'],
    ['extension-not-declared', 'the member'],
    ['extension-value-invalid', 'the member'],
    ['extension-anchored', 'the member'],
  ]) {
    const row = preconditions.split('\n').find((line) => line.startsWith(`| ${code} `));
    assert.ok(row, `the table must carry a row for ${code}`);
    assert.ok(row.includes(field), `${code} must state its field as ${field}`);
  }
  assert.match(
    preconditions,
    phrase('code field message and related_ids and nothing else'),
    'the contract must state that the issue shape does not grow to carry the member',
  );
});

test('the contract states the anchored rule and what the node-identity guard still proves', () => {
  assert.match(
    preconditions,
    phrase('it is refused, not attempted'),
    'the contract must state that an anchored member is never replaced',
  );
  assert.match(
    preconditions,
    phrase('The refusal is per named member'),
    'the contract must say one anchored member does not block the others',
  );
  assert.match(
    preconditions,
    phrase('Every extension member the request does not name keeps its exact extensionNodeIdentity guarantee'),
    'the contract must state exactly what the guard still proves',
  );
  assert.match(
    preconditions,
    phrase('parsed back and each named member must read as exactly the value the request asked for'),
    'the contract must state the second check the named members take instead',
  );
});

// The published-alpha.5 honesty: contract_version cannot answer this question,
// and the contract has to say so rather than let a consumer assume it can.
test('the version note states the probe rather than implying the version answers', () => {
  const versions = contract.slice(0, contract.indexOf('## 1. Scope'));
  assert.match(versions, phrase('the patchable extension member'), 'the delta must be listed');
  assert.match(
    versions,
    phrase('The issue shape does not move'),
    'the delta must say why this is not the class of change that forced the last bump',
  );
  assert.match(
    versions,
    phrase('0.1.0-alpha.5 released it and has no set.extensions'),
    'the delta must name the published release that lacks the path',
  );
  assert.match(
    versions,
    phrase('unknown-member issue at /set/extensions'),
    'the delta must name the probe a consumer sends instead',
  );
});

test('the consumer configuration layer counts the declaration and bounds it', () => {
  assert.match(
    configuration,
    phrase('Three repository-local artifacts are deliberately not consumer configuration.'),
    'the doc must count the declaration among the core-owned artifacts',
  );
  assert.match(configuration, /\.wowbagger\/extensions\.json/, 'the doc must name the file');
  assert.match(
    configuration,
    phrase('the first committed artifact that widens what a verb may write'),
    'the doc must state plainly what is new about it',
  );
  assert.match(
    configuration,
    phrase('It changes no item’s validity'.replace('’', "'")),
    'the doc must state that the declaration cannot make an item invalid',
  );
});

test('the installed skill shows the container a consumer actually sends', () => {
  assert.match(skill, /"extensions"/, 'the skill must carry a worked request');
  assert.match(
    skill,
    phrase('extensions.json decides which members that container may name'),
    'the skill must point at the declaration',
  );
  assert.match(
    skill,
    /extension-anchored/,
    'the skill must name the refusal a consumer with an anchored member will hit',
  );
});
