#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
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

const defaultFixtureRoot = fileURLToPath(new URL('./fixtures/adapters/', import.meta.url));

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
  if (assertion.expect !== 'claims-and-policy-false') {
    // `refuse-before-core-launch` and `work-claim-advisory` both need
    // invokeAdapter, which is Plan 2's work.
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
