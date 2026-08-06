export function resolveWorkClaimCapability({ gitCommonDir }) {
  if (!gitCommonDir) {
    return {
      supported: false,
      api_version: 1,
      mode: 'advisory',
      claim_protected_publication: false,
      fencing_enforced_at: 'none',
      safe_exclusive_dispatch: false,
    };
  }
  return {
    supported: true,
    api_version: 1,
    mode: 'advisory',
    claim_protected_publication: false,
    fencing_enforced_at: 'none',
    safe_exclusive_dispatch: false,
  };
}

export function coordinationScope({ gitCommonDir }) {
  return gitCommonDir ? 'shared-git-directory-cooperative-writers' : 'same-working-copy-cooperative-writers';
}
