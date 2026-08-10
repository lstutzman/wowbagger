import { createHash } from 'node:crypto';

import { isSafeLogicalPath } from './paths.js';
import { hasExactMembers, isNonNegativeSafeInteger } from './schema-helpers.js';

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;
const ORIGIN_PRECEDENCE = new Map([
  ['consumer', 0],
  ['repository', 1],
  ['harness', 2],
  ['user', 3],
  ['adapter', 4],
]);

function refuse(error_code, detail = {}) {
  return { ok: false, error_code, detail };
}

function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function decodeCanonicalBase64(value) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return null;
  }
  const bytes = Buffer.from(value, 'base64');
  return bytes.toString('base64') === value ? bytes : null;
}

export function validateInstructionInput(input, limits) {
  if (!hasExactMembers(input, ['instruction_input_version', 'required', 'sources'])
    || input.instruction_input_version !== 1
    || typeof input.required !== 'boolean'
    || !Array.isArray(input.sources)) {
    return refuse('invalid-instruction-input');
  }
  if (input.required && input.sources.length === 0) {
    return refuse('required-instruction-input-missing');
  }
  if (input.sources.length > limits.max_sources) {
    return refuse('instruction-source-limit-exceeded');
  }

  const seen = new Set();
  const summary = [];
  const diagnostics = [];
  let totalBytes = 0;
  for (const [ordinal, source] of input.sources.entries()) {
    if (!hasExactMembers(source, [
      'source_id', 'origin', 'content_encoding', 'content_base64', 'sha256', 'byte_length',
    ], ['logical_path'])
      || typeof source.source_id !== 'string'
      || !SAFE_ID.test(source.source_id)
      || !ORIGIN_PRECEDENCE.has(source.origin)
      || source.content_encoding !== 'base64'
      || !DIGEST.test(source.sha256)
      || !isNonNegativeSafeInteger(source.byte_length)
      || (Object.hasOwn(source, 'logical_path') && !isSafeLogicalPath(source.logical_path))) {
      return refuse('invalid-instruction-source', { source_id: source?.source_id ?? null });
    }
    if (seen.has(source.source_id)) {
      return refuse('duplicate-instruction-source-id', { source_id: source.source_id });
    }
    seen.add(source.source_id);
    const bytes = decodeCanonicalBase64(source.content_base64);
    if (bytes === null || bytes.length !== source.byte_length || digest(bytes) !== source.sha256) {
      return refuse('invalid-instruction-source', { source_id: source.source_id });
    }
    totalBytes += bytes.length;
    const record = {
      source_id: source.source_id,
      origin: source.origin,
      sha256: source.sha256,
      byte_length: source.byte_length,
    };
    summary.push(record);
    diagnostics.push({
      ordinal,
      source_id: source.source_id,
      origin: source.origin,
      precedence: ORIGIN_PRECEDENCE.get(source.origin),
      logical_path: source.logical_path ?? null,
      byte_length: source.byte_length,
      sha256: source.sha256,
    });
  }
  if (totalBytes > limits.max_bytes) return refuse('instruction-byte-limit-exceeded');

  return {
    ok: true,
    ordered_sources: summary.map(({ source_id }) => source_id),
    total_bytes: totalBytes,
    instruction_set_digest: digest(Buffer.from(canonicalJson(summary))),
    diagnostics,
  };
}
