import { createHash } from 'node:crypto';

import { normalizeJsonValue, parseJsonRequest } from '../request.js';
import { hasExactMembers, isNonNegativeSafeInteger } from './schema-helpers.js';

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const WOWBAGGER_ID = /^wb_[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

function refuse(error_code, detail = {}) {
  return { ok: false, error_code, detail };
}

function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function decodeCanonicalBase64(value) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return null;
  }
  const bytes = Buffer.from(value, 'base64');
  return bytes.toString('base64') === value ? bytes : null;
}

export function validateHandoffCarrier(carrier, options) {
  if (!hasExactMembers(carrier, [
    'handoff_carrier_version', 'workspace_id', 'content_encoding', 'content_base64',
    'byte_length', 'sha256', 'resume_request',
  ])
    || carrier.handoff_carrier_version !== 1
    || carrier.content_encoding !== 'base64'
    || !isNonNegativeSafeInteger(carrier.byte_length)
    || !DIGEST.test(carrier.sha256)) {
    return refuse('invalid-handoff-carrier');
  }
  if (carrier.workspace_id !== options.workspace_id) {
    return refuse('handoff-workspace-mismatch', { member: 'carrier.workspace_id' });
  }
  if (!hasExactMembers(carrier.resume_request, [
    'item_id', 'expected_revision', 'instruction_set_digest',
  ])
    || !WOWBAGGER_ID.test(carrier.resume_request.item_id)
    || !DIGEST.test(carrier.resume_request.expected_revision)
    || !DIGEST.test(carrier.resume_request.instruction_set_digest)) {
    return refuse('invalid-handoff-resume-request');
  }

  const bytes = decodeCanonicalBase64(carrier.content_base64);
  if (bytes === null || bytes.length !== carrier.byte_length || digest(bytes) !== carrier.sha256) {
    return refuse('invalid-handoff-bytes');
  }
  if (bytes.length > options.max_bytes) return refuse('handoff-limit-exceeded');
  const parsed = parseJsonRequest(bytes);
  if (parsed.issues.length > 0) return refuse('invalid-handoff-json');
  const handoff = normalizeJsonValue(parsed.value);
  if (!hasExactMembers(handoff, [
    'handoff_version', 'workspace_id', 'instruction_set_digest', 'item',
  ])
    || handoff.handoff_version !== 1
    || !DIGEST.test(handoff.instruction_set_digest)
    || !hasExactMembers(handoff.item, ['id', 'revision'])
    || !WOWBAGGER_ID.test(handoff.item.id)
    || !DIGEST.test(handoff.item.revision)) {
    return refuse('invalid-handoff-object');
  }
  if (handoff.workspace_id !== options.workspace_id || handoff.workspace_id !== carrier.workspace_id) {
    return refuse('handoff-workspace-mismatch', { member: 'handoff.workspace_id' });
  }
  const request = carrier.resume_request;
  if (request.item_id !== handoff.item.id
    || request.expected_revision !== handoff.item.revision
    || request.instruction_set_digest !== handoff.instruction_set_digest) {
    return refuse('handoff-resume-binding-mismatch');
  }
  if (request.instruction_set_digest !== options.current.instruction_set_digest) {
    return refuse('handoff-instruction-set-mismatch');
  }
  if (request.item_id !== options.current.item_id) return refuse('handoff-item-mismatch');
  if (request.expected_revision !== options.current.revision) {
    return refuse('handoff-stale-item-revision', {
      expected: request.expected_revision,
      current: options.current.revision,
    });
  }
  return { ok: true, byte_length: bytes.length, handoff };
}

export function buildResumePlan(carrier, options) {
  const validated = validateHandoffCarrier(carrier, options);
  if (!validated.ok) return validated;
  return {
    ok: true,
    must_invoke: ['describe', 'validate', 'inspect'],
    must_compare: ['instruction-set-digest', 'item-revision'],
    forbidden_automatic_actions: ['claim-renewal', 'create', 'git-commit', 'git-push', 'transition'],
  };
}

export function validateHandoffResume({
  handoff_bytes: handoffBytes,
  handoff_digest: handoffDigest,
  resume_request: resumeRequest,
  current,
  max_bytes: maxBytes,
}) {
  if (!(handoffBytes instanceof Uint8Array) || handoffBytes.length > maxBytes) {
    return refuse('handoff-limit-exceeded');
  }
  if (digest(handoffBytes) !== handoffDigest) return refuse('handoff-digest-mismatch');
  if (!WOWBAGGER_ID.test(resumeRequest?.item_id)) return refuse('invalid-handoff-resume-request');
  if (resumeRequest.instruction_set_digest !== current.instruction_set_digest) {
    return refuse('handoff-instruction-set-mismatch');
  }
  if (resumeRequest.item_id !== current.item_id) return refuse('handoff-item-mismatch');
  if (resumeRequest.expected_revision !== current.revision) {
    return refuse('handoff-stale-item-revision', {
      expected: resumeRequest.expected_revision,
      current: current.revision,
    });
  }
  return { ok: true };
}
