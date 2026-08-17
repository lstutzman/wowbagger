import { createHash } from 'node:crypto';
import path from 'node:path';

import { parseLedgerItemSource } from '../src/ledger.js';
import {
  createCandidateSource,
  validateCreateRequest,
  validateTransitionRequest,
} from '../src/mutation.js';
import { parseJsonRequest } from '../src/request.js';
import { validateLedger } from '../src/validate.js';

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;
const NONCE = /^[A-Za-z0-9._-]{16,128}$/;
const WOWBAGGER_ID = /^wb_[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/;
// What the runner may say about the request it wrote to the core's standard
// input. Only `delivered` means the core received the whole request.
const INPUT_DELIVERY_STATES = ['delivered', 'failed', 'unread'];
const PLATFORM_KEYS = ['darwin', 'linux', 'win32'];
const PLATFORM_STATUS = new Set(['supported', 'unsupported', 'unverified']);
const ADAPTER_CONTRACT_VERSION = 2;
const CORE_CONTRACT_VERSION = 3;
const CORE_ERROR_EXIT_CODES = new Map([
  ['invalid-request', 2],
  ['item-not-found', 2],
  ['transition-precondition-failed', 2],
  ['patch-precondition-failed', 2],
  ['candidate-invalid', 2],
  ['items-directory-unavailable', 2],
  ['ledger-invalid', 3],
  ['revision-conflict', 4],
  ['lock-held', 4],
  ['id-collision', 4],
  ['path-collision', 4],
  ['atomic-scope-required', 5],
  ['capability-unavailable', 5],
  ['operation-failed', 6],
  ['post-commit-recovery-required', 6],
  ['write-outcome-unknown', 6],
]);
const MUTATION_ERROR_STATES = new Map([
  ['post-commit-recovery-required', 'committed'],
  ['write-outcome-unknown', 'unknown'],
]);
// A mutating command may also be answered by the claim fence, which speaks the
// ledger-mutation domain and carries the legacy work-claim envelope marker
// rather than the core contract version.
const CLAIM_DOMAIN_ENVELOPE_VERSION = 1;
const CLAIM_NAMESPACE_ID = /^wbns_[a-f0-9]{32}$/;
const UNSIGNED_DECIMAL = /^(0|[1-9][0-9]*)$/;
const FENCE_REFUSAL_MESSAGES = new Map([
  ['claimed-item-write-refused', 'Legacy create cannot write an item identity with claim history.'],
  ['active-claim-write-refused', 'Legacy transition cannot write an item with an active claim.'],
  ['claim-store-unavailable', 'The durable claim store is unavailable.'],
]);
const FENCE_REFUSAL_EXITS = new Map([
  ['claimed-item-write-refused', 4],
  ['active-claim-write-refused', 4],
  ['claim-store-unavailable', 6],
]);
const FENCE_REFUSAL_COMMANDS = new Map([
  ['claimed-item-write-refused', ['create']],
  ['active-claim-write-refused', ['transition', 'patch']],
  ['claim-store-unavailable', ['create', 'transition', 'patch']],
]);
// Only the durable-store refusal can leave the outcome genuinely unobservable;
// the two legacy refusals always prove the write never started.
const FENCE_REFUSAL_STATES = new Map([
  ['claimed-item-write-refused', ['unchanged']],
  ['active-claim-write-refused', ['unchanged']],
  ['claim-store-unavailable', ['unchanged', 'unknown']],
]);
const CORE_ERROR_CODES_BY_COMMAND = Object.freeze({
  inspect: new Set(['invalid-request', 'item-not-found', 'ledger-invalid']),
  create: new Set([
    'invalid-request', 'ledger-invalid', 'lock-held', 'id-collision', 'path-collision',
    'candidate-invalid', 'items-directory-unavailable', 'capability-unavailable',
    'operation-failed', 'post-commit-recovery-required', 'write-outcome-unknown',
  ]),
  transition: new Set([
    'invalid-request', 'item-not-found', 'ledger-invalid', 'lock-held',
    'revision-conflict', 'atomic-scope-required', 'transition-precondition-failed',
    'candidate-invalid', 'operation-failed', 'post-commit-recovery-required',
    'write-outcome-unknown',
  ]),
  patch: new Set([
    'invalid-request', 'item-not-found', 'ledger-invalid', 'lock-held',
    'revision-conflict', 'patch-precondition-failed', 'candidate-invalid',
    'operation-failed', 'post-commit-recovery-required', 'write-outcome-unknown',
  ]),
});
const INVALID_REQUEST_CODES = new Set([
  'invalid-json', 'duplicate-key', 'missing-member', 'unknown-member', 'invalid-type',
  'invalid-value', 'missing-argument', 'repeated-argument', 'unknown-argument',
]);
const TRANSITION_ISSUE_MESSAGES = Object.freeze({
  'date-before-created': 'Transition date must not be earlier than the current created date.',
  'date-before-updated': 'Transition date must not be earlier than the current updated date.',
  'invalid-edge': 'The requested lifecycle edge is not allowed for this item.',
  'live-dependencies': 'Completion requires an empty depends_on list.',
  'nonterminal-children': 'Epic completion requires every direct child to be done or killed.',
});
const TRANSITION_ISSUE_FIELDS = Object.freeze({
  'date-before-created': 'date',
  'date-before-updated': 'date',
  'invalid-edge': 'to_status',
  'live-dependencies': 'depends_on',
  'nonterminal-children': 'parent',
});
const PATCH_ISSUE_MESSAGES = Object.freeze({
  'date-before-created': 'Patch date must not be earlier than the current created date.',
  'date-before-updated': 'Patch date must not be earlier than the current updated date.',
});
const DATE_ISSUE_CODES = new Set(['date-before-created', 'date-before-updated']);
const TRANSITION_BLOCKER_FIELDS = Object.freeze({
  'dependent-cleanup': 'depends_on',
  'dependent-disposition': 'depends_on',
  'child-disposition': 'parent',
});
export const CORE_COMMANDS = Object.freeze([
  'capabilities', 'create', 'inspect', 'patch', 'ready', 'transition', 'validate',
]);

function isMutationCommand(command) {
  return command === 'create' || command === 'transition' || command === 'patch';
}
const SUPPORTED_ADAPTER_CONTRACT_VERSIONS = Object.freeze([ADAPTER_CONTRACT_VERSION]);
const INSTRUCTION_MODES = new Set(['none', 'host-provided', 'configured-relative-paths']);
const WORKSPACE_SELECTION_MODES = new Set(['none', 'guarded-relative']);
const ORIGIN_PRECEDENCE = new Map([
  ['consumer', 0],
  ['repository', 1],
  ['harness', 2],
  ['user', 3],
  ['adapter', 4],
]);

export const ADAPTER_ERROR_CODES_BY_OPERATION = Object.freeze({
  approval: Object.freeze([
    'approval-binding-mismatch',
    'approval-expired',
    'approval-not-yet-valid',
    'approval-replayed',
    'approval-source-untrusted',
    'consumer-approval-required',
    'invalid-approval',
    'invalid-approval-binding',
    'invalid-approval-time',
    'invalid-approval-time-order',
  ]),
  handoff: Object.freeze([
    'handoff-digest-mismatch',
    'handoff-instruction-set-mismatch',
    'handoff-item-mismatch',
    'handoff-limit-exceeded',
    'handoff-resume-binding-mismatch',
    'handoff-stale-item-revision',
    'handoff-workspace-mismatch',
    'invalid-handoff-bytes',
    'invalid-handoff-carrier',
    'invalid-handoff-json',
    'invalid-handoff-object',
    'invalid-handoff-resume-request',
  ]),
  instruction: Object.freeze([
    'duplicate-instruction-source-id',
    'instruction-byte-limit-exceeded',
    'instruction-source-limit-exceeded',
    'invalid-instruction-input',
    'invalid-instruction-source',
    'required-instruction-input-missing',
  ]),
  invocation: Object.freeze([
    'capability-unavailable',
    'context-limit-exceeded',
    'core-launch-failed',
    'core-observation-incomplete',
    'core-protocol-error',
    'core-signaled',
    'core-timeout',
    'invalid-invocation',
    'mutation-outcome-unknown',
    'output-limit-exceeded',
    'path-rejected',
    'path-replaced',
    'timeout-limit-exceeded',
  ]),
  negotiation: Object.freeze([
    'adapter-contract-selection-mismatch',
    'adapter-identity-mismatch',
    'adapter-platform-mismatch',
    'adapter-version-mismatch',
    'core-contract-version-mismatch',
    'invalid-adapter-manifest',
    'invalid-describe-request',
    'invalid-describe-result',
    'required-core-contract-version-mismatch',
    'unsupported-adapter-contract-version',
    'unsupported-bootstrap-wire-version',
  ]),
});
export const ADAPTER_ERROR_CODES = Object.freeze(
  Object.values(ADAPTER_ERROR_CODES_BY_OPERATION).flat().sort(),
);
const ADAPTER_ERROR_CODE_SET = new Set(ADAPTER_ERROR_CODES);
const OUTER_ERROR_MESSAGES = Object.freeze({
  'capability-unavailable': 'The configured host cannot invoke the Wowbagger core.',
  'consumer-approval-required': 'The consumer must approve this ledger mutation.',
  'invalid-invocation': 'The adapter invocation is invalid.',
  'mutation-outcome-unknown': 'The mutation may have been applied; inspect current state before retrying.',
  'output-limit-exceeded': 'The core output exceeded the requested bound.',
  'path-rejected': 'The requested ledger path is not a guarded real directory.',
  'path-replaced': 'A guarded path component changed before core launch.',
});

export function canonicalInvocationDigest(binding) {
  if (!validInvocationBinding(binding)) {
    throw new TypeError('invalid invocation binding');
  }
  const canonical = canonicalJson(binding);
  return { canonical, digest: sha256(Buffer.from(canonical)) };
}

export function verifyTrustedApproval({
  approval,
  binding,
  now,
  redeemedNonces,
  trustedSources = new Set(['consumer']),
}) {
  const schemaError = approvalSchemaError(approval);
  if (schemaError) return refusal('invalid-approval', { reason: schemaError });
  if (!(trustedSources instanceof Set)
    || trustedSources.size !== 1
    || !trustedSources.has('consumer')
    || approval.source !== 'consumer') {
    return refusal('approval-source-untrusted', { source: approval.source });
  }
  if (!RFC3339.test(now) || !validCanonicalTime(now)) {
    return refusal('invalid-approval-time', { member: 'now' });
  }
  const issued = Date.parse(approval.issued_at);
  const expires = Date.parse(approval.expires_at);
  const current = Date.parse(now);
  if (issued >= expires) return refusal('invalid-approval-time-order', {});
  if (current < issued) return refusal('approval-not-yet-valid', { issued_at: approval.issued_at });
  if (current >= expires) return refusal('approval-expired', { expires_at: approval.expires_at });
  if (redeemedNonces.has(approval.nonce)) {
    return refusal('approval-replayed', { nonce: approval.nonce });
  }
  let invocationDigest;
  try {
    invocationDigest = canonicalInvocationDigest(binding).digest;
  } catch {
    return refusal('invalid-approval-binding', {});
  }
  if (invocationDigest !== approval.invocation_digest) {
    return refusal('approval-binding-mismatch', {});
  }
  redeemedNonces.add(approval.nonce);
  return { ok: true, nonce: approval.nonce };
}

export function verifyMutationAuthority({ command, approval, approvalOptions }) {
  if (!isMutationCommand(command)) {
    return { ok: true, authority: [] };
  }
  if (approval === null || approval === undefined) {
    return refusal('consumer-approval-required', { command });
  }
  const verified = verifyTrustedApproval({ approval, ...approvalOptions });
  if (!verified.ok) return verified;
  return { ok: true, authority: [`core:${command}`], nonce: verified.nonce };
}

export function verifyRequiredCapabilities({ required, available }) {
  if (!Array.isArray(required) || !Array.isArray(available)
    || !required.every(nonEmptyString) || !available.every(nonEmptyString)) {
    return refusal('invalid-invocation', { member: 'required_capabilities' });
  }
  const availableSet = new Set(available);
  const missing = required.filter((capability) => !availableSet.has(capability));
  if (missing.length > 0) return refusal('capability-unavailable', { missing });
  return { ok: true };
}

export function resolveEntrypointPath({ package_root: packageRoot, executable, before, after }) {
  if (!isSafePackageExecutablePath(executable)) {
    return refusal('path-rejected', { path_role: 'entrypoint', kind: 'invalid-package-path' });
  }
  const components = ['.', ...pathComponents(executable)];
  for (const [index, component] of components.entries()) {
    const expectedKind = index === components.length - 1 ? 'regular-file' : 'directory';
    const initial = before?.[component];
    const final = after?.[component];
    const initialIssue = snapshotIssue(initial, expectedKind);
    if (initialIssue) return snapshotRefusal('entrypoint', component, initialIssue, 'initial');
    const finalIssue = snapshotIssue(final, expectedKind);
    if (finalIssue) return snapshotRefusal('entrypoint', component, finalIssue, 'final');
    if (!sameJson(initial.identity, final.identity)) {
      return refusal('path-replaced', { path_role: 'entrypoint', component });
    }
  }
  return { ok: true, executable: path.posix.join(packageRoot, executable) };
}

export function resolveInvocationPaths({ workspace_root: workspaceRoot, cwd, ledger, before, after }) {
  for (const [role, logicalPath] of [['cwd', cwd], ['ledger', ledger]]) {
    if (!isSafeLogicalPath(logicalPath)) {
      return refusal('path-rejected', { path_role: role, kind: 'invalid-logical-path' });
    }
  }
  const components = [
    { role: 'workspace', logical: '.' },
    ...pathComponents(cwd).map((logical) => ({ role: 'cwd', logical })),
    ...pathComponents(ledger).map((logical) => ({ role: 'ledger', logical })),
  ];
  const seen = new Set();
  for (const component of components) {
    if (seen.has(component.logical)) continue;
    seen.add(component.logical);
    const initial = before?.[component.logical];
    const final = after?.[component.logical];
    const initialIssue = snapshotIssue(initial, 'directory');
    if (initialIssue) {
      return snapshotRefusal(component.role, component.logical, initialIssue, 'initial');
    }
    const finalIssue = snapshotIssue(final, 'directory');
    if (finalIssue) {
      return snapshotRefusal(component.role, component.logical, finalIssue, 'final');
    }
    if (!sameJson(initial.identity, final.identity)) {
      return refusal('path-replaced', {
        path_role: component.role,
        component: component.logical,
      });
    }
  }
  return {
    ok: true,
    workspace_root: workspaceRoot,
    cwd: cwd === '.' ? workspaceRoot : path.posix.join(workspaceRoot, cwd),
    ledger: ledger === '.' ? workspaceRoot : path.posix.join(workspaceRoot, ledger),
  };
}

export function mapProcessOutcome({
  adapter_contract_version: adapterContractVersion,
  request_id: requestId,
  command,
  core_request: coreRequest = null,
  mutation_request: mutationRequest = null,
  mutation_input: mutationInput,
  item_id: itemId,
  expected_revision: expectedRevision,
  stdout_limit_bytes: stdoutLimitBytes,
  stderr_limit_bytes: stderrLimitBytes,
  process,
}) {
  const base = {
    ok: false,
    adapter_contract_version: adapterContractVersion,
    request_id: requestId,
  };
  const mutation = isMutationCommand(command);
  const responseContext = coreRequest === null
    ? null
    : {
        core_request: coreRequest,
        mutation_request: mutationRequest,
        ...(mutationInput === undefined ? {} : { mutation_input: mutationInput }),
      };
  const processIssue = processObservationIssue(process);
  const launchState = launchObservationState(process, processIssue);
  if (processIssue) {
    if (mutation && launchState !== 'not-started') {
      return mutationUnknown(base, command, itemId, expectedRevision, process, processIssue, responseContext);
    }
    return {
      ...base,
      error: outerAdapterError('core-observation-incomplete', {
        reason: 'invalid-process-observation', member: processIssue,
      }),
      process: processSummary(process, command, responseContext),
    };
  }
  if (!process.started) {
    return {
      ...base,
      error: outerAdapterError('core-launch-failed', {}),
      process: processSummary(process, command, responseContext),
    };
  }
  const envelope = envelopeState(process, command, responseContext);
  const overLimitStreams = capturedStreamsOverLimit(process, stdoutLimitBytes, stderrLimitBytes);
  const mutationAmbiguous = process.timed_out
    || process.signal !== null
    || !process.process_tree_contained
    || process.orphaned
    || !process.stdout_complete
    || !process.stderr_complete
    || overLimitStreams.length > 0
    || !envelope.present
    || !envelope.valid
    || envelope.mutation_state === 'unknown';
  if (mutation && mutationAmbiguous) {
    return mutationUnknown(base, command, itemId, expectedRevision, process, null, responseContext);
  }
  if (process.timed_out) {
    // A request the runner reports as anything other than delivered never
    // reached the core. The wait that followed is then the adapter's own
    // silence, not an unobservable core hang, and it is named as such.
    const requestArrived = !Object.hasOwn(process, 'input_delivery')
      || process.input_delivery === 'delivered';
    return {
      ...base,
      error: requestArrived
        ? outerAdapterError('core-timeout', {})
        : outerAdapterError('core-observation-incomplete', {
            reason: 'core-input-undelivered', input_delivery: process.input_delivery,
          }),
      process: processSummary(process, command, responseContext),
    };
  }
  if (process.signal !== null) {
    return {
      ...base,
      error: outerAdapterError('core-signaled', { signal: process.signal }),
      process: processSummary(process, command, responseContext),
    };
  }
  if (!process.process_tree_contained || process.orphaned) {
    return {
      ...base,
      error: outerAdapterError('core-observation-incomplete', {}),
      process: processSummary(process, command, responseContext),
    };
  }
  if (!process.stdout_complete || !process.stderr_complete || overLimitStreams.length > 0) {
    const streams = new Set(overLimitStreams);
    if (!process.stdout_complete) streams.add('stdout');
    if (!process.stderr_complete) streams.add('stderr');
    return {
      ...base,
      error: outerAdapterError('output-limit-exceeded', { streams: [...streams] }),
      process: processSummary(process, command, responseContext),
    };
  }
  if (!envelope.present || !envelope.valid) {
    return {
      ...base,
      error: outerAdapterError('core-protocol-error', {
        envelope_present: envelope.present, envelope_valid: envelope.valid,
      }),
      process: processSummary(process, command, responseContext),
    };
  }
  return null;
}

export function validateInvocationLimits(requested, advertised) {
  if (!hasExactKeys(requested, ['context_bytes', 'stdout_bytes', 'stderr_bytes', 'timeout_ms'])) {
    return refusal('invalid-invocation', { member: 'limits' });
  }
  const mappings = [
    ['context_bytes', 'max_context_bytes', true],
    ['stdout_bytes', 'max_stdout_bytes', true],
    ['stderr_bytes', 'max_stderr_bytes', true],
    ['timeout_ms', 'max_timeout_ms', false],
  ];
  for (const [requestedKey, maximumKey, zeroAllowed] of mappings) {
    const value = requested[requestedKey];
    const maximum = advertised[maximumKey];
    if (!Number.isSafeInteger(value) || value < (zeroAllowed ? 0 : 1)
      || !Number.isSafeInteger(maximum) || maximum < (zeroAllowed ? 0 : 1)) {
      return refusal('invalid-invocation', { member: `limits.${requestedKey}` });
    }
    if (value > maximum) {
      const code = requestedKey === 'timeout_ms'
        ? 'timeout-limit-exceeded'
        : requestedKey === 'context_bytes' ? 'context-limit-exceeded' : 'output-limit-exceeded';
      return refusal(code, { member: requestedKey });
    }
  }
  return { ok: true };
}

export function describeAdapter(request, manifest, suppliedDynamic) {
  const requestError = describeRequestSchemaError(request);
  if (requestError) {
    return describeRequestRefusal(1, { member: requestError });
  }
  const manifestError = adapterManifestSchemaError(manifest);
  if (manifestError) {
    return refusalWithWire(1, 'invalid-adapter-manifest', { member: manifestError });
  }
  const bootstrapWireVersion = manifest.bootstrap_wire_version;
  if (request.bootstrap_wire_version !== bootstrapWireVersion) {
    return refusalWithWire(bootstrapWireVersion, 'unsupported-bootstrap-wire-version', {
      received: request.bootstrap_wire_version,
    });
  }
  const selected = SUPPORTED_ADAPTER_CONTRACT_VERSIONS.find(
    (version) => request.supported_adapter_contract_versions.includes(version)
      && manifest.adapter_contract_versions.includes(version),
  );
  if (selected === undefined) {
    return refusalWithWire(bootstrapWireVersion, 'unsupported-adapter-contract-version', {
      client: request.supported_adapter_contract_versions,
      adapter: manifest.adapter_contract_versions,
    });
  }
  const dynamicError = dynamicDescribeSchemaError(suppliedDynamic);
  if (dynamicError) {
    return refusalWithWire(bootstrapWireVersion, 'invalid-describe-result', { member: dynamicError });
  }
  const dynamic = suppliedDynamic;
  if (dynamic.adapter_id !== manifest.adapter_id) {
    return refusalWithWire(bootstrapWireVersion, 'adapter-identity-mismatch', {
      manifest: manifest.adapter_id, describe: dynamic.adapter_id,
    });
  }
  if (dynamic.adapter_version !== manifest.adapter_version) {
    return refusalWithWire(bootstrapWireVersion, 'adapter-version-mismatch', {
      manifest: manifest.adapter_version, describe: dynamic.adapter_version,
    });
  }
  if (dynamic.selected_adapter_contract_version !== selected) {
    return refusalWithWire(bootstrapWireVersion, 'adapter-contract-selection-mismatch', {
      expected: selected, describe: dynamic.selected_adapter_contract_version,
    });
  }
  if (dynamic.core?.required_core_contract_version !== manifest.required_core_contract_version) {
    return refusalWithWire(bootstrapWireVersion, 'required-core-contract-version-mismatch', {
      manifest: manifest.required_core_contract_version,
      describe: dynamic.core?.required_core_contract_version,
    });
  }
  if (!validPlatforms(manifest.platforms) || !sameJson(manifest.platforms, dynamic.platforms)) {
    return refusalWithWire(bootstrapWireVersion, 'adapter-platform-mismatch', {
      manifest: manifest.platforms, describe: dynamic.platforms,
    });
  }
  return structuredClone(dynamic);
}

export function verifyCoreProbe(describe, probe) {
  const schemaIssue = coreCapabilitiesSchemaIssue(probe);
  if (schemaIssue) {
    return refusal('core-protocol-error', { member: schemaIssue });
  }
  const required = describe.core?.required_core_contract_version;
  if (probe.contract_version !== required) {
    return refusal('core-contract-version-mismatch', { required, probed: probe.contract_version });
  }
  if (!sameJson(describe.core.commands, CORE_COMMANDS)) {
    return refusal('core-contract-version-mismatch', { member: 'core.commands' });
  }
  const probedClaims = probe.result.operations.work_claim.supported;
  if (describe.optional_features?.claims !== probedClaims) {
    return refusal('core-contract-version-mismatch', { member: 'optional_features.claims' });
  }
  if (describe.optional_features?.policy !== false) {
    return refusal('core-contract-version-mismatch', { member: 'optional_features.policy' });
  }
  return { ok: true };
}

export function referenceCoreCapabilities() {
  return {
    ok: true,
    command: 'capabilities',
    contract_version: CORE_CONTRACT_VERSION,
    result: {
      backend: {
        name: 'local-filesystem',
        coordination_scope: 'same-working-copy-cooperative-writers',
      },
      operations: {
        inspect: { supported: true, write_scope: 'none', cas_scope: 'none' },
        create: {
          supported: true,
          write_scope: 'single-item',
          cas_scope: 'requested-id-lock',
          publication_visibility: 'atomic-no-clobber-or-fail',
          publication_probe: 'per-ledger-operation',
        },
        transition: {
          supported: true,
          write_scope: 'single-item',
          cas_scope: 'exact-byte-sha256',
        },
        patch: {
          supported: true,
          write_scope: 'single-item',
          cas_scope: 'exact-byte-sha256',
        },
        work_claim: {
          supported: false,
          api_version: 1,
          mode: 'advisory',
          claim_protected_publication: false,
          fencing_enforced_at: 'none',
          safe_exclusive_dispatch: false,
        },
      },
      durability: {
        temporary_file_sync: 'required-before-publication',
        directory_sync: 'best-effort-when-supported',
        post_publication_verification: 'exact-bytes-required',
        power_loss_guarantee: 'none',
      },
      limits: {
        multi_item_atomicity: false,
        cross_clone_coordination: false,
        cross_worktree_coordination: false,
        cross_machine_coordination: false,
        noncooperating_writer_protection: false,
        automatic_stale_lock_breaking: false,
      },
    },
  };
}

export function validateInstructionInput(input, limits) {
  if (!hasExactKeys(input, ['instruction_input_version', 'required', 'sources'])
    || input.instruction_input_version !== 1
    || typeof input.required !== 'boolean'
    || !Array.isArray(input.sources)) {
    return refusal('invalid-instruction-input', {});
  }
  if (input.required && input.sources.length === 0) {
    return refusal('required-instruction-input-missing', {});
  }
  if (input.sources.length > limits.max_sources) {
    return refusal('instruction-source-limit-exceeded', {});
  }
  const sourceIds = new Set();
  let totalBytes = 0;
  const summary = [];
  const diagnostics = [];
  for (const [ordinal, source] of input.sources.entries()) {
    if (!hasExactKeys(source,
      ['source_id', 'origin', 'content_encoding', 'content_base64', 'sha256', 'byte_length'],
      ['logical_path'])
      || typeof source.source_id !== 'string'
      || !SAFE_ID.test(source.source_id)
      || !ORIGIN_PRECEDENCE.has(source.origin)
      || source.content_encoding !== 'base64'
      || !DIGEST.test(source.sha256)
      || !Number.isSafeInteger(source.byte_length)
      || source.byte_length < 0
      || ('logical_path' in source && !isSafeLogicalPath(source.logical_path))) {
      return refusal('invalid-instruction-source', {
        source_id: source !== null && typeof source === 'object' && !Array.isArray(source)
          && typeof source.source_id === 'string' ? source.source_id : null,
      });
    }
    if (sourceIds.has(source.source_id)) {
      return refusal('duplicate-instruction-source-id', { source_id: source.source_id });
    }
    sourceIds.add(source.source_id);
    const bytes = decodeCanonicalBase64(source.content_base64);
    if (bytes === null || bytes.length !== source.byte_length || sha256(bytes) !== source.sha256) {
      return refusal('invalid-instruction-source', { source_id: source.source_id });
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
  if (totalBytes > limits.max_bytes) return refusal('instruction-byte-limit-exceeded', {});
  return {
    ok: true,
    ordered_sources: summary.map(({ source_id: sourceId }) => sourceId),
    total_bytes: totalBytes,
    instruction_set_digest: sha256(Buffer.from(canonicalJson(summary))),
    diagnostics,
  };
}

export function validateHandoffCarrier(carrier, options) {
  if (!hasExactKeys(carrier, [
    'handoff_carrier_version', 'workspace_id', 'content_encoding', 'content_base64',
    'byte_length', 'sha256', 'resume_request',
  ])
    || carrier.handoff_carrier_version !== 1
    || carrier.content_encoding !== 'base64'
    || !Number.isSafeInteger(carrier.byte_length)
    || carrier.byte_length < 0
    || !DIGEST.test(carrier.sha256)) {
    return refusal('invalid-handoff-carrier', {});
  }
  if (carrier.workspace_id !== options.workspace_id) {
    return refusal('handoff-workspace-mismatch', { member: 'carrier.workspace_id' });
  }
  if (!hasExactKeys(carrier.resume_request,
    ['item_id', 'expected_revision', 'instruction_set_digest'])
    || !WOWBAGGER_ID.test(carrier.resume_request.item_id)
    || !DIGEST.test(carrier.resume_request.expected_revision)
    || !DIGEST.test(carrier.resume_request.instruction_set_digest)) {
    return refusal('invalid-handoff-resume-request', {});
  }
  const bytes = decodeCanonicalBase64(carrier.content_base64);
  if (bytes === null || bytes.length !== carrier.byte_length || sha256(bytes) !== carrier.sha256) {
    return refusal('invalid-handoff-bytes', {});
  }
  if (bytes.length > options.max_bytes) return refusal('handoff-limit-exceeded', {});
  const parsed = parseJsonRequest(bytes);
  if (parsed.issues.length > 0) return refusal('invalid-handoff-json', {});
  const handoff = JSON.parse(bytes.toString('utf8'));
  if (!hasExactKeys(handoff,
    ['handoff_version', 'workspace_id', 'instruction_set_digest', 'item'])
    || handoff.handoff_version !== 1
    || !DIGEST.test(handoff.instruction_set_digest)
    || !hasExactKeys(handoff.item, ['id', 'revision'])
    || !WOWBAGGER_ID.test(handoff.item.id)
    || !DIGEST.test(handoff.item.revision)) {
    return refusal('invalid-handoff-object', {});
  }
  if (handoff.workspace_id !== options.workspace_id
    || handoff.workspace_id !== carrier.workspace_id) {
    return refusal('handoff-workspace-mismatch', { member: 'handoff.workspace_id' });
  }
  const request = carrier.resume_request;
  if (request.item_id !== handoff.item.id || request.expected_revision !== handoff.item.revision
    || request.instruction_set_digest !== handoff.instruction_set_digest) {
    return refusal('handoff-resume-binding-mismatch', {});
  }
  if (request.instruction_set_digest !== options.current.instruction_set_digest) {
    return refusal('handoff-instruction-set-mismatch', {});
  }
  if (request.item_id !== options.current.item_id) return refusal('handoff-item-mismatch', {});
  if (request.expected_revision !== options.current.revision) {
    return refusal('handoff-stale-item-revision', {
      expected: request.expected_revision, current: options.current.revision,
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

export function validateInvokeContext({
  instruction_input: instructionInput,
  handoff_carrier: handoffCarrier,
  context_bytes: contextBytes,
  instruction_limits: instructionLimits,
  handoff_options: handoffOptions,
}) {
  const instructions = validateInstructionInput(instructionInput, instructionLimits);
  if (!instructions.ok) return instructions;
  const handoff = handoffCarrier === null
    ? { ok: true, byte_length: 0 }
    : validateHandoffCarrier(handoffCarrier, handoffOptions);
  if (!handoff.ok) return handoff;
  if (handoffCarrier !== null
    && handoffCarrier.resume_request.instruction_set_digest !== instructions.instruction_set_digest) {
    return refusal('handoff-instruction-set-mismatch', {});
  }
  const totalBytes = instructions.total_bytes + handoff.byte_length;
  if (totalBytes > contextBytes) {
    return refusal('context-limit-exceeded', {
      instruction_bytes: instructions.total_bytes,
      handoff_bytes: handoff.byte_length,
      context_bytes: contextBytes,
    });
  }
  return { ok: true, total_bytes: totalBytes, instructions, handoff };
}

export async function invokeAdapter(requestBytes, runtime) {
  const adapterContractVersion = ADAPTER_CONTRACT_VERSION;
  const maximumRequestBytes = runtime?.max_request_bytes;
  if (!(requestBytes instanceof Uint8Array) || !positiveSafeInteger(maximumRequestBytes)) {
    return invokeRefusal(adapterContractVersion, null, 'invalid-invocation', { member: 'request' });
  }
  if (requestBytes.byteLength > maximumRequestBytes) {
    return invokeRefusal(adapterContractVersion, null, 'invalid-invocation', {
      member: 'request', reason: 'byte-limit-exceeded', limit_bytes: maximumRequestBytes,
    });
  }
  const parsed = parseJsonRequest(requestBytes);
  if (parsed.issues.length > 0) {
    return invokeRefusal(adapterContractVersion, null, 'invalid-invocation', { member: 'request_json' });
  }
  const request = JSON.parse(Buffer.from(requestBytes).toString('utf8'));
  const requestIssue = invocationRequestSchemaIssue(request);
  const requestId = SAFE_ID.test(request?.request_id) ? request.request_id : null;
  if (requestIssue) return invokeRefusal(adapterContractVersion, requestId, 'invalid-invocation', { member: requestIssue });

  const described = describeAdapter(runtime.describe_request, runtime.manifest, runtime.dynamic);
  if (!described.ok) return invokeRefusal(adapterContractVersion, requestId, described.error.code, described.error.details);
  if (described.limits.max_request_bytes > maximumRequestBytes) {
    return invokeRefusal(adapterContractVersion, requestId, 'invalid-describe-result', {
      member: 'limits.max_request_bytes',
      described: described.limits.max_request_bytes,
      runtime: maximumRequestBytes,
    });
  }
  if (requestBytes.byteLength > described.limits.max_request_bytes) {
    return invokeRefusal(adapterContractVersion, requestId, 'invalid-invocation', {
      member: 'request', reason: 'byte-limit-exceeded',
      limit_bytes: described.limits.max_request_bytes,
    });
  }
  if (request.adapter_contract_version !== described.selected_adapter_contract_version) {
    return invokeRefusal(adapterContractVersion, requestId, 'adapter-contract-selection-mismatch', {
      expected: described.selected_adapter_contract_version,
      received: request.adapter_contract_version,
    });
  }
  const command = request.core_request.command;
  const mutation = isMutationCommand(command);
  const requiredCapabilities = ['command-execution'];
  if (command !== 'capabilities') requiredCapabilities.push('guarded-filesystem');
  if (mutation) requiredCapabilities.push('trusted-approval');
  if (request.handoff_carrier !== null) requiredCapabilities.push('handoff');
  const availableCapabilities = [];
  if (described.host.command_execution.supported) availableCapabilities.push('command-execution');
  if (described.host.filesystem.workspace_selection === 'guarded-relative') {
    availableCapabilities.push('guarded-filesystem');
  }
  if (described.host.trusted_approval?.supported === true) {
    availableCapabilities.push('trusted-approval');
  }
  if (described.host.handoff.supported === true) availableCapabilities.push('handoff');
  const capabilities = verifyRequiredCapabilities({
    required: requiredCapabilities, available: availableCapabilities,
  });
  if (!capabilities.ok) {
    return invokeRefusal(adapterContractVersion, requestId, capabilities.error.code, capabilities.error.details);
  }
  const activePlatform = runtime.platform ?? globalThis.process.platform;
  const platformStatus = PLATFORM_KEYS.includes(activePlatform)
    ? described.platforms[activePlatform]
    : 'unknown';
  if (platformStatus !== 'supported') {
    return invokeRefusal(adapterContractVersion, requestId, 'adapter-platform-mismatch', {
      platform: activePlatform, status: platformStatus, required: 'supported',
    });
  }
  const probed = verifyCoreProbe(described, runtime.core_probe);
  if (!probed.ok) return invokeRefusal(adapterContractVersion, requestId, probed.error.code, probed.error.details);
  const limits = validateInvocationLimits(request.limits, described.limits);
  if (!limits.ok) return invokeRefusal(adapterContractVersion, requestId, limits.error.code, limits.error.details);

  const coreRequestIssue = coreRequestSchemaIssue(request.core_request);
  if (coreRequestIssue) {
    return invokeRefusal(adapterContractVersion, requestId, 'invalid-invocation', { member: coreRequestIssue });
  }
  const coreInput = mutationInput(request.core_request);
  if (coreInput === null) {
    return invokeRefusal(adapterContractVersion, requestId, 'invalid-invocation', {
      member: 'core_request.input_base64',
    });
  }

  let resolvedWorkspace = null;
  if (command !== 'capabilities') {
    const configured = runtime.workspaces?.[request.workspace.workspace_id];
    if (!configured) {
      return invokeRefusal(adapterContractVersion, requestId, 'path-rejected', {
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
    if (!resolved.ok) return invokeRefusal(adapterContractVersion, requestId, resolved.error.code, resolved.error.details);
    resolvedWorkspace = {
      id: request.workspace.workspace_id,
      root: resolved.workspace_root,
      cwd: resolved.cwd,
      ledger: resolved.ledger,
    };
  }

  const instructionLimits = {
    max_sources: described.host.instruction_input.max_sources,
    max_bytes: described.host.instruction_input.max_bytes,
  };
  const handoffOptions = {
    workspace_id: request.workspace?.workspace_id ?? runtime.capability_workspace_id,
    max_bytes: described.limits.max_context_bytes,
    current: runtime.handoff_current ?? {
      item_id: 'wb_00000000000000000000000000',
      revision: `sha256:${'0'.repeat(64)}`,
      instruction_set_digest: `sha256:${'0'.repeat(64)}`,
    },
  };
  const context = validateInvokeContext({
    instruction_input: request.instruction_input,
    handoff_carrier: request.handoff_carrier,
    context_bytes: request.limits.context_bytes,
    instruction_limits: instructionLimits,
    handoff_options: handoffOptions,
  });
  if (!context.ok) return invokeRefusal(adapterContractVersion, requestId, context.error.code, context.error.details);

  const argv = coreArgumentVector(request.core_request, resolvedWorkspace?.ledger);
  let mutationRequest = null;
  if (mutation) {
    const mutationParsed = parseJsonRequest(coreInput);
    mutationRequest = mutationParsed.value;
    const authority = verifyMutationAuthority({
      command,
      approval: runtime.approval ?? null,
      approvalOptions: runtime.approval ? {
        binding: invocationBinding({
          request, described, resolvedWorkspace, argv, coreInput, context, runtime,
        }),
        now: runtime.now,
        redeemedNonces: runtime.redeemed_nonces,
        trustedSources: new Set(['consumer']),
      } : undefined,
    });
    if (!authority.ok) {
      return invokeRefusal(adapterContractVersion, requestId, authority.error.code, authority.error.details);
    }
  }

  let process;
  try {
    process = await runtime.launch({
      command,
      argv,
      cwd: resolvedWorkspace?.cwd ?? runtime.package_root,
      input: coreInput,
      limits: request.limits,
    });
  } catch {
    process = launchFailureObservation();
  }
  const processFailure = mapProcessOutcome({
    adapter_contract_version: ADAPTER_CONTRACT_VERSION,
    request_id: requestId,
    command,
    core_request: request.core_request,
    mutation_request: mutationRequest,
    mutation_input: coreInput,
    item_id: WOWBAGGER_ID.test(mutationRequest?.id) ? mutationRequest.id : null,
    expected_revision: DIGEST.test(mutationRequest?.expected_revision)
      ? mutationRequest.expected_revision
      : null,
    stdout_limit_bytes: request.limits.stdout_bytes,
    stderr_limit_bytes: request.limits.stderr_bytes,
    process,
  });
  if (processFailure) return processFailure;

  const stdout = decodeCanonicalBase64(process.stdout_base64);
  const stderr = decodeCanonicalBase64(process.stderr_base64);
  return {
    ok: true,
    adapter_contract_version: ADAPTER_CONTRACT_VERSION,
    request_id: requestId,
    result: {
      core_command: command,
      core_exit_code: process.exit_code,
      stdout: streamEnvelope(stdout),
      stderr: streamEnvelope(stderr),
    },
  };
}

export function validateHandoffResume({
  handoff_bytes: handoffBytes,
  handoff_digest: handoffDigest,
  resume_request: resumeRequest,
  current,
  max_bytes: maxBytes,
}) {
  if (handoffBytes.length > maxBytes) return refusal('handoff-limit-exceeded', {});
  if (sha256(handoffBytes) !== handoffDigest) return refusal('handoff-digest-mismatch', {});
  const parsedResumeBytes = parseJsonRequest(handoffBytes);
  if (parsedResumeBytes.issues.length > 0) return refusal('invalid-handoff-json', {});
  if (!WOWBAGGER_ID.test(resumeRequest?.item_id)) {
    return refusal('invalid-handoff-resume-request', {});
  }
  if (resumeRequest.instruction_set_digest !== current.instruction_set_digest) {
    return refusal('handoff-instruction-set-mismatch', {});
  }
  if (resumeRequest.item_id !== current.item_id) return refusal('handoff-item-mismatch', {});
  if (resumeRequest.expected_revision !== current.revision) {
    return refusal('handoff-stale-item-revision', {
      expected: resumeRequest.expected_revision, current: current.revision,
    });
  }
  return { ok: true };
}

function describeRequestSchemaError(value) {
  if (!hasExactKeys(value, [
    'bootstrap_wire_version', 'supported_adapter_contract_versions', 'request_id',
  ])) return 'members';
  if (!positiveSafeInteger(value.bootstrap_wire_version)) return 'bootstrap_wire_version';
  if (!validVersionArray(value.supported_adapter_contract_versions)) {
    return 'supported_adapter_contract_versions';
  }
  if (!SAFE_ID.test(value.request_id)) return 'request_id';
  return null;
}

function invocationRequestSchemaIssue(value) {
  if (!hasExactKeys(value, [
    'adapter_contract_version', 'request_id', 'core_request', 'instruction_input',
    'handoff_carrier', 'limits',
  ], ['workspace'])) return 'members';
  if (!positiveSafeInteger(value.adapter_contract_version)) return 'adapter_contract_version';
  if (!SAFE_ID.test(value.request_id)) return 'request_id';
  if (!hasExactKeys(value.limits, ['context_bytes', 'stdout_bytes', 'stderr_bytes', 'timeout_ms'])) {
    return 'limits';
  }
  const command = value.core_request?.command;
  if (command === 'capabilities') {
    if (Object.hasOwn(value, 'workspace')) return 'workspace';
  } else if (!hasExactKeys(value.workspace, ['workspace_id'], ['cwd'])
    || !SAFE_ID.test(value.workspace.workspace_id)
    || (Object.hasOwn(value.workspace, 'cwd') && !isSafeLogicalPath(value.workspace.cwd))) {
    return 'workspace';
  }
  return null;
}

function coreRequestSchemaIssue(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'core_request';
  switch (value.command) {
    case 'capabilities':
      return hasExactKeys(value, ['command']) ? null : 'core_request';
    case 'validate':
      return hasExactKeys(value, ['command', 'ledger']) && isSafeLogicalPath(value.ledger)
        ? null : 'core_request';
    case 'ready':
      return hasExactKeys(value, ['command', 'ledger', 'as_of'])
        && isSafeLogicalPath(value.ledger) && /^\d{4}-\d{2}-\d{2}$/.test(value.as_of)
        ? null : 'core_request';
    case 'inspect':
      return hasExactKeys(value, ['command', 'ledger', 'id'])
        && isSafeLogicalPath(value.ledger) && WOWBAGGER_ID.test(value.id)
        ? null : 'core_request';
    case 'create':
    case 'patch':
    case 'transition':
      return hasExactKeys(value, ['command', 'ledger', 'input_base64'])
        && isSafeLogicalPath(value.ledger)
        && decodeCanonicalBase64(value.input_base64) !== null
        ? null : 'core_request';
    default:
      return 'core_request.command';
  }
}

function mutationInput(coreRequest) {
  if (!isMutationCommand(coreRequest.command)) return Buffer.alloc(0);
  return decodeCanonicalBase64(coreRequest.input_base64);
}

function coreArgumentVector(coreRequest, ledger) {
  switch (coreRequest.command) {
    case 'capabilities': return ['capabilities', '--json'];
    case 'validate': return ['validate', '--ledger', ledger, '--json'];
    case 'ready': return ['ready', '--ledger', ledger, '--as-of', coreRequest.as_of, '--json'];
    case 'inspect': return ['inspect', '--ledger', ledger, '--id', coreRequest.id, '--json'];
    case 'create': return ['create', '--ledger', ledger, '--input', '-', '--json'];
    case 'patch': return ['patch', '--ledger', ledger, '--input', '-', '--json'];
    case 'transition': return ['transition', '--ledger', ledger, '--input', '-', '--json'];
    default: throw new TypeError('unsupported core command');
  }
}

function invocationBinding({ request, described, resolvedWorkspace, argv, coreInput, context, runtime }) {
  return {
    request_id: request.request_id,
    adapter: {
      id: described.adapter_id,
      version: described.adapter_version,
      contract_version: described.selected_adapter_contract_version,
    },
    core: {
      executable_identity: runtime.core_executable_identity,
      contract_version: runtime.core_probe.contract_version,
      argv,
      input_base64: coreInput.toString('base64'),
    },
    workspace: resolvedWorkspace,
    limits: request.limits,
    instruction_set_digest: context.instructions.instruction_set_digest,
    handoff_digest: request.handoff_carrier?.sha256 ?? null,
  };
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
    sha256: sha256(bytes),
    byte_length: bytes.length,
  };
}

function invokeRefusal(adapterContractVersion, requestId, code, details) {
  return {
    ok: false,
    adapter_contract_version: adapterContractVersion,
    request_id: requestId,
    error: outerAdapterError(code, details),
  };
}

function adapterManifestSchemaError(value) {
  if (!hasExactKeys(value, [
    'adapter_manifest_version', 'adapter_id', 'adapter_version',
    'adapter_contract_versions', 'bootstrap_wire_version',
    'required_core_contract_version', 'entrypoints', 'platforms',
  ])) return 'members';
  if (value.adapter_manifest_version !== 1) return 'adapter_manifest_version';
  if (!nonEmptyString(value.adapter_id)) return 'adapter_id';
  if (!nonEmptyString(value.adapter_version)) return 'adapter_version';
  if (!sameJson(value.adapter_contract_versions, SUPPORTED_ADAPTER_CONTRACT_VERSIONS)) {
    return 'adapter_contract_versions';
  }
  if (value.bootstrap_wire_version !== 1) return 'bootstrap_wire_version';
  if (!positiveSafeInteger(value.required_core_contract_version)) {
    return 'required_core_contract_version';
  }
  if (!hasExactKeys(value.entrypoints, ['describe', 'invoke'])) return 'entrypoints';
  for (const member of ['describe', 'invoke']) {
    if (!validEntrypoint(value.entrypoints[member])) return `entrypoints.${member}`;
  }
  if (!validPlatforms(value.platforms)) return 'platforms';
  return null;
}

function dynamicDescribeSchemaError(value) {
  if (!hasExactKeys(value, [
    'ok', 'bootstrap_wire_version', 'selected_adapter_contract_version',
    'adapter_id', 'adapter_version', 'core', 'host', 'optional_features',
    'limits', 'platforms',
  ])) return 'members';
  if (value.ok !== true) return 'ok';
  if (value.bootstrap_wire_version !== 1) return 'bootstrap_wire_version';
  if (value.selected_adapter_contract_version !== ADAPTER_CONTRACT_VERSION) {
    return 'selected_adapter_contract_version';
  }
  if (!nonEmptyString(value.adapter_id)) return 'adapter_id';
  if (!nonEmptyString(value.adapter_version)) return 'adapter_version';
  if (!hasExactKeys(value.core, ['required_core_contract_version', 'commands'])
    || !positiveSafeInteger(value.core.required_core_contract_version)
    || !validCommandArray(value.core.commands)) return 'core';
  const hostError = hostCapabilitiesSchemaError(value.host);
  if (hostError) return `host.${hostError}`;
  if (!hasExactKeys(value.optional_features, ['claims', 'policy'])
    || !booleanMembers(value.optional_features)) return 'optional_features';
  if (!hasExactKeys(value.limits, [
    'max_request_bytes', 'max_context_bytes', 'max_stdout_bytes',
    'max_stderr_bytes', 'max_timeout_ms',
  ])) return 'limits';
  for (const member of ['max_request_bytes', 'max_context_bytes', 'max_stdout_bytes', 'max_stderr_bytes']) {
    if (!nonNegativeSafeInteger(value.limits[member])) return `limits.${member}`;
  }
  if (!positiveSafeInteger(value.limits.max_timeout_ms)) return 'limits.max_timeout_ms';
  const capabilityInvariant = capabilityInvariantError(value);
  if (capabilityInvariant) return capabilityInvariant;
  if (!validPlatforms(value.platforms)) return 'platforms';
  return null;
}

function hostCapabilitiesSchemaError(value) {
  if (!hasExactKeys(value, [
    'command_execution', 'filesystem', 'model_transport', 'instruction_input',
    'handoff', 'integration_mechanisms',
  ], ['trusted_approval'])) return 'members';
  if (!hasExactKeys(value.command_execution, [
    'supported', 'arguments_array', 'shell', 'stdio', 'process_tree_containment',
    'orphan_detection', 'timeout_enforcement', 'stdout_limit', 'stderr_limit',
  ])
    || !booleanMembers(value.command_execution)) return 'command_execution';
  if (!hasExactKeys(value.filesystem, [
    'workspace_selection', 'no_follow_resolution', 'stable_identity', 'component_walk',
  ])
    || !WORKSPACE_SELECTION_MODES.has(value.filesystem.workspace_selection)
    || typeof value.filesystem.no_follow_resolution !== 'boolean'
    || typeof value.filesystem.stable_identity !== 'boolean'
    || typeof value.filesystem.component_walk !== 'boolean') return 'filesystem';
  if (!hasExactKeys(value.model_transport, ['available', 'protocol'])
    || typeof value.model_transport.available !== 'boolean'
    || !nonEmptyString(value.model_transport.protocol)) return 'model_transport';
  if (!hasExactKeys(value.instruction_input, ['mode', 'max_sources', 'max_bytes'])
    || !INSTRUCTION_MODES.has(value.instruction_input.mode)
    || !nonNegativeSafeInteger(value.instruction_input.max_sources)
    || !nonNegativeSafeInteger(value.instruction_input.max_bytes)) return 'instruction_input';
  if (!hasExactKeys(value.handoff, ['supported', 'persistence'])
    || typeof value.handoff.supported !== 'boolean'
    || value.handoff.persistence !== 'explicit-only') return 'handoff';
  if (Object.hasOwn(value, 'trusted_approval')
    && (!hasExactKeys(value.trusted_approval, ['supported', 'sources'])
      || typeof value.trusted_approval.supported !== 'boolean'
      || !sameJson(value.trusted_approval.sources, ['consumer']))) {
    return 'trusted_approval';
  }
  if (!hasExactKeys(value.integration_mechanisms, ['hooks', 'slash_commands', 'mcp', 'daemon'])
    || !booleanMembers(value.integration_mechanisms)) return 'integration_mechanisms';
  return null;
}

function capabilityInvariantError(value) {
  const execution = value.host.command_execution;
  const requiredExecution = [
    'arguments_array', 'stdio', 'process_tree_containment', 'orphan_detection',
    'timeout_enforcement', 'stdout_limit', 'stderr_limit',
  ];
  if (execution.shell !== false) return 'host.command_execution.shell';
  if (execution.supported) {
    const missingControl = requiredExecution.find((member) => execution[member] !== true);
    if (missingControl) return `host.command_execution.${missingControl}`;
    const missingLimit = Object.entries(value.limits)
      .find(([, limit]) => !positiveSafeInteger(limit));
    if (missingLimit) return `limits.${missingLimit[0]}`;
  } else {
    const contradictoryControl = requiredExecution
      .find((member) => execution[member] !== false);
    if (contradictoryControl) return `host.command_execution.${contradictoryControl}`;
    if (value.core.commands.length !== 0) return 'core.commands';
  }

  const filesystem = value.host.filesystem;
  const filesystemProofs = ['no_follow_resolution', 'stable_identity', 'component_walk'];
  const expectedProof = filesystem.workspace_selection === 'guarded-relative';
  const contradictoryProof = filesystemProofs
    .find((member) => filesystem[member] !== expectedProof);
  if (contradictoryProof) return `host.filesystem.${contradictoryProof}`;

  const instruction = value.host.instruction_input;
  if (instruction.mode === 'none') {
    if (instruction.max_sources !== 0) return 'host.instruction_input.max_sources';
    if (instruction.max_bytes !== 0) return 'host.instruction_input.max_bytes';
  } else if (instruction.max_sources === 0 || instruction.max_bytes === 0) {
    return 'host.instruction_input';
  }
  return null;
}

function validEntrypoint(value) {
  if (value?.kind === 'command') {
    return hasExactKeys(value, ['kind', 'executable', 'fixed_args'])
      && isSafePackageExecutablePath(value.executable)
      && Array.isArray(value.fixed_args)
      && value.fixed_args.every((argument) => typeof argument === 'string'
        && !CONTROL_CHARACTER.test(argument));
  }
  if (value?.kind === 'host-tool') {
    return hasExactKeys(value, ['kind', 'name']) && nonEmptyString(value.name);
  }
  return false;
}

function validVersionArray(value) {
  return Array.isArray(value)
    && value.length > 0
    && value.every(positiveSafeInteger)
    && new Set(value).size === value.length
    && value.every((version, index) => index === 0 || value[index - 1] < version);
}

function validCommandArray(value) {
  return Array.isArray(value)
    && value.every((command) => CORE_COMMANDS.includes(command))
    && new Set(value).size === value.length
    && value.every((command, index) => index === 0
      || CORE_COMMANDS.indexOf(value[index - 1]) < CORE_COMMANDS.indexOf(command));
}

function coreCapabilitiesSchemaIssue(value) {
  if (!hasExactKeys(value, ['ok', 'command', 'contract_version', 'result'])) return 'members';
  if (value.ok !== true) return 'ok';
  if (value.command !== 'capabilities') return 'command';
  if (value.contract_version !== CORE_CONTRACT_VERSION) return 'contract_version';
  const result = value.result;
  if (!hasExactKeys(result, ['backend', 'operations', 'durability', 'limits'])) return 'result';
  // Mutation coordination is local to one working copy. Advisory claim visibility through a
  // Git common directory is represented independently by operations.work_claim.supported.
  if (!hasExactKeys(result.backend, ['name', 'coordination_scope'])
    || result.backend.name !== 'local-filesystem'
    || result.backend.coordination_scope !== 'same-working-copy-cooperative-writers') {
    return 'result.backend';
  }
  if (!hasExactKeys(result.operations, ['inspect', 'create', 'transition', 'patch', 'work_claim'])) {
    return 'result.operations';
  }
  if (!hasExactKeys(result.operations.inspect, ['supported', 'write_scope', 'cas_scope'])
    || result.operations.inspect.supported !== true
    || result.operations.inspect.write_scope !== 'none'
    || result.operations.inspect.cas_scope !== 'none') return 'result.operations.inspect';
  if (!hasExactKeys(result.operations.create, [
    'supported', 'write_scope', 'cas_scope', 'publication_visibility', 'publication_probe',
  ])
    || result.operations.create.supported !== true
    || result.operations.create.write_scope !== 'single-item'
    || result.operations.create.cas_scope !== 'requested-id-lock'
    || result.operations.create.publication_visibility !== 'atomic-no-clobber-or-fail'
    || result.operations.create.publication_probe !== 'per-ledger-operation') {
    return 'result.operations.create';
  }
  if (!hasExactKeys(result.operations.transition, ['supported', 'write_scope', 'cas_scope'])
    || result.operations.transition.supported !== true
    || result.operations.transition.write_scope !== 'single-item'
    || result.operations.transition.cas_scope !== 'exact-byte-sha256') {
    return 'result.operations.transition';
  }
  if (!hasExactKeys(result.operations.patch, ['supported', 'write_scope', 'cas_scope'])
    || result.operations.patch.supported !== true
    || result.operations.patch.write_scope !== 'single-item'
    || result.operations.patch.cas_scope !== 'exact-byte-sha256') {
    return 'result.operations.patch';
  }
  // work_claim.supported is the one Git-environment-dependent member. Every other member is
  // a permanent advisory-claims invariant: claims never protect publication, never fence
  // writers, and must never advertise safe exclusive dispatch.
  const workClaim = result.operations.work_claim;
  if (!hasExactKeys(workClaim, [
    'supported', 'api_version', 'mode', 'claim_protected_publication',
    'fencing_enforced_at', 'safe_exclusive_dispatch',
  ])
    || typeof workClaim.supported !== 'boolean'
    || workClaim.api_version !== 1
    || workClaim.mode !== 'advisory'
    || workClaim.claim_protected_publication !== false
    || workClaim.fencing_enforced_at !== 'none'
    || workClaim.safe_exclusive_dispatch !== false) {
    return 'result.operations.work_claim';
  }
  if (!hasExactKeys(result.durability, [
    'temporary_file_sync', 'directory_sync', 'post_publication_verification',
    'power_loss_guarantee',
  ])
    || result.durability.temporary_file_sync !== 'required-before-publication'
    || result.durability.directory_sync !== 'best-effort-when-supported'
    || result.durability.post_publication_verification !== 'exact-bytes-required'
    || result.durability.power_loss_guarantee !== 'none') return 'result.durability';
  const limits = result.limits;
  if (!hasExactKeys(limits, [
    'multi_item_atomicity', 'cross_clone_coordination', 'cross_worktree_coordination',
    'cross_machine_coordination', 'noncooperating_writer_protection',
    'automatic_stale_lock_breaking',
  ])
    || limits.multi_item_atomicity !== false
    || limits.cross_clone_coordination !== false
    || limits.cross_worktree_coordination !== false
    || limits.cross_machine_coordination !== false
    || limits.noncooperating_writer_protection !== false
    || limits.automatic_stale_lock_breaking !== false) return 'result.limits';
  return null;
}

function positiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function nonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function nonEmptyTrimmedString(value) {
  return typeof value === 'string' && value.trim().length > 0 && !CONTROL_CHARACTER.test(value);
}

function isCalendarDate(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const monthLengths = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= monthLengths[month - 1];
}

function isCoreRfc3339Utc(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(value);
  return match !== null && isCalendarDate(match[1])
    && Number(match[2]) <= 23 && Number(match[3]) <= 59 && Number(match[4]) <= 59;
}

function booleanMembers(value) {
  return Object.values(value).every((member) => typeof member === 'boolean');
}

function validInvocationBinding(value) {
  if (!hasExactKeys(value, [
    'request_id', 'adapter', 'core', 'workspace', 'limits',
    'instruction_set_digest', 'handoff_digest',
  ]) || !SAFE_ID.test(value.request_id)) return false;
  if (!hasExactKeys(value.adapter, ['id', 'version', 'contract_version'])
    || typeof value.adapter.id !== 'string'
    || typeof value.adapter.version !== 'string'
    || !Number.isSafeInteger(value.adapter.contract_version)) return false;
  if (!hasExactKeys(value.core,
    ['executable_identity', 'contract_version', 'argv', 'input_base64'])
    || !DIGEST.test(value.core.executable_identity)
    || !Number.isSafeInteger(value.core.contract_version)
    || !Array.isArray(value.core.argv)
    || !value.core.argv.every((argument) => typeof argument === 'string')
    || decodeCanonicalBase64(value.core.input_base64) === null) return false;
  if (!hasExactKeys(value.workspace, ['id', 'root', 'cwd', 'ledger'])
    || !Object.values(value.workspace).every((member) => typeof member === 'string')) return false;
  if (!hasExactKeys(value.limits, ['context_bytes', 'stdout_bytes', 'stderr_bytes', 'timeout_ms'])
    || !Object.values(value.limits).every((member) => Number.isSafeInteger(member) && member >= 0)
    || value.limits.timeout_ms < 1) return false;
  return DIGEST.test(value.instruction_set_digest)
    && (value.handoff_digest === null || DIGEST.test(value.handoff_digest));
}

function approvalSchemaError(value) {
  if (!hasExactKeys(value, [
    'approval_version', 'source', 'nonce', 'issued_at', 'expires_at', 'invocation_digest',
  ])) return 'members';
  if (value.approval_version !== 1) return 'approval_version';
  if (typeof value.source !== 'string') return 'source';
  if (typeof value.nonce !== 'string' || !NONCE.test(value.nonce)) return 'nonce';
  if (!DIGEST.test(value.invocation_digest)) return 'invocation_digest';
  if (!RFC3339.test(value.issued_at) || !validCanonicalTime(value.issued_at)) return 'issued_at';
  if (!RFC3339.test(value.expires_at) || !validCanonicalTime(value.expires_at)) return 'expires_at';
  return null;
}

function validCanonicalTime(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().replace('.000Z', 'Z') === value;
}

function validPlatforms(value) {
  return hasExactKeys(value, PLATFORM_KEYS)
    && PLATFORM_KEYS.every((platform) => PLATFORM_STATUS.has(value[platform]));
}

function pathComponents(logicalPath) {
  if (logicalPath === '.') return [];
  const components = [];
  const segments = logicalPath.split('/');
  for (let index = 1; index <= segments.length; index += 1) {
    components.push(segments.slice(0, index).join('/'));
  }
  return components;
}

function envelopeState(process, command = null, responseContext = null) {
  const bytes = decodeCanonicalBase64(process?.stdout_base64);
  if (bytes === null) return { present: false, valid: false };
  const parsed = parseJsonRequest(bytes);
  const value = parsed.issues.length === 0
    ? JSON.parse(bytes.toString('utf8'))
    : null;
  const valid = hasRequiredFinalLf(bytes) && parsed.issues.length === 0
    && validCoreCommandEnvelope(value, command, process?.exit_code, responseContext);
  return {
    present: bytes.length > 0,
    valid,
    mutation_state: valid && isMutationCommand(command)
      ? value.state
      : null,
  };
}

function hasRequiredFinalLf(bytes) {
  if (bytes.length <= 1 || bytes[bytes.length - 1] !== 0x0A
    || bytes[bytes.length - 2] === 0x0A || bytes[bytes.length - 2] === 0x0D) return false;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < bytes.length - 1; index += 1) {
    const byte = bytes[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (byte === 0x5C) escaped = true;
      else if (byte === 0x22) inString = false;
      continue;
    }
    if (byte === 0x22) inString = true;
    else if (byte === 0x09 || byte === 0x0A || byte === 0x0D || byte === 0x20) return false;
  }
  return !inString && !escaped;
}

function validCoreCommandEnvelope(value, command, exitCode, responseContext) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  // Dispatch on the response domain before the command: a root namespace
  // member names the domain, and only ledger-mutation answers a core command.
  if (Object.hasOwn(value, 'namespace')) {
    return validClaimFenceRefusalEnvelope(value, command, exitCode, responseContext);
  }
  if (command === 'validate') {
    return validCoreValidateEnvelope(value, exitCode);
  }
  if (command === 'ready') return validCoreReadyEnvelope(value, exitCode, responseContext);
  if (command === 'capabilities') return coreCapabilitiesSchemaIssue(value) === null && exitCode === 0;
  if (command === 'inspect') return validCoreReadEnvelope(value, command, exitCode, responseContext);
  if (isMutationCommand(command)) {
    return validCoreMutationEnvelope(value, command, exitCode, responseContext);
  }
  return false;
}

function validCoreReadEnvelope(value, command, exitCode, responseContext) {
  const coreRequest = responseCoreRequest(responseContext, command);
  if (coreRequest === null) return false;
  if (!plainObject(value)
    || value.command !== command || value.contract_version !== CORE_CONTRACT_VERSION) return false;
  if (value.ok === true) {
    return hasExactKeys(value, ['ok', 'command', 'contract_version', 'result'])
      && hasExactKeys(value.result, ['item'])
      && validCoreItemShape(value.result.item)
      && (coreRequest === undefined || value.result.item.id === coreRequest.id)
      && exitCode === 0;
  }
  return value.ok === false
    && hasExactKeys(value, ['ok', 'command', 'contract_version', 'error'])
    && validCoreErrorAtExit(value.error, command, exitCode, responseContext);
}

function validCoreItemShape(value) {
  if (!hasExactKeys(value, [
    'id', 'path', 'revision', 'source_encoding', 'source_media_type',
    'source_base64', 'core', 'body',
  ])) return false;
  if (!hasExactKeys(value.core, [
    'schema_version', 'id', 'title', 'kind', 'status', 'created', 'updated',
    'provenance', 'depends_on', 'related',
  ], [
    'parent', 'snoozed_until', 'completed', 'killed', 'archived', 'number',
    'priority', 'decisions',
  ])) return false;
  if (!WOWBAGGER_ID.test(value.id)
    || !isSafeLedgerDisplayPath(value.path)
    || !DIGEST.test(value.revision)
    || value.source_encoding !== 'base64'
    || value.source_media_type !== 'text/markdown; charset=utf-8'
    || typeof value.body !== 'string'
    || !validCoreView(value.core)) return false;
  const source = decodeCanonicalBase64(value.source_base64);
  if (source === null || sha256(source) !== value.revision) return false;
  const sourceText = decodeUtf8(source);
  if (sourceText === null) return false;
  const parsed = parseLedgerItemSource(sourceText);
  const sourceCore = parsed.error ? null : sourceCoreView(parsed.data);
  return sourceCore !== null
    && value.id === value.core.id
    && value.body === parsed.body
    && sameJson(value.core, sourceCore)
    && validReturnedItemSemantics(value.path, parsed.data);
}

function validCoreView(value) {
  if (!plainObject(value)
    || (value.schema_version !== 1 && value.schema_version !== 2)
    || !WOWBAGGER_ID.test(value.id)
    || !nonEmptyTrimmedString(value.title)
    || !new Set(['task', 'epic']).has(value.kind)
    || !new Set(['triage', 'backlog', 'in-progress', 'done', 'killed', 'archived']).has(value.status)
    || !isCalendarDate(value.created)
    || !isCalendarDate(value.updated)
    || value.updated < value.created
    || !hasExactKeys(value.provenance, ['source', 'recorded_at'])
    || !nonEmptyTrimmedString(value.provenance.source)
    || !isCoreRfc3339Utc(value.provenance.recorded_at)
    || !validCoreRelationList(value.depends_on)
    || !validCoreRelationList(value.related)) return false;

  for (const field of ['parent']) {
    if (Object.hasOwn(value, field) && !WOWBAGGER_ID.test(value[field])) return false;
  }
  for (const field of ['snoozed_until', 'completed', 'killed', 'archived']) {
    if (Object.hasOwn(value, field) && !isCalendarDate(value[field])) return false;
  }
  if (Object.hasOwn(value, 'number')
    && (!Number.isSafeInteger(value.number) || value.number < 1)) return false;
  if (Object.hasOwn(value, 'priority')
    && (!Number.isSafeInteger(value.priority) || value.priority < 0)) return false;
  if (!validCoreTerminalDates(value)) return false;
  return !Object.hasOwn(value, 'decisions') || validCoreDecisions(value.decisions);
}

function validCoreRelationList(value) {
  return Array.isArray(value)
    && value.every((id) => WOWBAGGER_ID.test(id))
    && new Set(value).size === value.length;
}

function validCoreTerminalDates(value) {
  const terminalFields = ['completed', 'killed', 'archived'];
  const required = { done: 'completed', killed: 'killed', archived: 'archived' }[value.status] ?? null;
  if (required === null) return terminalFields.every((field) => !Object.hasOwn(value, field));
  return terminalFields.every((field) => field === required
    ? Object.hasOwn(value, field) && value[field] === value.updated
    : !Object.hasOwn(value, field));
}

function validCoreDecisions(value) {
  if (!Array.isArray(value)) return false;
  return value.every((decision) => {
    if (!hasExactKeys(decision, ['action', 'date', 'summary', 'rationale'], ['rollup'])
      || !new Set([
        'accept', 'complete', 'kill', 'archive', 'restore', 'replace-dependency',
        'waive-dependency', 'reparent', 'record',
      ]).has(decision.action)
      || !isCalendarDate(decision.date)
      || !nonEmptyTrimmedString(decision.summary)
      || !nonEmptyTrimmedString(decision.rationale)) return false;
    if (!Object.hasOwn(decision, 'rollup')) return true;
    return Array.isArray(decision.rollup)
      && decision.rollup.every((entry) => hasExactKeys(entry, ['id', 'status'])
        && WOWBAGGER_ID.test(entry.id)
        && new Set(['done', 'killed']).has(entry.status));
  });
}

function sourceCoreView(data) {
  if (!plainObject(data)) return null;
  const core = {};
  for (const field of [
    'schema_version', 'id', 'title', 'kind', 'status', 'created', 'updated',
  ]) {
    if (!Object.hasOwn(data, field)) return null;
    core[field] = data[field];
  }
  if (!plainObject(data.provenance)
    || !Object.hasOwn(data.provenance, 'source')
    || !Object.hasOwn(data.provenance, 'recorded_at')
    || !Array.isArray(data.depends_on)
    || (Object.hasOwn(data, 'related') && !Array.isArray(data.related))) return null;
  core.provenance = {
    source: data.provenance.source,
    recorded_at: data.provenance.recorded_at,
  };
  core.depends_on = data.depends_on;
  core.related = data.related ?? [];
  for (const field of ['parent', 'snoozed_until', 'completed', 'killed', 'archived', 'number', 'priority']) {
    if (Object.hasOwn(data, field)) core[field] = data[field];
  }
  if (Object.hasOwn(data, 'decisions')) {
    if (!Array.isArray(data.decisions)) return null;
    core.decisions = [];
    for (const decision of data.decisions) {
      if (!plainObject(decision)
        || !['action', 'date', 'summary', 'rationale'].every((field) => Object.hasOwn(decision, field))) {
        return null;
      }
      const normalized = {
        action: decision.action,
        date: decision.date,
        summary: decision.summary,
        rationale: decision.rationale,
      };
      if (Object.hasOwn(decision, 'rollup')) {
        if (!Array.isArray(decision.rollup)) return null;
        normalized.rollup = [];
        for (const entry of decision.rollup) {
          if (!plainObject(entry)) return null;
          normalized.rollup.push({ id: entry.id, status: entry.status });
        }
      }
      core.decisions.push(normalized);
    }
  }
  return core;
}

function validReturnedItemSemantics(itemPath, data) {
  const ledger = {
    errors: [],
    items: [
      { path: itemPath, data },
      ...semanticSupportItems(data),
    ],
  };
  return !validateLedger(ledger).errors.some((error) => error.path === itemPath);
}

function semanticSupportItems(data) {
  const parentIds = new Set();
  const referenceIds = new Set();
  const rollupChildren = new Map();
  if (Object.hasOwn(data, 'parent') && data.parent !== data.id) parentIds.add(data.parent);
  for (const relation of ['depends_on', 'related']) {
    for (const id of data[relation] ?? []) {
      if (id !== data.id) referenceIds.add(id);
    }
  }
  const rollup = matchingEpicRollup(data);
  for (const entry of rollup) {
    if (entry.id !== data.id && !rollupChildren.has(entry.id)) {
      rollupChildren.set(entry.id, entry.status);
    }
  }

  const ids = new Set([...parentIds, ...referenceIds, ...rollupChildren.keys()]);
  return [...ids].sort().map((id) => {
    if (parentIds.has(id)) return semanticSupportItem(id, { kind: 'epic' });
    if (rollupChildren.has(id)) {
      return semanticSupportItem(id, {
        status: rollupChildren.get(id),
        parent: data.id,
      });
    }
    return semanticSupportItem(id);
  });
}

function matchingEpicRollup(data) {
  if (data.kind !== 'epic' || data.status !== 'done' || !Array.isArray(data.decisions)) return [];
  const decision = data.decisions.find((candidate) => candidate?.action === 'complete'
    && candidate.date === data.completed && Array.isArray(candidate.rollup));
  return decision?.rollup ?? [];
}

function semanticSupportItem(id, { kind = 'task', status = 'backlog', parent = null } = {}) {
  const date = dateFromWowbaggerId(id);
  const terminal = {
    done: ['completed', 'complete'],
    killed: ['killed', 'kill'],
    archived: ['archived', 'archive'],
  }[status] ?? null;
  const data = {
    schema_version: 1,
    id,
    title: `Adapter semantic support ${id}`,
    kind,
    status,
    created: date,
    updated: date,
    provenance: {
      source: 'adapter-semantic-support',
      recorded_at: `${date}T00:00:00Z`,
    },
    depends_on: [],
    related: [],
    ...(parent === null ? {} : { parent }),
  };
  if (terminal) {
    const [field, action] = terminal;
    data[field] = date;
    data.decisions = [{
      action,
      date,
      summary: `Support ${action} decision.`,
      rationale: 'Synthetic relation support for adapter response validation.',
      ...(kind === 'epic' && status === 'done' ? { rollup: [] } : {}),
    }];
  }
  return { path: `.adapter-semantic-support/${id}.md`, data };
}

function dateFromWowbaggerId(id) {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let milliseconds = 0;
  for (const character of id.slice(3, 13)) {
    milliseconds = (milliseconds * 32) + alphabet.indexOf(character);
  }
  return new Date(milliseconds).toISOString().slice(0, 10);
}

function validCoreReadyEnvelope(value, exitCode, responseContext) {
  const coreRequest = responseCoreRequest(responseContext, 'ready');
  if (coreRequest === null) return false;
  if (value?.valid === true) {
    return hasExactKeys(value, ['as_of', 'valid', 'ready'])
      && isCalendarDate(value.as_of)
      && (coreRequest === undefined || value.as_of === coreRequest.as_of)
      && validCoreRelationList(value.ready)
      && exitCode === 0;
  }
  return value?.valid === false
    && hasExactKeys(value, ['valid', 'errors'])
    && validValidationErrors(value.errors) && value.errors.length > 0 && exitCode === 1;
}

function validCoreValidateEnvelope(value, exitCode) {
  return hasExactKeys(value, ['valid', 'errors'])
    && typeof value.valid === 'boolean'
    && validValidationErrors(value.errors)
    && exitCode === (value.valid ? 0 : 1)
    && (value.valid ? value.errors.length === 0 : value.errors.length > 0);
}

// SPEC.md requires a code, path, field, and message. A validator that can also
// derive the repair states it: expected_path and remediation ride along on the
// errors that have one, and nowhere else.
function validValidationErrors(value) {
  return Array.isArray(value) && value.every((error) => hasExactKeys(error, [
    'path', 'field', 'code', 'message',
  ], ['expected_path', 'remediation'])
    && (!Object.hasOwn(error, 'expected_path') || nonEmptyControlFreeString(error.expected_path))
    && (!Object.hasOwn(error, 'remediation') || nonEmptyControlFreeString(error.remediation))
    && nonEmptyControlFreeString(error.path)
    && nonEmptyControlFreeString(error.field)
    && nonEmptyControlFreeString(error.code)
    && nonEmptyControlFreeString(error.message))
    && isOrdered(value, compareValidationErrors);
}

function compareValidationErrors(left, right) {
  return compareText(left.path, right.path)
    || compareText(left.field, right.field)
    || compareText(left.code, right.code)
    || compareText(left.message, right.message);
}

function validClaimFenceRefusalEnvelope(value, command, exitCode, responseContext) {
  if (!hasExactKeys(value, ['ok', 'namespace', 'command', 'contract_version', 'state', 'error'])) {
    return false;
  }
  if (value.ok !== false || value.namespace !== 'ledger-mutation') return false;
  if (value.command !== `${command}-v1`) return false;
  if (value.contract_version !== CLAIM_DOMAIN_ENVELOPE_VERSION) return false;
  if (!hasExactKeys(value.error, ['code', 'message', 'details'])) return false;
  const code = value.error.code;
  if (!FENCE_REFUSAL_MESSAGES.has(code)) return false;
  if (value.error.message !== FENCE_REFUSAL_MESSAGES.get(code)) return false;
  if (exitCode !== FENCE_REFUSAL_EXITS.get(code)) return false;
  if (!FENCE_REFUSAL_COMMANDS.get(code).includes(command)) return false;
  if (!FENCE_REFUSAL_STATES.get(code).includes(value.state)) return false;
  // The core validates the request before the fence sees it, so a fence
  // refusal cannot answer a request that was never canonical.
  if (!hasCanonicalMutationRequest(responseContext, command)) return false;
  if (code === 'claim-store-unavailable') return validUnavailableStoreDetails(value.error.details);
  return validClaimReadBackDetails(code, value.error.details, responseItemId(responseContext, command));
}

function validClaimReadBackDetails(code, details, expectedItemId) {
  const members = ['ledger_namespace', 'item_id', 'observed_at', 'last_epoch', 'active'];
  if (!hasExactKeys(details, members)) return false;
  if (!CLAIM_NAMESPACE_ID.test(details.ledger_namespace)) return false;
  if (!WOWBAGGER_ID.test(details.item_id)) return false;
  if (expectedItemId !== undefined && details.item_id !== expectedItemId) return false;
  if (!isCoreRfc3339Utc(details.observed_at)) return false;
  if (typeof details.last_epoch !== 'string' || !UNSIGNED_DECIMAL.test(details.last_epoch)) {
    return false;
  }
  if (details.active !== null) {
    const active = details.active;
    if (!hasExactKeys(active, ['owner_id', 'epoch', 'issued_at', 'expires_at'])) return false;
    if (!nonEmptyControlFreeString(active.owner_id)) return false;
    if (typeof active.epoch !== 'string' || !UNSIGNED_DECIMAL.test(active.epoch)) return false;
    if (!isCoreRfc3339Utc(active.issued_at) || !isCoreRfc3339Utc(active.expires_at)) return false;
  }
  // The read-back must exhibit the condition its own code names.
  if (code === 'claimed-item-write-refused') return details.last_epoch !== '0';
  return details.active !== null;
}

function validUnavailableStoreDetails(details) {
  if (!plainObject(details)) return false;
  if (!nonEmptyControlFreeString(details.reason)) return false;
  if (!Object.hasOwn(details, 'findings')) {
    return details.reason !== 'publication-reconciliation-required';
  }
  const findings = details.findings;
  if (!Array.isArray(findings) || findings.length === 0) return false;
  for (const finding of findings) {
    if (!plainObject(finding)) return false;
    if (!nonEmptyControlFreeString(finding.code)) return false;
    if (!WOWBAGGER_ID.test(finding.item_id)) return false;
  }
  // Reconciliation is only actionable when some finding names a remediation.
  return findings.some((finding) => nonEmptyControlFreeString(finding.remediation));
}

function validCoreMutationEnvelope(value, command, exitCode, responseContext) {
  const mutationRequest = responseMutationRequest(responseContext, command);
  const canonicalMutationRequest = hasCanonicalMutationRequest(responseContext, command);
  if (!plainObject(value)
    || value.command !== command || value.contract_version !== CORE_CONTRACT_VERSION) return false;
  if (value.ok === true) {
    return canonicalMutationRequest && value.state === 'committed'
      && hasExactKeys(value, ['ok', 'command', 'contract_version', 'state', 'result'])
      && hasExactKeys(value.result, ['item'])
      && validCoreItemShape(value.result.item)
      && validMutationResultCorrelation(value.result.item, command, mutationRequest)
      && exitCode === 0;
  }
  return value.ok === false
    && new Set(['unchanged', 'committed', 'unknown']).has(value.state)
    && hasExactKeys(value, ['ok', 'command', 'contract_version', 'state', 'error'])
    && validCoreErrorAtExit(value.error, command, exitCode, responseContext)
    && value.state === (MUTATION_ERROR_STATES.get(value.error.code) ?? 'unchanged');
}

function validCoreErrorAtExit(value, command, exitCode, responseContext) {
  if (!hasExactKeys(value, ['code', 'message', 'details'])
    || !CORE_ERROR_CODES_BY_COMMAND[command]?.has(value.code)
    || CORE_ERROR_EXIT_CODES.get(value.code) !== exitCode
    || !coreErrorMessageMatches(value.code, command, value.message)) return false;
  return validCoreErrorDetails(value.code, value.details, command, responseContext);
}

function coreErrorMessageMatches(code, command, message) {
  const expected = {
    'item-not-found': 'The requested item was not found.',
    'ledger-invalid': 'The configured ledger is invalid.',
    'transition-precondition-failed': 'The requested lifecycle transition failed its preconditions.',
    'patch-precondition-failed': 'The requested patch failed its preconditions.',
    'candidate-invalid': 'The proposed item would make the ledger invalid.',
    'items-directory-unavailable': 'The configured items directory is unavailable.',
    'revision-conflict': 'The item changed after it was inspected.',
    'lock-held': 'The item is locked by another cooperative Wowbagger writer.',
    'id-collision': 'The requested item ID already exists.',
    'path-collision': 'The default item path is occupied by a different item.',
    'atomic-scope-required': 'The requested transition requires multi-item atomicity.',
    'capability-unavailable': 'Atomic no-clobber publication is unavailable for this ledger.',
    'operation-failed': 'The mutation operation failed before a commit was established.',
    'post-commit-recovery-required': 'The item was committed, but cleanup requires recovery.',
    'write-outcome-unknown': `The ${command} publication outcome could not be verified.`,
  }[code] ?? `The ${command} request is invalid.`;
  return message === expected;
}

function validCoreErrorDetails(code, details, command, responseContext) {
  const expectedItemId = responseItemId(responseContext, command);
  const expectedRevision = responseExpectedRevision(responseContext, command);
  const expectedCreateRevision = expectedCreateCandidateRevision(responseContext, command);
  const matchesItemId = (id) => expectedItemId === undefined || id === expectedItemId;
  // Canonicality is a property of a mutation request. inspect and the other
  // read commands never carry one, so this precondition only applies where a
  // request exists to judge; otherwise no read refusal could ever forward.
  if (code !== 'invalid-request' && isMutationCommand(command)
    && !hasCanonicalMutationRequest(responseContext, command)) {
    return false;
  }
  switch (code) {
    case 'invalid-request': return !hasCanonicalMutationRequest(responseContext, command)
      && validInvalidRequestDetails(details);
    case 'item-not-found': return hasExactKeys(details, ['id'])
      && WOWBAGGER_ID.test(details.id) && matchesItemId(details.id);
    // The refusal stands, and inspect may still hand back the snapshot of the
    // item this request named. Only inspect may; a mutation refusal that
    // carries an item is not the refusal this contract describes.
    case 'ledger-invalid': return hasExactKeys(details, ['validation_errors'],
      command === 'inspect' ? ['item'] : [])
      && validValidationErrors(details.validation_errors) && details.validation_errors.length > 0
      && (!Object.hasOwn(details, 'item')
        || (validCoreItemShape(details.item) && matchesItemId(details.item.id)));
    case 'transition-precondition-failed': return hasExactKeys(details, ['id', 'issues'])
      && WOWBAGGER_ID.test(details.id) && matchesItemId(details.id)
      && validTransitionIssues(details.issues) && details.issues.length > 0;
    case 'patch-precondition-failed': return hasExactKeys(details, ['id', 'issues'])
      && WOWBAGGER_ID.test(details.id) && matchesItemId(details.id)
      && validPatchIssues(details.issues) && details.issues.length > 0;
    case 'candidate-invalid': return hasExactKeys(details, ['id', 'validation_errors'])
      && WOWBAGGER_ID.test(details.id) && matchesItemId(details.id)
      && validValidationErrors(details.validation_errors) && details.validation_errors.length > 0;
    case 'revision-conflict': return hasExactKeys(details, [
      'id', 'expected_revision', 'actual_revision',
    ]) && WOWBAGGER_ID.test(details.id) && matchesItemId(details.id)
      && DIGEST.test(details.expected_revision) && DIGEST.test(details.actual_revision)
      && details.actual_revision !== details.expected_revision
      && (expectedRevision === undefined || details.expected_revision === expectedRevision);
    case 'lock-held': return validLockHeldDetails(details) && matchesItemId(details.id);
    case 'id-collision': return hasExactKeys(details, ['id', 'path', 'actual_revision'])
      && WOWBAGGER_ID.test(details.id) && matchesItemId(details.id)
      && isSafeLedgerDisplayPath(details.path)
      && DIGEST.test(details.actual_revision);
    case 'path-collision': return validPathCollisionDetails(details) && matchesItemId(details.id)
      && (command !== 'create' || expectedItemId === undefined
        || details.path === `${expectedItemId}.md`);
    case 'atomic-scope-required': return hasExactKeys(details, [
      'id', 'blockers', 'precondition_issues',
    ]) && WOWBAGGER_ID.test(details.id) && matchesItemId(details.id)
      && validTransitionBlockers(details.blockers)
      && validTransitionIssues(details.precondition_issues);
    case 'items-directory-unavailable': return validItemsDirectoryDetails(details)
      && matchesItemId(details.id);
    case 'capability-unavailable': return validCapabilityUnavailableDetails(details);
    case 'operation-failed': return validOperationFailedDetails(details) && matchesItemId(details.id);
    case 'post-commit-recovery-required': return hasExactKeys(details, [
      'id', 'revision', 'recovery_artifacts', 'recovery_artifacts_truncated',
    ]) && WOWBAGGER_ID.test(details.id) && matchesItemId(details.id) && DIGEST.test(details.revision)
      && (command !== 'create' || expectedCreateRevision === undefined
        || details.revision === expectedCreateRevision)
      && ((command !== 'transition' && command !== 'patch')
        || expectedRevision === undefined || details.revision !== expectedRevision)
      && validRecoveryArtifacts(details.recovery_artifacts, details.recovery_artifacts_truncated);
    case 'write-outcome-unknown': return hasExactKeys(details, [
      'id', 'recovery_artifacts', 'recovery_artifacts_truncated',
    ]) && WOWBAGGER_ID.test(details.id) && matchesItemId(details.id)
      && validRecoveryArtifacts(details.recovery_artifacts, details.recovery_artifacts_truncated);
    default: return false;
  }
}

function responseCoreRequest(responseContext, command) {
  if (responseContext === null || responseContext === undefined) return undefined;
  const coreRequest = responseContext.core_request;
  return plainObject(coreRequest) && coreRequest.command === command ? coreRequest : null;
}

function responseMutationRequest(responseContext, command) {
  const coreRequest = responseCoreRequest(responseContext, command);
  if (coreRequest === undefined) return undefined;
  if (coreRequest === null || !isMutationCommand(command)) return null;
  const mutationInput = responseMutationInput(responseContext, command);
  if (mutationInput !== undefined) {
    if (mutationInput === null) return null;
    const parsed = parseJsonRequest(mutationInput);
    return plainObject(parsed.value) ? parsed.value : null;
  }
  return plainObject(responseContext.mutation_request) ? responseContext.mutation_request : null;
}

function responseMutationInput(responseContext, command) {
  const coreRequest = responseCoreRequest(responseContext, command);
  if (coreRequest === undefined) return undefined;
  if (coreRequest === null || !isMutationCommand(command)) return null;
  if (!Object.hasOwn(responseContext, 'mutation_input')) return undefined;
  return responseContext.mutation_input instanceof Uint8Array
    ? responseContext.mutation_input
    : null;
}

function responseItemId(responseContext, command) {
  if (command === 'inspect') {
    const coreRequest = responseCoreRequest(responseContext, command);
    if (coreRequest === undefined) return undefined;
    return WOWBAGGER_ID.test(coreRequest?.id) ? coreRequest.id : null;
  }
  const mutationRequest = responseMutationRequest(responseContext, command);
  if (mutationRequest === undefined) return undefined;
  return WOWBAGGER_ID.test(mutationRequest?.id) ? mutationRequest.id : null;
}

function responseExpectedRevision(responseContext, command) {
  const mutationRequest = responseMutationRequest(responseContext, command);
  if (mutationRequest === undefined) return undefined;
  return (command === 'transition' || command === 'patch') && DIGEST.test(mutationRequest?.expected_revision)
    ? mutationRequest.expected_revision
    : null;
}

function expectedCreateCandidateRevision(responseContext, command) {
  if (command !== 'create') return null;
  const mutationRequest = responseMutationRequest(responseContext, command);
  if (mutationRequest === undefined) return undefined;
  if (!hasCanonicalMutationRequest(responseContext, command)) return null;
  try {
    return sha256(createCandidateSource(mutationRequest));
  } catch {
    return null;
  }
}

function hasCanonicalMutationRequest(responseContext, command) {
  const mutationInput = responseMutationInput(responseContext, command);
  if (mutationInput !== undefined) {
    if (mutationInput === null) return false;
    const parsed = parseJsonRequest(mutationInput);
    if (parsed.issues.length > 0 || !plainObject(parsed.value)) return false;
    if (command === 'create') return validateCreateRequest(parsed.value).length === 0;
    if (command === 'transition') return validateTransitionRequest(parsed.value).length === 0;
    if (command === 'patch') return validPatchRequest(parsed.value);
    return false;
  }
  const mutationRequest = responseMutationRequest(responseContext, command);
  if (mutationRequest === undefined) return true;
  if (!plainObject(mutationRequest)) return false;
  if (command === 'create') return validateCreateRequest(mutationRequest).length === 0;
  if (command === 'transition') return validateTransitionRequest(mutationRequest).length === 0;
  if (command === 'patch') return validPatchRequest(mutationRequest);
  return false;
}

function validMutationResultCorrelation(item, command, mutationRequest) {
  if (mutationRequest === undefined) return true;
  if (command === 'create') return validCreateResultCorrelation(item, mutationRequest);
  if (command === 'patch') return validPatchResultCorrelation(item, mutationRequest);
  return validTransitionResultCorrelation(item, mutationRequest);
}

function validCreateResultCorrelation(item, request) {
  if (!plainObject(request) || !plainObject(request.item)
    || item.id !== request.id || item.path !== `${request.id}.md` || item.body !== request.body
    || item.core.schema_version !== 1 || item.core.status !== 'triage'
    || item.core.title !== request.item.title || item.core.kind !== request.item.kind
    || !sameJson(item.core.provenance, {
      source: request.item.provenance?.source,
      recorded_at: request.item.provenance?.recorded_at,
    })
    || !sameJson(item.core.depends_on, request.item.depends_on)
    || !sameJson(item.core.related, request.item.related ?? [])) return false;
  for (const field of ['parent', 'snoozed_until']) {
    if (Object.hasOwn(item.core, field) !== Object.hasOwn(request.item, field)
      || (Object.hasOwn(item.core, field) && item.core[field] !== request.item[field])) return false;
  }
  if (['completed', 'killed', 'archived', 'decisions'].some((field) => Object.hasOwn(item.core, field))) {
    return false;
  }
  const source = decodeCanonicalBase64(item.source_base64);
  try {
    return source !== null && source.equals(createCandidateSource(request));
  } catch {
    return false;
  }
}

function validTransitionResultCorrelation(item, request) {
  if (!plainObject(request)
    || item.id !== request.id
    || item.revision === request.expected_revision
    || item.core.status !== request.to_status
    || item.core.updated !== request.date) return false;
  if (!Object.hasOwn(request, 'decision')) return true;
  if (!plainObject(request.decision) || !Array.isArray(item.core.decisions)) return false;
  const actions = request.to_status === 'backlog'
    ? new Set(['accept', 'restore'])
    : new Set(['complete', 'kill', 'archive']);
  return item.core.decisions.some((decision) => actions.has(decision.action)
    && decision.date === request.date
    && decision.summary === request.decision.summary
    && decision.rationale === request.decision.rationale);
}

// Independent patch-request validation. This deliberately does not call the
// core's validatePatchRequest implementation: the adapter vectors need a
// second implementation capable of detecting drift in either direction.
function validPatchRequest(request) {
  if (!hasExactKeys(request, ['id', 'expected_revision', 'date', 'set'])
    || !WOWBAGGER_ID.test(request.id)
    || !DIGEST.test(request.expected_revision)
    || !isCalendarDate(request.date)
    || !hasExactKeys(request.set, [], ['title', 'priority', 'depends_on', 'related', 'body'])
    || Object.keys(request.set).length === 0) return false;
  for (const [field, value] of Object.entries(request.set)) {
    // body is the one patchable value outside the frontmatter, and the one
    // that null does not remove: the body region always exists, so removing it
    // is the empty string and null is refused.
    if (field === 'body') {
      if (typeof value !== 'string') return false;
      continue;
    }
    if (value === null) continue;
    // title is a non-empty schema string, the same rule create validates it
    // under. null is a removal, handled above; the candidate refuses it later
    // because title is required, but the request itself is well formed.
    if (field === 'title') {
      if (typeof value !== 'string' || value.trim().length === 0) return false;
      continue;
    }
    if (field === 'priority') {
      if (parsedIntegerValue(value, 0) === undefined) return false;
      continue;
    }
    if (!Array.isArray(value)
      || !value.every((entry) => typeof entry === 'string' && WOWBAGGER_ID.test(entry))) return false;
  }
  return true;
}

function parsedIntegerValue(value, minimum) {
  if (Number.isSafeInteger(value) && value >= minimum) return value;
  if (value === null || typeof value !== 'object'
    || Object.getPrototypeOf(value)?.constructor?.name !== 'JsonNumber'
    || !hasExactKeys(value, ['source'])
    || typeof value.source !== 'string'
    || !/^(0|[1-9][0-9]*)$/.test(value.source)) return undefined;
  const parsed = Number(value.source);
  return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : undefined;
}

function validPatchResultCorrelation(item, request) {
  if (!validPatchRequest(request)
    || item.id !== request.id
    || item.revision === request.expected_revision
    || item.core.updated !== request.date) return false;
  for (const [field, requested] of Object.entries(request.set)) {
    if (field === 'body') {
      if (item.body !== requested) return false;
      continue;
    }
    if (field === 'title' || field === 'priority') {
      const expected = field === 'title' ? requested : parsedIntegerValue(requested, 0);
      if (requested === null) {
        if (Object.hasOwn(item.core, field)) return false;
      } else if (item.core[field] !== expected) {
        return false;
      }
      continue;
    }
    // A relation list is replaced wholesale. Removing the field leaves the
    // lossless core view reporting an empty list, so null and [] correlate
    // with the same observed value.
    if (!sameJson(item.core[field] ?? [], requested ?? [])) return false;
  }
  return true;
}

function validInvalidRequestDetails(value) {
  return hasExactKeys(value, ['issues']) && Array.isArray(value.issues) && value.issues.length > 0
    && value.issues.every((issue) => hasExactKeys(issue, ['path', 'code', 'message'])
      && isJsonPointer(issue.path)
      && INVALID_REQUEST_CODES.has(issue.code)
      && nonEmptyControlFreeString(issue.message))
    && isOrdered(value.issues, compareInvalidRequestIssues);
}

function compareInvalidRequestIssues(left, right) {
  return compareText(left.path, right.path)
    || compareText(left.code, right.code)
    || compareText(left.message, right.message);
}

// A date refusal carries the item's own dates; every other code keeps the
// four-key shape. The key set is exact in both directions, so a missing
// date member and a stray one are equally refused.
function issueKeys(code) {
  return DATE_ISSUE_CODES.has(code)
    ? ['code', 'field', 'message', 'related_ids', 'item_created', 'item_updated']
    : ['code', 'field', 'message', 'related_ids'];
}

function validIssueDates(issue) {
  return !DATE_ISSUE_CODES.has(issue.code)
    || (isCalendarDate(issue.item_created) && isCalendarDate(issue.item_updated)
      && issue.item_created <= issue.item_updated);
}

function validTransitionIssues(value) {
  if (!Array.isArray(value)) return false;
  return value.every((issue) => hasExactKeys(issue, issueKeys(issue?.code))
    && Object.hasOwn(TRANSITION_ISSUE_MESSAGES, issue.code)
    && issue.field === TRANSITION_ISSUE_FIELDS[issue.code]
    && issue.message === TRANSITION_ISSUE_MESSAGES[issue.code]
    && validIssueDates(issue)
    && validSortedUniqueIds(issue.related_ids))
    && isOrdered(value, compareTransitionIssues);
}

function validPatchIssues(value) {
  if (!Array.isArray(value)) return false;
  return value.every((issue) => hasExactKeys(issue, issueKeys(issue?.code))
    && Object.hasOwn(PATCH_ISSUE_MESSAGES, issue.code)
    && issue.field === 'date'
    && issue.message === PATCH_ISSUE_MESSAGES[issue.code]
    && validIssueDates(issue)
    && sameJson(issue.related_ids, []))
    && isOrdered(value, compareTransitionIssues);
}

function compareTransitionIssues(left, right) {
  return compareText(left.code, right.code)
    || compareText(left.field, right.field)
    || compareText(left.related_ids.join('\0'), right.related_ids.join('\0'));
}

function validTransitionBlockers(value) {
  if (!Array.isArray(value) || value.length === 0) return false;
  const seen = new Set();
  for (const [index, blocker] of value.entries()) {
    if (!hasExactKeys(blocker, ['code', 'item_id', 'field'])
      || !Object.hasOwn(TRANSITION_BLOCKER_FIELDS, blocker.code)
      || !WOWBAGGER_ID.test(blocker.item_id)
      || blocker.field !== TRANSITION_BLOCKER_FIELDS[blocker.code]
      || (index > 0 && compareTransitionBlockers(value[index - 1], blocker) > 0)) return false;
    const key = `${blocker.code}\0${blocker.item_id}\0${blocker.field}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

function compareTransitionBlockers(left, right) {
  return compareText(left.code, right.code)
    || compareText(left.item_id, right.item_id)
    || compareText(left.field, right.field);
}

function validLockHeldDetails(value) {
  if (!hasExactKeys(value, ['id', 'lock_path', 'owner', 'owner_diagnostic'])
    || !WOWBAGGER_ID.test(value.id)
    || value.lock_path !== `.wowbagger-locks/${value.id}.lock`) return false;
  const diagnostics = new Set(['too-large', 'invalid-utf8', 'duplicate-key', 'invalid-json', 'invalid-shape']);
  if (value.owner === null) return diagnostics.has(value.owner_diagnostic);
  return value.owner_diagnostic === null
    && hasExactKeys(value.owner, ['lock_version', 'item_id', 'operation', 'writer_id', 'started_at'])
    && value.owner.lock_version === 1
    && value.owner.item_id === value.id
    && new Set(['create', 'transition', 'patch']).has(value.owner.operation)
    && typeof value.owner.writer_id === 'string'
    && /^[\x21-\x7e]{1,128}$/.test(value.owner.writer_id)
    && isCoreRfc3339Utc(value.owner.started_at);
}

function validPathCollisionDetails(value) {
  if (!hasExactKeys(value, ['id', 'path', 'occupant_kind'], ['occupying_id'])
    || !WOWBAGGER_ID.test(value.id)
    || !isSafeLedgerDisplayPath(value.path)
    || !new Set(['item', 'directory']).has(value.occupant_kind)) return false;
  return value.occupant_kind === 'item'
    ? Object.hasOwn(value, 'occupying_id') && WOWBAGGER_ID.test(value.occupying_id)
    : !Object.hasOwn(value, 'occupying_id');
}

// The configured items directory is ledger setup, not a request member: the
// refusal names the ledger-relative directory and the operator action that
// makes create possible.
function validItemsDirectoryDetails(value) {
  if (!hasExactKeys(value, ['id', 'path', 'reason', 'remediation'])
    || !WOWBAGGER_ID.test(value.id)
    || !isSafeLedgerDirectoryPath(value.path)
    || !new Set(['absent', 'not-a-directory']).has(value.reason)
    || typeof value.remediation !== 'string') return false;
  return value.remediation.includes(value.path) && value.remediation.includes('create');
}

function validCapabilityUnavailableDetails(value) {
  return hasExactKeys(value, [
    'capability', 'reason', 'recovery_artifacts', 'recovery_artifacts_truncated',
  ]) && value.capability === 'atomic-no-clobber-publication'
    && value.reason === 'filesystem-primitive-unavailable'
    && validRecoveryArtifacts(value.recovery_artifacts, value.recovery_artifacts_truncated);
}

function validOperationFailedDetails(value) {
  if (!hasExactKeys(value, [
    'id', 'operation', 'reason', 'recovery_artifacts', 'recovery_artifacts_truncated',
  ]) || !WOWBAGGER_ID.test(value.id)
    || !new Set([
      'lock-closure', 'prepare-temporary', 'sync-temporary', 'publish',
      'verify-publication', 'cleanup',
    ]).has(value.operation)
    || !new Set(['retry-limit-exhausted', 'io-error', 'verification-failed']).has(value.reason)
    || !validRecoveryArtifacts(value.recovery_artifacts, value.recovery_artifacts_truncated)) return false;
  return (value.reason !== 'retry-limit-exhausted' || value.operation === 'lock-closure')
    && (value.reason !== 'verification-failed'
      || value.operation === 'publish' || value.operation === 'verify-publication');
}

function validRecoveryArtifacts(value, truncated) {
  if (!Array.isArray(value) || typeof truncated !== 'boolean' || value.length > 16
    || (truncated && value.length !== 16)) return false;
  const seen = new Set();
  for (const artifact of value) {
    if (!hasExactKeys(artifact, ['path', 'kind', 'sha256', 'size_bytes'])
      || !isSafeArtifactPath(artifact.path)
      || !new Set(['temporary-file', 'lock-file', 'final-item']).has(artifact.kind)) return false;
    const readable = DIGEST.test(artifact.sha256) && nonNegativeSafeInteger(artifact.size_bytes);
    if (!readable && !(artifact.sha256 === null && artifact.size_bytes === null)) return false;
    const key = artifact.path;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return isOrdered(value, compareRecoveryArtifacts);
}

function compareRecoveryArtifacts(left, right) {
  return compareText(left.path, right.path) || compareText(left.kind, right.kind);
}

function validSortedUniqueIds(value) {
  return Array.isArray(value)
    && value.every((id) => WOWBAGGER_ID.test(id))
    && new Set(value).size === value.length
    && value.every((id, index) => index === 0 || value[index - 1] < id);
}

function isJsonPointer(value) {
  if (typeof value !== 'string' || CONTROL_CHARACTER.test(value)) return false;
  return value === '' || /^\/(?:[^~]|~[01])*(?:\/(?:[^~]|~[01])*)*$/.test(value);
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function processObservationIssue(process) {
  if (!hasExactKeys(process, [
    'started', 'process_tree_contained', 'orphaned', 'exit_code', 'signal', 'timed_out',
    'stdout_complete', 'stderr_complete', 'stdout_base64', 'stderr_base64',
  ], ['input_delivery'])) return 'members';
  const claimsDelivery = Object.hasOwn(process, 'input_delivery');
  if (claimsDelivery && !INPUT_DELIVERY_STATES.includes(process.input_delivery)) {
    return 'input_delivery';
  }
  for (const member of [
    'started', 'process_tree_contained', 'orphaned', 'timed_out',
    'stdout_complete', 'stderr_complete',
  ]) {
    if (typeof process[member] !== 'boolean') return member;
  }
  if (process.signal !== null && !nonEmptyControlFreeString(process.signal)) return 'signal';
  if (process.exit_code !== null && !nonNegativeSafeInteger(process.exit_code)) return 'exit_code';
  const stdout = decodeCanonicalBase64(process.stdout_base64);
  if (stdout === null) return 'stdout_base64';
  const stderr = decodeCanonicalBase64(process.stderr_base64);
  if (stderr === null) return 'stderr_base64';
  if (!process.started) {
    // Nothing was written to a core that never ran, so any delivery claim here
    // contradicts the observation that is supposed to prove a clean non-start.
    if (process.exit_code !== null || process.signal !== null || process.timed_out
      || claimsDelivery
      || !process.process_tree_contained || process.orphaned
      || !process.stdout_complete || !process.stderr_complete
      || stdout.length !== 0 || stderr.length !== 0) {
      return 'not-started-state';
    }
    return null;
  }
  if ((process.timed_out || process.signal !== null) && process.exit_code !== null) {
    return 'contradictory-exit-state';
  }
  const incompleteReason = process.timed_out || process.signal !== null
    || !process.process_tree_contained || process.orphaned
    || !process.stdout_complete || !process.stderr_complete;
  if (process.exit_code === null && !incompleteReason) return 'exit_code';
  return null;
}

function launchObservationState(process, processIssue) {
  if (processIssue === null && process?.started === false) return 'not-started';
  if (process?.started === true) return 'may-have-started';
  return 'unknown';
}

function capturedStreamsOverLimit(process, stdoutLimitBytes, stderrLimitBytes) {
  const streams = [];
  for (const [stream, limit] of [
    ['stdout', stdoutLimitBytes],
    ['stderr', stderrLimitBytes],
  ]) {
    if (limit === undefined) continue;
    if (!nonNegativeSafeInteger(limit)) return ['stdout', 'stderr'];
    const bytes = decodeCanonicalBase64(process[`${stream}_base64`]);
    if (bytes !== null && bytes.length > limit) streams.push(stream);
  }
  return streams;
}

function processSummary(process, command = null, responseContext = null) {
  const envelope = envelopeState(process, command, responseContext);
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

function decodeCanonicalBase64(value) {
  if (typeof value !== 'string' || value.includes('\n') || value.includes('\r')) return null;
  try {
    const bytes = Buffer.from(value, 'base64');
    return bytes.toString('base64') === value ? bytes : null;
  } catch {
    return null;
  }
}

function decodeUtf8(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function hasExactKeys(value, required, optional = []) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key))
    && actual.every((key) => allowed.has(key))
    && actual.length >= required.length;
}

function isSafeLogicalPath(value) {
  return value === '.' || (typeof value === 'string'
    && value.length > 0
    && !value.startsWith('/')
    && !value.includes('\\')
    && !value.includes('\0')
    && !/^[A-Za-z]:/.test(value)
    && !/^volume\{[^}]+\}(?:\/|$)/i.test(value)
    && value.split('/').every((segment) => segment && segment !== '.' && segment !== '..'));
}

function isSafeLedgerDirectoryPath(value) {
  return isSafeLogicalPath(value) && value !== '.' && !value.endsWith('.md');
}

function isSafeLedgerDisplayPath(value) {
  return isSafeLogicalPath(value) && value !== '.' && value.endsWith('.md');
}

function isSafeArtifactPath(value) {
  return isSafeLogicalPath(value) && value !== '.' && [...value].length <= 1024;
}

function isSafePackageExecutablePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && !CONTROL_CHARACTER.test(value)
    && !value.startsWith('/')
    && !value.includes('\\')
    && !/^[A-Za-z]:/.test(value)
    && !/^volume\{[^/]*\}(?:\/|$)/i.test(value)
    && value.split('/').every((segment) => segment && segment !== '.' && segment !== '..');
}

function snapshotIssue(value, expectedKind) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'missing';
  if (!Object.hasOwn(value, 'kind')) return 'invalid-kind';
  if (value.kind !== expectedKind) return value.kind;
  if (!Object.hasOwn(value, 'identity') || !validSnapshotIdentity(value.identity)) {
    return 'invalid-identity';
  }
  if (!hasExactKeys(value, ['kind', 'identity'])) return 'invalid-snapshot';
  return null;
}

function validSnapshotIdentity(value) {
  if (nonEmptyControlFreeString(value)) return true;
  if (hasExactKeys(value, ['dev', 'ino'])) {
    return validIdentityMember(value.dev) && validIdentityMember(value.ino);
  }
  if (hasExactKeys(value, ['volume_id', 'file_id'])) {
    return validIdentityMember(value.volume_id) && validIdentityMember(value.file_id);
  }
  return false;
}

function validIdentityMember(value) {
  return nonEmptyControlFreeString(value) || nonNegativeSafeInteger(value);
}

function nonEmptyControlFreeString(value) {
  return typeof value === 'string' && value.length > 0 && !CONTROL_CHARACTER.test(value);
}

function snapshotRefusal(pathRole, component, kind, snapshot) {
  const details = { path_role: pathRole, component, kind };
  if (kind === 'invalid-identity' || kind === 'invalid-kind' || kind === 'invalid-snapshot') {
    details.snapshot = snapshot;
  }
  return refusal('path-rejected', details);
}

function mutationUnknown(
  base,
  command,
  itemId,
  expectedRevision,
  process,
  processIssue = null,
  responseContext = null,
) {
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
    error: outerAdapterError('mutation-outcome-unknown', details),
    process: processSummary(process, command, responseContext),
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sameJson(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function compareText(left, right) {
  const leftPoints = [...left];
  const rightPoints = [...right];
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    const difference = leftPoints[index].codePointAt(0) - rightPoints[index].codePointAt(0);
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

function isOrdered(values, compare) {
  return values.every((value, index) => index === 0 || compare(values[index - 1], value) <= 0);
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function refusal(code, details) {
  return { ok: false, error: adapterError(code, details) };
}

function refusalWithWire(bootstrapWireVersion, code, details) {
  return { ok: false, bootstrap_wire_version: bootstrapWireVersion, error: adapterError(code, details) };
}

function describeRequestRefusal(bootstrapWireVersion, details) {
  return {
    ok: false,
    bootstrap_wire_version: bootstrapWireVersion,
    error: {
      code: 'invalid-describe-request',
      message: 'The adapter describe request is invalid.',
      details,
    },
  };
}

function adapterError(code, details) {
  assertPublicErrorCode(code);
  return { code, details };
}

function outerAdapterError(code, details) {
  assertPublicErrorCode(code);
  return {
    code,
    message: OUTER_ERROR_MESSAGES[code] ?? `The adapter refused the operation (${code}).`,
    details,
  };
}

function assertPublicErrorCode(code) {
  if (!ADAPTER_ERROR_CODE_SET.has(code)) throw new TypeError(`unregistered adapter error code: ${code}`);
}
