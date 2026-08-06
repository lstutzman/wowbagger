// test/claim-publish-refusal.test.js
import assert from 'node:assert/strict';
import test from 'node:test';

import { runCli } from '../src/cli.js';

test('publish-claimed refuses with the contract capability-unavailable envelope', async () => {
  const written = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { written.push(chunk); return true; };
  try {
    await runCli(['publish-claimed', '--ledger', 'ledger', '--input', '/dev/null', '--json']);
  } finally {
    process.stdout.write = write;
  }
  const envelope = JSON.parse(written.join(''));
  assert.equal(envelope.ok, false);
  assert.equal(envelope.namespace, 'ledger-publication');
  assert.equal(envelope.command, 'publish-claimed');
  assert.equal(envelope.state, 'unchanged');
  assert.equal(envelope.error.code, 'capability-unavailable');
  assert.equal(envelope.error.message, 'Claim-protected publication is unavailable on an advisory backend.');
  assert.deepEqual(envelope.error.details, { reason: 'advisory-capability' });
  assert.equal(process.exitCode, 2);
  process.exitCode = 0;
});
