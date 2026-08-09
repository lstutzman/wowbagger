import { describeAdapter } from './describe.js';
import { verifyCoreProbe } from './core-probe.js';
import { validateInvocationLimits } from './limits.js';
import { hasExactMembers, isPositiveSafeInteger } from './schema-helpers.js';
import { normalizeJsonValue, parseJsonRequest } from '../request.js';

const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

const MESSAGES = Object.freeze({
  'capability-unavailable': 'The configured host cannot invoke the Wowbagger core.',
  'invalid-invocation': 'The adapter invocation is invalid.',
  'timeout-limit-exceeded': 'The requested timeout exceeds the adapter limit.',
});

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
  return refusal(requestId, 'invalid-invocation', { member: 'request' });
}
