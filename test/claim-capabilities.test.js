// test/claim-capabilities.test.js
import assert from 'node:assert/strict';
import test from 'node:test';

import { coordinationScope, resolveClaimBackend, resolveWorkClaimCapability } from '../src/claim-capabilities.js';

test('a provisioned git backend reports merge-coordinated claims without claiming safe dispatch', () => {
  const capability = resolveWorkClaimCapability({
    gitCommonDir: '/repo/.git',
    namespace: 'wbns_0123456789abcdef0123456789abcdef',
  });
  assert.deepEqual(capability, {
    supported: true,
    api_version: 1,
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
  });
});

test('without git the capability is unsupported', () => {
  const capability = resolveWorkClaimCapability({ gitCommonDir: null });
  assert.equal(capability.supported, false);
  assert.equal(capability.safe_exclusive_dispatch, false);
});

test('coordination scope names the shared git directory only when it exists', () => {
  assert.equal(coordinationScope({ gitCommonDir: '/repo/.git' }), 'shared-git-directory-cooperative-writers');
  assert.equal(coordinationScope({ gitCommonDir: null }), 'same-working-copy-cooperative-writers');
});

test('a provisioned git backend advertises the worktrees its journal serializes', () => {
  const backend = resolveClaimBackend({
    gitCommonDir: '/repo/.git',
    namespace: 'wbns_0123456789abcdef0123456789abcdef',
  });
  assert.deepEqual(backend.write_serialization, {
    scope: 'all-worktrees-of-one-repository',
    blocks_until: 'peer-commit-visible-in-this-checkout',
  });
});

test('an unprovisioned backend advertises no write serialization', () => {
  assert.deepEqual(
    resolveClaimBackend({ gitCommonDir: '/repo/.git' }).write_serialization,
    { scope: 'none', blocks_until: 'not-applicable' },
  );
  assert.deepEqual(
    resolveClaimBackend({ gitCommonDir: null }).write_serialization,
    { scope: 'none', blocks_until: 'not-applicable' },
  );
});
