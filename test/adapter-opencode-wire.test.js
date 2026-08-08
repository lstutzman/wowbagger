import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const entrypoint = fileURLToPath(new URL('../adapters/opencode/entrypoint.js', import.meta.url));

const validRequest = JSON.stringify({
  bootstrap_wire_version: 1,
  supported_adapter_contract_versions: [1],
  request_id: 'opencode-wire-test-0001',
});

// Spawns the opencode adapter entrypoint for real, like the Claude Code wire
// test, so the assertions exercise the actual process boundary.
function spawnEntrypoint(args, stdinInput) {
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [entrypoint, ...args], { encoding: 'buffer' });
    let stdout = Buffer.alloc(0);
    child.stdout.on('data', (chunk) => { stdout = Buffer.concat([stdout, chunk]); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout }));
    child.stdin.end(stdinInput);
  });
}

function assertSingleJsonObject(stdout) {
  const text = stdout.toString('utf8');
  assert.equal(text.endsWith('\n'), true);
  const body = text.slice(0, -1);
  assert.equal(body.includes('\n'), false);
  return JSON.parse(body);
}

test('the opencode adapter answers describe with its own identity on the shared wire', async () => {
  const { code, stdout } = await spawnEntrypoint(['describe'], validRequest);

  assert.equal(code, 0);
  const response = assertSingleJsonObject(stdout);
  assert.equal(response.ok, true);
  assert.equal(response.adapter_id, 'dev.wowbagger.adapter.opencode');
  assert.equal(response.bootstrap_wire_version, 1);
  assert.equal(response.selected_adapter_contract_version, 1);
  assert.equal(response.core.required_core_contract_version, 1);
  assert.equal(response.host.command_execution.shell, false);
  assert.deepEqual(response.platforms, { darwin: 'unverified', linux: 'unverified', win32: 'unverified' });
});

test('the opencode adapter refuses a malformed wire request and still exits zero', async () => {
  const { code, stdout } = await spawnEntrypoint(['describe'], '{"bootstrap_wire_version":1}{"extra":true}');

  assert.equal(code, 0);
  const response = assertSingleJsonObject(stdout);
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'invalid-describe-request');
});
