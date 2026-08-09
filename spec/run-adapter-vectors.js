#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCapabilityInvariantScenario, mutateObject } from './scenario-shaping.js';

import {
  buildResumePlan,
  describeAdapter,
  invokeAdapter,
  mapProcessOutcome,
  referenceCoreCapabilities,
  resolveEntrypointPath,
  resolveInvocationPaths,
  validateHandoffResume,
  validateInstructionInput,
  validateInvocationLimits,
  validateInvokeContext,
  verifyCoreProbe,
  verifyMutationAuthority,
  verifyRequiredCapabilities,
  verifyTrustedApproval,
} from './adapter-reference.js';
import { parseJsonRequest } from '../src/request.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const defaultFixtureRoot = fileURLToPath(new URL('./fixtures/adapters/', import.meta.url));
let activeArtifactUsage = null;

export async function runReferenceVectors(fixtureRoot = defaultFixtureRoot) {
  const entries = (await readdir(fixtureRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  const cases = [];
  const observedErrorCodes = new Set();
  for (const entry of entries) {
    const result = await runReferenceVector(path.join(fixtureRoot, entry.name));
    cases.push(result);
    for (const code of result.observed_error_codes) observedErrorCodes.add(code);
  }
  return {
    status: 'reference-pass',
    implementations: {
      'claude-code': 'unverified',
      codex: 'unverified',
      kimi: 'unverified',
      'openai-compatible-harness': 'unverified',
    },
    observed_error_codes: [...observedErrorCodes].sort(),
    cases,
  };
}

export async function runReferenceVector(directory) {
  const manifest = await json(directory, 'manifest.json');
  validateVectorManifest(manifest);
  await verifyArtifacts(directory, manifest);
  evaluateMode(manifest);
  const executedAssertions = [];
  const assertionEvidence = [];
  const observedErrorCodes = new Set();
  activeArtifactUsage = new Set();
  try {
    for (const assertion of manifest.assertions) {
      const evaluated = await evaluateAssertion(directory, manifest.case, assertion);
      const evidence = typeof evaluated === 'string' ? evaluated : evaluated.evidence;
      if (typeof evaluated === 'object' && evaluated.error_code) {
        observedErrorCodes.add(evaluated.error_code);
      }
      executedAssertions.push(assertion.id);
      assertionEvidence.push({ id: assertion.id, evidence });
    }
    assert.deepEqual(
      [...activeArtifactUsage].sort(),
      manifest.artifacts.map(({ path: artifactPath }) => artifactPath).sort(),
      `${manifest.case}: every hashed artifact must be consumed by an assertion`,
    );
  } finally {
    activeArtifactUsage = null;
  }
  assert.deepEqual(executedAssertions, manifest.assertions.map(({ id }) => id));
  return {
    case: manifest.case,
    status: 'reference-pass',
    executed_mode: manifest.mode,
    executed_assertions: executedAssertions,
    assertion_evidence: assertionEvidence,
    observed_error_codes: [...observedErrorCodes].sort(),
  };
}

function validateVectorManifest(manifest) {
  assert.equal(manifest?.adapter_vector_version, 1, 'adapter_vector_version must be exactly 1');
}

function evaluateMode(manifest) {
  switch (manifest.mode) {
    case 'equivalence':
      assert.ok(manifest.targets.includes('direct-core'));
      assert.ok(manifest.assertions.some(({ type }) => type === 'core-baseline'));
      return;
    case 'negative-capability':
    case 'protocol':
      assert.equal(manifest.targets.includes('direct-core'), false);
      return;
    default:
      throw new Error(`${manifest.case}: unevaluated vector mode ${manifest.mode}`);
  }
}

async function evaluateAssertion(directory, caseName, assertion) {
  switch (assertion.type) {
    case 'core-baseline':
      await evaluateCoreBaseline(directory, assertion);
      return 'invokeAdapter+real-core-baseline';
    case 'capability':
      return evidenceWithResult('invokeAdapter', await evaluateCapability(directory, assertion));
    case 'instruction-order':
      await evaluateInstruction(directory, assertion);
      return 'validateInstructionInput';
    case 'path-refusal': {
      const shape = await json(directory, 'filesystem-shape.json');
      const invocation = await json(directory, 'invocation.json');
      const refusal = await json(directory, 'expected-refusal.json');
      const ledger = invocation.core_request.ledger;
      const selected = shape.entries.find(({ path: entryPath }) => entryPath === ledger);
      const before = {
        '.': { kind: 'directory', identity: 'workspace' },
        [ledger]: { kind: selected?.kind ?? 'missing', identity: selected?.path ?? 'missing' },
      };
      const result = await invokeAdapter(Buffer.from(`${JSON.stringify(invocation)}\n`), referenceRuntime({
        workspaces: {
          [invocation.workspace.workspace_id]: {
            root: `/${shape.workspace_root}`,
            before,
            after: structuredClone(before),
          },
        },
      }));
      assert.deepEqual(result, refusal);
      assert.equal(result.error.details.kind, assertion.expect);
      return evidenceWithResult('invokeAdapter', result);
    }
    case 'output-bound': {
      const processCase = await json(directory, 'process.json');
      const invocation = await json(directory, 'invocation.json');
      const refusal = await json(directory, 'expected-refusal.json');
      const result = await invokeAdapter(Buffer.from(`${JSON.stringify(invocation)}\n`), referenceRuntime({
        workspaces: runtimeWorkspace(invocation),
        launch: async () => processCase.request.process,
      }));
      assert.deepEqual(result, refusal);
      assert.equal(result.mutation_outcome, undefined);
      return evidenceWithResult('invokeAdapter', result);
    }
    case 'approval-gate': {
      const state = await json(directory, 'approval-state.json');
      const invocation = await json(directory, 'invocation.json');
      if (assertion.expect === 'consumer-approval-required') {
        const refusal = await json(directory, 'expected-refusal.json');
        const result = await invokeAdapter(Buffer.from(`${JSON.stringify(invocation)}\n`), referenceRuntime({
          workspaces: runtimeWorkspace(invocation),
          approval: state.consumer_approval ? state.approval : null,
        }));
        assert.deepEqual(result, refusal);
        return evidenceWithResult('invokeAdapter', result);
      } else {
        const approved = await json(directory, 'approved-authority.json');
        const result = verifyMutationAuthority({
          command: 'transition',
          approval: approved.approval,
          approvalOptions: {
            ...approved.approval_options,
            redeemedNonces: new Set(),
            trustedSources: new Set(['consumer']),
          },
        });
        assert.deepEqual(result.authority, ['core:transition']);
        assert.equal(result.authority.some((entry) => entry.startsWith('git:')), false);
      }
      return 'verifyMutationAuthority';
    }
    case 'resume-plan': {
      const fixture = await json(directory, 'handoff-carrier.json');
      const handoff = await json(directory, 'handoff.json');
      const expected = await json(directory, assertion.expect);
      assert.deepEqual(
        JSON.parse(Buffer.from(fixture.carrier.content_base64, 'base64').toString('utf8')),
        handoff,
      );
      const plan = buildResumePlan(fixture.carrier, fixture.options);
      assert.equal(plan.ok, true);
      assert.deepEqual({
        must_invoke: plan.must_invoke,
        must_compare: plan.must_compare,
        forbidden_automatic_actions: plan.forbidden_automatic_actions,
      }, expected);
      return 'buildResumePlan';
    }
    case 'platform-status': {
      const packageManifest = await json(directory, 'package-manifest.json');
      const expected = await json(directory, assertion.expect);
      const interpretation = {
        supported_platforms: Object.entries(packageManifest.platforms)
          .filter(([, status]) => status === 'supported').map(([platform]) => platform),
        unverified_platforms: Object.entries(packageManifest.platforms)
          .filter(([, status]) => status === 'unverified').map(([platform]) => platform),
        required_before_support_claim: 'native-common-vector-evidence',
      };
      assert.deepEqual(interpretation, expected, 'expected-interpretation.json');
      return 'reference-platform-model';
    }
    case 'process-outcome': {
      const data = await json(directory, 'scenarios.json');
      const scenario = data.scenarios.find(({ id }) => id === assertion.scenario);
      assert.ok(scenario, assertion.scenario);
      const result = mapProcessOutcome(scenario.request);
      assert.equal(result.error.code, scenario.expected_code);
      assert.equal(result.mutation_outcome ?? null, scenario.expected_mutation_outcome);
      assert.equal(result.process.orphaned, false);
      return evidenceWithResult('mapProcessOutcome', result);
    }
    case 'path-race': {
      const scenario = await json(directory, 'scenarios.json');
      if (assertion.expect === 'root-anchored') {
        const stable = { ...scenario, after: scenario.before };
        delete stable.expected;
        assert.equal(resolveInvocationPaths(stable).ledger, scenario.expected.ledger_argument);
      } else {
        const expected = scenario.expected;
        const input = { ...scenario };
        delete input.expected;
        const result = resolveInvocationPaths(input);
        assert.equal(result.error.code, expected.refusal);
        assert.equal(result.error.details.path_role, expected.path_role);
        assert.equal(result.error.details.component, expected.component);
        return evidenceWithResult('resolveInvocationPaths', result);
      }
      return 'resolveInvocationPaths';
    }
    case 'path-syntax': {
      const data = await json(directory, 'scenarios.json');
      const scenario = data.invalid_paths.find(({ id }) => id === assertion.scenario);
      assert.ok(scenario, assertion.scenario);
      const snapshot = { '.': { kind: 'directory', identity: 'root-1' } };
      const result = resolveInvocationPaths({
        workspace_root: data.workspace_root,
        cwd: scenario.path,
        ledger: '.',
        before: snapshot,
        after: snapshot,
      });
      assert.equal(result.error.code, scenario.expected);
      return evidenceWithResult('resolveInvocationPaths', result);
    }
    case 'snapshot-identity': {
      const data = await json(directory, 'scenarios.json');
      const scenario = data.snapshot_cases.find(({ id }) => id === assertion.scenario);
      assert.ok(scenario, assertion.scenario);
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
      assert.equal(result.error.code, scenario.expected);
      return evidenceWithResult('resolveInvocationPaths', result);
    }
    case 'entrypoint-path': {
      const data = await json(directory, 'scenarios.json');
      const scenario = data.entrypoint_paths.find(({ id }) => id === assertion.scenario);
      assert.ok(scenario, assertion.scenario);
      const result = resolveEntrypointPath(scenario);
      assert.equal(result.error.code, scenario.expected);
      return evidenceWithResult('resolveEntrypointPath', result);
    }
    case 'invoke-version': {
      const data = await json(directory, 'scenarios.json');
      const scenario = data.invoke_cases.find(({ id }) => id === assertion.scenario);
      assert.ok(scenario, assertion.scenario);
      const request = {
        adapter_contract_version: scenario.adapter_contract_version,
        request_id: scenario.id,
        core_request: { command: 'capabilities' },
        instruction_input: { instruction_input_version: 1, required: false, sources: [] },
        handoff_carrier: null,
        limits: { context_bytes: 0, stdout_bytes: 4096, stderr_bytes: 1024, timeout_ms: 1000 },
      };
      const result = await invokeAdapter(Buffer.from(`${JSON.stringify(request)}\n`), referenceRuntime());
      assert.equal(result.error.code, scenario.expected);
      return evidenceWithResult('invokeAdapter', result);
    }
    case 'core-probe': {
      const data = await json(directory, 'scenarios.json');
      const scenario = data.core_probe_cases.find(({ id }) => id === assertion.scenario);
      assert.ok(scenario, assertion.scenario);
      const describe = structuredClone(data.base_dynamic);
      const probe = referenceCoreCapabilities();
      mutateObject(scenario.target === 'probe' ? probe : describe, scenario);
      const result = verifyCoreProbe(describe, probe);
      assert.equal(result.error.code, scenario.expected);
      return evidenceWithResult('verifyCoreProbe', result);
    }
    case 'negotiation': {
      const data = await json(directory, 'scenarios.json');
      const scenario = data.cases.find(({ id }) => id === assertion.scenario);
      assert.ok(scenario, assertion.scenario);
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
        assert.ok(targets[scenario.target], scenario.target);
        mutateObject(targets[scenario.target], scenario);
      }
      if (scenario.capability_invariant) {
        applyCapabilityInvariantScenario(dynamic, scenario.capability_invariant);
      }
      const result = scenario.id === 'required-core-version'
        ? verifyCoreProbe(
            {
              core: {
                required_core_contract_version: scenario.required_core_contract_version,
                commands: ['capabilities', 'create', 'inspect', 'ready', 'transition', 'validate'],
              },
              optional_features: { claims: false, policy: false },
            },
            referenceCoreCapabilities(),
          )
        : describeAdapter(request, manifest, dynamic);
      assert.equal(result.error.code, scenario.expected);
      return evidenceWithResult(
        scenario.id === 'required-core-version' ? 'verifyCoreProbe' : 'describeAdapter', result,
      );
    }
    case 'context-validation': {
      const data = await json(directory, 'scenarios.json');
      const scenario = data.cases.find(({ id }) => id === assertion.scenario);
      assert.ok(scenario, assertion.scenario);
      if (scenario.kind === 'invocation-limit') {
        const requested = structuredClone(data.base_invocation_limits);
        mutateObject(requested, scenario);
        const result = validateInvocationLimits(requested, data.advertised_invocation_limits);
        assert.equal(result.error.code, scenario.expected);
        return evidenceWithResult('validateInvocationLimits', result);
      }
      if (scenario.kind === 'legacy-handoff') {
        const result = validateHandoffResume({
          handoff_bytes: Buffer.from(data.base_handoff_carrier.content_base64, 'base64'),
          handoff_digest: scenario.handoff_digest,
          resume_request: data.base_handoff_carrier.resume_request,
          current: data.handoff_options.current,
          max_bytes: data.handoff_options.max_bytes,
        });
        assert.equal(result.error.code, scenario.expected);
        return evidenceWithResult('validateHandoffResume', result);
      }
      const instructionInput = structuredClone(data.base_instruction);
      const instructionLimits = structuredClone(data.instruction_limits);
      const handoffCarrier = scenario.kind === 'instruction' ? null : structuredClone(data.base_handoff_carrier);
      const handoffOptions = structuredClone(data.handoff_options);
      if (scenario.kind === 'instruction') {
        if (scenario.duplicate_source) instructionInput.sources.push(structuredClone(instructionInput.sources[0]));
        else if (scenario.limit_bytes !== undefined) instructionLimits.max_bytes = scenario.limit_bytes;
        else if (scenario.limit_sources !== undefined) instructionLimits.max_sources = scenario.limit_sources;
        else mutateObject(instructionInput, scenario);
      } else if (scenario.kind === 'handoff') {
        if (scenario.duplicate_json) {
          replaceHandoffBytes(handoffCarrier, Buffer.from('{"handoff_version":1,"handoff_version":1}\n'));
        } else if (scenario.handoff_object_version !== undefined) {
          const handoff = JSON.parse(Buffer.from(handoffCarrier.content_base64, 'base64').toString('utf8'));
          handoff.handoff_version = scenario.handoff_object_version;
          replaceHandoffBytes(handoffCarrier, Buffer.from(`${JSON.stringify(handoff)}\n`));
        } else if (scenario.handoff_item_id !== undefined) {
          const handoff = JSON.parse(Buffer.from(handoffCarrier.content_base64, 'base64').toString('utf8'));
          handoff.item.id = scenario.handoff_item_id;
          replaceHandoffBytes(handoffCarrier, Buffer.from(`${JSON.stringify(handoff)}\n`));
        } else if (scenario.current_revision) {
          handoffOptions.current.revision = scenario.current_revision;
        } else if (scenario.current_item_id) {
          handoffOptions.current.item_id = scenario.current_item_id;
        } else if (scenario.current_instruction_set_digest) {
          handoffOptions.current.instruction_set_digest = scenario.current_instruction_set_digest;
        } else if (scenario.handoff_limit_bytes !== undefined) {
          handoffOptions.max_bytes = scenario.handoff_limit_bytes;
        } else {
          mutateObject(handoffCarrier, scenario);
        }
      }
      const result = validateInvokeContext({
        instruction_input: instructionInput,
        handoff_carrier: handoffCarrier,
        context_bytes: scenario.context_bytes ?? data.context_bytes,
        instruction_limits: instructionLimits,
        handoff_options: handoffOptions,
      });
      assert.equal(result.ok ? 'ok' : result.error.code, scenario.expected);
      return evidenceWithResult('validateInvokeContext', result);
    }
    case 'approval-schema': {
      const data = await json(directory, 'scenarios.json');
      const scenario = data.cases.find(({ id }) => id === assertion.scenario);
      assert.ok(scenario, assertion.scenario);
      const approval = structuredClone(data.base_approval);
      const binding = structuredClone(data.base_binding);
      applyScenarioMutation(scenario, approval, binding);
      const redeemedNonces = new Set();
      const options = {
        approval,
        binding,
        now: scenario.now ?? data.now,
        trustedSources: new Set(scenario.trusted_sources ?? ['consumer']),
        redeemedNonces,
      };
      if (scenario.replay) {
        assert.equal(verifyTrustedApproval(options).ok, true);
      }
      const result = verifyTrustedApproval(options);
      assert.equal(result.ok ? 'ok' : result.error.code, scenario.expected);
      return evidenceWithResult('verifyTrustedApproval', result);
    }
    default:
      throw new Error(`${caseName}/${assertion.id}: unevaluated assertion type ${assertion.type}`);
  }
}

async function evaluateCoreBaseline(directory, assertion) {
  const coreInvocation = await json(directory, 'core-invocation.json');
  const adapterInvocation = await json(directory, 'invocation.json');
  const expectedAdapter = await json(directory, 'expected-adapter-result.json');
  let cwd = projectRoot;
  let argv = [...coreInvocation.argv];
  let workspaces = {};
  let temporary = null;
  if (coreInvocation.command === 'ready') {
    const root = path.join(projectRoot, 'spec/fixtures/ready-selection');
    const ledger = path.join(root, 'ledger');
    argv = replaceLedger(argv, ledger);
    workspaces = runtimeWorkspace(adapterInvocation, root);
  } else if (coreInvocation.command === 'validate') {
    temporary = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-adapter-vector-'));
    const ledger = path.join(temporary, 'ledger');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(ledger));
    await writeFile(path.join(ledger, 'bad.md'), await artifactBytes(directory, 'ledger-bad.md'));
    argv = replaceLedger(argv, ledger);
    cwd = temporary;
    workspaces = runtimeWorkspace(adapterInvocation, temporary);
  }
  try {
    const baseline = spawnSync(process.execPath, [path.join(projectRoot, 'bin/wowbagger.js'), ...argv], {
      cwd,
      input: Buffer.from(coreInvocation.stdin_base64, 'base64'),
      encoding: null,
    });
    assert.equal(baseline.status, assertion.exit_code);
    assert.equal(baseline.stderr.length, assertion.stderr_bytes);
    assert.deepEqual(baseline.stdout, await artifactBytes(directory, assertion.stdout_artifact));
    const result = await invokeAdapter(
      Buffer.from(`${JSON.stringify(adapterInvocation)}\n`),
      referenceRuntime({
        workspaces,
        launch: async (launch) => {
          assert.deepEqual(launch.argv, argv);
          return spawnCoreObservation(launch);
        },
      }),
    );
    assert.deepEqual(result, expectedAdapter);
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}

async function evaluateCapability(directory, assertion) {
  if (assertion.expect === 'refuse-before-core-launch') {
    const capabilities = await json(directory, 'adapter-capabilities.json');
    const refusal = await json(directory, 'expected-refusal.json');
    const invocation = await json(directory, 'invocation.json');
    assert.equal(capabilities.host.model_transport.available, true);
    assert.equal(capabilities.host.command_execution.supported, false);
    const result = await invokeAdapter(Buffer.from(`${JSON.stringify(invocation)}\n`), referenceRuntime({
      dynamic: capabilities,
    }));
    assert.deepEqual(result, refusal);
    return result;
  } else if (assertion.expect === 'claims-and-policy-false') {
    const capabilities = await json(directory, 'adapter-capabilities.json');
    assert.deepEqual(capabilities.optional_features, { claims: false, policy: false });
  } else if (assertion.expect === 'work-claim-advisory') {
    // Advisory claims must never advertise safe exclusive dispatch — the invariant a future
    // consumer's migration decision depends on, not the now-stale "claims aren't implemented yet" fact.
    const output = JSON.parse((await artifactBytes(directory, 'expected-core-stdout.jsonl')).toString('utf8'));
    assert.equal(output.result.operations.work_claim.supported, true);
    assert.equal(output.result.operations.work_claim.mode, 'advisory');
    assert.equal(output.result.operations.work_claim.safe_exclusive_dispatch, false);
    const describe = referenceRuntime().dynamic;
    assert.equal(
      verifyCoreProbe({ ...describe, optional_features: { ...describe.optional_features, claims: true } }, output).ok,
      true,
    );
  } else {
    throw new Error(`unknown capability expectation: ${assertion.expect}`);
  }
  return null;
}

async function evaluateInstruction(directory, assertion) {
  const input = await json(directory, 'instruction-input.json');
  const expected = await json(directory, 'expected-discovery.json');
  assert.deepEqual(Object.keys(expected).sort(), [
    'discovery_mode', 'guessed_filenames', 'source_ids', 'total_bytes',
  ]);
  const result = validateInstructionInput({ ...input, required: true }, {
    max_sources: input.sources.length,
    max_bytes: Number.MAX_SAFE_INTEGER,
  });
  assert.equal(result.ok, true);
  assert.deepEqual({
    source_ids: result.ordered_sources,
    discovery_mode: 'host-provided',
    guessed_filenames: false,
    total_bytes: result.total_bytes,
  }, expected, 'expected-discovery.json');
  if (Array.isArray(assertion.expect)) {
    assert.deepEqual(result.ordered_sources, assertion.expect);
  } else {
    assert.equal(expected.guessed_filenames, false);
  }
}

function referenceRuntime(overrides = {}) {
  const dynamic = overrides.dynamic ?? {
    ok: true,
    bootstrap_wire_version: 1,
    selected_adapter_contract_version: 2,
    adapter_id: 'example.reference',
    adapter_version: '1.0.0',
    core: {
      required_core_contract_version: 2,
      commands: ['capabilities', 'create', 'inspect', 'ready', 'transition', 'validate'],
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
      model_transport: { available: false, protocol: 'none' },
      instruction_input: { mode: 'host-provided', max_sources: 8, max_bytes: 65536 },
      handoff: { supported: true, persistence: 'explicit-only' },
      trusted_approval: { supported: true, sources: ['consumer'] },
      integration_mechanisms: { hooks: false, slash_commands: false, mcp: false, daemon: false },
    },
    optional_features: { claims: false, policy: false },
    limits: {
      max_request_bytes: 65536,
      max_context_bytes: 65536,
      max_stdout_bytes: 1048576,
      max_stderr_bytes: 65536,
      max_timeout_ms: 30000,
    },
    platforms: { darwin: 'supported', linux: 'supported', win32: 'supported' },
  };
  return {
    max_request_bytes: dynamic.limits.max_request_bytes,
    describe_request: {
      bootstrap_wire_version: 1,
      supported_adapter_contract_versions: [2],
      request_id: 'reference-vector-describe',
    },
    manifest: {
      adapter_manifest_version: 1,
      adapter_id: dynamic.adapter_id,
      adapter_version: dynamic.adapter_version,
      adapter_contract_versions: [2],
      bootstrap_wire_version: 1,
      required_core_contract_version: 2,
      entrypoints: {
        describe: { kind: 'command', executable: 'bin/adapter', fixed_args: ['describe'] },
        invoke: { kind: 'command', executable: 'bin/adapter', fixed_args: ['invoke'] },
      },
      platforms: dynamic.platforms,
    },
    dynamic,
    core_probe: referenceCoreCapabilities(),
    package_root: projectRoot,
    workspaces: overrides.workspaces ?? {},
    launch: overrides.launch ?? (async () => { throw new Error('unexpected core launch'); }),
    approval: overrides.approval ?? null,
    now: overrides.now ?? '2030-01-15T12:01:00Z',
    redeemed_nonces: overrides.redeemed_nonces ?? new Set(),
    core_executable_identity: `sha256:${'a'.repeat(64)}`,
    handoff_current: overrides.handoff_current,
  };
}

function runtimeWorkspace(invocation, root = '/approved/workspace') {
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
    [invocation.workspace.workspace_id]: {
      root,
      before,
      after: structuredClone(before),
    },
  };
}

function spawnCoreObservation({ argv, cwd, input, limits }) {
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

function replaceLedger(argv, ledger) {
  const index = argv.indexOf('--ledger');
  assert.notEqual(index, -1);
  const result = [...argv];
  result[index + 1] = ledger;
  return result;
}

async function json(directory, name) {
  if (activeArtifactUsage && name !== 'manifest.json') activeArtifactUsage.add(name);
  const bytes = await readFile(path.join(directory, name));
  const parsed = parseJsonRequest(bytes);
  if (parsed.issues.length > 0) {
    throw new Error(`${path.join(directory, name)}: invalid strict JSON`);
  }
  return JSON.parse(bytes.toString('utf8'));
}

async function artifactBytes(directory, name) {
  if (activeArtifactUsage) activeArtifactUsage.add(name);
  return readFile(path.join(directory, name));
}

async function verifyArtifacts(directory, manifest) {
  for (const artifact of manifest.artifacts) {
    assert.equal(safeRelativePath(artifact.path), true, `${manifest.case}/${artifact.path}`);
    const bytes = await readFile(path.join(directory, artifact.path));
    const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    assert.equal(digest, artifact.sha256, `${manifest.case}/${artifact.path}`);
    if (artifact.path.endsWith('.json')) await json(directory, artifact.path);
  }
}

function safeRelativePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && !value.startsWith('/')
    && !value.includes('\\')
    && !value.includes('\0')
    && value.split('/').every((segment) => segment && segment !== '.' && segment !== '..');
}

function applyScenarioMutation(scenario, approval, binding) {
  const target = scenario.target === 'binding' ? binding : approval;
  mutateObject(target, scenario);
}

export { applyCapabilityInvariantScenario, mutateObject };

function replaceHandoffBytes(carrier, bytes) {
  carrier.content_base64 = bytes.toString('base64');
  carrier.byte_length = bytes.length;
  carrier.sha256 = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function evidenceWithResult(evidence, result) {
  return { evidence, error_code: result?.ok === false ? result.error.code : null };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(`${JSON.stringify(await runReferenceVectors())}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  }
}
