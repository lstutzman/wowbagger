import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

function read(relativePath) {
  return readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

const surfaces = {
  'the mutation contract': read('docs/mutation-contract.md'),
  'the work-claim contract': read('docs/work-claim-contract.md'),
  'the README': read('README.md'),
  'the installed skill': read('skills/wowbagger/SKILL.md'),
};

test('every consumer-facing surface states the commit-per-mutation invariant', () => {
  for (const [name, source] of Object.entries(surfaces)) {
    assert.match(
      source,
      /Commit each mutation to Git before running the next mutating command/,
      `${name} must state the invariant`,
    );
  }
});

test('every consumer-facing surface names claim-verify as the reconciliation procedure', () => {
  for (const [name, source] of Object.entries(surfaces)) {
    assert.match(source, /publication-reconciliation-required/, `${name} must name the refusal reason`);
    assert.match(source, /claim-verify/, `${name} must name the reconciliation verb`);
  }
});

test('every consumer-facing surface states the authorized predecessor window is nonblocking', () => {
  for (const [name, source] of Object.entries(surfaces)) {
    assert.match(
      source,
      /authorized predecessor\/successor window/,
      `${name} must distinguish the nonblocking authorized window from a refusal`,
    );
  }
});

test('the mutation contract records the rejected working-tree validation alternative', () => {
  assert.match(surfaces['the mutation contract'], /Rejected alternative: validate against working-tree bytes/);
  assert.match(surfaces['the mutation contract'], /the working tree instead of Git `HEAD`/);
});

test('both installed skill loops carry the commit and claim-verify steps', () => {
  const skill = surfaces['the installed skill'];
  const claimed = section(skill, '## Work claims are merge-coordinated');
  const unclaimed = section(skill, '## Working the unclaimed loop');

  for (const [name, loop] of [['claimed loop', claimed], ['unclaimed loop', unclaimed]]) {
    assert.match(loop, /git (add|commit)|Commit the item change/, `${name} must include the commit step`);
    assert.match(loop, /claim-verify/, `${name} must include claim-verify`);
    assert.match(
      loop,
      /[Ww]rite, commit, `claim-verify`, next\s+write/,
      `${name} must spell out the ordered rule`,
    );
  }
});

function section(source, heading) {
  const start = source.indexOf(heading);
  assert.notEqual(start, -1, `missing heading ${heading}`);
  const next = source.indexOf('\n## ', start + heading.length);
  return source.slice(start, next === -1 ? source.length : next);
}
