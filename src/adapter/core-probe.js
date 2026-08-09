import { hasExactMembers } from './schema-helpers.js';

// The version 1 core command list, in the fixed advertising order (contract
// section 3). `describe.js` also needs this order to validate the
// `core.commands` subset it accepts, so it is exported from here.
export const CORE_COMMAND_ORDER = Object.freeze([
  'capabilities', 'create', 'inspect', 'ready', 'transition', 'validate',
]);
export const CORE_CONTRACT_VERSION = 2;

const GIT_COORDINATION_SCOPES = new Set([
  'same-working-copy-cooperative-writers',
  'shared-git-directory-cooperative-writers',
]);

function refuse(error_code, detail) {
  return { ok: false, error_code, detail };
}

function backendIssue(backend) {
  if (!hasExactMembers(backend, ['name', 'coordination_scope'])
    || backend.name !== 'local-filesystem'
    || !GIT_COORDINATION_SCOPES.has(backend.coordination_scope)) {
    return 'result.backend';
  }
  return null;
}

function inspectOperationIssue(inspect) {
  if (!hasExactMembers(inspect, ['supported', 'write_scope', 'cas_scope'])
    || inspect.supported !== true
    || inspect.write_scope !== 'none'
    || inspect.cas_scope !== 'none') {
    return 'result.operations.inspect';
  }
  return null;
}

function createOperationIssue(create) {
  if (!hasExactMembers(create, [
    'supported', 'write_scope', 'cas_scope', 'publication_visibility', 'publication_probe',
  ])
    || create.supported !== true
    || create.write_scope !== 'single-item'
    || create.cas_scope !== 'requested-id-lock'
    || create.publication_visibility !== 'atomic-no-clobber-or-fail'
    || create.publication_probe !== 'per-ledger-operation') {
    return 'result.operations.create';
  }
  return null;
}

function transitionOperationIssue(transition) {
  if (!hasExactMembers(transition, ['supported', 'write_scope', 'cas_scope'])
    || transition.supported !== true
    || transition.write_scope !== 'single-item'
    || transition.cas_scope !== 'exact-byte-sha256') {
    return 'result.operations.transition';
  }
  return null;
}

// Every member except `supported` is a permanent advisory-claims invariant:
// claims never protect publication, never fence writers, and must never
// advertise safe exclusive dispatch.
function workClaimOperationIssue(workClaim) {
  if (!hasExactMembers(workClaim, [
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
  return null;
}

function operationsIssue(operations) {
  if (!hasExactMembers(operations, ['inspect', 'create', 'transition', 'work_claim'])) {
    return 'result.operations';
  }
  return inspectOperationIssue(operations.inspect)
    || createOperationIssue(operations.create)
    || transitionOperationIssue(operations.transition)
    || workClaimOperationIssue(operations.work_claim);
}

function durabilityIssue(durability) {
  if (!hasExactMembers(durability, [
    'temporary_file_sync', 'directory_sync', 'post_publication_verification', 'power_loss_guarantee',
  ])
    || durability.temporary_file_sync !== 'required-before-publication'
    || durability.directory_sync !== 'best-effort-when-supported'
    || durability.post_publication_verification !== 'exact-bytes-required'
    || durability.power_loss_guarantee !== 'none') {
    return 'result.durability';
  }
  return null;
}

function limitsIssue(limits) {
  if (!hasExactMembers(limits, [
    'multi_item_atomicity', 'cross_clone_coordination', 'cross_worktree_coordination',
    'cross_machine_coordination', 'noncooperating_writer_protection', 'automatic_stale_lock_breaking',
  ])
    || limits.multi_item_atomicity !== false
    || limits.cross_clone_coordination !== false
    || typeof limits.cross_worktree_coordination !== 'boolean'
    || limits.cross_machine_coordination !== false
    || limits.noncooperating_writer_protection !== false
    || limits.automatic_stale_lock_breaking !== false) {
    return 'result.limits';
  }
  return null;
}

// `work_claim.supported`, `backend.coordination_scope`, and
// `limits.cross_worktree_coordination` all derive from the same "was a
// shared git common directory found?" fact; a probe may only report one of
// the two internally-consistent combinations.
function coordinationConsistencyIssue(result) {
  const gitDirectoryFound = result.backend.coordination_scope === 'shared-git-directory-cooperative-writers';
  if (result.operations.work_claim.supported !== gitDirectoryFound
    || result.limits.cross_worktree_coordination !== gitDirectoryFound) {
    return 'result.git-coordination-consistency';
  }
  return null;
}

function coreProbeSchemaIssue(probe) {
  if (!hasExactMembers(probe, ['ok', 'command', 'contract_version', 'result'])) {
    return 'members';
  }
  if (probe.ok !== true) {
    return 'ok';
  }
  if (probe.command !== 'capabilities') {
    return 'command';
  }
  if (probe.contract_version !== CORE_CONTRACT_VERSION) {
    return 'contract_version';
  }
  const result = probe.result;
  if (!hasExactMembers(result, ['backend', 'operations', 'durability', 'limits'])) {
    return 'result';
  }
  return backendIssue(result.backend)
    || operationsIssue(result.operations)
    || durabilityIssue(result.durability)
    || limitsIssue(result.limits)
    || coordinationConsistencyIssue(result);
}

function sameCommandOrder(commands) {
  return Array.isArray(commands)
    && commands.length === CORE_COMMAND_ORDER.length
    && commands.every((command, index) => command === CORE_COMMAND_ORDER[index]);
}

// verifyCoreProbe(describe, probe) checks the independently-launched core
// `capabilities --json` probe against an already-validated describe
// result (contract section 3): the probe must match the exact version 1
// envelope, its contract version must match the required core contract
// version, its command list must match the advertised one, and neither
// optional feature may be elevated beyond what the probe actually supports.
export function verifyCoreProbe(describe, probe) {
  const schemaIssue = coreProbeSchemaIssue(probe);
  if (schemaIssue) {
    return refuse('core-protocol-error', { member: schemaIssue });
  }
  const required = describe?.core?.required_core_contract_version;
  if (probe.contract_version !== required) {
    return refuse('core-contract-version-mismatch', { required, probed: probe.contract_version });
  }
  if (!sameCommandOrder(describe.core.commands)) {
    return refuse('core-contract-version-mismatch', { member: 'core.commands' });
  }
  if (describe.optional_features?.claims !== probe.result.operations.work_claim.supported) {
    return refuse('core-contract-version-mismatch', { member: 'optional_features.claims' });
  }
  if (describe.optional_features?.policy !== false) {
    return refuse('core-contract-version-mismatch', { member: 'optional_features.policy' });
  }
  return { ok: true };
}

// The engine's own core capability snapshot: this repository's core is a
// same-process, same-working-copy `local-filesystem` backend that has not
// found a shared git common directory, so work-claim coordination is
// unsupported (contract section 3: "optional_features.claims is derived
// only from operations.work_claim.supported").
export function coreCapabilities() {
  return {
    ok: true,
    command: 'capabilities',
    contract_version: CORE_CONTRACT_VERSION,
    result: {
      backend: { name: 'local-filesystem', coordination_scope: 'same-working-copy-cooperative-writers' },
      operations: {
        inspect: { supported: true, write_scope: 'none', cas_scope: 'none' },
        create: {
          supported: true,
          write_scope: 'single-item',
          cas_scope: 'requested-id-lock',
          publication_visibility: 'atomic-no-clobber-or-fail',
          publication_probe: 'per-ledger-operation',
        },
        transition: { supported: true, write_scope: 'single-item', cas_scope: 'exact-byte-sha256' },
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
