import { describeAdapter } from './describe.js';
import { normalizeJsonValue, parseJsonRequest } from '../request.js';

function refusal(requestId, code, details) {
  return {
    ok: false,
    adapter_contract_version: 1,
    request_id: requestId,
    error: {
      code,
      message: 'The adapter invocation is invalid.',
      details,
    },
  };
}

export async function invokeAdapter(requestBytes, runtime) {
  const parsed = parseJsonRequest(requestBytes);
  if (parsed.issues.length > 0) {
    return refusal(null, 'invalid-invocation', { member: 'request_json' });
  }
  const request = normalizeJsonValue(parsed.value);
  const described = describeAdapter(runtime.describe_request, runtime.manifest, runtime.dynamic);
  if (!described.ok) {
    return refusal(request.request_id ?? null, described.error_code, described.detail);
  }
  if (request.adapter_contract_version !== described.result.selected_adapter_contract_version) {
    return refusal(request.request_id ?? null, 'adapter-contract-selection-mismatch', {
      expected: described.result.selected_adapter_contract_version,
      received: request.adapter_contract_version,
    });
  }
  return refusal(request.request_id ?? null, 'invalid-invocation', { member: 'request' });
}
