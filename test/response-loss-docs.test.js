import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { mapProcessOutcome } from '../src/adapter/process-outcome.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

function read(relativePath) {
  return readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

// Every surface is hard-wrapped, so a normative sentence is compared with its
// line breaks collapsed. The words and their order still have to match exactly.
const surfaces = {
  'the mutation contract': flow(read('docs/mutation-contract.md')),
  'the adapter contract': flow(read('docs/adapter-contract.md')),
  'the README': flow(read('README.md')),
  'the installed skill': flow(read('skills/wowbagger/SKILL.md')),
};

function flow(source) {
  return source.replace(/\s+/g, ' ');
}

test('every consumer-facing surface states the response-loss sequence exactly', () => {
  for (const [name, source] of Object.entries(surfaces)) {
    assert.match(
      source,
      /Dispatch once, never replay, invalidate the inspected revision, reconnect, then re-read the ledger\./,
      `${name} must state the once-only dispatch sequence`,
    );
    assert.match(
      source,
      /never proves that the lost dispatch caused it/,
      `${name} must deny later bytes causal authority`,
    );
  }
});

test('the mutation contract separates every response-loss outcome class', () => {
  const contract = surfaces['the mutation contract'];
  const classes = [
    ['a committed success', /exit 0, state committed \| The mutation applied exactly as returned\./],
    ['a proven non-write', /state unchanged, any nonzero exit \| The mutation did not create, remove, rename, or byte-modify an item\./],
    ['committed recovery', /exit 6 post-commit-recovery-required, state committed \| The item is published; a verify or cleanup step still needs recovery\./],
    ['unknown publication', /exit 6 write-outcome-unknown, state unknown \| Publication was attempted and the visible bytes are indeterminate\./],
    ['signalled or timed-out transport', /Signal, timeout, orphan or containment doubt, or an incomplete or over-limit stream \| Nothing\./],
    ['no envelope at all', /No envelope, a partial envelope, or no response at all because the transport was lost \| Nothing\./],
  ];

  for (const [name, pattern] of classes) {
    assert.match(contract, pattern, `the mutation contract must classify ${name}`);
  }
  assert.match(
    contract,
    /No row reports success that was not observed, and no row licenses a repeat of the mutation\./,
    'the mutation contract must forbid inventing success from the table',
  );
});

// The recovery object is the only machine-readable instruction a consumer gets
// for an unresolved mutation, so the contract is compared with what the
// production seam actually emits rather than with a hand-copied table.
test('the adapter contract documents the exact unknown-outcome envelope the adapter emits', () => {
  const contract = surfaces['the adapter contract'];
  const emitted = ['create', 'transition', 'patch'].map((command) => mapProcessOutcome({
    adapter_contract_version: 2,
    request_id: `response-loss-${command}-0001`,
    command,
    item_id: 'wb_01Q45X474N28T5CY4GNF6YY4HM',
    expected_revision: command === 'create' ? null : `sha256:${'1'.repeat(64)}`,
    process: {
      started: true,
      process_tree_contained: true,
      orphaned: false,
      exit_code: null,
      signal: null,
      timed_out: true,
      stdout_complete: true,
      stderr_complete: true,
      stdout_base64: '',
      stderr_base64: '',
    },
  }));

  for (const result of emitted) {
    assert.equal(result.mutation_outcome, 'unknown');
    assert.match(contract, /"mutation_outcome": "unknown"/);
    assert.match(contract, new RegExp(`"${result.error.code}"`));
    assert.match(contract, new RegExp(`"${result.error.message}"`));
    for (const [member, value] of Object.entries(result.error.details.recovery)) {
      assert.match(contract, new RegExp(`\`?${member}\`?`), `the adapter contract must name ${member}`);
      if (typeof value === 'string') {
        assert.match(contract, new RegExp(value), `the adapter contract must name ${value}`);
      }
    }
  }
  assert.match(
    contract,
    /`details` also carries `process_issue`/,
    'the adapter contract must document the observation member',
  );
});
