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
