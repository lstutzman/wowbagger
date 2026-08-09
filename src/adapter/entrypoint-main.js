import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readBootstrapRequest, writeBootstrapResponse } from './bootstrap.js';
import { CORE_COMMAND_ORDER } from './core-probe.js';
import { describeAdapter } from './describe.js';
import { invokeAdapter } from './invoke.js';
import { validateAdapterManifest } from './manifest.js';
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

export function standardDynamicResult(manifest, coreProbe) {
  return {
    ok: true,
    bootstrap_wire_version: 1,
    selected_adapter_contract_version: 1,
    adapter_id: manifest.adapter_id,
    adapter_version: manifest.adapter_version,
    core: {
      required_core_contract_version: 1,
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

export function launchCoreProcess({ executable, argv, cwd, input, limits }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [executable, ...argv], {
      cwd,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    let started = false;
    let spawnError = false;

    child.once('spawn', () => {
      started = true;
      child.stdin.end(input);
    });
    child.once('error', () => { spawnError = true; });
    child.stdout.on('data', (chunk) => { stdoutChunks.push(chunk); });
    child.stderr.on('data', (chunk) => { stderrChunks.push(chunk); });
    child.once('close', (code, signal) => {
      resolve({
        started: started && !spawnError,
        process_tree_contained: true,
        orphaned: false,
        exit_code: Number.isInteger(code) ? code : null,
        signal,
        timed_out: false,
        stdout_complete: true,
        stderr_complete: true,
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

// The shared §3.3 entrypoint flow every adapter package runs: load and
// validate its own manifest, read one bootstrap request, answer describe or
// refuse. Each adapter supplies only its manifest location and its honest
// host declaration through `dynamicResult(manifest)`.
export async function runAdapterEntrypoint({
  manifestUrl,
  dynamicResult,
  packageRoot = fileURLToPath(new URL('../../', manifestUrl)),
  coreExecutable = fileURLToPath(new URL('../../bin/wowbagger.js', import.meta.url)),
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

  const coreProbe = await probeCore(coreExecutable, packageRoot);
  const dynamic = dynamicResult(manifest, coreProbe);
  const incoming = await readBootstrapRequest(process.stdin, operation === 'invoke' ? {
    maxBytes: dynamic.limits.max_request_bytes,
    errorCode: 'invalid-invocation',
  } : undefined);
  if (!incoming.ok) {
    const response = operation === 'invoke'
      ? {
          ok: false,
          adapter_contract_version: 1,
          request_id: null,
          error: {
            code: incoming.error_code,
            message: 'The adapter invocation is invalid.',
            details: incoming.detail ?? { member: 'request_json' },
          },
        }
      : { ok: false, error: { code: incoming.error_code } };
    await writeBootstrapResponse(process.stdout, response);
    return;
  }

  if (operation === 'describe') {
    const described = describeAdapter(incoming.request, manifest, dynamic);
    await writeBootstrapResponse(
      process.stdout,
      described.ok ? described.result : { ok: false, error: { code: described.error_code } },
    );
    return;
  }

  if (operation === 'invoke') {
    const response = await invokeAdapter(incoming.bytes, {
      max_request_bytes: dynamic.limits.max_request_bytes,
      describe_request: {
        bootstrap_wire_version: 1,
        supported_adapter_contract_versions: [1],
        request_id: 'entrypoint-invoke-describe',
      },
      manifest,
      dynamic,
      core_probe: coreProbe,
      platform: process.platform,
      package_root: packageRoot,
      workspaces: {},
      launch: (request) => launchCoreProcess({ executable: coreExecutable, ...request }),
    });
    await writeBootstrapResponse(process.stdout, response);
    return;
  }

  await writeBootstrapResponse(process.stdout, { ok: false, error: { code: 'invalid-invocation' } });
}
