import { describeAdapter } from './describe.js';
import { createHash } from 'node:crypto';
import { verifyCoreProbe } from './core-probe.js';
import { validateInvocationLimits } from './limits.js';
import { resolveInvocationPaths } from './paths.js';
import { mapProcessOutcome } from './process-outcome.js';
import { hasExactMembers, isPositiveSafeInteger } from './schema-helpers.js';
import { normalizeJsonValue, parseJsonRequest } from '../request.js';

const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

const MESSAGES = Object.freeze({
  'capability-unavailable': 'The configured host cannot invoke the Wowbagger core.',
  'invalid-invocation': 'The adapter invocation is invalid.',
  'timeout-limit-exceeded': 'The requested timeout exceeds the adapter limit.',
});

function coreRequestIssue(coreRequest) {
  if (coreRequest?.command === 'capabilities') {
    return hasExactMembers(coreRequest, ['command']) ? null : 'core_request';
  }
  if (coreRequest?.command === 'validate') {
    return hasExactMembers(coreRequest, ['command', 'ledger']) && typeof coreRequest.ledger === 'string'
      ? null : 'core_request';
  }
  if (coreRequest?.command === 'ready') {
    return hasExactMembers(coreRequest, ['command', 'ledger', 'as_of'])
      && typeof coreRequest.ledger === 'string' && typeof coreRequest.as_of === 'string'
      ? null : 'core_request';
  }
  if (coreRequest?.command === 'inspect') {
    return hasExactMembers(coreRequest, ['command', 'ledger', 'id'])
      && typeof coreRequest.ledger === 'string' && typeof coreRequest.id === 'string'
      ? null : 'core_request';
  }
  return 'core_request';
}

function emptyContextCarriers(request) {
  return hasExactMembers(request.instruction_input, ['instruction_input_version', 'required', 'sources'])
    && request.instruction_input.instruction_input_version === 1
    && request.instruction_input.required === false
    && Array.isArray(request.instruction_input.sources)
    && request.instruction_input.sources.length === 0
    && request.handoff_carrier === null;
}

function argumentVector(coreRequest, ledger) {
  switch (coreRequest.command) {
    case 'capabilities': return ['capabilities', '--json'];
    case 'validate': return ['validate', '--ledger', ledger, '--json'];
    case 'ready': return ['ready', '--ledger', ledger, '--as-of', coreRequest.as_of, '--json'];
    case 'inspect': return ['inspect', '--ledger', ledger, '--id', coreRequest.id, '--json'];
    default: throw new TypeError('unsupported core command');
  }
}

function launchFailureObservation() {
  return {
    started: false,
    process_tree_contained: true,
    orphaned: false,
    exit_code: null,
    signal: null,
    timed_out: false,
    stdout_complete: true,
    stderr_complete: true,
    stdout_base64: '',
    stderr_base64: '',
  };
}

function streamEnvelope(bytes) {
  return {
    encoding: 'base64',
    data: bytes.toString('base64'),
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    byte_length: bytes.length,
  };
}

function refusal(requestId, code, details) {
  return {
    ok: false,
    adapter_contract_version: 1,
    request_id: requestId,
    error: {
      code,
      message: MESSAGES[code] ?? `The adapter refused the operation (${code}).`,
      details,
    },
  };
}

export async function invokeAdapter(requestBytes, runtime) {
  if (!(requestBytes instanceof Uint8Array) || !isPositiveSafeInteger(runtime?.max_request_bytes)) {
    return refusal(null, 'invalid-invocation', { member: 'request' });
  }
  if (requestBytes.byteLength > runtime.max_request_bytes) {
    return refusal(null, 'invalid-invocation', {
      member: 'request', reason: 'byte-limit-exceeded', limit_bytes: runtime.max_request_bytes,
    });
  }
  const parsed = parseJsonRequest(requestBytes);
  if (parsed.issues.length > 0) {
    return refusal(null, 'invalid-invocation', { member: 'request_json' });
  }
  const request = normalizeJsonValue(parsed.value);
  const requestId = typeof request?.request_id === 'string' && SAFE_ID.test(request.request_id)
    ? request.request_id
    : null;
  if (!hasExactMembers(request, [
    'adapter_contract_version', 'request_id', 'core_request', 'instruction_input', 'handoff_carrier', 'limits',
  ], ['workspace']) || requestId === null) {
    return refusal(requestId, 'invalid-invocation', { member: 'request' });
  }
  const described = describeAdapter(runtime.describe_request, runtime.manifest, runtime.dynamic);
  if (!described.ok) {
    return refusal(requestId, described.error_code, described.detail);
  }
  if (described.result.limits.max_request_bytes > runtime.max_request_bytes) {
    return refusal(requestId, 'invalid-describe-result', { member: 'limits.max_request_bytes' });
  }
  if (requestBytes.byteLength > described.result.limits.max_request_bytes) {
    return refusal(requestId, 'invalid-invocation', {
      member: 'request', reason: 'byte-limit-exceeded', limit_bytes: described.result.limits.max_request_bytes,
    });
  }
  if (request.adapter_contract_version !== described.result.selected_adapter_contract_version) {
    return refusal(requestId, 'adapter-contract-selection-mismatch', {
      expected: described.result.selected_adapter_contract_version,
      received: request.adapter_contract_version,
    });
  }
  const command = request.core_request?.command;
  const required = ['command-execution'];
  if (command !== 'capabilities') required.push('guarded-filesystem');
  const available = [];
  if (described.result.host.command_execution.supported) available.push('command-execution');
  if (described.result.host.filesystem.workspace_selection === 'guarded-relative') {
    available.push('guarded-filesystem');
  }
  const missing = required.filter((capability) => !available.includes(capability));
  if (missing.length > 0) return refusal(requestId, 'capability-unavailable', { missing });

  const activePlatform = runtime.platform ?? process.platform;
  const platformStatus = described.result.platforms[activePlatform] ?? 'unknown';
  if (platformStatus !== 'supported') {
    return refusal(requestId, 'adapter-platform-mismatch', {
      platform: activePlatform, status: platformStatus, required: 'supported',
    });
  }
  const probed = verifyCoreProbe(described.result, runtime.core_probe);
  if (!probed.ok) return refusal(requestId, probed.error_code, probed.detail);
  const limits = validateInvocationLimits(request.limits, described.result.limits);
  if (!limits.ok) return refusal(requestId, limits.error_code, limits.detail);
  const requestIssue = coreRequestIssue(request.core_request);
  if (requestIssue) return refusal(requestId, 'invalid-invocation', { member: requestIssue });
  if (!emptyContextCarriers(request)) {
    return refusal(requestId, 'invalid-invocation', { member: 'instruction_input' });
  }

  let workspace = null;
  if (command !== 'capabilities') {
    if (!hasExactMembers(request.workspace, ['workspace_id'], ['cwd'])
      || typeof request.workspace.workspace_id !== 'string') {
      return refusal(requestId, 'invalid-invocation', { member: 'workspace' });
    }
    const configured = runtime.workspaces?.[request.workspace.workspace_id];
    if (!configured) {
      return refusal(requestId, 'path-rejected', {
        path_role: 'workspace', kind: 'unconfigured-workspace',
      });
    }
    const resolved = resolveInvocationPaths({
      workspace_root: configured.root,
      cwd: request.workspace.cwd ?? '.',
      ledger: request.core_request.ledger,
      before: configured.before,
      after: configured.after,
    });
    if (!resolved.ok) return refusal(requestId, resolved.error_code, resolved.detail);
    workspace = resolved;
  }

  const argv = argumentVector(request.core_request, workspace?.ledger);
  let processObservation;
  try {
    processObservation = await runtime.launch({
      command,
      argv,
      cwd: workspace?.cwd ?? runtime.package_root,
      input: Buffer.alloc(0),
      limits: request.limits,
    });
  } catch {
    processObservation = launchFailureObservation();
  }
  const processFailure = mapProcessOutcome({
    adapter_contract_version: 1,
    request_id: requestId,
    command,
    stdout_limit_bytes: request.limits.stdout_bytes,
    stderr_limit_bytes: request.limits.stderr_bytes,
    process: processObservation,
  });
  if (processFailure) return processFailure;

  const stdout = Buffer.from(processObservation.stdout_base64, 'base64');
  const stderr = Buffer.from(processObservation.stderr_base64, 'base64');
  return {
    ok: true,
    adapter_contract_version: 1,
    request_id: requestId,
    result: {
      core_command: command,
      core_exit_code: processObservation.exit_code,
      stdout: streamEnvelope(stdout),
      stderr: streamEnvelope(stderr),
    },
  };
}
