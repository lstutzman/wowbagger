import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { TextDecoder } from 'node:util';
import { parseLedgerItemSource } from '../src/ledger.js';
import { validateLedger } from '../src/validate.js';

const SAFE_WRITE_PATH_MODES = new Set([
  'atomic-fence',
  'none',
  'reject-active-claim',
  'reject-claimed-id',
]);
const REQUIRED_WRITE_PATHS = {
  alternate: 'none',
  claimed_publication_v1: 'atomic-fence',
  legacy_create_v1: 'reject-claimed-id',
  legacy_transition_v1: 'reject-active-claim',
};
const MAX_ITEM_SOURCE_BYTES = 8388608;
const MAX_EPOCH = 18446744073709551615n;
const UTC_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/;
const NAMESPACE_ID = /^wbns_[a-f0-9]{32}$/;
const ITEM_ID = /^wb_[0-9A-HJKMNP-TV-Z]{26}$/;
const REVISION = /^sha256:[0-9a-f]{64}$/;

export function runReferenceVector(vector) {
  const state = structuredClone(vector.initial);
  const transcript = [];
  for (const action of vector.actions) {
    transcript.push(execute(state, action));
  }
  return { transcript, final: state };
}

function execute(state, action) {
  const schemaError = requestSchemaError(action);
  if (schemaError) return schemaError;
  if (action.operation === 'work-claim.capabilities') {
    if (!action.request || Object.keys(action.request).length !== 0) return invalidCapabilitiesRequest();
    return capabilities(state.backend);
  }
  if (action.operation === 'work-claim.acquire') {
    return acquire(state, action);
  }
  if (action.operation === 'work-claim.read') {
    return claimRead(state, action);
  }
  if (action.operation === 'work-claim.renew') {
    return renew(state, action);
  }
  if (action.operation === 'work-claim.release') {
    return release(state, action);
  }
  if (action.operation === 'work-claim.claim-adopt') {
    return claimAdopt(state, action);
  }
  if (action.operation === 'work-claim.mutation-finalize') {
    return mutationFinalize(state, action);
  }
  if (action.operation === 'ledger-publication.preflight') {
    return publicationPreflight(state, action);
  }
  if (action.operation === 'ledger-publication.commit') {
    return publicationCommit(state, action);
  }
  if (action.operation === 'ledger-publication.read') {
    return publicationRead(state, action);
  }
  if (action.operation === 'legacy-transition-v1.commit') {
    return legacyWrite(state, action, 'transition-v1');
  }
  if (action.operation === 'legacy-create-v1.commit') {
    return legacyWrite(state, action, 'create-v1');
  }
  if (action.operation === 'control.inject-fault') {
    state.faults ??= {};
    state.faults[action.target] = true;
    return { event: 'fault-injected', target: action.target };
  }
  if (action.operation === 'control.restart') {
    state.process = { preflights: [] };
    return { event: 'restart' };
  }
  throw new Error(`unsupported reference operation: ${action.operation}`);
}

function requestSchemaError(action) {
  const request = action.request;
  if (!['work-claim.capabilities', 'control.restart', 'control.inject-fault'].includes(action.operation) && (!request || typeof request !== 'object' || Array.isArray(request))) {
    if (action.operation === 'ledger-publication.commit') return invalidPublicationRequest(action.operation_id);
    return invalidRequestEnvelope(action.operation, action.operation?.split('.')[0] ?? 'work-claim');
  }
  const exact = {
    'work-claim.acquire': ['ledger_namespace', 'item_id', 'owner_id', 'lease_duration_ms', 'expected'],
    'work-claim.renew': ['ledger_namespace', 'item_id', 'owner_id', 'epoch', 'expected_expires_at', 'lease_duration_ms'],
    'work-claim.release': ['ledger_namespace', 'item_id', 'owner_id', 'epoch', 'expected_expires_at'],
    'work-claim.read': ['ledger_namespace', 'item_id'],
    'work-claim.claim-adopt': ['adopted_by', 'from_revision', 'item_id', 'ledger_namespace', 'to_revision'],
    'work-claim.mutation-finalize': ['commit_paths', 'git_commit', 'item_id', 'ledger_namespace', 'published_revision'],
  }[action.operation];
  if (exact && (Object.keys(request).sort().join(',') !== exact.slice().sort().join(',') || !NAMESPACE_ID.test(request.ledger_namespace) || !ITEM_ID.test(request.item_id))) return invalidRequestEnvelope(action.operation, 'work-claim');
  if (exact && (typeof request.owner_id !== 'undefined' && typeof request.owner_id !== 'string' || typeof request.epoch !== 'undefined' && typeof request.epoch !== 'string' || typeof request.lease_duration_ms !== 'undefined' && (!Number.isInteger(request.lease_duration_ms) || request.lease_duration_ms < 1 || request.lease_duration_ms > 86400000) || request.expected && (typeof request.expected !== 'object' || Array.isArray(request.expected)))) return invalidRequestEnvelope(action.operation, 'work-claim');
  if (exact && typeof request.owner_id !== 'undefined' && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(request.owner_id)) return invalidRequestEnvelope(action.operation, 'work-claim');
  if (exact && typeof request.epoch !== 'undefined' && !canonicalUint64(request.epoch, false)) return invalidRequestEnvelope(action.operation, 'work-claim');
  if (exact && request.expected && Object.keys(request.expected).sort().join(',') !== 'active,last_epoch') return invalidRequestEnvelope(action.operation, 'work-claim');
  if (exact && action.operation === 'work-claim.acquire' && (!request.expected || typeof request.expected !== 'object' || request.expected.active === undefined)) return invalidRequestEnvelope(action.operation, 'work-claim');
  if (exact && request.expected) {
    const active = request.expected.active;
    const malformed = typeof request.expected.last_epoch !== 'string'
      || !canonicalUint64(request.expected.last_epoch, true)
      || (active !== null && (typeof active !== 'object'
        || Object.keys(active).sort().join(',') !== 'epoch,expires_at,issued_at,owner_id'
        || typeof active.owner_id !== 'string'
        || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(active.owner_id)
        || !canonicalUint64(active.epoch, false)
        || !isStrictUtcInstant(active.issued_at)
        || !isStrictUtcInstant(active.expires_at)));
    if (malformed) return invalidRequestEnvelope(action.operation, 'work-claim');
  }
  if (action.operation === 'work-claim.claim-adopt'
    && (!REVISION.test(request.from_revision ?? '') || !REVISION.test(request.to_revision ?? '')
      || request.from_revision === request.to_revision
      || typeof request.adopted_by !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(request.adopted_by))) {
    return invalidRequestEnvelope(action.operation, 'work-claim');
  }
  if (['work-claim.renew', 'work-claim.release'].includes(action.operation)
    && (typeof request.expected_expires_at !== 'string' || !isStrictUtcInstant(request.expected_expires_at))) {
    return invalidRequestEnvelope(action.operation, 'work-claim');
  }
  if (action.operation === 'work-claim.mutation-finalize'
    && (!REVISION.test(request.published_revision ?? '')
      || typeof request.git_commit !== 'string'
      || !/^[0-9a-f]{40,64}$/.test(request.git_commit)
      || !Array.isArray(request.commit_paths)
      || request.commit_paths.length < 1
      || request.commit_paths.length > 2
      || request.commit_paths.some((entry) => typeof entry !== 'string' || entry === ''))) {
    return invalidRequestEnvelope(action.operation, 'work-claim');
  }
  if (['ledger-publication.commit','ledger-publication.preflight'].includes(action.operation)) {
    if (!NAMESPACE_ID.test(request.ledger_namespace) || !ITEM_ID.test(request.item_id)
      || typeof request.candidate_sha256 !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(request.candidate_sha256)
      || typeof request.candidate_source_base64 !== 'string'
      || typeof request.expected_revision !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(request.expected_revision)
      || typeof request.claim_fence?.owner_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(request.claim_fence.owner_id)
      || typeof request.claim_fence?.epoch !== 'string' || !canonicalUint64(request.claim_fence.epoch, false)
      || !NAMESPACE_ID.test(request.claim_fence?.ledger_namespace) || !ITEM_ID.test(request.claim_fence?.item_id)) return invalidPublicationSchema(request);
    if (typeof request.candidate_source_base64 === 'string') {
      try { const b = Buffer.from(request.candidate_source_base64, 'base64'); if (b.toString('base64') !== request.candidate_source_base64) return canonicalBase64Error(request); } catch { return canonicalBase64Error(request); }
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(request.operation_id || '')) return invalidPublicationSchema(request);
    if (!request.claim_fence || typeof request.claim_fence !== 'object' || Object.keys(request.claim_fence).sort().join(',') !== 'epoch,item_id,ledger_namespace,owner_id') return invalidPublicationSchema(request);
  }
  if (action.operation === 'ledger-publication.read' && (Object.keys(request).sort().join(',') !== 'item_id,ledger_namespace,operation_id' || !NAMESPACE_ID.test(request.ledger_namespace) || !ITEM_ID.test(request.item_id) || Object.values(request).some((value) => typeof value !== 'string') || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(request.operation_id))) return invalidRequestEnvelope(action.operation, 'ledger-publication');
  if (['ledger-publication.commit','ledger-publication.preflight'].includes(action.operation) && (!request || Object.keys(request).sort().join(',') !== ['candidate_sha256','candidate_source_base64','claim_fence','expected_revision','item_id','ledger_namespace','operation_id'].sort().join(','))) return invalidPublicationSchema(request);
  return null;
}

function invalidRequestEnvelope(operation, namespace) {
  return { exit: 2, stdout: { ok: false, namespace, command: operation?.split('.').pop() ?? 'request', contract_version: 1, state: 'unchanged', error: { code: 'invalid-request', message: 'The request does not match the documented version 1 schema.', details: {} } } };
}

function invalidCapabilitiesRequest() {
  return { exit: 2, stdout: { ok: false, namespace: 'work-claim', command: 'capabilities', contract_version: 1, state: 'unchanged', error: { code: 'invalid-request', message: 'The request does not match capabilities version 1.', details: {} } } };
}

function canonicalUint64(value, allowZero) {
  const pattern = allowZero ? /^(0|[1-9][0-9]{0,19})$/ : /^[1-9][0-9]{0,19}$/;
  if (typeof value !== 'string' || !pattern.test(value)) return false;
  try { return BigInt(value) <= MAX_EPOCH; } catch { return false; }
}

function isStrictUtcInstant(value) {
  const match = typeof value === 'string' ? UTC_INSTANT.exec(value) : null;
  if (!match) return false;
  const [, year, month, day, hour, minute, second, millis] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millis));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    && date.getUTCHours() === hour && date.getUTCMinutes() === minute && date.getUTCSeconds() === second && date.getUTCMilliseconds() === millis;
}

function capabilities(backend) {
  const safe = isFencedBackend(backend);
  return {
    exit: 0,
    stdout: {
      ok: true,
      namespace: 'work-claim',
      command: 'capabilities',
      contract_version: 1,
      result: {
        backend: {
          name: backend.name,
          coordination_scope: backend.coordination_scope,
          ledger_binding: structuredClone(backend.ledger_binding),
          write_serialization: structuredClone(backend.write_serialization),
        },
        operations: {
          work_claim: {
            supported: true,
            api_version: 2,
            mode: safe ? 'fenced' : 'advisory',
            claim_protected_publication: safe,
            fencing_enforced_at: safe ? 'ledger-publication-commit-boundary' : 'none',
            safe_exclusive_dispatch: safe,
            write_paths: structuredClone(backend.write_paths),
          },
        },
      },
    },
  };
}

function isFencedBackend(backend) {
  return backend.coordination_scope === 'shared-transactional-coordinator'
    && backend.durability === 'durable-coordinator'
    && backend.ledger_binding?.mode === 'explicit-allowlist'
    && Array.isArray(backend.ledger_binding.namespaces)
    && backend.ledger_binding.namespaces.length > 0
    && Object.entries(REQUIRED_WRITE_PATHS).every(([path, mode]) => (
    backend.write_paths[path] === mode
    )) && Object.values(backend.write_paths).every((mode) => SAFE_WRITE_PATH_MODES.has(mode));
}

function namespaceIsBound(backend, namespace) {
  return backend.ledger_binding?.mode === 'explicit-allowlist'
    && Array.isArray(backend.ledger_binding.namespaces)
    && backend.ledger_binding.namespaces.includes(namespace);
}

function namespaceClaimError(command, request) {
  return {
    exit: 2,
    stdout: {
      ok: false,
      namespace: 'work-claim',
      command,
      contract_version: 1,
      state: 'unchanged',
      error: {
        code: 'ledger-namespace-unbound',
        message: 'The ledger namespace is not provisioned for this endpoint.',
        details: { ledger_namespace: request.ledger_namespace, item_id: request.item_id },
      },
    },
  };
}

function acquire(state, action) {
  const request = action.request;
  if (!namespaceIsBound(state.backend, request.ledger_namespace)) return namespaceClaimError('acquire', request);
  const observedAt = persistClockFloor(state, request.ledger_namespace, action.physical_now);
  if (observedAt === null) {
    return clockFloorError('work-claim', 'acquire', request);
  }
  const existing = state.durable.claims.find((claim) => claim.ledger_namespace === request.ledger_namespace && claim.item_id === request.item_id);
  const record = existing ?? { ledger_namespace: request.ledger_namespace, item_id: request.item_id, last_epoch: '0', active: null };
  const observed = { last_epoch: record.last_epoch, active: structuredClone(record.active) };
  if (!isDeepStrictEqual(request.expected, observed)) {
    return claimError('acquire', 'claim-conflict', 'The observed claim state no longer matches this request.', request, observedAt, record);
  }
  if (record.active !== null && observedAt < record.active.expires_at) {
    return claimError('acquire', 'claim-held', 'The item has an unexpired active claim.', request, observedAt, record);
  }
  if (BigInt(record.last_epoch) >= MAX_EPOCH) {
    return epochExhausted(request, observedAt, record);
  }
  const nextEpoch = String(BigInt(record.last_epoch) + 1n);
  const claim = {
    owner_id: request.owner_id,
    epoch: nextEpoch,
    issued_at: observedAt,
    expires_at: new Date(Date.parse(observedAt) + request.lease_duration_ms).toISOString(),
  };
  record.last_epoch = nextEpoch;
  record.active = claim;
  if (!existing) state.durable.claims.push(record);
  return claimResponseOrLoss(state, 'acquire', {
    exit: 0,
    stdout: {
      ok: true,
      namespace: 'work-claim',
      command: 'acquire',
      contract_version: 1,
      state: 'committed',
      result: {
        claim: structuredClone(claim),
        read_back: readBack(request.ledger_namespace, request.item_id, observedAt, record),
      },
    },
  });
}

function claimRead(state, action) {
  const request = action.request;
  if (!namespaceIsBound(state.backend, request.ledger_namespace)) return namespaceClaimError('read', request);
  const record = state.durable.claims.find((claim) => (
    claim.ledger_namespace === request.ledger_namespace && claim.item_id === request.item_id
  )) ?? {
    ledger_namespace: request.ledger_namespace,
    item_id: request.item_id,
    last_epoch: '0',
    active: null,
  };
  const observedAt = readObservedAt(state, request.ledger_namespace, action.physical_now);
  return {
    exit: 0,
    stdout: {
      ok: true,
      namespace: 'work-claim',
      command: 'read',
      contract_version: 1,
      state: 'committed',
      result: { read_back: readBack(request.ledger_namespace, request.item_id, observedAt, record) },
    },
  };
}

function renew(state, action) {
  const request = action.request;
  if (!namespaceIsBound(state.backend, request.ledger_namespace)) return namespaceClaimError('renew', request);
  const record = findClaim(state, request.ledger_namespace, request.item_id);
  const observedAt = persistClockFloor(state, request.ledger_namespace, action.physical_now);
  if (observedAt === null) {
    return clockFloorError('work-claim', 'renew', request);
  }
  if (!claimTupleMatches(record.active, request)) {
    return claimError(
      'renew',
      'claim-conflict',
      'The active claim tuple no longer matches this request.',
      request,
      observedAt,
      record,
    );
  }
  if (observedAt >= record.active.expires_at) {
    return claimError('renew', 'claim-expired', 'The matching claim has expired.', request, observedAt, record);
  }
  record.active.expires_at = new Date(Date.parse(observedAt) + request.lease_duration_ms).toISOString();
  return claimSuccess(state, 'renew', request, observedAt, record);
}

function release(state, action) {
  const request = action.request;
  if (!namespaceIsBound(state.backend, request.ledger_namespace)) return namespaceClaimError('release', request);
  const record = findClaim(state, request.ledger_namespace, request.item_id);
  const observedAt = persistClockFloor(state, request.ledger_namespace, action.physical_now);
  if (observedAt === null) {
    return clockFloorError('work-claim', 'release', request);
  }
  if (!claimTupleMatches(record.active, request)) {
    return claimError(
      'release',
      'claim-conflict',
      'The active claim tuple no longer matches this request.',
      request,
      observedAt,
      record,
    );
  }
  if (observedAt >= record.active.expires_at) {
    return claimError('release', 'claim-expired', 'The matching claim has expired.', request, observedAt, record);
  }
  const released = structuredClone(record.active);
  record.active = null;
  return claimSuccess(state, 'release', request, observedAt, record, { released_claim: released });
}

function claimTupleMatches(active, request) {
  return active !== null
    && active.owner_id === request.owner_id
    && active.epoch === request.epoch
    && active.expires_at === request.expected_expires_at;
}

function claimSuccess(state, command, request, observedAt, record, extra = {}) {
  return claimResponseOrLoss(state, command, {
    exit: 0,
    stdout: {
      ok: true,
      namespace: 'work-claim',
      command,
      contract_version: 1,
      state: 'committed',
      result: {
        ...extra,
        ...(record.active === null ? {} : { claim: structuredClone(record.active) }),
        read_back: readBack(request.ledger_namespace, request.item_id, observedAt, record),
      },
    },
  });
}

function epochExhausted(request, observedAt, record) {
  return {
    exit: 6,
    stdout: {
      ok: false,
      namespace: 'work-claim',
      command: 'acquire',
      contract_version: 1,
      state: 'unchanged',
      error: {
        code: 'epoch-exhausted',
        message: 'The epoch high-water mark is exhausted.',
        details: readBack(request.ledger_namespace, request.item_id, observedAt, record),
      },
    },
  };
}

function readObservedAt(state, ledgerNamespace, physicalNow) {
  const floor = state.durable.clock_floors.find((entry) => entry.ledger_namespace === ledgerNamespace);
  return floor && floor.observed_at > physicalNow ? floor.observed_at : physicalNow;
}

function claimResponseOrLoss(state, command, envelope) {
  if (state?.faults?.['claim-response-loss'] === true) {
    state.faults['claim-response-loss'] = false;
    return { event: 'response-lost', namespace: 'work-claim', command };
  }
  return envelope;
}

function publicationPreflight(state, action) {
  const request = structuredClone(action.request);
  if (!namespaceIsBound(state.backend, request.ledger_namespace)) {
    return namespaceUnbound(request);
  }
  if (!isFencedBackend(state.backend)) {
    return capabilityUnavailable(request);
  }
  let source;
  try { source = Buffer.from(request.candidate_source_base64, 'base64'); } catch { return invalidPublicationSchema(request, 'candidate_source_base64'); }
  if (source.toString('base64') !== request.candidate_source_base64) {
    return canonicalBase64Error(request);
  }
  if (source.length > MAX_ITEM_SOURCE_BYTES) return itemSourceTooLarge(request, source.length);
  const digest = `sha256:${createHash('sha256').update(source).digest('hex')}`;
  if (digest !== request.candidate_sha256) {
    return candidateDigestMismatch(request);
  }
  const candidateError = validateCandidateLedger(request, source);
  if (candidateError) {
    return candidateError;
  }
  const ledger = findLedger(state, request.ledger_namespace, request.item_id);
  if (ledger.revision !== request.expected_revision) {
    return publicationError(request, 'ledger-revision-conflict', 'The durable ledger revision no longer matches this publication.', {
      ledger_namespace: request.ledger_namespace,
      item_id: request.item_id,
      expected_revision: request.expected_revision,
      actual_revision: ledger.revision,
    });
  }
  const existing = state.process.preflights.find((entry) => entry.operation_id === request.operation_id
    && entry.ledger_namespace === request.ledger_namespace && entry.item_id === request.item_id);
  const operationDigest = digestRequest(request);
  if (existing && existing.operation_digest !== operationDigest) {
    throw new Error(`operation identity reused with different request: ${request.operation_id}`);
  }
  if (!existing) {
    state.process.preflights.push({ operation_id: request.operation_id, ledger_namespace: request.ledger_namespace, item_id: request.item_id, request, operation_digest: operationDigest });
  }
  return { event: 'preflight-complete', operation_id: request.operation_id };
}

function validateCandidateLedger(request, source) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(source); } catch { text = null; }
  const parsed = text === null ? { error: { code: 'invalid-utf8' } } : parseLedgerItemSource(text);
  const data = parsed.data;
  const required = ['schema_version', 'id', 'title', 'kind', 'status', 'created', 'updated', 'provenance'];
  const complete = data && required.every((key) => Object.hasOwn(data, key))
    && data.schema_version === 1
    && data.id === request.item_id
    && typeof data.title === 'string'
    && typeof data.kind === 'string'
    && ['triage', 'backlog', 'in-progress', 'done', 'killed', 'archived'].includes(data.status)
    && ['task', 'epic'].includes(data.kind)
    && /^\d{4}-\d{2}-\d{2}$/.test(data.created)
    && /^\d{4}-\d{2}-\d{2}$/.test(data.updated)
    && (data.depends_on === undefined || Array.isArray(data.depends_on))
    && (data.related === undefined || Array.isArray(data.related))
    && (data.decisions === undefined || Array.isArray(data.decisions))
    && data.provenance && typeof data.provenance === 'object'
    && typeof data.provenance.source === 'string'
    && typeof data.provenance.recorded_at === 'string'
    && (data.decisions === undefined || data.decisions.every((decision) => (
      decision && typeof decision.action === 'string'
      && /^\d{4}-\d{2}-\d{2}$/.test(decision.date)
      && typeof decision.summary === 'string'
      && typeof decision.rationale === 'string'
    )))
    && (data.status !== 'done' || /^\d{4}-\d{2}-\d{2}$/.test(data.completed));
  if (parsed.error || !complete) {
    return {
      exit: 3,
      stdout: {
        ok: false,
        namespace: 'ledger-publication',
        command: 'publish-claimed',
        contract_version: 1,
        state: 'unchanged',
        operation_id: request.operation_id,
        error: {
          code: 'ledger-invalid',
          message: 'The candidate ledger is invalid.',
          details: {
            item_id: request.item_id,
            reason: parsed.error?.code ?? (data?.id !== request.item_id ? 'item-id-mismatch' : 'incomplete-ledger-item'),
          },
        },
      },
    };
  }
  const validation = validateLedger({ errors: [], items: [{ data, source: text, body: parsed.body, bytes: source }] });
  if (!validation.valid) {
    return {
      exit: 3,
      stdout: {
        ok: false, namespace: 'ledger-publication', command: 'publish-claimed', contract_version: 1,
        state: 'unchanged', operation_id: request.operation_id,
        error: { code: 'ledger-invalid', message: 'The candidate ledger is invalid.', details: validation.errors },
      },
    };
  }
  return null;
}

function publicationCommit(state, action) {
  if (!action.request) {
    return invalidPublicationRequest(action.operation_id);
  }
  const exactPrior = state.durable.publication_outcomes.find((entry) => (
    entry.operation_id === action.operation_id
      && entry.ledger_namespace === action.request.ledger_namespace
      && entry.item_id === action.request.item_id
  ));
  if (!namespaceIsBound(state.backend, action.request.ledger_namespace)) return namespaceUnbound(action.request);
  if (exactPrior && digestRequest(action.request) === exactPrior.operation_digest) {
    return structuredClone(exactPrior.envelope);
  }
  if (exactPrior) return idempotencyConflict(action.operation_id, exactPrior.operation_digest, digestRequest(action.request));
  const guard = publicationRequestGuard(state, action.request);
  if (guard) return guard;
  const prior = state.durable.publication_outcomes.find((entry) => (
    entry.operation_id === action.operation_id
      && entry.ledger_namespace === action.request.ledger_namespace
      && entry.item_id === action.request.item_id
  ));
  if (prior) {
    const record = findClaim(state, action.request.ledger_namespace, action.request.item_id);
    const observedAt = action.physical_now ?? new Date(0).toISOString();
    const rejectionReason = fenceRejectionReason(action.request, record.active, observedAt);
    if (rejectionReason !== null) return publicationFenceError(action.request, observedAt, record.active, rejectionReason);
    const submittedDigest = digestRequest(action.request);
    if (submittedDigest !== prior.operation_digest) {
      return idempotencyConflict(action.operation_id, prior.operation_digest, submittedDigest);
    }
    return structuredClone(prior.envelope);
  }
  const plan = state.process.preflights.find((entry) => entry.operation_id === action.operation_id);
  if (!plan) {
    throw new Error(`missing publication preflight: ${action.operation_id}`);
  }
  if (!isFencedBackend(state.backend)) {
    return capabilityUnavailable(plan.request);
  }
  if (digestRequest(action.request) !== plan.operation_digest) {
    return idempotencyConflict(
      action.operation_id,
      plan.operation_digest,
      digestRequest(action.request),
    );
  }
  const request = plan.request;
  if (state.faults?.['publication-outcome-unknown'] === true) {
    state.faults['publication-outcome-unknown'] = false;
    return publicationOutcomeUnknown(request);
  }
  const observedAt = persistClockFloor(state, request.ledger_namespace, action.physical_now);
  if (observedAt === null) {
    return clockFloorError(
      'ledger-publication',
      'publish-claimed',
      request,
    );
  }
  const record = findClaim(state, request.ledger_namespace, request.item_id);
  const fence = request.claim_fence;
  const active = record.active;
  const rejectionReason = fenceRejectionReason(request, active, observedAt);
  if (rejectionReason !== null) {
    return persistPublicationOutcome(state, request.operation_id, publicationFenceError(
      request,
      observedAt,
      active,
      rejectionReason,
    ), request);
  }
  const ledger = findLedger(state, request.ledger_namespace, request.item_id);
  if (ledger.revision !== request.expected_revision) {
    return persistPublicationOutcome(state, request.operation_id, publicationError(
      request,
      'ledger-revision-conflict',
      'The durable ledger revision no longer matches this publication.',
      {
        ledger_namespace: request.ledger_namespace,
        item_id: request.item_id,
        expected_revision: request.expected_revision,
        actual_revision: ledger.revision,
      },
    ), request);
  }
  ledger.revision = request.candidate_sha256;
  ledger.source_base64 = request.candidate_source_base64;
  const committed = persistPublicationOutcome(state, request.operation_id, {
    exit: 0,
    stdout: {
      ok: true,
      namespace: 'ledger-publication',
      command: 'publish-claimed',
      contract_version: 1,
      state: 'committed',
      operation_id: request.operation_id,
      result: {
        ledger_namespace: request.ledger_namespace,
        item_id: request.item_id,
        committed_revision: request.candidate_sha256,
        claim_fence: structuredClone(request.claim_fence),
        claim_read_back: readBack(
          request.ledger_namespace,
          request.item_id,
          observedAt,
          record,
        ),
      },
    },
  }, request);
  if (state.faults?.['publication-response-loss'] === true) {
    state.faults['publication-response-loss'] = false;
    return { event: 'response-lost', operation_id: request.operation_id };
  }
  return committed;
}

function publicationRequestGuard(state, request) {
  if (!namespaceIsBound(state.backend, request.ledger_namespace)) return namespaceUnbound(request);
  if (!isFencedBackend(state.backend)) return capabilityUnavailable(request);
  let source;
  try {
    source = Buffer.from(request.candidate_source_base64, 'base64');
    if (source.toString('base64') !== request.candidate_source_base64) return canonicalBase64Error(request);
  } catch {
    return canonicalBase64Error(request);
  }
  if (source.length > MAX_ITEM_SOURCE_BYTES) return itemSourceTooLarge(request, source.length);
  const digest = `sha256:${createHash('sha256').update(source).digest('hex')}`;
  if (digest !== request.candidate_sha256) return candidateDigestMismatch(request);
  return validateCandidateLedger(request, source);
}

function fenceRejectionReason(request, active, observedAt) {
  if (request.claim_fence.ledger_namespace !== request.ledger_namespace) {
    return 'ledger-namespace-mismatch';
  }
  if (request.claim_fence.item_id !== request.item_id) {
    return 'item-id-mismatch';
  }
  if (active === null) {
    return 'no-active-claim';
  }
  if (active.owner_id !== request.claim_fence.owner_id) {
    return 'owner-mismatch';
  }
  if (active.epoch !== request.claim_fence.epoch) {
    return 'epoch-mismatch';
  }
  if (observedAt >= active.expires_at) {
    return 'claim-expired';
  }
  return null;
}

function publicationFenceError(request, observedAt, active, reason) {
  return publicationError(
    request,
    'claim-fence-rejected',
    'The supplied claim fence is not the active owner generation.',
    {
      ledger_namespace: request.ledger_namespace,
      item_id: request.item_id,
      observed_at: observedAt,
      reason,
      supplied_owner_id: request.claim_fence.owner_id,
      supplied_epoch: request.claim_fence.epoch,
      active_owner_id: active?.owner_id ?? null,
      active_epoch: active?.epoch ?? null,
    },
  );
}

function publicationError(request, code, message, details, exit = 4) {
  return {
    exit,
    stdout: {
      ok: false,
      namespace: 'ledger-publication',
      command: 'publish-claimed',
      contract_version: 1,
      state: 'unchanged',
      operation_id: request.operation_id,
      error: { code, message, details },
    },
  };
}

function persistPublicationOutcome(state, operationId, envelope, request) {
  state.durable.publication_outcomes.push({
    operation_id: operationId,
    ledger_namespace: request?.ledger_namespace,
    item_id: request?.item_id,
    ...(request ? { request: structuredClone(request) } : {}),
    ...(request ? { operation_digest: digestRequest(request) } : {}),
    envelope: structuredClone(envelope),
  });
  return envelope;
}

function capabilityUnavailable(request) {
  return {
    exit: 2,
    stdout: {
      ok: false,
      namespace: 'ledger-publication',
      command: 'publish-claimed',
      contract_version: 1,
      state: 'unchanged',
      operation_id: request.operation_id,
      error: {
        code: 'capability-unavailable',
        message: 'Claim-protected publication is unavailable on an advisory backend.',
        details: { reason: 'advisory-capability' },
      },
    },
  };
}

function idempotencyConflict(operationId, expectedDigest, actualDigest) {
  return {
    exit: 4,
    stdout: {
      ok: false,
      namespace: 'ledger-publication',
      command: 'publish-claimed',
      contract_version: 1,
      state: 'unchanged',
      operation_id: operationId,
      error: {
        code: 'idempotency-conflict',
        message: 'The operation identity is already bound to a different request.',
        details: {
          operation_id: operationId,
          expected_operation_digest: expectedDigest,
          actual_operation_digest: actualDigest,
        },
      },
    },
  };
}

function publicationRead(state, action) {
  const { operation_id: operationId, ledger_namespace: ledgerNamespace, item_id: itemId } = action.request;
  if (!namespaceIsBound(state.backend, ledgerNamespace)) return namespacePublicationReadError(action.request);
  const outcome = state.durable.publication_outcomes.find((entry) => (
    entry.operation_id === operationId
      && entry.ledger_namespace === ledgerNamespace
      && entry.item_id === itemId
  ));
  if (!outcome) {
    return {
      exit: 2,
      stdout: {
        ok: false,
        namespace: 'ledger-publication',
        command: 'read',
        contract_version: 1,
        state: 'unchanged',
        operation_id: operationId,
        error: {
          code: 'operation-not-found',
          message: 'The publication operation outcome was not found.',
          details: { operation_id: operationId, ledger_namespace: ledgerNamespace, item_id: itemId },
        },
      },
    };
  }
  return {
    exit: 0,
    stdout: {
      ok: true,
      namespace: 'ledger-publication',
      command: 'read',
      contract_version: 1,
      state: 'committed',
      operation_id: operationId,
      result: {
        operation_id: operationId,
        ledger_namespace: ledgerNamespace,
        item_id: itemId,
        operation_digest: outcome.operation_digest,
        outcome: structuredClone(outcome.envelope),
      },
    },
  };
}

function invalidPublicationRequest(operationId) {
  return {
    exit: 2,
    stdout: {
      ok: false,
      namespace: 'ledger-publication',
      command: 'publish-claimed',
      contract_version: 1,
      state: 'unchanged',
      ...(operationId ? { operation_id: operationId } : {}),
      error: {
        code: 'invalid-request',
        message: 'The publish-claimed retry must include its complete request.',
        details: {},
      },
    },
  };
}

function invalidPublicationSchema(request, field) {
  return {
    exit: 2,
    stdout: {
      ok: false, namespace: 'ledger-publication', command: 'publish-claimed', contract_version: 1,
      state: 'unchanged', ...(request?.operation_id ? { operation_id: request.operation_id } : {}),
      error: { code: 'invalid-request', message: 'The request does not match publish-claimed version 1.', details: field ? { field } : {} },
    },
  };
}

function itemSourceTooLarge(request, sizeBytes) {
  return {
    exit: 2,
    stdout: {
      ok: false,
      namespace: 'ledger-publication',
      command: 'publish-claimed',
      contract_version: 1,
      state: 'unchanged',
      operation_id: request.operation_id,
      error: {
        code: 'item-source-too-large',
        message: 'The proposed item source exceeds the supported byte limit.',
        details: {
          item_id: request.item_id,
          size_bytes: sizeBytes,
          limit_bytes: MAX_ITEM_SOURCE_BYTES,
        },
      },
    },
  };
}

function canonicalBase64Error(request) {
  return { exit: 2, stdout: { ok: false, namespace: 'ledger-publication', command: 'publish-claimed', contract_version: 1, state: 'unchanged', operation_id: request.operation_id, error: { code: 'invalid-request', message: 'The candidate source is not canonical base64.', details: { field: 'candidate_source_base64' } } } };
}

function publicationOutcomeUnknown(request) {
  return {
    exit: 6,
    stdout: {
      ok: false,
      namespace: 'ledger-publication',
      command: 'publish-claimed',
      contract_version: 1,
      state: 'unknown',
      operation_id: request.operation_id,
      error: {
        code: 'publication-outcome-unknown',
        message: 'The publication outcome could not be determined.',
        details: {
          operation_id: request.operation_id,
          ledger_namespace: request.ledger_namespace,
          item_id: request.item_id,
        },
      },
    },
  };
}

function candidateDigestMismatch(request) {
  return publicationError(request, 'candidate-digest-mismatch', 'The candidate digest does not match the candidate source.', {
    operation_id: request.operation_id,
  }, 2);
}

function namespaceUnbound(request) {
  return {
    exit: 2,
    stdout: {
      ok: false,
      namespace: 'ledger-publication',
      command: 'publish-claimed',
      contract_version: 1,
      state: 'unchanged',
      operation_id: request.operation_id,
      error: {
        code: 'ledger-namespace-unbound',
        message: 'The ledger namespace is not provisioned for this endpoint.',
        details: { ledger_namespace: request.ledger_namespace },
      },
    },
  };
}

function namespacePublicationReadError(request) {
  return {
    exit: 2,
    stdout: {
      ok: false,
      namespace: 'ledger-publication',
      command: 'read',
      contract_version: 1,
      state: 'unchanged',
      operation_id: request.operation_id,
      error: {
        code: 'ledger-namespace-unbound',
        message: 'The ledger namespace is not provisioned for this endpoint.',
        details: { ledger_namespace: request.ledger_namespace, item_id: request.item_id },
      },
    },
  };
}

function clockFloorError(namespace, command, request) {
  return {
    exit: 6,
    stdout: {
      ok: false,
      namespace,
      command,
      contract_version: 1,
      state: 'unchanged',
      ...(request.operation_id ? { operation_id: request.operation_id } : {}),
      error: {
        code: 'clock-floor-persistence-failed',
        message: 'The authoritative clock floor could not be persisted.',
        details: {
          ledger_namespace: request.ledger_namespace,
          item_id: request.item_id,
        },
      },
    },
  };
}

function legacyWrite(state, action, command) {
  const request = action.request;
  if (!namespaceIsBound(state.backend, request.ledger_namespace)) return namespaceClaimError(command, request);
  const record = findClaim(state, request.ledger_namespace, request.item_id);
  const observedAt = persistClockFloor(state, request.ledger_namespace, action.physical_now);
  if (observedAt === null) {
    return clockFloorError('ledger-mutation', command, request);
  }
  const mustRefuse = command === 'create-v1'
    ? record.last_epoch !== '0'
    : record.active !== null && observedAt < record.active.expires_at;
  if (!mustRefuse) {
    throw new Error(`reference vector attempted an unmodelled permitted ${command}`);
  }
  return {
    exit: 4,
    stdout: {
      ok: false,
      namespace: 'ledger-mutation',
      command,
      contract_version: 1,
      state: 'unchanged',
      error: {
        code: command === 'create-v1'
          ? 'claimed-item-write-refused'
          : 'active-claim-write-refused',
        message: command === 'create-v1'
          ? 'Legacy create cannot write an item identity with claim history.'
          : 'Legacy transition cannot write an item with an active claim.',
        details: readBack(request.ledger_namespace, request.item_id, observedAt, record),
      },
    },
  };
}

// Adoption re-baselines the authorized revision onto bytes the coordinator
// never wrote. It changes no item byte, so a ledger record carries three
// revisions: `revision` is what the writer's own surface holds,
// `committed_revision` is what every cooperating checkout can see (Git HEAD in
// the shipped profile), and `authorized_revision` is what the coordinator has
// ruled legitimate. The two optional members default to `revision`, which is
// the only state a backend without an out-of-coordinator ledger can reach.
function claimAdopt(state, action) {
  const request = action.request;
  if (!namespaceIsBound(state.backend, request.ledger_namespace)) {
    return namespaceClaimError('claim-adopt', request);
  }
  const record = findOrCreateClaim(state, request.ledger_namespace, request.item_id);
  const observedAt = persistClockFloor(state, request.ledger_namespace, action.physical_now);
  if (observedAt === null) return clockFloorError('work-claim', 'claim-adopt', request);
  const ledger = state.durable.ledgers.find((entry) => (
    entry.ledger_namespace === request.ledger_namespace && entry.item_id === request.item_id
  )) ?? null;
  const authorized = ledger === null ? null : (ledger.authorized_revision ?? ledger.revision);
  if (authorized !== request.from_revision) {
    return adoptionError(request, 'adoption-witness-mismatch',
      'The adoption witness no longer names the authorized revision.', {
        ledger_namespace: request.ledger_namespace,
        item_id: request.item_id,
        authorized_revision: authorized,
        requested_from_revision: request.from_revision,
      });
  }
  if (record.active !== null && observedAt < record.active.expires_at) {
    return claimError('claim-adopt', 'claim-held', 'The item has an unexpired active claim.',
      request, observedAt, record);
  }
  const committed = ledger.committed_revision ?? ledger.revision;
  for (const [surface, observed] of [['git-head', committed], ['working-tree', ledger.revision]]) {
    if (observed === request.to_revision) continue;
    return adoptionError(request, 'adoption-revision-uncommitted',
      'The adopted revision is not committed at Git HEAD.', {
        ledger_namespace: request.ledger_namespace,
        item_id: request.item_id,
        requested_to_revision: request.to_revision,
        observed_surface: surface,
        observed_revision: observed,
      });
  }
  const invalid = adoptedLedgerErrors(ledger);
  if (invalid !== null) {
    return {
      exit: 3,
      stdout: {
        ok: false,
        namespace: 'work-claim',
        command: 'claim-adopt',
        contract_version: 1,
        state: 'unchanged',
        error: {
          code: 'adoption-ledger-invalid',
          message: 'The complete ledger is invalid with the adopted revision.',
          details: {
            ledger_namespace: request.ledger_namespace,
            item_id: request.item_id,
            errors: invalid,
          },
        },
      },
    };
  }
  ledger.authorized_revision = request.to_revision;
  ledger.adoptions = [...(ledger.adoptions ?? []), {
    from_revision: request.from_revision,
    to_revision: request.to_revision,
    adopted_by: request.adopted_by,
    adopted_at: observedAt,
  }];
  return {
    exit: 0,
    stdout: {
      ok: true,
      namespace: 'work-claim',
      command: 'claim-adopt',
      contract_version: 1,
      state: 'committed',
      result: {
        ledger_namespace: request.ledger_namespace,
        item_id: request.item_id,
        from_revision: request.from_revision,
        to_revision: request.to_revision,
        adopted_by: request.adopted_by,
        adopted_at: observedAt,
      },
    },
  };
}

// Recovery of a Git commit an auto-commit mutation could not establish. Derived
// from the mutation contract section 13 alone: it writes no item byte, so the
// only durable change it can make is moving the ledger record's committed
// surface — the shipped profile's Git HEAD — onto bytes the writer's own surface
// already holds. Everything else refuses without changing state, and a repeat
// after the surface already matches changes nothing at all.
function mutationFinalize(state, action) {
  const request = action.request;
  if (!namespaceIsBound(state.backend, request.ledger_namespace)) {
    return namespaceClaimError('mutation-finalize', request);
  }
  const ledger = state.durable.ledgers.find((entry) => (
    entry.ledger_namespace === request.ledger_namespace && entry.item_id === request.item_id
  )) ?? null;
  if (ledger === null) return finalizeRefusal(request, 'item-not-readable', {});
  if (ledger.revision !== request.published_revision) {
    return finalizeRefusal(request, 'item-changed', { published_revision: request.published_revision });
  }
  const committed = ledger.committed_revision ?? null;
  if (committed !== request.published_revision) {
    ledger.committed_revision = request.published_revision;
  }
  return {
    exit: 0,
    stdout: {
      ok: true,
      namespace: 'work-claim',
      command: 'mutation-finalize',
      contract_version: 1,
      state: 'committed',
      result: {
        ledger_namespace: request.ledger_namespace,
        item_id: request.item_id,
        published_revision: request.published_revision,
        git_commit: request.git_commit,
        commit_paths: [...request.commit_paths],
        claim_verified: true,
      },
    },
  };
}

function finalizeRefusal(request, reason, details) {
  return {
    exit: 4,
    stdout: {
      ok: false,
      namespace: 'work-claim',
      command: 'mutation-finalize',
      contract_version: 1,
      state: 'unchanged',
      error: {
        code: 'mutation-finalize-refused',
        message: 'Recovery refused before any Git write.',
        details: { reason, ...details },
      },
    },
  };
}

function adoptionError(request, code, message, details) {
  return {
    exit: 4,
    stdout: {
      ok: false,
      namespace: 'work-claim',
      command: 'claim-adopt',
      contract_version: 1,
      state: 'unchanged',
      error: { code, message, details },
    },
  };
}

function adoptedLedgerErrors(ledger) {
  const bytes = Buffer.from(ledger.source_base64, 'base64');
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return [{ code: 'invalid-utf8' }];
  }
  const parsed = parseLedgerItemSource(text);
  if (parsed.error) return [parsed.error];
  const validation = validateLedger({
    errors: [],
    items: [{ data: parsed.data, source: text, body: parsed.body, bytes }],
  });
  return validation.valid ? null : validation.errors;
}

function claimError(command, code, message, request, observedAt, record) {
  return {
    exit: 4,
    stdout: {
      ok: false,
      namespace: 'work-claim',
      command,
      contract_version: 1,
      state: 'unchanged',
      error: {
        code,
        message,
        details: readBack(request.ledger_namespace, request.item_id, observedAt, record),
      },
    },
  };
}

function findClaim(state, ledgerNamespace, itemId) {
  const record = state.durable.claims.find((claim) => (
    claim.ledger_namespace === ledgerNamespace && claim.item_id === itemId
  ));
  if (!record) {
    throw new Error(`missing claim record: ${ledgerNamespace}/${itemId}`);
  }
  return record;
}

function findOrCreateClaim(state, ledgerNamespace, itemId) {
  return state.durable.claims.find((claim) => (
    claim.ledger_namespace === ledgerNamespace && claim.item_id === itemId
  )) ?? (() => {
    const record = { ledger_namespace: ledgerNamespace, item_id: itemId, last_epoch: '0', active: null };
    state.durable.claims.push(record);
    return record;
  })();
}

function findLedger(state, ledgerNamespace, itemId) {
  const ledger = state.durable.ledgers.find((entry) => (
    entry.ledger_namespace === ledgerNamespace && entry.item_id === itemId
  ));
  if (!ledger) {
    throw new Error(`missing ledger record: ${ledgerNamespace}/${itemId}`);
  }
  return ledger;
}

function persistClockFloor(state, ledgerNamespace, physicalNow) {
  if (state.faults?.clock_floor_persist === true) {
    return null;
  }
  const floor = state.durable.clock_floors.find((entry) => entry.ledger_namespace === ledgerNamespace);
  if (!floor) {
    state.durable.clock_floors.push({ ledger_namespace: ledgerNamespace, observed_at: physicalNow });
    state.durable.clock_floors.sort((left, right) => left.ledger_namespace.localeCompare(right.ledger_namespace));
    return physicalNow;
  }
  if (physicalNow > floor.observed_at) {
    floor.observed_at = physicalNow;
  }
  return floor.observed_at;
}

function readBack(ledgerNamespace, itemId, observedAt, record) {
  return {
    ledger_namespace: ledgerNamespace,
    item_id: itemId,
    observed_at: observedAt,
    last_epoch: record.last_epoch,
    active: structuredClone(record.active),
  };
}

function digestRequest(value) {
  return `sha256:${createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
