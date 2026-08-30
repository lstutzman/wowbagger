export function resolveWorkClaimCapability({ gitCommonDir, namespace = null }) {
  if (!gitCommonDir) {
    return {
      supported: false,
      api_version: 3,
      mode: 'advisory',
      claim_protected_publication: false,
      fencing_enforced_at: 'none',
      safe_exclusive_dispatch: false,
    };
  }
  if (!namespace) {
    return {
      supported: true,
      api_version: 3,
      mode: 'advisory',
      claim_protected_publication: false,
      fencing_enforced_at: 'none',
      safe_exclusive_dispatch: false,
    };
  }
  return {
    supported: true,
    api_version: 3,
    mode: 'merge-coordinated',
    claim_protected_publication: true,
    fencing_enforced_at: 'git-history-reconciliation',
    safe_exclusive_dispatch: false,
    write_paths: {
      alternate: 'none',
      claimed_publication_v1: 'git-journal-fence',
      legacy_create_v1: 'reject-claimed-id',
      legacy_transition_v1: 'reject-active-claim',
    },
  };
}

export function resolveClaimBackend({ gitCommonDir, namespace = null }) {
  if (!gitCommonDir || !namespace) {
    return {
      name: 'local-filesystem',
      coordination_scope: coordinationScope({ gitCommonDir }),
      write_serialization: { scope: 'none', blocks_until: 'not-applicable' },
    };
  }
  return {
    name: 'local-filesystem-git-journal',
    coordination_scope: 'shared-git-common-dir-serialized-journal',
    ledger_binding: { mode: 'explicit-allowlist', namespaces: [namespace] },
    // The shared journal still coordinates durable publication, but a private
    // foreign publication blocks only mutations targeting its item.
    write_serialization: {
      scope: 'target-item-reconciliation',
      blocks_until: 'target-item-publication-reconciled',
    },
  };
}

export function coordinationScope({ gitCommonDir }) {
  return gitCommonDir ? 'shared-git-directory-cooperative-writers' : 'same-working-copy-cooperative-writers';
}
