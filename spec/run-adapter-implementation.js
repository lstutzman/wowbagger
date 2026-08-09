#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonNumber, normalizeJsonValue, parseJsonRequest } from '../src/request.js';
// Scenario-shaping helpers only, from a module that imports nothing. The
// model under test is never imported from spec/adapter-reference.js: an
// implementation runner that asked the oracle whether the oracle passes its
// own vectors would report nothing.
import { applyCapabilityInvariantScenario, mutateObject } from './scenario-shaping.js';
import { describeAdapter } from '../src/adapter/describe.js';
import { resolveEntrypointPath } from '../src/adapter/entrypoint-path.js';
import { validateAdapterManifest } from '../src/adapter/manifest.js';
import { CORE_COMMAND_ORDER, coreCapabilities, verifyCoreProbe } from '../src/adapter/core-probe.js';
import { verifyMutationAuthority, verifyTrustedApproval } from '../src/adapter/approval.js';
import { validateInstructionInput } from '../src/adapter/instructions.js';
import { validateInvokeContext } from '../src/adapter/context.js';
import { buildResumePlan, validateHandoffResume } from '../src/adapter/handoff.js';
import { validateInvocationLimits } from '../src/adapter/limits.js';
import { resolveInvocationPaths } from '../src/adapter/paths.js';
import { mapProcessOutcome } from '../src/adapter/process-outcome.js';
import { sameJson } from '../src/adapter/schema-helpers.js';

const defaultFixtureRoot = fileURLToPath(new URL('./fixtures/adapters/', import.meta.url));
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const ADAPTER_STDOUT_LIMIT = 2 * 1024 * 1024;
const ADAPTER_STDERR_LIMIT = 64 * 1024;
const ADAPTER_TIMEOUT_MS = 35000;

const SUPPORTED_ASSERTION_TYPES = new Set([
  'core-baseline', 'capability', 'instruction-order', 'path-refusal',
  'output-bound', 'approval-gate', 'resume-plan', 'platform-status',
  'process-outcome', 'path-race', 'path-syntax', 'snapshot-identity',
  'entrypoint-path', 'invoke-version', 'core-probe', 'negotiation',
  'context-validation', 'approval-schema',
]);
const SUPPORTED_EXECUTION_MODES = new Set(['equivalence', 'negative-capability', 'protocol']);

const CORE_COMMANDS = [...CORE_COMMAND_ORDER];

// Every assertion this plan cannot evidence carries this outcome. It is never
// `ok`, so a case holding one can never reach `pass`.
const UNIMPLEMENTED = Object.freeze({ ok: false, evidence: 'unimplemented' });

// Fixture JSON is held to the same strict standard as the wire: a duplicate
// member or trailing bytes is a fixture defect, not a value to guess at. The
// vector manifest keeps its numbers boxed, because `adapter_vector_version` is
// compared against the raw source text — unwrapping first would silently
// accept `1.0` and `1e0` as version 1.
async function parseStrictJson(file) {
  const parsed = parseJsonRequest(await readFile(file));
  if (parsed.issues.length > 0) {
    throw new Error(`${file}: invalid strict JSON`);
  }
  return parsed.value;
}

async function readStrictJson(file) {
  return normalizeJsonValue(await parseStrictJson(file));
}

function isSafeArtifactPath(value) {
  return typeof value === 'string'
    && value.length > 0
    && !value.startsWith('/')
    && !value.includes('\\')
    && !value.includes('\0')
    && value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

async function verifyArtifacts(directory, manifest) {
  if (!Array.isArray(manifest.artifacts)) {
    throw new Error(`${manifest.case}: artifacts must be an array`);
  }
  for (const artifact of manifest.artifacts) {
    if (!isSafeArtifactPath(artifact?.path)) {
      throw new Error(`${manifest.case}: unsafe artifact path ${artifact?.path}`);
    }
    const file = path.join(directory, artifact.path);
    const bytes = await readFile(file);
    const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (digest !== artifact.sha256) {
      throw new Error(`${manifest.case}: artifact SHA-256 mismatch for ${artifact.path}`);
    }
    if (artifact.path.endsWith('.json')) await parseStrictJson(file);
  }
}

function parseBootstrapResponse(stdout, entrypoint) {
  if (stdout.length < 3 || stdout[stdout.length - 1] !== 0x0A) {
    throw new Error(`${entrypoint}: bootstrap stdout must end with exactly one LF`);
  }
  const body = stdout.subarray(0, -1);
  if (body[0] !== 0x7B || body[body.length - 1] !== 0x7D
    || body.includes(0x0A) || body.includes(0x0D)) {
    throw new Error(`${entrypoint}: bootstrap stdout is not exactly one JSON object plus one LF`);
  }
  const parsed = parseJsonRequest(body);
  if (parsed.issues.length > 0) {
    throw new Error(`${entrypoint}: bootstrap stdout is not strict JSON`);
  }
  return normalizeJsonValue(parsed.value);
}

async function spawnAdapterEntrypoint(entrypoint, operation, request, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entrypoint, operation], {
      cwd: projectRoot,
      detached: process.platform !== 'win32',
      env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let transportFailure = null;
    const terminate = () => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    };
    const timer = setTimeout(() => {
      transportFailure = new Error(`${entrypoint}: adapter bootstrap timed out`);
      terminate();
    }, ADAPTER_TIMEOUT_MS);
    child.once('spawn', () => { child.stdin.end(Buffer.from(JSON.stringify(request))); });
    child.once('error', reject);
    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= ADAPTER_STDOUT_LIMIT) stdout.push(chunk);
      else {
        transportFailure = new Error(`${entrypoint}: adapter stdout limit exceeded`);
        terminate();
      }
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= ADAPTER_STDERR_LIMIT) stderr.push(chunk);
      else {
        transportFailure = new Error(`${entrypoint}: adapter stderr limit exceeded`);
        terminate();
      }
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (transportFailure) reject(transportFailure);
      else if (code !== 0 || signal !== null) {
        reject(new Error(`${entrypoint}: adapter transport failed (${code ?? signal})`));
      } else resolve(parseBootstrapResponse(Buffer.concat(stdout), entrypoint));
    });
  });
}

async function callShippedEntrypoint(request, target, { operation = 'invoke', workspaces = {} } = {}) {
  const entrypoint = path.join(projectRoot, 'adapters', target, 'entrypoint.js');
  const shippedManifestPath = path.join(projectRoot, 'adapters', target, 'wowbagger-adapter.json');
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-adapter-candidate-'));
  try {
    const candidateManifest = await readStrictJson(shippedManifestPath);
    candidateManifest.platforms[process.platform] = 'supported';
    const candidateManifestPath = path.join(temporary, 'wowbagger-adapter.json');
    const workspacesPath = path.join(temporary, 'workspaces.json');
    await writeFile(candidateManifestPath, JSON.stringify(candidateManifest));
    await writeFile(workspacesPath, JSON.stringify(workspaces));
    return {
      response: await spawnAdapterEntrypoint(entrypoint, operation, request, {
        WOWBAGGER_ADAPTER_MANIFEST_PATH: candidateManifestPath,
        WOWBAGGER_ADAPTER_WORKSPACES_PATH: workspacesPath,
      }),
      evidence: path.relative(projectRoot, entrypoint),
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

const scenarioCache = new Map();

// Every caller gets its own copy. The scenario objects handed to the engine
// are shallow spreads of the bases, so a nested mutation such as
// `entrypoints.invoke.executable` would otherwise reach through the spread
// and corrupt the bases for every later assertion in the case.
async function readScenarios(directory) {
  if (!scenarioCache.has(directory)) {
    scenarioCache.set(directory, await readStrictJson(path.join(directory, 'scenarios.json')));
  }
  return structuredClone(scenarioCache.get(directory));
}

function findScenario(scenarios, id) {
  const scenario = scenarios?.find((entry) => entry.id === id);
  if (!scenario) {
    throw new Error(`unknown scenario ${id}`);
  }
  return scenario;
}

// A scenario that does not declare what it expects measures nothing:
// `result.error_code === scenario.expected` reduces to `undefined ===
// undefined` for every accept, so a missing or misspelled `expected` key
// would report `ok` on the strength of a fixture typo. A fixture defect is
// refused outright, as every other fixture defect in this runner is.
function matchesExpectation(result, scenario) {
  if (!Object.hasOwn(scenario, 'expected')) {
    throw new Error(`scenario ${scenario.id} declares no expected error code`);
  }
  return result.error_code === scenario.expected;
}

// The negotiation, core-probe, and entrypoint-path assertions all inject a
// synthetic manifest or describe result. The §3.3 bootstrap wire carries only
// the describe request, so they are evaluated against the shipped engine
// modules imported directly rather than across the process boundary; adding a
// test-injection seam to the entrypoint would weaken the shipped binary.
async function evaluateNegotiationAssertion(directory, assertion, target) {
  const data = await readScenarios(directory);

  if (assertion.type === 'invoke-version') {
    const scenario = findScenario(data.invoke_cases, assertion.scenario);
    const request = {
      adapter_contract_version: scenario.adapter_contract_version,
      request_id: scenario.id,
      core_request: { command: 'capabilities' },
      instruction_input: { instruction_input_version: 1, required: false, sources: [] },
      handoff_carrier: null,
      limits: { context_bytes: 0, stdout_bytes: 4096, stderr_bytes: 1024, timeout_ms: 1000 },
    };
    const invoked = await callShippedEntrypoint(request, target);
    const result = invoked.response;
    return {
      ok: result.error.code === scenario.expected,
      evidence: invoked.evidence,
      error_code: result.error.code,
    };
  }

  if (assertion.type === 'entrypoint-path') {
    const scenario = findScenario(data.entrypoint_paths, assertion.scenario);
    const result = resolveEntrypointPath(scenario);
    return {
      ok: matchesExpectation(result, scenario),
      evidence: 'src/adapter/entrypoint-path.js',
      error_code: result.error_code,
    };
  }

  if (assertion.type === 'core-probe') {
    const scenario = findScenario(data.core_probe_cases, assertion.scenario);
    const describe = structuredClone(data.base_dynamic);
    const probe = coreCapabilities();
    mutateObject(scenario.target === 'probe' ? probe : describe, scenario);
    const result = verifyCoreProbe(describe, probe);
    return {
      ok: matchesExpectation(result, scenario),
      evidence: 'src/adapter/core-probe.js',
      error_code: result.error_code,
    };
  }

  const scenario = findScenario(data.cases, assertion.scenario);
  const request = { ...data.base_request, ...scenario.request };
  const manifest = { ...data.base_manifest, ...scenario.manifest };
  const dynamic = {
    ...data.base_dynamic,
    ...scenario.dynamic,
    core: { ...data.base_dynamic.core, ...scenario.dynamic?.core },
    platforms: scenario.dynamic?.platforms ?? data.base_dynamic.platforms,
  };
  if (scenario.target) {
    const targets = { request, manifest, dynamic };
    if (!targets[scenario.target]) {
      throw new Error(`unknown mutation target ${scenario.target}`);
    }
    mutateObject(targets[scenario.target], scenario);
  }
  if (scenario.capability_invariant) {
    applyCapabilityInvariantScenario(dynamic, scenario.capability_invariant);
  }
  // One scenario probes the core contract version rather than the describe
  // negotiation, so it is answered by the core-probe module.
  const probesCore = scenario.id === 'required-core-version';
  const result = probesCore
    ? verifyCoreProbe(
      {
        core: {
          required_core_contract_version: scenario.required_core_contract_version,
          commands: CORE_COMMANDS,
        },
        optional_features: { claims: false, policy: false },
      },
      coreCapabilities(),
    )
    : describeAdapter(request, manifest, dynamic);
  return {
    ok: matchesExpectation(result, scenario),
    evidence: probesCore ? 'src/adapter/core-probe.js' : 'src/adapter/describe.js',
    error_code: result.error_code,
  };
}

// The committed capability artifact is a §3.2 describe result. Running it back
// through the shipped negotiator is what makes `src/adapter/describe.js` an
// honest evidence label: the accepted result, not the raw file, is what
// declares both optional features absent.
async function evaluateCapabilityAssertion(directory, assertion, target) {
  if (assertion.expect === 'refuse-before-core-launch') {
    const invocation = await readStrictJson(path.join(directory, 'invocation.json'));
    const expected = await readStrictJson(path.join(directory, 'expected-refusal.json'));
    await readStrictJson(path.join(directory, 'adapter-capabilities.json'));
    const invoked = await callShippedEntrypoint(invocation, target);
    const result = invoked.response;
    return {
      ok: sameJson(result, expected),
      evidence: invoked.evidence,
      error_code: result.error.code,
    };
  }
  if (assertion.expect !== 'claims-and-policy-false') {
    if (assertion.expect === 'work-claim-advisory') {
      const bytes = await readFile(path.join(directory, 'expected-core-stdout.jsonl'));
      const parsed = parseJsonRequest(bytes);
      if (parsed.issues.length > 0) return { ok: false, evidence: 'src/adapter/core-probe.js' };
      const probe = normalizeJsonValue(parsed.value);
      const invocation = await readStrictJson(path.join(directory, 'invocation.json'));
      const invoked = await callShippedEntrypoint(invocation, target);
      const actual = invoked.response.ok
        ? JSON.parse(Buffer.from(invoked.response.result.stdout.data, 'base64').toString('utf8'))
        : null;
      return {
        ok: probe.result.operations.work_claim.mode === 'advisory'
          && probe.result.operations.work_claim.safe_exclusive_dispatch === false
          && actual?.result?.operations?.work_claim?.mode === 'advisory'
          && actual.result.operations.work_claim.safe_exclusive_dispatch === false,
        evidence: invoked.evidence,
        error_code: invoked.response.error?.code,
      };
    }
    return UNIMPLEMENTED;
  }
  const capabilities = await readStrictJson(path.join(directory, 'adapter-capabilities.json'));
  const invoked = await callShippedEntrypoint({
    bootstrap_wire_version: capabilities.bootstrap_wire_version,
    supported_adapter_contract_versions: [1],
    request_id: assertion.id,
  }, target, { operation: 'describe' });
  const described = invoked.response;
  return {
    ok: described.ok === true
      && described.optional_features.claims === false
      && described.optional_features.policy === false,
    evidence: invoked.evidence,
    error_code: described.error?.code,
  };
}

let probedCore;

function actualCoreProbe() {
  if (probedCore) return structuredClone(probedCore);
  const result = spawnSync(process.execPath, [path.join(projectRoot, 'bin/wowbagger.js'), 'capabilities', '--json'], {
    cwd: projectRoot,
    encoding: null,
  });
  if (result.status !== 0) throw new Error('core capability probe failed');
  const parsed = parseJsonRequest(result.stdout);
  if (parsed.issues.length > 0) throw new Error('core capability probe returned invalid JSON');
  probedCore = normalizeJsonValue(parsed.value);
  return structuredClone(probedCore);
}

function vectorDynamic(probe = actualCoreProbe()) {
  return {
    ok: true,
    bootstrap_wire_version: 1,
    selected_adapter_contract_version: 1,
    adapter_id: 'example.implementation-vector',
    adapter_version: '1.0.0',
    core: { required_core_contract_version: 1, commands: [...CORE_COMMAND_ORDER] },
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
    optional_features: { claims: probe.result.operations.work_claim.supported, policy: false },
    limits: {
      max_request_bytes: 65536,
      max_context_bytes: 65536,
      max_stdout_bytes: 1048576,
      max_stderr_bytes: 65536,
      max_timeout_ms: 30000,
    },
    platforms: { darwin: 'supported', linux: 'supported', win32: 'supported' },
  };
}

function vectorRuntime({ workspaces = {}, launch, approval = null } = {}) {
  const probe = actualCoreProbe();
  const dynamic = vectorDynamic(probe);
  return {
    max_request_bytes: dynamic.limits.max_request_bytes,
    describe_request: {
      bootstrap_wire_version: 1,
      supported_adapter_contract_versions: [1],
      request_id: 'implementation-vector-describe',
    },
    manifest: {
      adapter_manifest_version: 1,
      adapter_id: dynamic.adapter_id,
      adapter_version: dynamic.adapter_version,
      adapter_contract_versions: [1],
      bootstrap_wire_version: 1,
      required_core_contract_version: 1,
      entrypoints: {
        describe: { kind: 'command', executable: 'bin/adapter', fixed_args: ['describe'] },
        invoke: { kind: 'command', executable: 'bin/adapter', fixed_args: ['invoke'] },
      },
      platforms: dynamic.platforms,
    },
    dynamic,
    core_probe: probe,
    platform: process.platform,
    package_root: projectRoot,
    workspaces,
    launch,
    approval,
    now: '2030-01-15T12:01:00Z',
    redeemed_nonces: new Set(),
    core_executable_identity: `sha256:${'a'.repeat(64)}`,
  };
}

function workspaceFor(invocation, root) {
  if (!invocation.workspace) return {};
  const before = { '.': { kind: 'directory', identity: 'workspace-root' } };
  for (const logicalPath of [invocation.workspace.cwd ?? '.', invocation.core_request.ledger]) {
    if (!logicalPath || logicalPath === '.') continue;
    const segments = logicalPath.split('/');
    for (let index = 1; index <= segments.length; index += 1) {
      const component = segments.slice(0, index).join('/');
      before[component] = { kind: 'directory', identity: `component-${component}` };
    }
  }
  return {
    [invocation.workspace.workspace_id]: { root, before, after: structuredClone(before) },
  };
}

function coreObservation({ argv, cwd, input, limits }) {
  const result = spawnSync(process.execPath, [path.join(projectRoot, 'bin/wowbagger.js'), ...argv], {
    cwd,
    input,
    encoding: null,
    timeout: limits.timeout_ms,
    maxBuffer: Math.max(limits.stdout_bytes, limits.stderr_bytes) + 1,
  });
  const stdout = result.stdout ?? Buffer.alloc(0);
  const stderr = result.stderr ?? Buffer.alloc(0);
  return {
    started: !result.error || result.error.code !== 'ENOENT',
    process_tree_contained: true,
    orphaned: false,
    exit_code: Number.isInteger(result.status) ? result.status : null,
    signal: result.signal ?? null,
    timed_out: result.error?.code === 'ETIMEDOUT',
    stdout_complete: stdout.length <= limits.stdout_bytes,
    stderr_complete: stderr.length <= limits.stderr_bytes,
    stdout_base64: stdout.subarray(0, limits.stdout_bytes).toString('base64'),
    stderr_base64: stderr.subarray(0, limits.stderr_bytes).toString('base64'),
  };
}

async function evaluateCoreBaselineAssertion(directory, assertion, target) {
  const coreInvocation = await readStrictJson(path.join(directory, 'core-invocation.json'));
  const invocation = await readStrictJson(path.join(directory, 'invocation.json'));
  const expected = await readStrictJson(path.join(directory, 'expected-adapter-result.json'));
  let root = projectRoot;
  let argv = [...coreInvocation.argv];
  let temporary = null;
  if (coreInvocation.command === 'ready') {
    root = path.join(projectRoot, 'spec/fixtures/ready-selection');
    const ledgerIndex = argv.indexOf('--ledger');
    argv[ledgerIndex + 1] = path.join(root, 'ledger');
  } else if (coreInvocation.command === 'validate') {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-adapter-vector-'));
    root = temporary;
    const ledger = path.join(root, 'ledger');
    await mkdir(ledger);
    await writeFile(path.join(ledger, 'bad.md'), await readFile(path.join(directory, 'ledger-bad.md')));
    const ledgerIndex = argv.indexOf('--ledger');
    argv[ledgerIndex + 1] = ledger;
  }
  try {
    const workspaces = invocation.workspace
      ? { [invocation.workspace.workspace_id]: root }
      : {};
    const invoked = await callShippedEntrypoint(invocation, target, { workspaces });
    return {
      ok: sameJson(invoked.response, expected),
      evidence: invoked.evidence,
      error_code: invoked.response.error?.code,
    };
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}

async function evaluateOutputBoundAssertion(directory, assertion, target) {
  await readStrictJson(path.join(directory, 'process.json'));
  const invocation = await readStrictJson(path.join(directory, 'invocation.json'));
  const expected = await readStrictJson(path.join(directory, 'expected-refusal.json'));
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-output-vector-'));
  try {
    await mkdir(path.join(temporary, 'ledger'));
    const invoked = await callShippedEntrypoint(invocation, target, {
      workspaces: { [invocation.workspace.workspace_id]: temporary },
    });
    return {
      ok: invoked.response.error?.code === assertion.expect && sameJson(invoked.response, expected),
      evidence: invoked.evidence,
      error_code: invoked.response.error?.code,
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

// §3.1 platform statuses are evidence-based: `supported` is a claim, and no
// manifest may make it without native common-vector evidence. The shipped
// manifest validator is what accepts the package manifest whose platform map
// the interpretation then reads.
async function evaluatePlatformAssertion(directory, assertion) {
  const packageManifest = await readStrictJson(path.join(directory, 'package-manifest.json'));
  const expected = await readStrictJson(path.join(directory, assertion.expect));
  const validated = validateAdapterManifest(packageManifest);
  const interpretation = {
    supported_platforms: Object.entries(packageManifest.platforms)
      .filter(([, status]) => status === 'supported').map(([platform]) => platform),
    unverified_platforms: Object.entries(packageManifest.platforms)
      .filter(([, status]) => status === 'unverified').map(([platform]) => platform),
    required_before_support_claim: 'native-common-vector-evidence',
  };
  return {
    ok: validated.ok === true && JSON.stringify(interpretation) === JSON.stringify(expected),
    evidence: 'src/adapter/manifest.js',
    error_code: validated.error_code,
  };
}

async function evaluateInvocationPathAssertion(directory, assertion, target) {
  if (assertion.type === 'path-refusal') {
    await readStrictJson(path.join(directory, 'filesystem-shape.json'));
    const invocation = await readStrictJson(path.join(directory, 'invocation.json'));
    const expected = await readStrictJson(path.join(directory, 'expected-refusal.json'));
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-path-vector-'));
    try {
      await mkdir(path.join(temporary, 'ledger'));
      await symlink('ledger', path.join(temporary, invocation.core_request.ledger));
      const invoked = await callShippedEntrypoint(invocation, target, {
        workspaces: { [invocation.workspace.workspace_id]: temporary },
      });
      return {
        ok: sameJson(invoked.response, expected)
          && invoked.response.error?.details?.kind === assertion.expect,
        evidence: invoked.evidence,
        error_code: invoked.response.error?.code,
      };
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  const data = await readScenarios(directory);
  if (assertion.type === 'path-race') {
    const input = {
      workspace_root: data.workspace_root,
      cwd: data.cwd,
      ledger: data.ledger,
      before: data.before,
      after: assertion.expect === 'root-anchored' ? data.before : data.after,
    };
    const result = resolveInvocationPaths(input);
    const ok = assertion.expect === 'root-anchored'
      ? result.ok === true && result.ledger === data.expected.ledger_argument
      : result.error_code === data.expected.refusal
        && result.detail.path_role === data.expected.path_role
        && result.detail.component === data.expected.component;
    return { ok, evidence: 'src/adapter/paths.js', error_code: result.error_code };
  }
  if (assertion.type === 'path-syntax') {
    const scenario = findScenario(data.invalid_paths, assertion.scenario);
    const snapshot = { '.': { kind: 'directory', identity: 'root-1' } };
    const result = resolveInvocationPaths({
      workspace_root: data.workspace_root,
      cwd: scenario.path,
      ledger: '.',
      before: snapshot,
      after: snapshot,
    });
    return {
      ok: result.error_code === scenario.expected,
      evidence: 'src/adapter/paths.js',
      error_code: result.error_code,
    };
  }

  const scenario = findScenario(data.snapshot_cases, assertion.scenario);
  const before = structuredClone(data.before);
  const after = structuredClone(data.before);
  const snapshot = scenario.side === 'before' ? before : after;
  if (scenario.operation === 'delete') delete snapshot[scenario.component].identity;
  else snapshot[scenario.component].identity = scenario.identity;
  const result = resolveInvocationPaths({
    workspace_root: data.workspace_root,
    cwd: data.cwd,
    ledger: data.ledger,
    before,
    after,
  });
  return {
    ok: result.error_code === scenario.expected,
    evidence: 'src/adapter/paths.js',
    error_code: result.error_code,
  };
}

async function evaluateProcessOutcomeAssertion(directory, assertion) {
  const data = await readScenarios(directory);
  const scenario = findScenario(data.scenarios, assertion.scenario);
  const result = mapProcessOutcome(scenario.request);
  return {
    ok: result.error.code === scenario.expected_code
      && (result.mutation_outcome ?? null) === scenario.expected_mutation_outcome
      && result.process.orphaned === false,
    evidence: 'src/adapter/process-outcome.js',
    error_code: result.error.code,
  };
}

async function evaluateInstructionAssertion(directory, assertion) {
  const input = await readStrictJson(path.join(directory, 'instruction-input.json'));
  const expected = await readStrictJson(path.join(directory, 'expected-discovery.json'));
  const result = validateInstructionInput(input, {
    max_sources: input.sources.length,
    max_bytes: Number.MAX_SAFE_INTEGER,
  });
  const discovery = result.ok ? {
    source_ids: result.ordered_sources,
    discovery_mode: 'host-provided',
    guessed_filenames: false,
    total_bytes: result.total_bytes,
  } : null;
  return {
    ok: result.ok
      && sameJson(discovery, expected)
      && (Array.isArray(assertion.expect)
        ? sameJson(result.ordered_sources, assertion.expect)
        : assertion.expect === 'no-guessed-filenames' && discovery.guessed_filenames === false),
    evidence: 'src/adapter/instructions.js',
    error_code: result.error_code,
  };
}

function replaceHandoffBytes(carrier, bytes) {
  carrier.content_base64 = bytes.toString('base64');
  carrier.byte_length = bytes.length;
  carrier.sha256 = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

async function evaluateContextAssertion(directory, assertion) {
  const data = await readScenarios(directory);
  const scenario = findScenario(data.cases, assertion.scenario);
  if (scenario.kind === 'invocation-limit') {
    const requested = structuredClone(data.base_invocation_limits);
    mutateObject(requested, scenario);
    const result = validateInvocationLimits(requested, data.advertised_invocation_limits);
    return {
      ok: result.error_code === scenario.expected,
      evidence: 'src/adapter/limits.js',
      error_code: result.error_code,
    };
  }
  if (scenario.kind === 'legacy-handoff') {
    const result = validateHandoffResume({
      handoff_bytes: Buffer.from(data.base_handoff_carrier.content_base64, 'base64'),
      handoff_digest: scenario.handoff_digest,
      resume_request: data.base_handoff_carrier.resume_request,
      current: data.handoff_options.current,
      max_bytes: data.handoff_options.max_bytes,
    });
    return {
      ok: result.error_code === scenario.expected,
      evidence: 'src/adapter/handoff.js',
      error_code: result.error_code,
    };
  }

  const instructionInput = structuredClone(data.base_instruction);
  const instructionLimits = structuredClone(data.instruction_limits);
  const handoffCarrier = scenario.kind === 'instruction'
    ? null : structuredClone(data.base_handoff_carrier);
  const handoffOptions = structuredClone(data.handoff_options);
  if (scenario.kind === 'instruction') {
    if (scenario.duplicate_source) instructionInput.sources.push(structuredClone(instructionInput.sources[0]));
    else if (scenario.limit_bytes !== undefined) instructionLimits.max_bytes = scenario.limit_bytes;
    else if (scenario.limit_sources !== undefined) instructionLimits.max_sources = scenario.limit_sources;
    else mutateObject(instructionInput, scenario);
  } else if (scenario.kind === 'handoff') {
    if (scenario.duplicate_json) {
      replaceHandoffBytes(handoffCarrier, Buffer.from('{"handoff_version":1,"handoff_version":1}\n'));
    } else if (scenario.handoff_object_version !== undefined || scenario.handoff_item_id !== undefined) {
      const handoff = JSON.parse(Buffer.from(handoffCarrier.content_base64, 'base64').toString('utf8'));
      if (scenario.handoff_object_version !== undefined) handoff.handoff_version = scenario.handoff_object_version;
      if (scenario.handoff_item_id !== undefined) handoff.item.id = scenario.handoff_item_id;
      replaceHandoffBytes(handoffCarrier, Buffer.from(`${JSON.stringify(handoff)}\n`));
    } else if (scenario.current_revision) handoffOptions.current.revision = scenario.current_revision;
    else if (scenario.current_item_id) handoffOptions.current.item_id = scenario.current_item_id;
    else if (scenario.current_instruction_set_digest) {
      handoffOptions.current.instruction_set_digest = scenario.current_instruction_set_digest;
    } else if (scenario.handoff_limit_bytes !== undefined) handoffOptions.max_bytes = scenario.handoff_limit_bytes;
    else mutateObject(handoffCarrier, scenario);
  }
  const result = validateInvokeContext({
    instruction_input: instructionInput,
    handoff_carrier: handoffCarrier,
    context_bytes: scenario.context_bytes ?? data.context_bytes,
    instruction_limits: instructionLimits,
    handoff_options: handoffOptions,
  });
  return {
    ok: (result.ok ? 'ok' : result.error_code) === scenario.expected,
    evidence: scenario.kind === 'instruction'
      ? 'src/adapter/instructions.js'
      : scenario.kind === 'combined' ? 'src/adapter/context.js' : 'src/adapter/handoff.js',
    error_code: result.error_code,
  };
}

async function evaluateResumePlanAssertion(directory, assertion) {
  const fixture = await readStrictJson(path.join(directory, 'handoff-carrier.json'));
  const expected = await readStrictJson(path.join(directory, assertion.expect));
  const result = buildResumePlan(fixture.carrier, fixture.options);
  return {
    ok: result.ok && sameJson({
      must_invoke: result.must_invoke,
      must_compare: result.must_compare,
      forbidden_automatic_actions: result.forbidden_automatic_actions,
    }, expected),
    evidence: 'src/adapter/handoff.js',
    error_code: result.error_code,
  };
}

async function evaluateApprovalSchemaAssertion(directory, assertion) {
  const data = await readScenarios(directory);
  const scenario = findScenario(data.cases, assertion.scenario);
  const approval = structuredClone(data.base_approval);
  const binding = structuredClone(data.base_binding);
  mutateObject(scenario.target === 'binding' ? binding : approval, scenario);
  const redeemedNonces = new Set();
  const options = {
    approval,
    binding,
    now: scenario.now ?? data.now,
    trustedSources: new Set(scenario.trusted_sources ?? ['consumer']),
    redeemedNonces,
  };
  if (scenario.replay) verifyTrustedApproval(options);
  const result = verifyTrustedApproval(options);
  return {
    ok: (result.ok ? 'ok' : result.error_code) === scenario.expected,
    evidence: 'src/adapter/approval.js',
    error_code: result.error_code,
  };
}

async function evaluateApprovalGateAssertion(directory, assertion, target) {
  if (assertion.expect === 'consumer-approval-required') {
    const invocation = await readStrictJson(path.join(directory, 'invocation.json'));
    const expected = await readStrictJson(path.join(directory, 'expected-refusal.json'));
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-approval-vector-'));
    try {
      await mkdir(path.join(temporary, 'ledger'));
      const invoked = await callShippedEntrypoint(invocation, target, {
        workspaces: { [invocation.workspace.workspace_id]: temporary },
      });
      return {
        ok: sameJson(invoked.response, expected),
        evidence: invoked.evidence,
        error_code: invoked.response.error?.code,
      };
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
  if (assertion.expect === 'no-commit-or-push') {
    const approved = await readStrictJson(path.join(directory, 'approved-authority.json'));
    const result = verifyMutationAuthority({
      command: 'transition',
      approval: approved.approval,
      approvalOptions: {
        ...approved.approval_options,
        redeemedNonces: new Set(),
        trustedSources: new Set(['consumer']),
      },
    });
    return {
      ok: result.ok && sameJson(result.authority, ['core:transition'])
        && result.authority.every((entry) => !entry.startsWith('git:')),
      evidence: 'src/adapter/approval.js',
      error_code: result.error_code,
    };
  }
  throw new Error(`unknown approval expectation ${assertion.expect}`);
}

async function evaluateAssertion(directory, assertion, target) {
  if (target !== 'claude-code' && [
    'instruction-order', 'approval-gate', 'resume-plan', 'context-validation', 'approval-schema',
  ].includes(assertion.type)) {
    return UNIMPLEMENTED;
  }
  switch (assertion.type) {
    case 'negotiation':
    case 'core-probe':
    case 'entrypoint-path':
    case 'invoke-version':
      return evaluateNegotiationAssertion(directory, assertion, target);
    case 'capability':
      return evaluateCapabilityAssertion(directory, assertion, target);
    case 'platform-status':
      return evaluatePlatformAssertion(directory, assertion);
    case 'path-refusal':
    case 'path-race':
    case 'path-syntax':
    case 'snapshot-identity':
      return evaluateInvocationPathAssertion(directory, assertion, target);
    case 'process-outcome':
      return evaluateProcessOutcomeAssertion(directory, assertion);
    case 'core-baseline':
      return evaluateCoreBaselineAssertion(directory, assertion, target);
    case 'output-bound':
      return evaluateOutputBoundAssertion(directory, assertion, target);
    case 'instruction-order':
      return evaluateInstructionAssertion(directory, assertion);
    case 'context-validation':
      return evaluateContextAssertion(directory, assertion);
    case 'resume-plan':
      return evaluateResumePlanAssertion(directory, assertion);
    case 'approval-schema':
      return evaluateApprovalSchemaAssertion(directory, assertion);
    case 'approval-gate':
      return evaluateApprovalGateAssertion(directory, assertion, target);
    default:
      return UNIMPLEMENTED;
  }
}

export async function runImplementationVectors({
  fixtureRoot = defaultFixtureRoot,
  platform,
  target = 'claude-code',
} = {}) {
  const directories = (await readdir(fixtureRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const cases = [];
  for (const name of directories) {
    const directory = path.join(fixtureRoot, name);
    const manifest = await parseStrictJson(path.join(directory, 'manifest.json'));
    const version = manifest.adapter_vector_version;
    // parseJsonRequest boxes every JSON number, so the version is compared
    // against its raw source text: `1.0`, `1e0` and `"1"` are all refused.
    const isVersionOne = version instanceof JsonNumber && version.source === '1';
    if (!isVersionOne) {
      throw new Error(`unsupported adapter_vector_version in ${name}`);
    }
    if (!SUPPORTED_EXECUTION_MODES.has(manifest.mode)) {
      throw new Error(`unknown execution mode ${manifest.mode} in ${name}`);
    }
    await verifyArtifacts(directory, manifest);
    if (!manifest.targets.includes(target)) {
      continue;
    }
    // A case that asserts nothing cannot be evidence of anything, and
    // `cased` starts true, so it would otherwise report `pass` for free.
    if (manifest.assertions.length === 0) {
      throw new Error(`no assertions in ${name}`);
    }
    for (const assertion of manifest.assertions) {
      if (!SUPPORTED_ASSERTION_TYPES.has(assertion.type)) {
        throw new Error(`unknown assertion type ${assertion.type} in ${name}`);
      }
    }

    const evaluated = [];
    const errorCodes = new Set();
    let cased = true;
    for (const assertion of manifest.assertions) {
      const outcome = await evaluateAssertion(directory, assertion, target);
      if (outcome.error_code) {
        errorCodes.add(outcome.error_code);
      }
      if (!outcome.ok) {
        cased = false;
      }
      evaluated.push({ id: assertion.id, evidence: outcome.evidence });
    }

    cases.push({
      case: manifest.case,
      status: cased ? 'pass' : 'fail',
      executed_mode: manifest.mode,
      executed_assertions: manifest.assertions.map((assertion) => assertion.id),
      assertion_evidence: evaluated,
      observed_error_codes: [...errorCodes].sort(),
    });
  }

  // `every` is vacuously true on an empty array, so a wrong fixture root
  // would otherwise be told the adapter conforms on the strength of no
  // measurement at all.
  if (cases.length === 0) {
    throw new Error(`no ${target} cases in ${fixtureRoot}`);
  }

  const passed = cases.every((entry) => entry.status === 'pass');
  return {
    status: passed ? 'pass' : 'fail',
    implementations: { [target]: passed ? 'pass' : 'fail' },
    evidence_platform: platform,
    observed_error_codes: [...new Set(cases.flatMap((entry) => entry.observed_error_codes))].sort(),
    cases,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const targetIndex = process.argv.indexOf('--target');
    const target = targetIndex >= 0 ? process.argv[targetIndex + 1] : undefined;
    if (targetIndex >= 0 && (!target || target.startsWith('--'))) {
      throw new Error('--target requires a value');
    }
    process.stdout.write(`${JSON.stringify(await runImplementationVectors({
      platform: process.platform,
      ...(target ? { target } : {}),
    }))}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  }
}
