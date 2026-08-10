import { createHash } from 'node:crypto';

import { hasExactMembers } from './schema-helpers.js';

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const NONCE = /^[A-Za-z0-9._-]{16,128}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

function refuse(error_code, detail = {}) {
  return { ok: false, error_code, detail };
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

function validCanonicalTime(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().replace('.000Z', 'Z') === value;
}

function validInvocationBinding(value) {
  if (!hasExactMembers(value, [
    'request_id', 'adapter', 'core', 'workspace', 'limits',
    'instruction_set_digest', 'handoff_digest',
  ]) || !SAFE_ID.test(value.request_id)) return false;
  if (!hasExactMembers(value.adapter, ['id', 'version', 'contract_version'])
    || typeof value.adapter.id !== 'string'
    || typeof value.adapter.version !== 'string'
    || !Number.isSafeInteger(value.adapter.contract_version)) return false;
  if (!hasExactMembers(value.core, [
    'executable_identity', 'contract_version', 'argv', 'input_base64',
  ])
    || !DIGEST.test(value.core.executable_identity)
    || !Number.isSafeInteger(value.core.contract_version)
    || !Array.isArray(value.core.argv)
    || !value.core.argv.every((argument) => typeof argument === 'string')
    || decodeCanonicalBase64(value.core.input_base64) === null) return false;
  if (!hasExactMembers(value.workspace, ['id', 'root', 'cwd', 'ledger'])
    || !Object.values(value.workspace).every((member) => typeof member === 'string')) return false;
  if (!hasExactMembers(value.limits, [
    'context_bytes', 'stdout_bytes', 'stderr_bytes', 'timeout_ms',
  ])
    || !Object.values(value.limits).every((member) => Number.isSafeInteger(member) && member >= 0)
    || value.limits.timeout_ms < 1) return false;
  return DIGEST.test(value.instruction_set_digest)
    && (value.handoff_digest === null || DIGEST.test(value.handoff_digest));
}

function approvalSchemaError(value) {
  if (!hasExactMembers(value, [
    'approval_version', 'source', 'nonce', 'issued_at', 'expires_at', 'invocation_digest',
  ])) return true;
  return value.approval_version !== 1
    || typeof value.source !== 'string'
    || typeof value.nonce !== 'string'
    || !NONCE.test(value.nonce)
    || !DIGEST.test(value.invocation_digest)
    || !RFC3339.test(value.issued_at)
    || !validCanonicalTime(value.issued_at)
    || !RFC3339.test(value.expires_at)
    || !validCanonicalTime(value.expires_at);
}

export function canonicalInvocationDigest(binding) {
  if (!validInvocationBinding(binding)) throw new TypeError('invalid invocation binding');
  const canonical = canonicalJson(binding);
  return {
    canonical,
    digest: `sha256:${createHash('sha256').update(Buffer.from(canonical)).digest('hex')}`,
  };
}

export function verifyTrustedApproval({
  approval,
  binding,
  now,
  redeemedNonces,
  trustedSources = new Set(['consumer']),
}) {
  if (approvalSchemaError(approval)) return refuse('invalid-approval');
  if (!(trustedSources instanceof Set)
    || trustedSources.size !== 1
    || !trustedSources.has('consumer')
    || approval.source !== 'consumer') {
    return refuse('approval-source-untrusted', { source: approval.source });
  }
  if (!RFC3339.test(now) || !validCanonicalTime(now)) {
    return refuse('invalid-approval-time', { member: 'now' });
  }
  const issued = Date.parse(approval.issued_at);
  const expires = Date.parse(approval.expires_at);
  const current = Date.parse(now);
  if (issued >= expires) return refuse('invalid-approval-time-order');
  if (current < issued) return refuse('approval-not-yet-valid', { issued_at: approval.issued_at });
  if (current >= expires) return refuse('approval-expired', { expires_at: approval.expires_at });
  if (!(redeemedNonces instanceof Set)) return refuse('invalid-approval');
  if (redeemedNonces.has(approval.nonce)) {
    return refuse('approval-replayed', { nonce: approval.nonce });
  }
  let invocationDigest;
  try {
    invocationDigest = canonicalInvocationDigest(binding).digest;
  } catch {
    return refuse('invalid-approval-binding');
  }
  if (invocationDigest !== approval.invocation_digest) return refuse('approval-binding-mismatch');
  redeemedNonces.add(approval.nonce);
  return { ok: true, nonce: approval.nonce };
}

export function verifyMutationAuthority({ command, approval, approvalOptions }) {
  if (command !== 'create' && command !== 'transition' && command !== 'patch') {
    return { ok: true, authority: [] };
  }
  if (approval === null || approval === undefined) {
    return refuse('consumer-approval-required', { command });
  }
  const verified = verifyTrustedApproval({ approval, ...approvalOptions });
  if (!verified.ok) return verified;
  return { ok: true, authority: [`core:${command}`], nonce: verified.nonce };
}
