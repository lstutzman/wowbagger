import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertSingleJsonObject, spawnEntrypoint } from './adapter-wire-support.js';

const entrypoint = fileURLToPath(new URL('../adapters/codex/entrypoint.js', import.meta.url));

const validRequest = JSON.stringify({
  bootstrap_wire_version: 1,
  supported_adapter_contract_versions: [2],
  request_id: 'codex-wire-test-0001',
});

test('the codex adapter answers describe with its own identity on the shared wire', async () => {
  const { code, stdout } = await spawnEntrypoint(entrypoint, ['describe'], validRequest);

  assert.equal(code, 0);
  const response = assertSingleJsonObject(stdout);
  assert.equal(response.ok, true);
  assert.equal(response.adapter_id, 'dev.wowbagger.adapter.codex');
  assert.equal(response.bootstrap_wire_version, 1);
  assert.equal(response.selected_adapter_contract_version, 2);
  assert.equal(response.core.required_core_contract_version, 3);
  assert.equal(response.host.command_execution.shell, false);
  assert.deepEqual(response.platforms, { darwin: 'unverified', linux: 'unverified', win32: 'unverified' });
});

test('the codex adapter refuses a malformed wire request and still exits zero', async () => {
  const { code, stdout } = await spawnEntrypoint(entrypoint, ['describe'], '{"bootstrap_wire_version":1}{"extra":true}');

  assert.equal(code, 0);
  const response = assertSingleJsonObject(stdout);
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'invalid-describe-request');
});
