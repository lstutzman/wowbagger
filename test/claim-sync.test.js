import assert from 'node:assert/strict';
import test from 'node:test';

import { selectCommittedAdoptions } from '../src/claim-sync.js';

const NAMESPACE = 'wbns_0123456789abcdef0123456789abcdef';
const ITEM_ID = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';
const FROM = `sha256:${'1'.repeat(64)}`;
const TO = `sha256:${'2'.repeat(64)}`;

function adoption(overrides = {}) {
  return {
    seq: 7,
    type: 'revision-adoption',
    ledger_namespace: NAMESPACE,
    item_id: ITEM_ID,
    from_revision: FROM,
    to_revision: TO,
    adopted_by: 'operator-lee',
    adopted_at: '2026-08-22T10:00:00.000Z',
    git_commit: 'a'.repeat(40),
    ...overrides,
  };
}

test('selects one committed adoption missing from local journal', () => {
  assert.deepEqual(
    selectCommittedAdoptions({
      namespace: NAMESPACE,
      committedEntries: [adoption()],
      localEntries: [],
    }),
    { ok: true, entries: [adoption()], already_present: 0 },
  );
});

test('repeating committed adoption selection is idempotent', () => {
  const entry = adoption();
  assert.deepEqual(
    selectCommittedAdoptions({
      namespace: NAMESPACE,
      committedEntries: [entry],
      localEntries: [entry],
    }),
    { ok: true, entries: [], already_present: 1 },
  );
});

test('rejects conflicting local adoption evidence', () => {
  const entry = adoption();
  const conflict = adoption({ to_revision: `sha256:${'3'.repeat(64)}` });
  assert.deepEqual(
    selectCommittedAdoptions({
      namespace: NAMESPACE,
      committedEntries: [entry],
      localEntries: [conflict],
    }),
    { ok: false, error: { code: 'conflicting-adoption', item_id: ITEM_ID } },
  );
});
