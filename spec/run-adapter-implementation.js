#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
import { invokeAdapter } from '../src/adapter/invoke.js';
import { validateInstructionInput } from '../src/adapter/instructions.js';
import { validateInvokeContext } from '../src/adapter/context.js';
import { buildResumePlan, validateHandoffResume } from '../src/adapter/handoff.js';
import { validateInvocationLimits } from '../src/adapter/limits.js';
import { resolveInvocationPaths } from '../src/adapter/paths.js';
import { mapProcessOutcome } from '../src/adapter/process-outcome.js';
import { sameJson } from '../src/adapter/schema-helpers.js';

const defaultFixtureRoot = fileURLToPath(new URL('./fixtures/adapters/', import.meta.url));
const projectRoot = fileURLToPath(new URL('../', import.meta.url));

const SUPPORTED_ASSERTION_TYPES = new Set([
  'core-baseline', 'capability', 'instruction-order', 'path-refusal',
  'output-bound', 'approval-gate', 'resume-plan', 'platform-status',
  'process-outcome', 'path-race', 'path-syntax', 'snapshot-identity',
  'entrypoint-path', 'invoke-version', 'core-probe', 'negotiation',
  'context-validation', 'approval-schema',
]);

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
async function evaluateNegotiationAssertion(directory, assertion) {
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
    const result = await invokeAdapter(Buffer.from(`${JSON.stringify(request)}\n`), {
      max_request_bytes: data.base_dynamic.limits.max_request_bytes,
      describe_request: data.base_request,
      manifest: data.base_manifest,
      dynamic: data.base_dynamic,
    });
    return {
      ok: result.error.code === scenario.expected,
      evidence: 'src/adapter/invoke.js',
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
async function evaluateCapabilityAssertion(directory, assertion) {
  if (assertion.expect === 'refuse-before-core-launch') {
    const dynamic = await readStrictJson(path.join(directory, 'adapter-capabilities.json'));
    const invocation = await readStrictJson(path.join(directory, 'invocation.json'));
    const expected = await readStrictJson(path.join(directory, 'expected-refusal.json'));
    let launches = 0;
    const result = await invokeAdapter(Buffer.from(`${JSON.stringify(invocation)}\n`), {
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
        required_core_contract_version: dynamic.core.required_core_contract_version,
        entrypoints: {
          describe: { kind: 'command', executable: 'bin/adapter', fixed_args: ['describe'] },
          invoke: { kind: 'command', executable: 'bin/adapter', fixed_args: ['invoke'] },
        },
        platforms: dynamic.platforms,
      },
      dynamic,
      platform: process.platform,
      launch: async () => { launches += 1; },
    });
    return {
      ok: launches === 0 && sameJson(result, expected),
      evidence: 'src/adapter/invoke.js',
      error_code: result.error.code,
    };
  }
  if (assertion.expect !== 'claims-and-policy-false') {
    if (assertion.expect === 'work-claim-advisory') {
      const bytes = await readFile(path.join(directory, 'expected-core-stdout.jsonl'));
      const parsed = parseJsonRequest(bytes);
      if (parsed.issues.length > 0) return { ok: false, evidence: 'src/adapter/core-probe.js' };
      const probe = normalizeJsonValue(parsed.value);
      const described = vectorDynamic(probe);
      return {
        ok: probe.result.operations.work_claim.mode === 'advisory'
          && probe.result.operations.work_claim.safe_exclusive_dispatch === false
          && verifyCoreProbe(described, probe).ok,
        evidence: 'src/adapter/core-probe.js',
      };
    }
    return UNIMPLEMENTED;
  }
  const capabilities = await readStrictJson(path.join(directory, 'adapter-capabilities.json'));
  const described = describeAdapter(
    {
      bootstrap_wire_version: capabilities.bootstrap_wire_version,
      supported_adapter_contract_versions: [1],
      request_id: assertion.id,
    },
    {
      adapter_manifest_version: 1,
      adapter_id: capabilities.adapter_id,
      adapter_version: capabilities.adapter_version,
      adapter_contract_versions: [1],
      bootstrap_wire_version: capabilities.bootstrap_wire_version,
      required_core_contract_version: capabilities.core.required_core_contract_version,
      entrypoints: {
        describe: { kind: 'command', executable: 'bin/adapter', fixed_args: ['describe'] },
        invoke: { kind: 'command', executable: 'bin/adapter', fixed_args: ['invoke'] },
      },
      platforms: capabilities.platforms,
    },
    capabilities,
  );
  return {
    ok: described.ok === true
      && described.result.optional_features.claims === false
      && described.result.optional_features.policy === false,
    evidence: 'src/adapter/describe.js',
    error_code: described.error_code,
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

function vectorRuntime({ workspaces = {}, launch } = {}) {
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

async function evaluateCoreBaselineAssertion(directory, assertion) {
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
    const result = await invokeAdapter(Buffer.from(`${JSON.stringify(invocation)}\n`), vectorRuntime({
      workspaces: workspaceFor(invocation, root),
      launch: async (launch) => {
        if (!sameJson(launch.argv, argv)) throw new Error('adapter constructed the wrong core argv');
        return coreObservation(launch);
      },
    }));
    return {
      ok: sameJson(result, expected),
      evidence: 'src/adapter/invoke.js',
      error_code: result.error?.code,
    };
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}

async function evaluateOutputBoundAssertion(directory, assertion) {
  const processCase = await readStrictJson(path.join(directory, 'process.json'));
  const invocation = await readStrictJson(path.join(directory, 'invocation.json'));
  const expected = await readStrictJson(path.join(directory, 'expected-refusal.json'));
  const result = await invokeAdapter(Buffer.from(`${JSON.stringify(invocation)}\n`), vectorRuntime({
    workspaces: workspaceFor(invocation, '/approved/workspace'),
    launch: async () => processCase.request.process,
  }));
  return {
    ok: result.error?.code === assertion.expect && sameJson(result, expected),
    evidence: 'src/adapter/process-outcome.js',
    error_code: result.error?.code,
  };
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

async function evaluateInvocationPathAssertion(directory, assertion) {
  if (assertion.type === 'path-refusal') {
    const shape = await readStrictJson(path.join(directory, 'filesystem-shape.json'));
    const invocation = await readStrictJson(path.join(directory, 'invocation.json'));
    const ledger = invocation.core_request.ledger;
    const selected = shape.entries.find(({ path: entryPath }) => entryPath === ledger);
    const snapshots = {
      '.': { kind: 'directory', identity: 'workspace' },
      [ledger]: { kind: selected?.kind ?? 'missing', identity: selected?.path ?? 'missing' },
    };
    const result = resolveInvocationPaths({
      workspace_root: `/${shape.workspace_root}`,
      cwd: invocation.workspace.cwd,
      ledger,
      before: snapshots,
      after: structuredClone(snapshots),
    });
    return {
      ok: result.error_code === 'path-rejected' && result.detail.kind === assertion.expect,
      evidence: 'src/adapter/paths.js',
      error_code: result.error_code,
    };
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

async function evaluateAssertion(directory, assertion) {
  switch (assertion.type) {
    case 'negotiation':
    case 'core-probe':
    case 'entrypoint-path':
    case 'invoke-version':
      return evaluateNegotiationAssertion(directory, assertion);
    case 'capability':
      return evaluateCapabilityAssertion(directory, assertion);
    case 'platform-status':
      return evaluatePlatformAssertion(directory, assertion);
    case 'path-refusal':
    case 'path-race':
    case 'path-syntax':
    case 'snapshot-identity':
      return evaluateInvocationPathAssertion(directory, assertion);
    case 'process-outcome':
      return evaluateProcessOutcomeAssertion(directory, assertion);
    case 'core-baseline':
      return evaluateCoreBaselineAssertion(directory, assertion);
    case 'output-bound':
      return evaluateOutputBoundAssertion(directory, assertion);
    case 'instruction-order':
      return evaluateInstructionAssertion(directory, assertion);
    case 'context-validation':
      return evaluateContextAssertion(directory, assertion);
    case 'resume-plan':
      return evaluateResumePlanAssertion(directory, assertion);
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
      const outcome = await evaluateAssertion(directory, assertion);
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
