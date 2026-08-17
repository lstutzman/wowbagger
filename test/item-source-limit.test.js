import assert from 'node:assert/strict';
import test from 'node:test';

import {
  referenceCoreCapabilities,
  verifyCoreProbe as referenceVerifyCoreProbe,
} from '../spec/adapter-reference.js';
import { coreCapabilities, verifyCoreProbe } from '../src/adapter/core-probe.js';
import { dynamicDescribe } from './adapter-contract-fixtures.js';
import { runCli } from './support.js';

// The one public bound on a complete serialized item source. Written here as a
// literal, never imported from src: a test that reads the production constant
// cannot notice the constant moving.
const LIMIT = 8388608;

test('capabilities negotiates core contract version 4', () => {
  const result = runCli('capabilities', '--json');

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).contract_version, 4);
});

test('capabilities advertises the exact item source byte limit', () => {
  const result = runCli('capabilities', '--json');

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).result.limits.max_item_source_bytes, LIMIT);
});

// The two engines spell a refusal differently. Normalize to the one pair the
// negotiation questions below actually ask about.
function refusalOf(result) {
  return {
    code: result.error_code ?? result.error?.code,
    detail: result.detail ?? result.error?.details,
  };
}

// Both engines answer the same negotiation questions from independent code, so
// every probe question below is asked twice.
const PROBES = [
  ['engine', coreCapabilities, verifyCoreProbe],
  ['oracle', referenceCoreCapabilities, referenceVerifyCoreProbe],
];

for (const [name, capabilities, verify] of PROBES) {
  test(`${name}: a complete version 4 core envelope passes probe negotiation`, () => {
    assert.deepEqual(verify(dynamicDescribe(), capabilities()), { ok: true });
  });

  // A version 3 consumer validated `result.limits` by exact members and did not
  // know `max_item_source_bytes`. It must stop at negotiation rather than accept
  // a core whose accepted input has narrowed underneath it.
  test(`${name}: a version 3 core envelope fails closed at probe negotiation`, () => {
    const probe = capabilities();
    probe.contract_version = 3;
    const describe = dynamicDescribe();
    describe.core.required_core_contract_version = 3;

    const result = verify(describe, probe);

    assert.equal(result.ok, false);
    assert.equal(refusalOf(result).code, 'core-protocol-error');
  });

  test(`${name}: a real version 3 core envelope fails closed at probe negotiation`, () => {
    const probe = capabilities();
    probe.contract_version = 3;
    delete probe.result.limits.max_item_source_bytes;
    const describe = dynamicDescribe();
    describe.core.required_core_contract_version = 3;

    const result = verify(describe, probe);

    assert.equal(result.ok, false);
    assert.equal(refusalOf(result).code, 'core-protocol-error');
  });

  test(`${name}: a core envelope without the limit fails closed at probe negotiation`, () => {
    const probe = capabilities();
    delete probe.result.limits.max_item_source_bytes;

    const result = verify(dynamicDescribe(), probe);

    assert.equal(result.ok, false);
    assert.deepEqual(refusalOf(result).detail, { member: 'result.limits' });
  });

  test(`${name}: a core envelope whose advertised limit drifted fails closed`, () => {
    const probe = capabilities();
    probe.result.limits.max_item_source_bytes = LIMIT + 1;

    const result = verify(dynamicDescribe(), probe);

    assert.equal(result.ok, false);
    assert.deepEqual(refusalOf(result).detail, { member: 'result.limits' });
  });
}
