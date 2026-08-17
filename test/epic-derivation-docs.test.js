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
  return new RegExp(text.split(' ').map(escape).join('[\\s`*,\\-]+'));
}

function escape(word) {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function subsection(source, heading, name) {
  const start = source.indexOf(heading);
  assert.notEqual(start, -1, `missing heading ${heading} in ${name}`);
  const next = source.indexOf('\n### ', start + heading.length);
  return source.slice(start, next === -1 ? source.length : next);
}

const DERIVATION_HEADING = '### Epic progress is derived from direct children';
const derivation = subsection(contract, DERIVATION_HEADING, 'the mutation contract');
const edges = subsection(contract, '### Allowed edges', 'the mutation contract');

test('the contract states that an epic stores no progress', () => {
  assert.match(
    derivation,
    phrase('An epic stores no progress'),
    'the derivation section must say the ledger holds no epic progress',
  );
  assert.match(
    derivation,
    phrase('derived from its direct children'),
    'the derivation section must name direct children as the source',
  );
  assert.match(
    derivation,
    phrase('Grandchildren never count'),
    'the derivation section must exclude grandchildren so two implementations agree',
  );
});

test('the contract defines the terminal ratio exactly', () => {
  assert.match(
    derivation,
    phrase('Direct children whose status is done or killed divided by all direct children'),
    'the terminal ratio must be defined over the done-or-killed set only',
  );
  assert.match(
    derivation,
    phrase('An epic with no direct children has no ratio'),
    'the derivation section must rule the empty-epic case rather than leave 0/0 open',
  );
});

test('the contract ties the terminal ratio to the epic complete rollup', () => {
  assert.match(
    derivation,
    phrase('The epic complete rollup uses this same set'),
    'the contract and the rollup must provably share one definition',
  );
  assert.match(
    derivation,
    phrase('a ratio of 1 is the precondition of the rollup'),
    'the derivation section must name what a full ratio means for the rollup',
  );
});

test('the contract ties the report epic-enablement factor to the same set', () => {
  assert.match(
    derivation,
    phrase("The report's epic-enablement factor reads this same set"),
    'the report factor, the terminal ratio, and the rollup must share one definition',
  );
  assert.match(
    derivation,
    phrase('the contract the epic complete rollup and the report all derive the same number'),
    'the derivation section must name the three surfaces the one definition serves',
  );
  assert.match(
    derivation,
    phrase('A terminal date is not the test'),
    'the derivation section must rule out the wider terminal-date set by name',
  );
  assert.match(
    derivation,
    phrase('archived restores and deferred undefers'),
    'the derivation section must say why a parked child is not progress',
  );
});

test('the contract defines the three derived activity states', () => {
  assert.match(
    derivation,
    phrase('at least one direct child is in-progress or holds an active work claim'),
    'active must be defined over in-progress children and live claims',
  );
  assert.match(
    derivation,
    phrase('no direct child has left triage or backlog'),
    'untouched must be defined over the children that never started',
  );
  assert.match(
    derivation,
    phrase('in progress by derivation'),
    'the third derived state must be named',
  );
  assert.match(
    derivation,
    phrase('Test active first then untouched then in progress by derivation'),
    'the evaluation order must be fixed so a claimed backlog child cannot read as untouched',
  );
});

test('the contract states the mirror rule against the derived state', () => {
  assert.match(
    derivation,
    phrase('never against the ledger'),
    'the mirror rule must forbid comparing against the ledger side stored field',
  );
  assert.match(
    derivation,
    phrase('stored status field'),
    'the mirror rule must name the field it forbids comparing against',
  );
  assert.match(
    derivation,
    /#1075/,
    'the derivation section must carry the worked in-progress-epic mirror example',
  );
  assert.match(
    derivation,
    phrase('permanent false positive'),
    'the worked example must name the failure a stored-vs-stored comparison produces',
  );
});

test('the contract records the no-wire-change decision', () => {
  assert.match(
    derivation,
    phrase('No machine surface exposes the derived value'),
    'the recorded decision must be in the contract prose, not only in a report',
  );
  assert.match(
    derivation,
    phrase('inspect gains no derived member'),
    'the decision must name the surface it declines to change',
  );
});

// One row per shipped edge. src/mutation.js allows task and epic defer and
// undefer and requires a decision on both, so a table that omits either row
// under-reports the lifecycle a consumer may drive.
function edgeRow(from, to) {
  return edges.split('\n').find((line) => {
    const cells = line.split('|').map((cell) => cell.trim());
    return cells[2] === from && cells[3] === to;
  });
}

test('the allowed-edges table carries the defer and undefer edges', () => {
  const defer = edgeRow('backlog', 'deferred');
  assert.ok(defer, 'the table must carry the backlog to deferred row');
  assert.match(defer, /task or epic/, 'defer must be offered for both kinds, as source allows');
  assert.match(defer, /set deferred/, 'the row must name the terminal date the edge writes');
  assert.match(defer, /append defer decision/, 'the row must name the decision the edge requires');

  const undefer = edgeRow('deferred', 'backlog');
  assert.ok(undefer, 'the table must carry the deferred to backlog row');
  assert.match(undefer, /task or epic/, 'undefer must be offered for both kinds, as source allows');
  assert.match(undefer, /clear deferred/, 'the row must name the terminal date the edge clears');
  assert.match(undefer, /append undefer decision/, 'the row must name the decision the edge requires');
});

test('the allowed-edges table cross-references the derivation model', () => {
  assert.match(
    edges,
    phrase('by design not by omission'),
    'the prohibition must read as the model it is',
  );
  assert.match(
    edges,
    phrase('Epic progress is derived from direct children'),
    'the edge table must point at the derivation section by name',
  );
});

test('the installed skill teaches derived epic progress', () => {
  assert.match(
    skill,
    phrase('An epic stores no progress'),
    'the skill must state the model an agent reasons with',
  );
  assert.match(
    skill,
    phrase('done or killed'),
    'the skill must name the terminal set the ratio counts',
  );
  assert.match(
    skill,
    phrase('never against the ledger'),
    'the skill must carry the mirror rule that keeps an audit honest',
  );
  assert.match(
    skill,
    phrase('stored status field'),
    'the skill must name the field an audit must not compare against',
  );
  assert.match(
    skill,
    /#1075/,
    'the skill must show the worked mirror case an agent will meet',
  );
});
