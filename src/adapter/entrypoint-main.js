import { lstat, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBootstrapRequest, writeBootstrapResponse } from './bootstrap.js';
import { CORE_COMMAND_ORDER, CORE_CONTRACT_VERSION } from './core-probe.js';
import { ADAPTER_CONTRACT_VERSION, describeAdapter } from './describe.js';
import { invokeAdapter } from './invoke.js';
import { validateAdapterManifest } from './manifest.js';
import { INVOKE_MESSAGES } from './messages.js';
import { isSafeLogicalPath } from './paths.js';
import { normalizeJsonValue, parseJsonRequest } from '../request.js';

// The launch discipline every current adapter package shares: argv-array
// core launch without a shell, guarded-relative workspace selection,
// host-provided instructions, consumer-only trusted approval. Each adapter
// still owns its declaration — it calls this factory and may override any
// member before returning, so a harness whose guarantees genuinely differ
// diverges deliberately instead of by missed edit.
const STANDARD_LIMITS = Object.freeze({
  max_request_bytes: 65536,
  max_context_bytes: 65536,
  max_stdout_bytes: 1048576,
  max_stderr_bytes: 65536,
  max_timeout_ms: 30000,
});
const PROBE_LIVE_CORE = Symbol('probe-live-core');

function invalidDescribeResponse(details) {
  return {
    ok: false,
    bootstrap_wire_version: 1,
    error: {
      code: 'invalid-describe-request',
      message: 'The adapter describe request is invalid.',
      details,
    },
  };
}

export function standardDynamicResult(manifest, coreProbe) {
  return {
    ok: true,
    bootstrap_wire_version: 1,
    selected_adapter_contract_version: ADAPTER_CONTRACT_VERSION,
    adapter_id: manifest.adapter_id,
    adapter_version: manifest.adapter_version,
    core: {
      required_core_contract_version: CORE_CONTRACT_VERSION,
      commands: [...CORE_COMMAND_ORDER],
    },
    host: {
      command_execution: {
        supported: true,
        arguments_array: true,
        shell: false,
        stdio: true,
        process_tree_containment: true,
        orphan_detection: true,
        timeout_enforcement: true,
        stdout_limit: true,
        stderr_limit: true,
      },
      filesystem: {
        workspace_selection: 'guarded-relative',
        no_follow_resolution: true,
        stable_identity: true,
        component_walk: true,
      },
      model_transport: { available: true, protocol: 'openai-compatible' },
      instruction_input: { mode: 'host-provided', max_sources: 8, max_bytes: 65536 },
      handoff: { supported: true, persistence: 'explicit-only' },
      trusted_approval: { supported: true, sources: ['consumer'] },
      integration_mechanisms: { hooks: false, slash_commands: false, mcp: false, daemon: false },
    },
    optional_features: { claims: coreProbe?.result?.operations?.work_claim?.supported === true, policy: false },
    limits: { ...STANDARD_LIMITS },
    platforms: manifest.platforms,
  };
}

function appendBounded(chunks, state, chunk, limit, terminate) {
  const remaining = Math.max(0, limit - state.length);
  if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
  state.length += chunk.length;
  if (state.length > limit && !state.exceeded) {
    state.exceeded = true;
    terminate();
  }
}

export function launchCoreProcess({ executable, argv, cwd, input, limits }) {
  return new Promise((resolve) => {
    const detached = process.platform !== 'win32';
    const child = spawn(process.execPath, [executable, ...argv], {
      cwd,
      detached,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    const stdoutState = { length: 0, exceeded: false };
    const stderrState = { length: 0, exceeded: false };
    let started = false;
    let spawnError = false;
    let timedOut = false;
    // Item 109: what the core received is a separate fact from how the run
    // ended. Until the write settles the request is simply unread — the core
    // has neither drained the pipe nor closed it.
    let inputDelivery = 'unread';
    let inputDeliverySettled = false;
    const settleInputDelivery = (state) => {
      if (inputDeliverySettled) return;
      inputDeliverySettled = true;
      inputDelivery = state;
    };

    const terminate = () => {
      // Killing the core closes its read end, so a pending write errors EPIPE
      // moments later. That error is this adapter's own doing and says nothing
      // about the core, so the delivery fact is frozen before the kill.
      inputDeliverySettled = true;
      if (child.exitCode !== null || child.signalCode !== null) return;
      try {
        if (detached && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, limits.timeout_ms);

    child.once('spawn', () => {
      started = true;
      // The core may already be gone when this write lands — it refused fast,
      // or this process was descheduled under load between `spawn` and here.
      // Its read end is then closed and the write fails EPIPE. That is the
      // core's outcome to report, not the adapter's to die of: an unhandled
      // stdin error would kill the adapter before it could emit its one §3.3
      // JSON object, leaving the host a bare non-zero exit and empty stdout.
      // The `close` handler below still reports the core's real exit.
      child.stdin.on('error', () => settleInputDelivery('failed'));
      child.stdin.end(input, (writeError) => {
        settleInputDelivery(writeError ? 'failed' : 'delivered');
      });
    });
    child.once('error', () => { spawnError = true; });
    child.stdout.on('data', (chunk) => {
      appendBounded(stdoutChunks, stdoutState, chunk, limits.stdout_bytes, terminate);
    });
    child.stderr.on('data', (chunk) => {
      appendBounded(stderrChunks, stderrState, chunk, limits.stderr_bytes, terminate);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      const outputExceeded = stdoutState.exceeded || stderrState.exceeded;
      const deliberatelyTerminated = outputExceeded || timedOut;
      const launched = started && !spawnError;
      resolve({
        started: launched,
        // A run that never started never attempted a write, so it makes no
        // delivery claim at all rather than a false 'unread' one.
        ...(launched ? { input_delivery: inputDelivery } : {}),
        process_tree_contained: true,
        orphaned: false,
        exit_code: deliberatelyTerminated || !Number.isInteger(code) ? null : code,
        signal: deliberatelyTerminated ? null : signal,
        timed_out: timedOut,
        stdout_complete: !stdoutState.exceeded,
        stderr_complete: !stderrState.exceeded,
        stdout_base64: Buffer.concat(stdoutChunks).toString('base64'),
        stderr_base64: Buffer.concat(stderrChunks).toString('base64'),
      });
    });
  });
}

async function probeCore(coreExecutable, packageRoot) {
  const observation = await launchCoreProcess({
    executable: coreExecutable,
    argv: ['capabilities', '--json'],
    cwd: packageRoot,
    input: Buffer.alloc(0),
    limits: {
      stdout_bytes: STANDARD_LIMITS.max_stdout_bytes,
      stderr_bytes: STANDARD_LIMITS.max_stderr_bytes,
      timeout_ms: STANDARD_LIMITS.max_timeout_ms,
    },
  });
  if (!observation.started || observation.exit_code !== 0
    || !observation.stdout_complete || !observation.stderr_complete) return undefined;
  const parsed = parseJsonRequest(Buffer.from(observation.stdout_base64, 'base64'));
  return parsed.issues.length === 0 ? normalizeJsonValue(parsed.value) : undefined;
}

// The installed package's own manifest file is read as bytes and parsed
// with the same strict-JSON parser used for the wire request (section 3.1
// declares the manifest is "strict JSON", the same standard section 10
// holds the fixtures to). A missing/unreadable file, syntactically invalid
// JSON, or a duplicate top-level member (e.g. a hostile second adapter_id
// that a lenient last-wins parser would silently accept) all resolve to
// `undefined` rather than throwing; `validateAdapterManifest(undefined)`
// already refuses with `invalid-adapter-manifest`, so the caller does not
// need a separate load-failure branch.
async function loadManifest(manifestUrl) {
  let bytes;
  try {
    bytes = await readFile(fileURLToPath(manifestUrl));
  } catch {
    return undefined;
  }
  const parsed = parseJsonRequest(bytes);
  if (parsed.issues.length > 0) {
    return undefined;
  }
  return normalizeJsonValue(parsed.value);
}

async function loadWorkspaceRoots(workspaceConfigUrl) {
  if (!workspaceConfigUrl) return Object.create(null);
  let parsed;
  try {
    parsed = parseJsonRequest(await readFile(fileURLToPath(workspaceConfigUrl)));
  } catch {
    return Object.create(null);
  }
  if (parsed.issues.length > 0) return Object.create(null);
  const roots = normalizeJsonValue(parsed.value);
  if (roots === null || typeof roots !== 'object' || Array.isArray(roots)) {
    return Object.create(null);
  }
  return roots;
}

function logicalComponents(logicalPath) {
  if (!isSafeLogicalPath(logicalPath) || logicalPath === '.') return [];
  const segments = logicalPath.split('/');
  return segments.map((_, index) => segments.slice(0, index + 1).join('/'));
}

async function pathSnapshot(absolutePath) {
  try {
    const stats = await lstat(absolutePath);
    const kind = stats.isDirectory()
      ? 'directory'
      : stats.isSymbolicLink() ? 'symbolic-link' : stats.isFile() ? 'regular-file' : 'special';
    return { kind, identity: { dev: stats.dev, ino: stats.ino } };
  } catch {
    return { kind: 'missing', identity: 'missing' };
  }
}

async function captureWorkspace(root, request) {
  const snapshot = { '.': await pathSnapshot(root) };
  const components = new Set([
    ...logicalComponents(request.workspace.cwd ?? '.'),
    ...logicalComponents(request.core_request.ledger),
  ]);
  for (const component of components) {
    snapshot[component] = await pathSnapshot(path.join(root, ...component.split('/')));
  }
  return snapshot;
}

async function invocationWorkspaces(request, workspaceRoots) {
  if (request?.core_request?.command === 'capabilities' || !request?.workspace) return {};
  const root = workspaceRoots[request.workspace.workspace_id];
  if (typeof root !== 'string' || !path.isAbsolute(root)) return {};
  const approvedRoot = path.resolve(root);
  const before = await captureWorkspace(approvedRoot, request);
  const after = await captureWorkspace(approvedRoot, request);
  return {
    [request.workspace.workspace_id]: { root: approvedRoot, before, after },
  };
}

// The shared §3.3 entrypoint flow every adapter package runs: load and
// validate its own manifest, read one bootstrap request, answer describe or
// refuse. Each adapter supplies only its manifest location and its honest
// host declaration through `dynamicResult(manifest)`.
export async function runAdapterEntrypoint({
  manifestUrl,
  dynamicResult,
  packageRoot = fileURLToPath(new URL('../../', manifestUrl)),
  coreExecutable = fileURLToPath(new URL('../../bin/wowbagger.js', import.meta.url)),
  workspaceConfigUrl,
  coreProbe: suppliedCoreProbe = PROBE_LIVE_CORE,
  launch: suppliedLaunch,
  argv = process.argv,
}) {
  const [operation] = argv.slice(2);
  const manifest = await loadManifest(manifestUrl);

  // §3.1: the package's own manifest is validated before it is advertised.
  const validated = validateAdapterManifest(manifest);
  if (!validated.ok) {
    await writeBootstrapResponse(process.stdout, { ok: false, error: { code: validated.error_code } });
    return;
  }

  const coreProbe = suppliedCoreProbe === PROBE_LIVE_CORE
    ? await probeCore(coreExecutable, packageRoot)
    : suppliedCoreProbe;
  const dynamic = dynamicResult(manifest, coreProbe);

  // §3.3 (item 39): an unknown operation is refused without reading stdin.
  // Reading would otherwise wait on a host that never closes stdin, and a
  // malformed read would misreport as a describe error instead of an
  // invalid-invocation. Only describe and invoke are valid bootstrap ops.
  if (operation !== 'describe' && operation !== 'invoke') {
    await writeBootstrapResponse(process.stdout, { ok: false, error: { code: 'invalid-invocation' } });
    return;
  }

  // Both describe and invoke reads share the configured request byte ceiling
  // (item 39, D1). describe was previously unbounded — the first call any
  // host makes is the more exposed surface, so it must be bounded too.
  const incoming = await readBootstrapRequest(process.stdin, {
    maxBytes: dynamic.limits.max_request_bytes,
    errorCode: operation === 'invoke' ? 'invalid-invocation' : 'invalid-describe-request',
  });
  if (!incoming.ok) {
    const response = operation === 'invoke'
      ? {
          ok: false,
          adapter_contract_version: ADAPTER_CONTRACT_VERSION,
          request_id: null,
          error: {
            code: incoming.error_code,
            message: INVOKE_MESSAGES[incoming.error_code]
              ?? 'The adapter invocation is invalid.',
            details: incoming.detail,
          },
        }
      : invalidDescribeResponse(incoming.detail);
    await writeBootstrapResponse(process.stdout, response);
    return;
  }

  if (operation === 'describe') {
    const described = describeAdapter(incoming.request, manifest, dynamic);
    const response = described.ok
      ? described.result
      : described.error_code === 'invalid-describe-request'
        ? invalidDescribeResponse({ member: described.detail })
        : { ok: false, error: { code: described.error_code } };
    await writeBootstrapResponse(process.stdout, response);
    return;
  }

  if (operation === 'invoke') {
    const workspaceRoots = await loadWorkspaceRoots(workspaceConfigUrl);
    const workspaces = await invocationWorkspaces(incoming.request, workspaceRoots);
    const response = await invokeAdapter(incoming.bytes, {
      max_request_bytes: dynamic.limits.max_request_bytes,
      describe_request: {
        bootstrap_wire_version: 1,
        supported_adapter_contract_versions: [ADAPTER_CONTRACT_VERSION],
        request_id: 'entrypoint-invoke-describe',
      },
      manifest,
      dynamic,
      core_probe: coreProbe,
      platform: process.platform,
      package_root: packageRoot,
      workspaces,
      launch: suppliedLaunch
        ?? ((request) => launchCoreProcess({ executable: coreExecutable, ...request })),
    });
    await writeBootstrapResponse(process.stdout, response);
    return;
  }
}
