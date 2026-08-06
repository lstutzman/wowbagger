import { validateAdapterManifest } from './manifest.js';
import { CORE_COMMAND_ORDER } from './core-probe.js';
import {
  hasExactMembers, isAllBoolean, isNonEmptyString, isNonNegativeSafeInteger, isPositiveSafeInteger, sameJson,
} from './schema-helpers.js';

// Opaque-ID syntax used for the describe request's `request_id` (contract
// section 3: "The request ID uses the safe opaque-ID syntax").
const SAFE_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

// The version 1 manifest array is exactly [1] (contract section 3): a
// manifest or dynamic result advertising an unregistered future version has
// no schema or handler to select, so it is refused rather than negotiated.
const SUPPORTED_ADAPTER_CONTRACT_VERSIONS = Object.freeze([1]);

const INSTRUCTION_INPUT_MODES = new Set(['none', 'host-provided', 'configured-relative-paths']);
const WORKSPACE_SELECTION_MODES = new Set(['none', 'guarded-relative']);
const PLATFORM_NAMES = Object.freeze(['darwin', 'linux', 'win32']);
const PLATFORM_STATUSES = new Set(['supported', 'unsupported', 'unverified']);

// The dependent execution flags in the §3.2 capability table.
const EXECUTION_DEPENDENT_FLAGS = Object.freeze([
  'arguments_array', 'stdio', 'process_tree_containment', 'orphan_detection',
  'timeout_enforcement', 'stdout_limit', 'stderr_limit',
]);

function refuse(error_code, detail) {
  return { ok: false, error_code, detail };
}

function isVersionArray(value) {
  return Array.isArray(value)
    && value.length > 0
    && value.every(isPositiveSafeInteger)
    && value.every((version, index) => index === 0 || value[index - 1] < version);
}

function isCommandArray(value) {
  if (!Array.isArray(value)) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const command = value[index];
    if (!CORE_COMMAND_ORDER.includes(command)) {
      return false;
    }
    if (index > 0 && CORE_COMMAND_ORDER.indexOf(value[index - 1]) >= CORE_COMMAND_ORDER.indexOf(command)) {
      return false;
    }
  }
  return new Set(value).size === value.length;
}

function isValidPlatformMap(value) {
  return hasExactMembers(value, PLATFORM_NAMES)
    && PLATFORM_NAMES.every((name) => PLATFORM_STATUSES.has(value[name]));
}

// ---- describe request schema (contract section 3) ----

function describeRequestIssue(request) {
  if (!hasExactMembers(request, ['bootstrap_wire_version', 'supported_adapter_contract_versions', 'request_id'])) {
    return 'members';
  }
  if (!isPositiveSafeInteger(request.bootstrap_wire_version)) {
    return 'bootstrap_wire_version';
  }
  if (!isVersionArray(request.supported_adapter_contract_versions)) {
    return 'supported_adapter_contract_versions';
  }
  if (typeof request.request_id !== 'string' || !SAFE_ID_PATTERN.test(request.request_id)) {
    return 'request_id';
  }
  return null;
}

// ---- static manifest value checks (section 3.1), on top of Task 3's
// structural validateAdapterManifest ----

function manifestValueIssue(manifest) {
  if (manifest.adapter_manifest_version !== 1) {
    return 'adapter_manifest_version';
  }
  if (!isNonEmptyString(manifest.adapter_id)) {
    return 'adapter_id';
  }
  if (!isNonEmptyString(manifest.adapter_version)) {
    return 'adapter_version';
  }
  if (!sameJson(manifest.adapter_contract_versions, SUPPORTED_ADAPTER_CONTRACT_VERSIONS)) {
    return 'adapter_contract_versions';
  }
  if (manifest.bootstrap_wire_version !== 1) {
    return 'bootstrap_wire_version';
  }
  if (!isPositiveSafeInteger(manifest.required_core_contract_version)) {
    return 'required_core_contract_version';
  }
  if (!isValidPlatformMap(manifest.platforms)) {
    return 'platforms';
  }
  return null;
}

// ---- dynamic describe result schema (section 3.2) ----

function commandExecutionIssue(execution) {
  if (!hasExactMembers(execution, [
    'supported', 'arguments_array', 'shell', 'stdio', 'process_tree_containment',
    'orphan_detection', 'timeout_enforcement', 'stdout_limit', 'stderr_limit',
  ]) || !isAllBoolean(execution)) {
    return 'command_execution';
  }
  return null;
}

function filesystemIssue(filesystem) {
  if (!hasExactMembers(filesystem, ['workspace_selection', 'no_follow_resolution', 'stable_identity', 'component_walk'])
    || !WORKSPACE_SELECTION_MODES.has(filesystem.workspace_selection)
    || typeof filesystem.no_follow_resolution !== 'boolean'
    || typeof filesystem.stable_identity !== 'boolean'
    || typeof filesystem.component_walk !== 'boolean') {
    return 'filesystem';
  }
  return null;
}

function modelTransportIssue(transport) {
  if (!hasExactMembers(transport, ['available', 'protocol'])
    || typeof transport.available !== 'boolean'
    || !isNonEmptyString(transport.protocol)) {
    return 'model_transport';
  }
  return null;
}

function instructionInputIssue(input) {
  if (!hasExactMembers(input, ['mode', 'max_sources', 'max_bytes'])
    || !INSTRUCTION_INPUT_MODES.has(input.mode)
    || !isNonNegativeSafeInteger(input.max_sources)
    || !isNonNegativeSafeInteger(input.max_bytes)) {
    return 'instruction_input';
  }
  return null;
}

function handoffIssue(handoff) {
  if (!hasExactMembers(handoff, ['supported', 'persistence'])
    || typeof handoff.supported !== 'boolean'
    || handoff.persistence !== 'explicit-only') {
    return 'handoff';
  }
  return null;
}

// `host.trusted_approval` MAY be absent to declare mutations unavailable.
// Version 1 has exactly one authority label.
function trustedApprovalIssue(host) {
  if (!Object.hasOwn(host, 'trusted_approval')) {
    return null;
  }
  const approval = host.trusted_approval;
  if (!hasExactMembers(approval, ['supported', 'sources'])
    || typeof approval.supported !== 'boolean'
    || !sameJson(approval.sources, ['consumer'])) {
    return 'trusted_approval';
  }
  return null;
}

function integrationMechanismsIssue(mechanisms) {
  if (!hasExactMembers(mechanisms, ['hooks', 'slash_commands', 'mcp', 'daemon']) || !isAllBoolean(mechanisms)) {
    return 'integration_mechanisms';
  }
  return null;
}

function hostCapabilitiesIssue(host) {
  if (!hasExactMembers(host, [
    'command_execution', 'filesystem', 'model_transport', 'instruction_input', 'handoff', 'integration_mechanisms',
  ], ['trusted_approval'])) {
    return 'members';
  }
  return commandExecutionIssue(host.command_execution)
    || filesystemIssue(host.filesystem)
    || modelTransportIssue(host.model_transport)
    || instructionInputIssue(host.instruction_input)
    || handoffIssue(host.handoff)
    || trustedApprovalIssue(host)
    || integrationMechanismsIssue(host.integration_mechanisms);
}

function coreSectionIssue(core) {
  if (!hasExactMembers(core, ['required_core_contract_version', 'commands'])
    || !isPositiveSafeInteger(core.required_core_contract_version)
    || !isCommandArray(core.commands)) {
    return 'core';
  }
  return null;
}

function optionalFeaturesIssue(optionalFeatures) {
  if (!hasExactMembers(optionalFeatures, ['claims', 'policy']) || !isAllBoolean(optionalFeatures)) {
    return 'optional_features';
  }
  return null;
}

function limitsSectionIssue(limits) {
  if (!hasExactMembers(limits, [
    'max_request_bytes', 'max_context_bytes', 'max_stdout_bytes', 'max_stderr_bytes', 'max_timeout_ms',
  ])) {
    return 'limits';
  }
  for (const member of ['max_request_bytes', 'max_context_bytes', 'max_stdout_bytes', 'max_stderr_bytes']) {
    if (!isNonNegativeSafeInteger(limits[member])) {
      return `limits.${member}`;
    }
  }
  if (!isPositiveSafeInteger(limits.max_timeout_ms)) {
    return 'limits.max_timeout_ms';
  }
  return null;
}

// The §3.2 cross-field capability invariants: a contradictory describe
// result is `invalid-describe-result` even when every individual field has
// the right type.
export function validateExecutionCapabilities(dynamic) {
  const execution = dynamic.host.command_execution;
  if (execution.shell !== false) {
    return refuse('invalid-describe-result', 'host.command_execution.shell');
  }
  if (execution.supported === true) {
    const missing = EXECUTION_DEPENDENT_FLAGS.find((flag) => execution[flag] !== true);
    if (missing) {
      return refuse('invalid-describe-result', `host.command_execution.${missing}`);
    }
    const badLimit = Object.entries(dynamic.limits).find(([, value]) => !isPositiveSafeInteger(value));
    if (badLimit) {
      return refuse('invalid-describe-result', `limits.${badLimit[0]}`);
    }
  } else {
    const contradicted = EXECUTION_DEPENDENT_FLAGS.find((flag) => execution[flag] !== false);
    if (contradicted) {
      return refuse('invalid-describe-result', `host.command_execution.${contradicted}`);
    }
    if (dynamic.core.commands.length !== 0) {
      return refuse('invalid-describe-result', 'core.commands');
    }
  }
  return { ok: true };
}

function filesystemInvariantIssue(dynamic) {
  const filesystem = dynamic.host.filesystem;
  const guarded = filesystem.workspace_selection === 'guarded-relative';
  const flags = ['no_follow_resolution', 'stable_identity', 'component_walk'];
  const bad = flags.find((flag) => filesystem[flag] !== guarded);
  return bad ? `host.filesystem.${bad}` : null;
}

function instructionInvariantIssue(dynamic) {
  const instruction = dynamic.host.instruction_input;
  if (instruction.mode === 'none') {
    if (instruction.max_sources !== 0) {
      return 'host.instruction_input.max_sources';
    }
    if (instruction.max_bytes !== 0) {
      return 'host.instruction_input.max_bytes';
    }
    return null;
  }
  return instruction.max_sources === 0 || instruction.max_bytes === 0 ? 'host.instruction_input' : null;
}

function dynamicDescribeIssue(dynamic) {
  if (!hasExactMembers(dynamic, [
    'ok', 'bootstrap_wire_version', 'selected_adapter_contract_version', 'adapter_id', 'adapter_version',
    'core', 'host', 'optional_features', 'limits', 'platforms',
  ])) {
    return 'members';
  }
  if (dynamic.ok !== true) {
    return 'ok';
  }
  if (dynamic.bootstrap_wire_version !== 1) {
    return 'bootstrap_wire_version';
  }
  if (dynamic.selected_adapter_contract_version !== 1) {
    return 'selected_adapter_contract_version';
  }
  if (!isNonEmptyString(dynamic.adapter_id)) {
    return 'adapter_id';
  }
  if (!isNonEmptyString(dynamic.adapter_version)) {
    return 'adapter_version';
  }
  const schemaIssue = coreSectionIssue(dynamic.core)
    || hostCapabilitiesIssue(dynamic.host)
    || optionalFeaturesIssue(dynamic.optional_features)
    || limitsSectionIssue(dynamic.limits);
  if (schemaIssue) {
    return schemaIssue;
  }
  const capabilities = validateExecutionCapabilities(dynamic);
  if (!capabilities.ok) {
    return capabilities.detail;
  }
  const invariantIssue = filesystemInvariantIssue(dynamic) || instructionInvariantIssue(dynamic);
  if (invariantIssue) {
    return invariantIssue;
  }
  return isValidPlatformMap(dynamic.platforms) ? null : 'platforms';
}

// describeAdapter(request, manifest, dynamic) implements the bootstrap
// negotiation of contract section 3: schema-validate the request, the
// static manifest, and the dynamic result in turn, select a shared adapter
// contract version, then cross-check static and dynamic identity, version,
// selected contract, required core version, and the platform map, in the
// error-precedence order given in section 3.3.
export function describeAdapter(request, manifest, dynamic) {
  const requestIssue = describeRequestIssue(request);
  if (requestIssue) {
    return refuse('invalid-describe-request', requestIssue);
  }

  const manifestResult = validateAdapterManifest(manifest);
  if (!manifestResult.ok) {
    return refuse('invalid-adapter-manifest', manifestResult.detail);
  }
  const manifestIssue = manifestValueIssue(manifest);
  if (manifestIssue) {
    return refuse('invalid-adapter-manifest', manifestIssue);
  }

  if (request.bootstrap_wire_version !== manifest.bootstrap_wire_version) {
    return refuse('unsupported-bootstrap-wire-version', { received: request.bootstrap_wire_version });
  }

  const selected = SUPPORTED_ADAPTER_CONTRACT_VERSIONS.find(
    (version) => request.supported_adapter_contract_versions.includes(version)
      && manifest.adapter_contract_versions.includes(version),
  );
  if (selected === undefined) {
    return refuse('unsupported-adapter-contract-version', {
      client: request.supported_adapter_contract_versions,
      adapter: manifest.adapter_contract_versions,
    });
  }

  const dynamicIssue = dynamicDescribeIssue(dynamic);
  if (dynamicIssue) {
    return refuse('invalid-describe-result', dynamicIssue);
  }

  if (dynamic.adapter_id !== manifest.adapter_id) {
    return refuse('adapter-identity-mismatch', { manifest: manifest.adapter_id, describe: dynamic.adapter_id });
  }
  if (dynamic.adapter_version !== manifest.adapter_version) {
    return refuse('adapter-version-mismatch', {
      manifest: manifest.adapter_version, describe: dynamic.adapter_version,
    });
  }
  if (dynamic.selected_adapter_contract_version !== selected) {
    return refuse('adapter-contract-selection-mismatch', {
      expected: selected, describe: dynamic.selected_adapter_contract_version,
    });
  }
  if (dynamic.core.required_core_contract_version !== manifest.required_core_contract_version) {
    return refuse('required-core-contract-version-mismatch', {
      manifest: manifest.required_core_contract_version,
      describe: dynamic.core.required_core_contract_version,
    });
  }
  if (!sameJson(manifest.platforms, dynamic.platforms)) {
    return refuse('adapter-platform-mismatch', { manifest: manifest.platforms, describe: dynamic.platforms });
  }

  return { ok: true, result: dynamic };
}
