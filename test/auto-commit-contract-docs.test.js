import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const contract = readFileSync(path.join(projectRoot, 'docs', 'mutation-contract.md'), 'utf8');
const workClaim = readFileSync(path.join(projectRoot, 'docs', 'work-claim-contract.md'), 'utf8');

function phrase(text) {
  return new RegExp(text.split(' ').map(escape).join('[\\s`*,|]+'), 'iu');
}

function escape(word) {
  return word.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

test('the auto-commit contract defines derived-log recovery', () => {
  assert.match(contract, phrase('journal-owning auto-commit validates and rebuilds the dirty derived reconciliation log'));
  assert.match(contract, phrase('create still refuses a dirty reconciliation log'));
  assert.match(contract, phrase('claim refusal evidence is never suppressed'));
});

test('the auto-commit contract defines claim verification diagnostics', () => {
  assert.match(contract, /claim_verify_code/u);
  assert.match(contract, /claim_verify_reason/u);
  assert.match(contract, phrase('claim-store-locked is retryable'));
  assert.match(contract, phrase('persistent reconciliation is not retryable'));
});

test('preflight and post-commit use target-scoped findings', () => {
  assert.match(contract, phrase('no findings blocking the target item'));
  assert.match(workClaim, phrase('no findings blocking the target item'));
  assert.match(contract, phrase('nonblocking findings remain available to claim-verify'));
});

// Item #181 replaced the journal-silent create decision with a journal-fenced
// one. These rows pin the behavior both contracts must describe — the ordering,
// the fence predicate, the recorded grammar, the commit set, and the exact
// evidence an alpha.13 writer emits — not the sentences that describe them.
// These sentences are hard-wrapped in the source, so every assertion below
// reads a whitespace-flattened copy and matches the sentence, not the wrap.
function flatten(text) {
  return text.replace(/\s+/gu, ' ');
}

const LEGACY_WRITER_EVIDENCE = [
  'claim-store-unavailable',
  'The durable claim store is unavailable.',
  'claim-store-unreadable',
  'upgrade every writer',
  'before the first alpha.14 create',
];

for (const [surface, text] of [
  ['mutation contract', () => flatten(contract)],
  ['work-claim contract', () => flatten(workClaim)],
]) {
  test(`the ${surface} states that a create records its intent before any item byte`, () => {
    const source = text();

    assert.match(source, /`legacy-mutation-intent`[^.]*`command: "create-v1"`/u);
    assert.match(source, /before any byte reaches the item path/u);
  });

  test(`the ${surface} states the create allocation fence`, () => {
    const source = text();

    assert.match(source, /coordinated item this checkout does not hold blocks `create`/u);
    assert.match(source, /stale revision of an item this checkout holds does not block `create`/u);
    assert.match(source, /`publication-reconciliation-required`/u);
  });

  test(`the ${surface} routes an existing duplicate number to item #182`, () => {
    assert.match(text(), /duplicate numbers?[^.]*item #182/u);
  });

  test(`the ${surface} carries the literal alpha.13 old-writer evidence`, () => {
    const source = text();

    for (const literal of LEGACY_WRITER_EVIDENCE) {
      assert.ok(source.includes(literal), `${surface} must state ${JSON.stringify(literal)}`);
    }
  });
}

test('the work-claim contract pins the create terminal and abort grammar', () => {
  const source = flatten(workClaim);

  assert.match(source, /create abort carries `command: "create-v1"` and `observed_revision: null`/u);
  assert.match(source, /`expected_revision: null`[^.]*only for `create-v1`/u);
});

test('the auto-commit contract gives create the item and its reconciliation log', () => {
  assert.match(
    flatten(contract),
    /successful `create` commits exactly the created item and its reconciliation log/u,
  );
});
