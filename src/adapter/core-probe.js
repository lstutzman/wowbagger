import {
  DEFAULT_LIST_PAGE_SIZE,
  LIST_QUERY_VERSION,
  MAX_ITEM_SOURCE_BYTES,
  MAX_LIST_PAGE_SIZE,
  MAX_LIST_RESPONSE_BYTES,
  MAX_LIST_TITLE_CHARACTERS,
} from '../limits.js';
import { hasExactMembers } from './schema-helpers.js';

// The version 3 core command list, in the fixed advertising order (contract
// section 3). `describe.js` also needs this order to validate the
// `core.commands` subset it accepts, so it is exported from here.
export const CORE_COMMAND_ORDER = Object.freeze([
  'capabilities', 'create', 'inspect', 'patch', 'ready', 'transition', 'validate',
]);
export const CORE_CONTRACT_VERSION = 5;
// The work-claim API lives in its own version domain. It moved to 2 with the
// item-source refusal that replaced publish-claimed's version 1 error for an
// oversized candidate.
export const WORK_CLAIM_API_VERSION = 2;

function refuse(error_code, detail) {
  return { ok: false, error_code, detail };
}

function backendIssue(backend) {
  if (!hasExactMembers(backend, ['name', 'coordination_scope'])
    || backend.name !== 'local-filesystem'
    || backend.coordination_scope !== 'same-working-copy-cooperative-writers') {
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

function patchOperationIssue(patch) {
  if (!hasExactMembers(patch, ['supported', 'write_scope', 'cas_scope'])
    || patch.supported !== true
    || patch.write_scope !== 'single-item'
    || patch.cas_scope !== 'exact-byte-sha256') {
    return 'result.operations.patch';
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
    || workClaim.api_version !== WORK_CLAIM_API_VERSION
    || workClaim.mode !== 'advisory'
    || workClaim.claim_protected_publication !== false
    || workClaim.fencing_enforced_at !== 'none'
    || workClaim.safe_exclusive_dispatch !== false) {
    return 'result.operations.work_claim';
  }
  return null;
}

function listOperationIssue(list) {
  if (!hasExactMembers(list, ['supported', 'write_scope', 'cas_scope', 'query_version'])
    || list.supported !== true
    || list.write_scope !== 'none'
    || list.cas_scope !== 'none'
    || list.query_version !== LIST_QUERY_VERSION) {
    return 'result.operations.list';
  }
  return null;
}

function operationsIssue(operations) {
  if (!hasExactMembers(operations, ['inspect', 'list', 'create', 'transition', 'patch', 'work_claim'])) {
    return 'result.operations';
  }
  return inspectOperationIssue(operations.inspect)
    || listOperationIssue(operations.list)
    || createOperationIssue(operations.create)
    || transitionOperationIssue(operations.transition)
    || patchOperationIssue(operations.patch)
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
    'max_item_source_bytes',
    'default_list_page_size', 'max_list_page_size', 'max_list_title_characters', 'max_list_response_bytes',
    'multi_item_atomicity', 'cross_clone_coordination', 'cross_worktree_coordination',
    'cross_machine_coordination', 'noncooperating_writer_protection', 'automatic_stale_lock_breaking',
  ])
    || limits.max_item_source_bytes !== MAX_ITEM_SOURCE_BYTES
    || limits.default_list_page_size !== DEFAULT_LIST_PAGE_SIZE
    || limits.max_list_page_size !== MAX_LIST_PAGE_SIZE
    || limits.max_list_title_characters !== MAX_LIST_TITLE_CHARACTERS
    || limits.max_list_response_bytes !== MAX_LIST_RESPONSE_BYTES
    || limits.multi_item_atomicity !== false
    || limits.cross_clone_coordination !== false
    || limits.cross_worktree_coordination !== false
    || limits.cross_machine_coordination !== false
    || limits.noncooperating_writer_protection !== false
    || limits.automatic_stale_lock_breaking !== false) {
    return 'result.limits';
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
    || limitsIssue(result.limits);
}

function sameCommandOrder(commands) {
  return Array.isArray(commands)
    && commands.length === CORE_COMMAND_ORDER.length
    && commands.every((command, index) => command === CORE_COMMAND_ORDER[index]);
}

// verifyCoreProbe(describe, probe) checks the independently-launched core
// `capabilities --json` probe against an already-validated describe
// result (contract section 3): the probe must match the exact version 3
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
// same-process, same-working-copy `local-filesystem` backend. Advisory
// work-claim visibility is independent of this mutation-coordination scope
// (contract section 3: "optional_features.claims is derived only from
// operations.work_claim.supported").
export function coreCapabilities() {
  return {
    ok: true,
    command: 'capabilities',
    contract_version: CORE_CONTRACT_VERSION,
    result: {
      backend: { name: 'local-filesystem', coordination_scope: 'same-working-copy-cooperative-writers' },
      operations: {
        inspect: { supported: true, write_scope: 'none', cas_scope: 'none' },
        list: {
          supported: true,
          write_scope: 'none',
          cas_scope: 'none',
          query_version: LIST_QUERY_VERSION,
        },
        create: {
          supported: true,
          write_scope: 'single-item',
          cas_scope: 'requested-id-lock',
          publication_visibility: 'atomic-no-clobber-or-fail',
          publication_probe: 'per-ledger-operation',
        },
        transition: { supported: true, write_scope: 'single-item', cas_scope: 'exact-byte-sha256' },
        patch: { supported: true, write_scope: 'single-item', cas_scope: 'exact-byte-sha256' },
        work_claim: {
          supported: false,
          api_version: WORK_CLAIM_API_VERSION,
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
        max_item_source_bytes: MAX_ITEM_SOURCE_BYTES,
        default_list_page_size: DEFAULT_LIST_PAGE_SIZE,
        max_list_page_size: MAX_LIST_PAGE_SIZE,
        max_list_title_characters: MAX_LIST_TITLE_CHARACTERS,
        max_list_response_bytes: MAX_LIST_RESPONSE_BYTES,
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
