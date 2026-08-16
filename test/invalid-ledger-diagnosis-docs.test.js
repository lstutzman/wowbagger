import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

function read(relativePath) {
  return readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

const consumerSurfaces = {
  'the README': read('README.md'),
  'the installed skill': read('skills/wowbagger/SKILL.md'),
};

test('every consumer-facing surface teaches the invalid-ledger diagnosis path', () => {
  for (const [name, source] of Object.entries(consumerSurfaces)) {
    assert.match(source, /error\.details\.item/, `${name} must name the attached inspect snapshot`);
    assert.match(source, /result\.ledger_validation/, `${name} must name the claim-verify report`);
  }
});

test('the mutation contract keeps inspect a refusal and states what the refusal carries', () => {
  const contract = read('docs/mutation-contract.md');
  assert.match(contract, /An invalid ledger stays a refusal\./);
  assert.match(contract, /there is no escape flag that skips\nvalidation/);
  assert.match(contract, /ledger-invalid details carry an optional item/);
  assert.match(
    contract,
    /\| ledger-invalid \| validation_errors; item iff the command is inspect/,
    'the stable error details table must record the optional member',
  );
  assert.match(
    contract,
    /\*\*the diagnosable inspect refusal\.\*\*/,
    'the version 3 delta list must record the widened refusal',
  );
});

test('the work-claim contract version-notes the claim-verify ledger report', () => {
  const contract = read('docs/work-claim-contract.md');
  assert.match(contract, /`result\.ledger_validation` is always present/);
  assert.match(contract, /This member widens a version 1 envelope and the version does not move\./);
  assert.match(
    contract,
    /`findings`, `state`, and\nthe exit status describe claim state alone/,
    'the contract must keep the claim answer separate from ledger validity',
  );
});

test('SPEC.md permits exactly the two derived validation-error members', () => {
  const spec = read('SPEC.md');
  assert.match(spec, /MAY also\ncarry `expected_path`/);
  assert.match(spec, /No other member is permitted on a validation error\./);
});
