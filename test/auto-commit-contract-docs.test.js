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
