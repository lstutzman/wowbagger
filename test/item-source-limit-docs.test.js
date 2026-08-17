import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runCli } from './support.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

function read(relativePath) {
  return readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

const mutationContract = read('docs/mutation-contract.md');
const workClaimContract = read('docs/work-claim-contract.md');
const adapterContract = read('docs/adapter-contract.md');
const skill = read('skills/wowbagger/SKILL.md');

// The contract states the value; the runtime emits it. A number that only
// exists in prose is a promise nobody keeps.
test('the advertised limit is the number every contract states', () => {
  const result = runCli('capabilities', '--json');
  assert.equal(result.status, 0, result.stderr);
  const { contract_version: version, result: capability } = JSON.parse(result.stdout);

  assert.ok(
    mutationContract.includes(`| \`result.limits.max_item_source_bytes\` | \`${capability.limits.max_item_source_bytes}\` |`),
    'the mutation contract capability delta must state the advertised limit',
  );
  assert.ok(
    mutationContract.includes(`| \`contract_version\` | \`${version}\` |`),
    'the mutation contract capability delta must state the emitted core version',
  );
  assert.ok(
    mutationContract.includes(`| \`result.operations.work_claim.api_version\` | \`${capability.operations.work_claim.api_version}\` |`),
    'the mutation contract capability delta must state the advertised work-claim API version',
  );
  assert.ok(
    adapterContract.includes(`| Independently probed core \`contract_version\` | Exactly \`${version}\` |`),
    'the adapter contract must require the emitted core version',
  );
  assert.ok(
    adapterContract.includes(`| Manifest and describe required core contract | Exactly \`${version}\` |`),
    'the adapter contract must require the emitted core version of a manifest',
  );
  assert.ok(
    skill.includes(`core \`contract_version: ${version}\``),
    'the installed skill must pin the emitted core version',
  );
  assert.ok(
    skill.includes(`\`result.operations.work_claim.api_version: ${capability.operations.work_claim.api_version}\``),
    'the installed skill must pin the advertised work-claim API version',
  );
  assert.ok(
    skill.includes(String(capability.limits.max_item_source_bytes).replace(/\B(?=(\d{3})+(?!\d))/g, ',')),
    'the installed skill must state the advertised limit',
  );
});

const REFUSAL = {
  code: 'item-source-too-large',
  message: 'The proposed item source exceeds the supported byte limit.',
};

test('both contracts name the one refusal with the one message', () => {
  for (const [name, source] of [
    ['the mutation contract', mutationContract],
    ['the work-claim contract', workClaimContract],
  ]) {
    assert.ok(source.includes(REFUSAL.code), `${name} must name ${REFUSAL.code}`);
    assert.ok(source.includes(REFUSAL.message), `${name} must state the refusal message`);
  }
});

test('the mutation contract states the core-domain details and the work-claim contract its own', () => {
  assert.ok(
    mutationContract.includes('| item-source-too-large | id, size_bytes, limit_bytes |'),
    'the stable error details table must carry the core-domain details',
  );
  assert.ok(
    workClaimContract.includes('`{item_id, size_bytes, limit_bytes}`'),
    'the work-claim contract must carry the ledger-publication details',
  );
});

test('the work-claim contract states the version it moved to and why', () => {
  assert.ok(workClaimContract.includes('### Version 2'), 'the work-claim contract must have a version 2 section');
  assert.ok(
    workClaimContract.includes('The candidate source is not canonical base64.'),
    'the work-claim contract must keep the version 1 error it replaced for the size case',
  );
});
