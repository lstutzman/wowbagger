// test/claim-publish-refusal.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runCli } from '../src/cli.js';

// The comparison the spec promised: the CLI's refusal is held against the
// normative advisory-publication-rejection transcript, excluding only
// `operation_id` — the documented exclusion for a backend that refuses
// before reading any input (work-claim contract, advisory rejection).
test('the refusal matches the normative transcript except the documented operation_id exclusion', async () => {
  const manifest = JSON.parse(readFileSync(fileURLToPath(new URL(
    '../spec/fixtures/work-claims/advisory-publication-rejection/manifest.json',
    import.meta.url,
  )), 'utf8'));
  const [expected] = manifest.expected.transcript;
  const { operation_id, ...expectedEnvelope } = expected.stdout;
  assert.equal(typeof operation_id, 'string');

  const written = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { written.push(chunk); return true; };
  process.exitCode = 0;
  try {
    await runCli(['publish-claimed', '--ledger', 'ledger', '--input', '/dev/null', '--json']);
  } finally {
    process.stdout.write = write;
  }

  assert.deepEqual(JSON.parse(written.join('')), expectedEnvelope);
  assert.equal(process.exitCode, expected.exit);
  process.exitCode = 0;
});

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

test('publish-claimed refuses without reading its input file', async () => {
  const missingDir = await mkdtemp(path.join(tmpdir(), 'wb-pub-'));
  const missingInput = path.join(missingDir, 'definitely-absent.json');
  const written = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { written.push(chunk); return true; };
  try {
    await runCli(['publish-claimed', '--ledger', 'ledger', '--input', missingInput, '--json']);
  } finally {
    process.stdout.write = write;
  }
  const envelope = JSON.parse(written.join(''));
  assert.equal(envelope.ok, false);
  assert.equal(envelope.namespace, 'ledger-publication');
  assert.equal(envelope.command, 'publish-claimed');
  assert.equal(envelope.contract_version, 1);
  assert.equal(envelope.state, 'unchanged');
  assert.equal(envelope.error.code, 'capability-unavailable');
  assert.equal(envelope.error.message, 'Claim-protected publication is unavailable on an advisory backend.');
  assert.deepEqual(envelope.error.details, { reason: 'advisory-capability' });
  assert.equal(process.exitCode, 2);
  process.exitCode = 0;
});
