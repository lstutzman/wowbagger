import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { withLedger, runCli } from './support.js';

const EPIC = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';
const CHILD = 'wb_01KZBMBEZKPE7D15HKW9Q3GT55';

function item(id, kind, parent = null) {
  return `---\nschema_version: 1\nid: ${id}\ntitle: "${kind}"\nkind: ${kind}\nstatus: backlog\ncreated: 2026-08-06\nupdated: 2026-08-06\nprovenance:\n  source: "test/parent-migration"\n  recorded_at: "2026-08-06T12:00:00Z"\ndepends_on: []\nrelated: []${parent ? `\nparent: ${parent}` : ''}\n---\n${kind}\n`;
}

test('parent-migrate detaches a live child with a CAS witness', async () => {
  await withLedger({
    [`${EPIC}.md`]: item(EPIC, 'epic'),
    [`${CHILD}.md`]: item(CHILD, 'task', EPIC),
  }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', CHILD, '--json');
    assert.equal(inspected.status, 0, inspected.stderr + inspected.stdout);
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'parent-migrate.json');
    await import('node:fs/promises').then(({ writeFile }) => writeFile(requestPath, JSON.stringify({
      id: CHILD,
      expected_revision: revision,
      expected_parent: EPIC,
      parent: null,
      date: '2030-01-21',
    })));
    const migrated = runCli('parent-migrate', '--ledger', ledger, '--input', requestPath, '--json');
    assert.equal(migrated.status, 0, migrated.stderr);
    const result = JSON.parse(migrated.stdout);
    assert.equal(result.result.item.core.parent, undefined);
    const source = await readFile(path.join(ledger, `${CHILD}.md`), 'utf8');
    assert.doesNotMatch(source, /^parent:/m);
  });
});
