import { normalizeJsonValue, parseJsonRequest } from '../request.js';
import { CORE_COMMAND_ORDER, CORE_CONTRACT_VERSION, verifyCoreProbe } from './core-probe.js';
import { hasExactMembers, isNonNegativeSafeInteger } from './schema-helpers.js';

const MESSAGES = Object.freeze({
  'mutation-outcome-unknown': 'The mutation may have been applied; inspect current state before retrying.',
  'output-limit-exceeded': 'The core output exceeded the requested bound.',
});

function error(code, details) {
  return { code, message: MESSAGES[code] ?? `The adapter refused the operation (${code}).`, details };
}

function decodeCanonicalBase64(value) {
  if (typeof value !== 'string' || value.includes('\n') || value.includes('\r')) return null;
  const bytes = Buffer.from(value, 'base64');
  return bytes.toString('base64') === value ? bytes : null;
}

function observationIssue(process) {
  if (!hasExactMembers(process, [
    'started', 'process_tree_contained', 'orphaned', 'exit_code', 'signal', 'timed_out',
    'stdout_complete', 'stderr_complete', 'stdout_base64', 'stderr_base64',
  ])) return 'members';
  for (const member of [
    'started', 'process_tree_contained', 'orphaned', 'timed_out', 'stdout_complete', 'stderr_complete',
  ]) {
    if (typeof process[member] !== 'boolean') return member;
  }
  if (process.signal !== null && (typeof process.signal !== 'string' || process.signal.length === 0)) return 'signal';
  if (process.exit_code !== null && !isNonNegativeSafeInteger(process.exit_code)) return 'exit_code';
  const stdout = decodeCanonicalBase64(process.stdout_base64);
  const stderr = decodeCanonicalBase64(process.stderr_base64);
  if (stdout === null) return 'stdout_base64';
  if (stderr === null) return 'stderr_base64';
  if (!process.started) {
    if (process.exit_code !== null || process.signal !== null || process.timed_out
      || !process.process_tree_contained || process.orphaned
      || !process.stdout_complete || !process.stderr_complete
      || stdout.length > 0 || stderr.length > 0) return 'not-started-state';
    return null;
  }
  if ((process.timed_out || process.signal !== null) && process.exit_code !== null) {
    return 'contradictory-exit-state';
  }
  const incomplete = process.timed_out || process.signal !== null
    || !process.process_tree_contained || process.orphaned
    || !process.stdout_complete || !process.stderr_complete;
  return process.exit_code === null && !incomplete ? 'exit_code' : null;
}

function coreEnvelope(process, command) {
  const bytes = decodeCanonicalBase64(process?.stdout_base64);
  if (bytes === null || bytes.length === 0) return { present: false, valid: false };
  const finalLf = bytes.length > 1 && bytes.at(-1) === 0x0a && bytes.at(-2) !== 0x0a && bytes.at(-2) !== 0x0d;
  const parsed = parseJsonRequest(bytes);
  if (!finalLf || parsed.issues.length > 0) return { present: true, valid: false };
  const value = normalizeJsonValue(parsed.value);
  let valid = false;
  if (command === 'ready') {
    valid = hasExactMembers(value, value.valid ? ['as_of', 'valid', 'ready'] : ['valid', 'errors'])
      && typeof value.valid === 'boolean'
      && (value.valid ? process.exit_code === 0 && Array.isArray(value.ready) : process.exit_code === 1);
  } else if (command === 'validate') {
    valid = hasExactMembers(value, value.valid ? ['valid', 'item_count'] : ['valid', 'errors'])
      && typeof value.valid === 'boolean'
      && (value.valid ? process.exit_code === 0 : process.exit_code === 1);
  } else if (command === 'capabilities') {
    valid = verifyCoreProbe({
      core: { required_core_contract_version: CORE_CONTRACT_VERSION, commands: [...CORE_COMMAND_ORDER] },
      optional_features: {
        claims: value?.result?.operations?.work_claim?.supported === true,
        policy: false,
      },
    }, value).ok && process.exit_code === 0;
  }
  return { present: true, valid };
}

function processSummary(process, command) {
  const envelope = coreEnvelope(process, command);
  return {
    started: process?.started ?? null,
    process_tree_contained: process?.process_tree_contained ?? null,
    orphaned: process?.orphaned ?? null,
    exit_code: process?.exit_code ?? null,
    signal: process?.signal ?? null,
    timed_out: process?.timed_out ?? null,
    stdout_complete: process?.stdout_complete ?? null,
    stderr_complete: process?.stderr_complete ?? null,
    core_envelope_present: envelope.present,
    core_envelope_valid: envelope.valid,
  };
}

function mutationUnknown(base, command, itemId, expectedRevision, process, processIssue) {
  const recovery = command === 'create'
    ? {
        action: 'inspect-caller-known-id',
        validate_ledger_first: true,
        retry: 'only-after-item-not-found-and-audited-artifact-recovery',
      }
    : {
        action: 'validate-inspect-and-compare-revision',
        expected_revision: expectedRevision,
        retry: 'never-before-current-state-review',
      };
  const details = { command, item_id: itemId, recovery };
  if (processIssue) details.process_issue = processIssue;
  return {
    ...base,
    mutation_outcome: 'unknown',
    error: error('mutation-outcome-unknown', details),
    process: processSummary(process, command),
  };
}

export function mapProcessOutcome({
  adapter_contract_version: adapterContractVersion,
  request_id: requestId,
  command,
  item_id: itemId,
  expected_revision: expectedRevision,
  stdout_limit_bytes: stdoutLimit,
  stderr_limit_bytes: stderrLimit,
  process,
}) {
  const base = { ok: false, adapter_contract_version: adapterContractVersion, request_id: requestId };
  const mutation = command === 'create' || command === 'transition' || command === 'patch';
  const issue = observationIssue(process);
  if (issue) {
    if (mutation && process?.started !== false) {
      return mutationUnknown(base, command, itemId, expectedRevision, process, issue);
    }
    return {
      ...base,
      error: error('core-observation-incomplete', { reason: 'invalid-process-observation', member: issue }),
      process: processSummary(process, command),
    };
  }
  if (!process.started) {
    return { ...base, error: error('core-launch-failed', {}), process: processSummary(process, command) };
  }
  const envelope = coreEnvelope(process, command);
  const stdout = decodeCanonicalBase64(process.stdout_base64);
  const stderr = decodeCanonicalBase64(process.stderr_base64);
  const overLimit = [];
  if (isNonNegativeSafeInteger(stdoutLimit) && stdout.length > stdoutLimit) overLimit.push('stdout');
  if (isNonNegativeSafeInteger(stderrLimit) && stderr.length > stderrLimit) overLimit.push('stderr');
  const ambiguous = process.timed_out || process.signal !== null
    || !process.process_tree_contained || process.orphaned
    || !process.stdout_complete || !process.stderr_complete || overLimit.length > 0
    || !envelope.present || !envelope.valid;
  if (mutation && ambiguous) {
    return mutationUnknown(base, command, itemId, expectedRevision, process, null);
  }
  if (process.timed_out) {
    return { ...base, error: error('core-timeout', {}), process: processSummary(process, command) };
  }
  if (process.signal !== null) {
    return { ...base, error: error('core-signaled', { signal: process.signal }), process: processSummary(process, command) };
  }
  if (!process.process_tree_contained || process.orphaned) {
    return { ...base, error: error('core-observation-incomplete', {}), process: processSummary(process, command) };
  }
  if (!process.stdout_complete || !process.stderr_complete || overLimit.length > 0) {
    const streams = new Set(overLimit);
    if (!process.stdout_complete) streams.add('stdout');
    if (!process.stderr_complete) streams.add('stderr');
    return {
      ...base,
      error: error('output-limit-exceeded', { streams: [...streams] }),
      process: processSummary(process, command),
    };
  }
  if (!envelope.present || !envelope.valid) {
    return {
      ...base,
      error: error('core-protocol-error', { envelope_present: envelope.present, envelope_valid: envelope.valid }),
      process: processSummary(process, command),
    };
  }
  return null;
}
