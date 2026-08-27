import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const contract = readFileSync(path.join(projectRoot, 'docs', 'mutation-contract.md'), 'utf8');
const skill = readFileSync(path.join(projectRoot, 'skills', 'wowbagger', 'SKILL.md'), 'utf8');

function phrase(text) {
  return new RegExp(text.split(' ').map(escape).join('[\\s`*,|]+'), 'iu');
}

function escape(word) {
  return word.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

test('the mutation contract defines parent-migrate and snooze requests', () => {
  for (const required of [
    'Parent-migrate accepts exactly',
    'expected_parent',
    'parent-revision-conflict',
    'Snooze accepts exactly',
    'snoozed_until',
    'request date must equal the existing updated date',
  ]) {
    assert.match(contract, phrase(required), `missing contract phrase: ${required}`);
  }
});

test('the contract distinguishes fence-family command from response operation', () => {
  assert.match(contract, phrase('patch-v1 fence family'));
  assert.match(contract, phrase('responseCommand identifies the response operation'));
  assert.match(contract, phrase('parent-migrate-v1'));
  assert.match(contract, phrase('snooze-v1'));
});

test('the installed skill gives exact parent-migrate and snooze requests', () => {
  for (const required of [
    'parent-migrate request',
    'expected_parent',
    'snooze request',
    'snoozed_until',
    '--auto-commit',
  ]) {
    assert.match(skill, phrase(required), `missing skill phrase: ${required}`);
  }
});
