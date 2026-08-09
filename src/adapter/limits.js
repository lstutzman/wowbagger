import { hasExactMembers, isNonNegativeSafeInteger, isPositiveSafeInteger } from './schema-helpers.js';

function refuse(error_code, detail) {
  return { ok: false, error_code, detail };
}

export function validateInvocationLimits(requested, advertised) {
  if (!hasExactMembers(requested, ['context_bytes', 'stdout_bytes', 'stderr_bytes', 'timeout_ms'])) {
    return refuse('invalid-invocation', { member: 'limits' });
  }
  const limits = [
    ['context_bytes', 'max_context_bytes', isNonNegativeSafeInteger, 'context-limit-exceeded'],
    ['stdout_bytes', 'max_stdout_bytes', isNonNegativeSafeInteger, 'output-limit-exceeded'],
    ['stderr_bytes', 'max_stderr_bytes', isNonNegativeSafeInteger, 'output-limit-exceeded'],
    ['timeout_ms', 'max_timeout_ms', isPositiveSafeInteger, 'timeout-limit-exceeded'],
  ];
  for (const [requestedKey, maximumKey, valid, exceededCode] of limits) {
    if (!valid(requested[requestedKey]) || !valid(advertised?.[maximumKey])) {
      return refuse('invalid-invocation', { member: `limits.${requestedKey}` });
    }
    if (requested[requestedKey] > advertised[maximumKey]) {
      return refuse(exceededCode, { member: requestedKey });
    }
  }
  return { ok: true };
}
