import assert from 'node:assert/strict';
import test from 'node:test';

import { checkProspectiveLedger } from '../src/claim-prospective.js';
import { revisionFor } from '../src/mutation.js';

const ITEM_ID = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';
const NAMESPACE = 'wbns_0123456789abcdef0123456789abcdef';

function item(title) {
  return Buffer.from(`---\nschema_version: 2\nid: ${ITEM_ID}\nnumber: 1\ntitle: "${title}"\nkind: task\nstatus: backlog\ncreated: 2026-08-06\nupdated: 2026-08-11\nprovenance:\n  source: "test"\n  recorded_at: "2026-08-11T00:00:00Z"\ndepends_on: []\nrelated: []\ndecisions: []\n---\n${title}\n`);
}

test('rejects a prospective merge whose journal adoption disagrees with candidate item bytes', () => {
  const predecessor = item('R0');
  const reviewed = item('R1');
  const predecessorRevision = revisionFor(predecessor);
  const reviewedRevision = revisionFor(reviewed);

  const result = checkProspectiveLedger({
    namespace: NAMESPACE,
    items: new Map([[ITEM_ID, { path: `items/${ITEM_ID}.md`, bytes: reviewed }]]),
    entries: [
      {
        seq: 1,
        type: 'legacy-mutation',
        ledger_namespace: NAMESPACE,
        item_id: ITEM_ID,
        command: 'patch-v1',
        committed_revision: reviewedRevision,
        item_path: `items/${ITEM_ID}.md`,
        observed_at: '2026-08-22T00:00:00.000Z',
      },
      {
        seq: 2,
        type: 'revision-adoption',
        ledger_namespace: NAMESPACE,
        item_id: ITEM_ID,
        from_revision: reviewedRevision,
        to_revision: predecessorRevision,
        adopted_by: 'test-agent',
        adopted_at: '2026-08-22T00:01:00.000Z',
        git_commit: 'a'.repeat(40),
        item_path: `items/${ITEM_ID}.md`,
      },
    ],
    parents: { base: 'base-commit', head: 'head-commit' },
    candidate: 'merge-tree',
  });

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: 'unauthorized-revision',
      item_id: ITEM_ID,
      actual_revision: reviewedRevision,
      expected_revision: predecessorRevision,
      decisive_sequences: [1, 2],
      parents: { base: 'base-commit', head: 'head-commit' },
      candidate: 'merge-tree',
    },
  });
});
