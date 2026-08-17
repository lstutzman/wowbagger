export function resolveWorkClaimCapability({ gitCommonDir, namespace = null }) {
  if (!gitCommonDir) {
    return {
      supported: false,
      api_version: 2,
      mode: 'advisory',
      claim_protected_publication: false,
      fencing_enforced_at: 'none',
      safe_exclusive_dispatch: false,
    };
  }
  if (!namespace) {
    return {
      supported: true,
      api_version: 2,
      mode: 'advisory',
      claim_protected_publication: false,
      fencing_enforced_at: 'none',
      safe_exclusive_dispatch: false,
    };
  }
  return {
    supported: true,
    api_version: 2,
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
    // One journal in the shared Git common directory serializes every worktree
    // of this repository. A recorded write blocks the other worktrees until
    // its commit is visible in the checkout that wants to write next.
    write_serialization: {
      scope: 'all-worktrees-of-one-repository',
      blocks_until: 'peer-commit-visible-in-this-checkout',
    },
  };
}

export function coordinationScope({ gitCommonDir }) {
  return gitCommonDir ? 'shared-git-directory-cooperative-writers' : 'same-working-copy-cooperative-writers';
}
