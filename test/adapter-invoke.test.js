import assert from 'node:assert/strict';
import test from 'node:test';
import { coreCapabilities } from '../src/adapter/core-probe.js';
import { invokeAdapter } from '../src/adapter/invoke.js';
import { adapterManifest, describeRequest, dynamicDescribe } from './adapter-contract-fixtures.js';

function runtime() {
  const dynamic = dynamicDescribe();
  return {
    max_request_bytes: dynamic.limits.max_request_bytes,
    describe_request: describeRequest(),
    manifest: adapterManifest(),
    dynamic,
    core_probe: coreCapabilities(),
    platform: 'darwin',
  };
}

test('refuses an invocation timeout above the advertised maximum', async () => {
  const request = {
    adapter_contract_version: 1,
    request_id: 'timeout-limit-0001',
    core_request: { command: 'capabilities' },
    instruction_input: { instruction_input_version: 1, required: false, sources: [] },
    handoff_carrier: null,
    limits: { context_bytes: 0, stdout_bytes: 4096, stderr_bytes: 1024, timeout_ms: 30001 },
  };

  const result = await invokeAdapter(Buffer.from(`${JSON.stringify(request)}\n`), runtime());

  assert.equal(result.error.code, 'timeout-limit-exceeded');
  assert.equal(result.request_id, request.request_id);
});

test('preserves exact core stream bytes and exit code', async () => {
  const request = {
    adapter_contract_version: 1,
    request_id: 'capability-bytes-0001',
    core_request: { command: 'capabilities' },
    instruction_input: { instruction_input_version: 1, required: false, sources: [] },
    handoff_carrier: null,
    limits: { context_bytes: 0, stdout_bytes: 4096, stderr_bytes: 1024, timeout_ms: 1000 },
  };
  const stdout = Buffer.from(`${JSON.stringify(coreCapabilities())}\n`);
  const configured = runtime();
  configured.package_root = '/installed/adapter';
  configured.launch = async () => ({
    started: true,
    process_tree_contained: true,
    orphaned: false,
    exit_code: 0,
    signal: null,
    timed_out: false,
    stdout_complete: true,
    stderr_complete: true,
    stdout_base64: stdout.toString('base64'),
    stderr_base64: '',
  });

  const result = await invokeAdapter(Buffer.from(`${JSON.stringify(request)}\n`), configured);

  assert.equal(result.ok, true);
  assert.equal(result.result.core_exit_code, 0);
  assert.deepEqual(Buffer.from(result.result.stdout.data, 'base64'), stdout);
  assert.deepEqual(Buffer.from(result.result.stderr.data, 'base64'), Buffer.alloc(0));
});
