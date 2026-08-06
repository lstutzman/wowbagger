// test/claim-capabilities.test.js
import assert from 'node:assert/strict';
import test from 'node:test';

import { coordinationScope, resolveWorkClaimCapability } from '../src/claim-capabilities.js';

test('the backend reports advisory and never claims safe dispatch', () => {
  const capability = resolveWorkClaimCapability({ gitCommonDir: '/repo/.git' });
  assert.deepEqual(capability, {
    supported: true,
    api_version: 1,
    mode: 'advisory',
    claim_protected_publication: false,
    fencing_enforced_at: 'none',
    safe_exclusive_dispatch: false,
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
