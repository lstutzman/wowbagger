import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readBootstrapRequest } from '../src/adapter/bootstrap.js';

const entrypoint = fileURLToPath(new URL('../adapters/claude-code/entrypoint.js', import.meta.url));
const projectRoot = fileURLToPath(new URL('..', import.meta.url));

const validRequest = JSON.stringify({
  bootstrap_wire_version: 1,
  supported_adapter_contract_versions: [1],
  request_id: 'wire-test-0001',
});

// Spawns `adapters/claude-code/entrypoint.js` for real (never calling its
// exported functions directly) so the wire assertions exercise the actual
// process boundary: real stdin, real stdout, real exit code.
function spawnEntrypoint(args, stdinInput, { env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [entrypoint, ...args], { encoding: 'buffer', env });
    let stdout = Buffer.alloc(0);
    child.stdout.on('data', (chunk) => { stdout = Buffer.concat([stdout, chunk]); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout }));
    if (stdinInput === undefined) {
      child.stdin.end();
    } else {
      child.stdin.end(stdinInput);
    }
  });
}

function execFileBytes(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { ...options, encoding: 'buffer' }, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
  });
}

async function candidateEnvironment(t, workspaces) {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-adapter-candidate-'));
  t.after(() => rm(temporaryDirectory, { force: true, recursive: true }));
  const candidateManifestPath = path.join(temporaryDirectory, 'wowbagger-adapter.json');
  const shippedManifest = JSON.parse(await readFile(
    path.join(projectRoot, 'adapters', 'claude-code', 'wowbagger-adapter.json'),
    'utf8',
  ));
  shippedManifest.platforms[process.platform] = 'supported';
  await writeFile(candidateManifestPath, JSON.stringify(shippedManifest));
  const env = { ...process.env, WOWBAGGER_ADAPTER_MANIFEST_PATH: candidateManifestPath };
  if (workspaces) {
    const workspaceConfigPath = path.join(temporaryDirectory, 'workspaces.json');
    await writeFile(workspaceConfigPath, JSON.stringify(workspaces));
    env.WOWBAGGER_ADAPTER_WORKSPACES_PATH = workspaceConfigPath;
  }
  return env;
}

// Asserts the §3.3 wire shape: exactly one JSON object, followed by exactly
// one trailing LF, with nothing else on stdout.
function assertSingleJsonObject(stdout) {
  const text = stdout.toString('utf8');
  assert.equal(text.endsWith('\n'), true);
  const body = text.slice(0, -1);
  assert.equal(body.includes('\n'), false);
  return JSON.parse(body);
}

test('answers describe with exactly one JSON object and exits zero', async () => {
  const { code, stdout } = await spawnEntrypoint(['describe'], validRequest);
  const baseline = await execFileBytes(process.execPath, [
    path.join(projectRoot, 'bin', 'wowbagger.js'), 'capabilities', '--json',
  ], { cwd: projectRoot });
  assert.equal(code, 0);
  const response = assertSingleJsonObject(stdout);
  assert.equal(response.ok, true);
  assert.equal(response.adapter_id, 'dev.wowbagger.adapter.claude-code');
  assert.equal(response.host.command_execution.shell, false);
  assert.equal(response.host.integration_mechanisms.mcp, false);
  assert.equal(response.host.integration_mechanisms.daemon, false);
  assert.equal(
    response.optional_features.claims,
    JSON.parse(baseline.stdout).result.operations.work_claim.supported,
  );
  assert.deepEqual(response.platforms, { darwin: 'unverified', linux: 'unverified', win32: 'unverified' });
});

test('answers invoke through the bootstrap wire and refuses a future contract version', async () => {
  const request = JSON.stringify({
    adapter_contract_version: 2,
    request_id: 'wire-invoke-version-0001',
    core_request: { command: 'capabilities' },
    instruction_input: { instruction_input_version: 1, required: false, sources: [] },
    handoff_carrier: null,
    limits: { context_bytes: 0, stdout_bytes: 4096, stderr_bytes: 1024, timeout_ms: 1000 },
  });

  const { code, stdout } = await spawnEntrypoint(['invoke'], request);

  assert.equal(code, 0);
  const response = assertSingleJsonObject(stdout);
  assert.equal(response.error.code, 'adapter-contract-selection-mismatch');
  assert.equal(response.request_id, 'wire-invoke-version-0001');
});

test('forwards capabilities through the shipped entrypoint and real core', async (t) => {
  const env = await candidateEnvironment(t);
  const request = JSON.stringify({
    adapter_contract_version: 1,
    request_id: 'wire-capabilities-real-core-0001',
    core_request: { command: 'capabilities' },
    instruction_input: { instruction_input_version: 1, required: false, sources: [] },
    handoff_carrier: null,
    limits: { context_bytes: 0, stdout_bytes: 65536, stderr_bytes: 1024, timeout_ms: 1000 },
  });
  const baseline = await execFileBytes(process.execPath, [
    path.join(projectRoot, 'bin', 'wowbagger.js'), 'capabilities', '--json',
  ], { cwd: projectRoot });

  const { code, stdout } = await spawnEntrypoint(['invoke'], request, {
    env,
  });

  assert.equal(code, 0);
  const response = assertSingleJsonObject(stdout);
  assert.equal(response.ok, true);
  assert.equal(response.result.core_exit_code, 0);
  assert.deepEqual(Buffer.from(response.result.stdout.data, 'base64'), baseline.stdout);
  assert.deepEqual(Buffer.from(response.result.stderr.data, 'base64'), baseline.stderr);
});

test('resolves an approved workspace and forwards ready through the real core', async (t) => {
  const env = await candidateEnvironment(t, {
    'fixture-ready-workspace': path.join(projectRoot, 'spec', 'fixtures', 'ready-selection'),
  });
  const invocation = await readFile(
    path.join(projectRoot, 'spec', 'fixtures', 'adapters', '03-ready-forwarding', 'invocation.json'),
  );
  const expected = JSON.parse(await readFile(
    path.join(projectRoot, 'spec', 'fixtures', 'adapters', '03-ready-forwarding', 'expected-adapter-result.json'),
    'utf8',
  ));

  const { code, stdout } = await spawnEntrypoint(['invoke'], invocation, {
    env,
  });

  assert.equal(code, 0);
  assert.deepEqual(assertSingleJsonObject(stdout), expected);
});

test('bounds invoke bytes before parsing the request', async () => {
  const oversizedInvalidJson = Buffer.alloc(65537, 0x20);

  const { code, stdout } = await spawnEntrypoint(['invoke'], oversizedInvalidJson);

  assert.equal(code, 0);
  const response = assertSingleJsonObject(stdout);
  assert.equal(response.error.code, 'invalid-invocation');
  assert.equal(response.error.details.reason, 'byte-limit-exceeded');
  assert.equal(response.request_id, null);
});

test('accepts an invocation request at the exact byte limit', async () => {
  const maxBytes = 65536;
  const prefix = '{"padding":"';
  const suffix = '"}';
  const requestBytes = Buffer.from(prefix + 'x'.repeat(maxBytes - prefix.length - suffix.length) + suffix);

  const result = await readBootstrapRequest(Readable.from([requestBytes]), {
    maxBytes,
    errorCode: 'invalid-invocation',
  });

  assert.equal(requestBytes.length, maxBytes);
  assert.equal(result.ok, true);
});

test('stops consuming and releases an invocation stream after it crosses the byte limit', async () => {
  let pulledBytes = 0;
  let released = false;
  async function* requestChunks() {
    try {
      for (const size of [4, 4, 4]) {
        pulledBytes += size;
        yield Buffer.alloc(size, 0x20);
      }
    } finally {
      released = true;
    }
  }

  const result = await readBootstrapRequest(requestChunks(), {
    maxBytes: 5,
    errorCode: 'invalid-invocation',
  });

  assert.deepEqual(result, {
    ok: false,
    error_code: 'invalid-invocation',
    detail: { member: 'request', reason: 'byte-limit-exceeded', limit_bytes: 5 },
  });
  assert.equal(pulledBytes, 8);
  assert.equal(released, true);
});

test('refuses a request with trailing bytes and still exits zero', async () => {
  const { code, stdout } = await spawnEntrypoint(['describe'], '{"bootstrap_wire_version":1}{"extra":true}');
  assert.equal(code, 0);
  const response = assertSingleJsonObject(stdout);
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'invalid-describe-request');
});

test('refuses a request with duplicate members and still exits zero', async () => {
  const duplicateRequest = '{"bootstrap_wire_version":1,"bootstrap_wire_version":1,'
    + '"supported_adapter_contract_versions":[1],"request_id":"wire-test-0002"}';
  const { code, stdout } = await spawnEntrypoint(['describe'], duplicateRequest);
  assert.equal(code, 0);
  const response = assertSingleJsonObject(stdout);
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'invalid-describe-request');
});

test('refuses invalid UTF-8 on stdin and still exits zero', async () => {
  const invalidUtf8 = Buffer.from([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d]); // {"<invalid bytes>"}
  const { code, stdout } = await spawnEntrypoint(['describe'], invalidUtf8);
  assert.equal(code, 0);
  const response = assertSingleJsonObject(stdout);
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'invalid-describe-request');
});

test('refuses empty stdin and still exits zero', async () => {
  const { code, stdout } = await spawnEntrypoint(['describe'], '');
  assert.equal(code, 0);
  const response = assertSingleJsonObject(stdout);
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'invalid-describe-request');
});

// §3.3 gives the describe request an exact member set. `__proto__` is the
// dangerous spelling: a normalizer that rebuilds the parsed object with
// `target[key] = value` invokes Object.prototype's `__proto__` setter, which
// erases the member as an own key, so an exact-member check counting
// `Object.keys` never sees the fourth member and accepts the request.
test('refuses a describe request carrying a __proto__ member and still exits zero', async () => {
  const protoRequest = '{"__proto__":{"polluted":true},"bootstrap_wire_version":1,'
    + '"supported_adapter_contract_versions":[1],"request_id":"wire-test-0004"}';
  const { code, stdout } = await spawnEntrypoint(['describe'], protoRequest);
  assert.equal(code, 0);
  const response = assertSingleJsonObject(stdout);
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'invalid-describe-request');
});

test('refuses a describe request carrying an ordinary unknown member and still exits zero', async () => {
  const unknownMemberRequest = JSON.stringify({
    bootstrap_wire_version: 1,
    supported_adapter_contract_versions: [1],
    request_id: 'wire-test-0005',
    unexpected_member: true,
  });
  const { code, stdout } = await spawnEntrypoint(['describe'], unknownMemberRequest);
  assert.equal(code, 0);
  const response = assertSingleJsonObject(stdout);
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'invalid-describe-request');
});

test('refuses an unsupported adapter contract version and still exits zero', async () => {
  const unsupportedRequest = JSON.stringify({
    bootstrap_wire_version: 1,
    supported_adapter_contract_versions: [99],
    request_id: 'wire-test-0003',
  });
  const { code, stdout } = await spawnEntrypoint(['describe'], unsupportedRequest);
  assert.equal(code, 0);
  const response = assertSingleJsonObject(stdout);
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'unsupported-adapter-contract-version');
});

test('refuses an unknown operation and still exits zero', async () => {
  const { code, stdout } = await spawnEntrypoint(['bogus-operation'], validRequest);
  assert.equal(code, 0);
  const response = assertSingleJsonObject(stdout);
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'invalid-invocation');
});

test('reports the request read failure, not invalid-invocation, for an unknown operation with malformed stdin', async () => {
  const { code, stdout } = await spawnEntrypoint(['bogus-operation'], '{"bootstrap_wire_version":1}{"extra":true}');
  assert.equal(code, 0);
  const response = assertSingleJsonObject(stdout);
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'invalid-describe-request');
});

const STRUCTURALLY_INVALID_MANIFEST = JSON.stringify({
  adapter_manifest_version: 1,
  adapter_id: 'dev.wowbagger.adapter.claude-code',
  adapter_version: '0.1.0',
  adapter_contract_versions: [1],
  bootstrap_wire_version: 1,
  required_core_contract_version: 1,
  entrypoints: {
    describe: { kind: 'command', executable: 'adapters/claude-code/entrypoint.js', fixed_args: ['describe'] },
    invoke: { kind: 'command', executable: 'adapters/claude-code/entrypoint.js', fixed_args: ['invoke'] },
  },
  // `platforms` deliberately omitted.
});

// A manifest that is syntactically valid JSON but carries a duplicated
// `adapter_id` member — a lenient last-wins parser (e.g. bare JSON.parse)
// would silently advertise the second, hostile value.
const HOSTILE_ADAPTER_ID = 'dev.evil.impostor';
const DUPLICATE_MEMBER_MANIFEST = `{
  "adapter_manifest_version": 1,
  "adapter_id": "dev.wowbagger.adapter.claude-code",
  "adapter_id": "${HOSTILE_ADAPTER_ID}",
  "adapter_version": "0.1.0",
  "adapter_contract_versions": [1],
  "bootstrap_wire_version": 1,
  "required_core_contract_version": 1,
  "entrypoints": {
    "describe": { "kind": "command", "executable": "adapters/claude-code/entrypoint.js", "fixed_args": ["describe"] },
    "invoke": { "kind": "command", "executable": "adapters/claude-code/entrypoint.js", "fixed_args": ["invoke"] }
  },
  "platforms": { "darwin": "unverified", "linux": "unverified", "win32": "unverified" }
}`;

// Spawns a byte-for-byte copy of the real entrypoint.js from a temp
// directory at the same `adapters/<name>/entrypoint.js` depth (so its
// `../../src/...` relative imports still resolve, via a symlink to the real
// `src/`), with `wowbagger-adapter.json` replaced by `manifestContent`.
// Passing `undefined` omits the manifest file entirely (simulating a
// missing/unreadable install). This is the harness the manifest self-check
// tests share; it never calls entrypoint logic directly.
async function withTemporaryManifest(manifestContent, { operation = 'describe', stdinInput = validRequest } = {}) {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-adapter-'));
  try {
    const claudeCodeDirectory = path.join(temporaryDirectory, 'adapters', 'claude-code');
    await cp(path.join(projectRoot, 'adapters', 'claude-code', 'entrypoint.js'), path.join(claudeCodeDirectory, 'entrypoint.js'), {
      recursive: true,
    });
    await symlink(path.join(projectRoot, 'src'), path.join(temporaryDirectory, 'src'));
    if (manifestContent !== undefined) {
      await writeFile(path.join(claudeCodeDirectory, 'wowbagger-adapter.json'), manifestContent);
    }

    const spawnedEntrypoint = path.join(claudeCodeDirectory, 'entrypoint.js');
    return await new Promise((resolve, reject) => {
      const child = execFile(process.execPath, [spawnedEntrypoint, operation], { encoding: 'buffer' });
      let out = Buffer.alloc(0);
      let err = Buffer.alloc(0);
      child.stdout.on('data', (chunk) => { out = Buffer.concat([out, chunk]); });
      child.stderr.on('data', (chunk) => { err = Buffer.concat([err, chunk]); });
      child.on('error', reject);
      child.on('close', (exitCode) => resolve({ code: exitCode, stdout: out, stderr: err }));
      if (stdinInput === undefined) {
        child.stdin.end();
      } else {
        child.stdin.end(stdinInput);
      }
    });
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

test('refuses to advertise when its own manifest is structurally invalid, before touching stdin', async () => {
  // Never writes stdin: the manifest self-check must fail and respond
  // before the entrypoint would otherwise wait for a request.
  const { code, stdout } = await withTemporaryManifest(STRUCTURALLY_INVALID_MANIFEST, { stdinInput: undefined });
  assert.equal(code, 0);
  const response = assertSingleJsonObject(stdout);
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'invalid-adapter-manifest');
});

test('refuses a syntactically broken manifest file with exit 0 and nothing on stderr', async () => {
  const { code, stdout, stderr } = await withTemporaryManifest('{ this is not json', { stdinInput: undefined });
  assert.equal(code, 0);
  assert.equal(stderr.length, 0);
  const response = assertSingleJsonObject(stdout);
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'invalid-adapter-manifest');
});

test('refuses an absent manifest file with exit 0 and nothing on stderr', async () => {
  const { code, stdout, stderr } = await withTemporaryManifest(undefined, { stdinInput: undefined });
  assert.equal(code, 0);
  assert.equal(stderr.length, 0);
  const response = assertSingleJsonObject(stdout);
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'invalid-adapter-manifest');
});

test('refuses an empty manifest file with exit 0 and nothing on stderr', async () => {
  const { code, stdout, stderr } = await withTemporaryManifest('', { stdinInput: undefined });
  assert.equal(code, 0);
  assert.equal(stderr.length, 0);
  const response = assertSingleJsonObject(stdout);
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'invalid-adapter-manifest');
});

// The manifest read path carries the same `__proto__` hazard as the wire
// request: an unknown root member spelled `__proto__` must be refused as an
// unknown root member, not silently absorbed into the object's prototype.
const PROTO_MEMBER_MANIFEST = `{
  "__proto__": { "polluted": true },
  "adapter_manifest_version": 1,
  "adapter_id": "dev.wowbagger.adapter.claude-code",
  "adapter_version": "0.1.0",
  "adapter_contract_versions": [1],
  "bootstrap_wire_version": 1,
  "required_core_contract_version": 1,
  "entrypoints": {
    "describe": { "kind": "command", "executable": "adapters/claude-code/entrypoint.js", "fixed_args": ["describe"] },
    "invoke": { "kind": "command", "executable": "adapters/claude-code/entrypoint.js", "fixed_args": ["invoke"] }
  },
  "platforms": { "darwin": "unverified", "linux": "unverified", "win32": "unverified" }
}`;

test('refuses a manifest carrying a __proto__ root member with exit 0 and nothing on stderr', async () => {
  const { code, stdout, stderr } = await withTemporaryManifest(PROTO_MEMBER_MANIFEST, { stdinInput: undefined });
  assert.equal(code, 0);
  assert.equal(stderr.length, 0);
  const response = assertSingleJsonObject(stdout);
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'invalid-adapter-manifest');
});

test('refuses a duplicate-member manifest and never advertises the hostile second adapter_id', async () => {
  const { code, stdout } = await withTemporaryManifest(DUPLICATE_MEMBER_MANIFEST, { stdinInput: undefined });
  assert.equal(code, 0);
  const response = assertSingleJsonObject(stdout);
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'invalid-adapter-manifest');
  assert.equal(stdout.toString('utf8').includes(HOSTILE_ADAPTER_ID), false);
});
