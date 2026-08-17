import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { linkDirectory } from './support.js';
import { readBootstrapRequest } from '../src/adapter/bootstrap.js';
import { launchCoreProcess } from '../src/adapter/entrypoint-main.js';
import { describeAdapter as referenceDescribeAdapter } from '../spec/adapter-reference.js';

const entrypoint = fileURLToPath(new URL('../adapters/claude-code/entrypoint.js', import.meta.url));
const adapterEntrypoints = ['claude-code', 'codex', 'opencode']
  .map((adapter) => fileURLToPath(new URL(`../adapters/${adapter}/entrypoint.js`, import.meta.url)));
const projectRoot = fileURLToPath(new URL('..', import.meta.url));

const validRequest = JSON.stringify({
  bootstrap_wire_version: 1,
  supported_adapter_contract_versions: [2],
  request_id: 'wire-test-0001',
});

// Spawns `adapters/claude-code/entrypoint.js` for real (never calling its
// exported functions directly) so the wire assertions exercise the actual
// process boundary: real stdin, real stdout, real exit code.
// §3.3 makes every entrypoint exit zero, so a non-zero exit is always a
// crash rather than a refusal; the child's stderr is the only place it
// explains itself, so it travels with the failure (item 106).
function spawnEntrypoint(args, stdinInput, {
  env = process.env,
  entrypointPath = entrypoint,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [entrypointPath, ...args], { encoding: 'buffer', env });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    child.stdout.on('data', (chunk) => { stdout = Buffer.concat([stdout, chunk]); });
    child.stderr.on('data', (chunk) => { stderr = Buffer.concat([stderr, chunk]); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(
          `${entrypointPath} ${args.join(' ')}: exited ${code}\nstderr:\n${stderr.toString('utf8')}`,
        ));
        return;
      }
      resolve({ code, stdout });
    });
    // The entrypoint can be gone before this write lands (it refuses an
    // unknown operation without reading stdin). An unhandled EPIPE here
    // would kill the test process instead of the child's real exit being
    // reported above.
    child.stdin.on('error', () => {});
    if (stdinInput === undefined) {
      child.stdin.end();
    } else {
      child.stdin.end(stdinInput);
    }
  });
}

// Like spawnEntrypoint but leaves the child's stdin open after writing
// `stdinInput` (no end()). Used to prove a refusal does not block waiting on
// a host that never closes stdin.
function spawnEntrypointOpenStdin(args, stdinInput, { env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [entrypoint, ...args], { encoding: 'buffer', env });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    child.stdout.on('data', (chunk) => { stdout = Buffer.concat([stdout, chunk]); });
    child.stderr.on('data', (chunk) => { stderr = Buffer.concat([stderr, chunk]); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(
          `${entrypoint} ${args.join(' ')}: exited ${code}\nstderr:\n${stderr.toString('utf8')}`,
        ));
        return;
      }
      resolve({ code, stdout });
    });
    child.stdin.on('error', () => {});
    child.stdin.write(stdinInput);
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
  assert.deepEqual(response.platforms, { darwin: 'supported', linux: 'supported', win32: 'supported' });
});

test('all adapter entrypoints return the contracted malformed describe refusal bytes', async () => {
  const request = {
    bootstrap_wire_version: 1,
    supported_adapter_contract_versions: [2],
    request_id: 'has a space',
  };
  const expected = Buffer.from(`${JSON.stringify(referenceDescribeAdapter(request, null, null))}\n`);

  for (const entrypointPath of adapterEntrypoints) {
    const { code, stdout } = await spawnEntrypoint(
      ['describe'],
      JSON.stringify(request),
      { entrypointPath },
    );
    assert.equal(code, 0, entrypointPath);
    assert.deepEqual(stdout, expected, entrypointPath);
  }
});

test('a version 1 consumer cannot negotiate with the version 2 adapter', async () => {
  const versionOneRequest = JSON.stringify({
    bootstrap_wire_version: 1,
    supported_adapter_contract_versions: [1],
    request_id: 'wire-v1-consumer-0001',
  });
  const { code, stdout } = await spawnEntrypoint(['describe'], versionOneRequest);

  assert.equal(code, 0);
  const response = assertSingleJsonObject(stdout);
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'unsupported-adapter-contract-version');
});

test('does not accept a runtime scenario through the production environment', async (t) => {
  const env = await candidateEnvironment(t);
  const runtimeConfigPath = path.join(path.dirname(env.WOWBAGGER_ADAPTER_MANIFEST_PATH), 'runtime.json');
  const apiOnly = JSON.parse(await readFile(
    path.join(projectRoot, 'spec', 'fixtures', 'adapters', '01-capability-separation', 'adapter-capabilities.json'),
    'utf8',
  ));
  await writeFile(runtimeConfigPath, JSON.stringify({ dynamic_result: apiOnly, core_probe: null }));
  env.WOWBAGGER_ADAPTER_RUNTIME_CONFIG_PATH = runtimeConfigPath;

  const { code, stdout } = await spawnEntrypoint(['describe'], validRequest, { env });

  assert.equal(code, 0);
  const response = assertSingleJsonObject(stdout);
  assert.equal(response.ok, true);
  assert.equal(response.adapter_id, 'dev.wowbagger.adapter.claude-code');
});

test('answers invoke through the bootstrap wire and refuses a future contract version', async () => {
  const request = JSON.stringify({
    adapter_contract_version: 3,
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
    adapter_contract_version: 2,
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

test('the core launcher enforces stream byte limits while retaining raw bytes', async (t) => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-core-launch-'));
  t.after(() => rm(temporaryDirectory, { force: true, recursive: true }));
  const launchWriter = async (stream, bytes) => {
    const executable = path.join(temporaryDirectory, `write-${stream}.js`);
    await writeFile(executable, `process.${stream}.write(Buffer.from(${JSON.stringify(bytes)}));\n`);
    return launchCoreProcess({
      executable,
      argv: [],
      cwd: temporaryDirectory,
      input: Buffer.alloc(0),
      limits: { stdout_bytes: 3, stderr_bytes: 3, timeout_ms: 1000 },
    });
  };

  const stdout = await launchWriter('stdout', [0x00, 0xff, 0x41, 0x42]);
  assert.equal(stdout.started, true);
  assert.equal(stdout.stdout_complete, false);
  assert.deepEqual(Buffer.from(stdout.stdout_base64, 'base64'), Buffer.from([0x00, 0xff, 0x41]));

  const stderr = await launchWriter('stderr', [0xfe, 0x42, 0x43, 0x44]);
  assert.equal(stderr.started, true);
  assert.equal(stderr.stderr_complete, false);
  assert.deepEqual(Buffer.from(stderr.stderr_base64, 'base64'), Buffer.from([0xfe, 0x42, 0x43]));
});

test('the core launcher enforces the advertised timeout', async (t) => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-core-timeout-'));
  t.after(() => rm(temporaryDirectory, { force: true, recursive: true }));
  const executable = path.join(temporaryDirectory, 'wait.js');
  await writeFile(executable, 'setTimeout(() => process.exit(0), 150);\n');

  const observation = await launchCoreProcess({
    executable,
    argv: [],
    cwd: temporaryDirectory,
    input: Buffer.alloc(0),
    limits: { stdout_bytes: 3, stderr_bytes: 3, timeout_ms: 20 },
  });

  assert.equal(observation.started, true);
  assert.equal(observation.timed_out, true);
  assert.equal(observation.exit_code, null);
  assert.equal(observation.signal, null);
  // A slow core that did receive its request is still an ordinary timeout.
  assert.equal(observation.input_delivery, 'delivered');
});

// Item 106: the core can be gone before the launcher's input write lands —
// it refused fast, or the adapter was descheduled under load between the
// spawn event and the write. The read end is then closed and the write
// fails EPIPE. The launcher must report the core's real exit through the
// observation; an unhandled stdin error would instead kill the adapter
// process itself, which the host sees only as a bare non-zero exit with no
// §3.3 response on stdout.
test('the core launcher survives a core that exits before its input is written', async (t) => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-core-epipe-'));
  t.after(() => rm(temporaryDirectory, { force: true, recursive: true }));
  const executable = path.join(temporaryDirectory, 'exit-before-read.js');
  await writeFile(executable, 'process.exit(7);\n');

  const observation = await launchCoreProcess({
    executable,
    argv: [],
    cwd: temporaryDirectory,
    // Larger than the pipe buffer, so the write is a real syscall against a
    // read end the exited core has already closed.
    input: Buffer.alloc(1024 * 1024, 0x61),
    limits: { stdout_bytes: 4096, stderr_bytes: 4096, timeout_ms: 5000 },
  });

  assert.equal(observation.started, true);
  assert.equal(observation.exit_code, 7);
  assert.equal(observation.signal, null);
  assert.equal(observation.timed_out, false);
  // The write failed here too, but the core's own exit is the answer. The
  // delivery fact stays honest without displacing that exit code.
  assert.equal(observation.input_delivery, 'failed');
});

// Item 109: the same failed write against a core that is still running has a
// different story. The core exited in the case above, so its exit code is the
// answer. Here nothing ends the run but the timeout, and reporting only the
// timeout hides the diagnosable fact that the request never reached the core.
test('the core launcher reports a failed input write against a living core', {
  // POSIX-only construct: a write into a pipe whose reading descriptor was
  // closed fails EPIPE there. win32 pipe writes complete into the buffer, so
  // the launcher's honest report on win32 is `unread`, covered by the next
  // test rather than a platform fork of this one.
  skip: process.platform === 'win32'
    ? 'win32 pipe writes into a closed descriptor do not fail; the honest observation there is unread'
    : false,
}, async (t) => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-core-unfed-'));
  t.after(() => rm(temporaryDirectory, { force: true, recursive: true }));
  const executable = path.join(temporaryDirectory, 'close-stdin-and-live.js');
  // Closing the descriptor itself, not just a Node stream wrapper around it,
  // is what makes the adapter's pending write fail EPIPE while the core runs.
  await writeFile(
    executable,
    'require("node:fs").closeSync(0);\nsetTimeout(() => process.exit(0), 5000);\n',
  );

  const observation = await launchCoreProcess({
    executable,
    argv: [],
    cwd: temporaryDirectory,
    input: Buffer.alloc(1024 * 1024, 0x61),
    limits: { stdout_bytes: 4096, stderr_bytes: 4096, timeout_ms: 250 },
  });

  assert.equal(observation.started, true);
  assert.equal(observation.timed_out, true);
  assert.equal(observation.input_delivery, 'failed');
});

// A core that neither reads its stdin nor closes it never fails the write: the
// pipe buffer fills and the rest of the request sits in the adapter. Nothing
// errors, so the observation must record the stall rather than call an input
// the core never saw delivered.
test('the core launcher reports an input write a living core never drains', async (t) => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-core-unread-'));
  t.after(() => rm(temporaryDirectory, { force: true, recursive: true }));
  const executable = path.join(temporaryDirectory, 'ignore-stdin-and-live.js');
  await writeFile(executable, 'setTimeout(() => process.exit(0), 5000);\n');

  const observation = await launchCoreProcess({
    executable,
    argv: [],
    cwd: temporaryDirectory,
    // Larger than the pipe buffer, so the write cannot complete without a
    // reader on the other end.
    input: Buffer.alloc(1024 * 1024, 0x61),
    limits: { stdout_bytes: 4096, stderr_bytes: 4096, timeout_ms: 250 },
  });

  assert.equal(observation.started, true);
  assert.equal(observation.timed_out, true);
  assert.equal(observation.input_delivery, 'unread');
});

// A launch that never happened wrote nothing, so it must claim no delivery
// state at all. Claiming one contradicts `started: false`, and the classifier
// then loses the deterministic `core-launch-failed` this observation proves.
test('the core launcher claims no delivery state when the core never started', async (t) => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-core-nostart-'));
  t.after(() => rm(temporaryDirectory, { force: true, recursive: true }));

  const observation = await launchCoreProcess({
    executable: path.join(temporaryDirectory, 'never-runs.js'),
    argv: [],
    cwd: path.join(temporaryDirectory, 'absent-working-directory'),
    input: Buffer.alloc(1024 * 1024, 0x61),
    limits: { stdout_bytes: 4096, stderr_bytes: 4096, timeout_ms: 5000 },
  });

  assert.equal(observation.started, false);
  assert.equal(Object.hasOwn(observation, 'input_delivery'), false);
});

// The ordinary case has to be nameable too, or the classifier cannot tell a
// core that never got its request from one that got it and misbehaved. The
// core here proves delivery by counting the bytes it read.
test('the core launcher reports an input write the core drains completely', async (t) => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-core-fed-'));
  t.after(() => rm(temporaryDirectory, { force: true, recursive: true }));
  const executable = path.join(temporaryDirectory, 'drain-stdin.js');
  await writeFile(executable, [
    'let read = 0;',
    'process.stdin.on("data", (chunk) => { read += chunk.length; });',
    'process.stdin.on("end", () => process.exit(read === 1048576 ? 0 : 9));',
    '',
  ].join('\n'));

  const observation = await launchCoreProcess({
    executable,
    argv: [],
    cwd: temporaryDirectory,
    input: Buffer.alloc(1024 * 1024, 0x61),
    limits: { stdout_bytes: 4096, stderr_bytes: 4096, timeout_ms: 5000 },
  });

  assert.equal(observation.started, true);
  assert.equal(observation.exit_code, 0);
  assert.equal(observation.input_delivery, 'delivered');
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

// Item 39 D2: the shipped wire's refusal message is pinned so it cannot
// silently diverge from the reference model and the contract. The expected
// text is asserted here independent of both copies; if anyone changes it in
// the entrypoint, invocation table, or reference model, this goes red.
test('pins the wire refusal message to the reference model and contract', async () => {
  const oversizedInvalidJson = Buffer.alloc(65537, 0x20);

  const { code, stdout } = await spawnEntrypoint(['invoke'], oversizedInvalidJson);

  assert.equal(code, 0);
  const response = assertSingleJsonObject(stdout);
  assert.equal(response.error.code, 'invalid-invocation');
  assert.equal(response.error.message, 'The adapter invocation is invalid.');
});

// Item 39 D1: describe reads share the configured byte ceiling so the first
// call any host makes is not an unbounded surface. The observable property is
// the bounded reader bails as soon as the limit is crossed without waiting
// for the stream to end — an unbounded describe reader would block forever on
// a never-ending oversized stream.
test('describe reads stop consuming an oversized stream that never ends', async () => {
  const oversizedSpaces = Buffer.alloc(65537, 0x20);

  const { code, stdout } = await spawnEntrypointOpenStdin(['describe'], oversizedSpaces);

  assert.equal(code, 0);
  const response = assertSingleJsonObject(stdout);
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'invalid-describe-request');
});

test('refuses with a stream-error detail instead of throwing when stdin errors', async () => {
  const failingStream = new Readable({
    read() {
      this.destroy(new Error('simulated stdin read error'));
    },
  });

  const result = await readBootstrapRequest(failingStream, {
    maxBytes: 65536,
    errorCode: 'invalid-invocation',
  });

  // §3.3: a stdin read failure must become a refusal the entrypoint can emit as
  // exactly one JSON object plus one LF, never an uncaught rejection that exits 1.
  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'invalid-invocation');
  assert.equal(result.detail.reason, 'stream-error');
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
    supported_adapter_contract_versions: [2],
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

// Item 39 D3: an unknown operation is refused BEFORE reading stdin, so a
// malformed or never-closed stdin cannot hang the entrypoint or be
// misreported as a describe read failure. The invalid-invocation refusal
// must win regardless of what arrives on stdin.
test('refuses an unknown operation before reading stdin, even with malformed stdin', async () => {
  const { code, stdout } = await spawnEntrypoint(['bogus-operation'], '{"bootstrap_wire_version":1}{"extra":true}');
  assert.equal(code, 0);
  const response = assertSingleJsonObject(stdout);
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'invalid-invocation');
});

test('refuses an unknown operation before reading stdin, even with never-closing stdin', async () => {
  // Leave stdin open (never end it) to prove the D3 guarantee: an unknown
  // operation is refused without blocking on a host that never closes stdin.
  const result = await spawnEntrypointOpenStdin(
    ['bogus-operation'],
    Buffer.from(validRequest),
  );
  assert.equal(result.code, 0);
  const response = assertSingleJsonObject(result.stdout);
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'invalid-invocation');
});

const STRUCTURALLY_INVALID_MANIFEST = JSON.stringify({
  adapter_manifest_version: 1,
  adapter_id: 'dev.wowbagger.adapter.claude-code',
  adapter_version: '0.1.0',
  adapter_contract_versions: [2],
  bootstrap_wire_version: 1,
  required_core_contract_version: 4,
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
    await linkDirectory(path.join(projectRoot, 'src'), path.join(temporaryDirectory, 'src'));
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
      // These cases make the entrypoint refuse before it touches stdin, so
      // the read end can already be closed when this write lands. An
      // unhandled EPIPE would kill the test process instead of the refusal
      // being asserted.
      child.stdin.on('error', () => {});
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
