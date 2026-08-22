import assert from 'node:assert/strict';
import test from 'node:test';

import { proposeExtensionDeclaration } from '../src/extension-provision.js';

function ledger(items) {
  return { items: items.map((data) => ({ data })) };
}

test('proposes an explicit declaration for uniform existing extensions', () => {
  const result = proposeExtensionDeclaration({
    ledger: ledger([{ tags: ['bug'] }, { tags: ['tax'] }]),
    members: { tags: 'string-list' },
  });
  assert.deepEqual(result, {
    ok: true,
    declaration: { extensions_version: 1, members: { tags: 'string-list' } },
    source: '{"extensions_version":1,"members":{"tags":"string-list"}}\n',
    counts: { tags: 2 },
  });
});

test('rejects mixed extension types instead of inferring authority', () => {
  const result = proposeExtensionDeclaration({
    ledger: ledger([{ tier: 1 }, { tier: 'gold' }]),
    members: { tier: 'string' },
  });
  assert.deepEqual(result, { ok: false, error: { code: 'extension-type-conflict', member: 'tier', type: 'string' } });
});
