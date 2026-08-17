// test/claim-adoption.test.js
//
// Item #113: `unauthorized-revision` needs a non-destructive remedy. The
// destructive one (restore the authorized bytes) discards reviewed, merged
// work. Adoption re-baselines the coordinator's authorized revision onto bytes
// that are already committed, records who ruled them legitimate, and touches no
// item byte.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  appendClaimEntry,
  claimJournalPath,
  replayClaimJournal,
} from '../src/claim-journal.js';

const CLI = fileURLToPath(new URL('../bin/wowbagger.js', import.meta.url));
const ITEM_ID = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';
const NAMESPACE = 'wbns_0123456789abcdef0123456789abcdef';

function run(root, ...argumentsList) {
  const result = spawnSync(process.execPath, [CLI, ...argumentsList], {
    cwd: root,
    encoding: 'utf8',
  });
  return { envelope: JSON.parse(result.stdout), exit: result.status };
}

function git(root, ...argumentsList) {
  const result = spawnSync('git', argumentsList, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

async function repository() {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-adoption-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Wowbagger Test');
  const ledger = path.join(root, 'ledger');
  await mkdir(ledger);
  await mkdir(path.join(ledger, '.wowbagger'));
  await writeFile(path.join(ledger, '.wowbagger', 'namespace'), `${NAMESPACE}\n`);
  const itemPath = path.join(ledger, 'item.md');
  const before = Buffer.from('---\nschema_version: 2\nid: wb_01KZBMBEZKPE7D15HKW9Q3GSZV\nnumber: 1\ntitle: "Before"\nkind: task\nstatus: backlog\ncreated: 2026-08-06\nupdated: 2026-08-11\nprovenance:\n  source: "repository-backlog"\n  recorded_at: "2026-08-11T00:00:00Z"\ndepends_on: []\nrelated: []\ndecisions: []\n---\nBefore\n');
  await writeFile(itemPath, before);
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'Initial item');
  return { before, itemPath, ledger, namespace: NAMESPACE, root };
}

// The consumer's exact state: a valid ledger, one authorized revision recorded
// by the protocol, and a hand-edited body that was reviewed, committed, and
// merged out of protocol. `claim-verify` refuses exit 6 with a working-tree
// `unauthorized-revision` finding.
async function blockedByUnauthorizedRevision() {
  const fixture = await repository();
  const patchPath = path.join(fixture.root, 'authorize.json');
  await writeFile(patchPath, JSON.stringify({
    id: ITEM_ID,
    expected_revision: sha256(fixture.before),
    date: '2026-08-11',
    set: { priority: 1 },
  }));
  const patched = run(
    fixture.root,
    'patch', '--ledger', fixture.ledger, '--input', patchPath, '--json',
  );
  assert.equal(patched.exit, 0, JSON.stringify(patched.envelope));
  git(fixture.root, 'add', 'ledger/item.md');
  git(fixture.root, 'commit', '-qm', 'Authorized patch');
  const authorized = await readFile(fixture.itemPath);

  const edited = Buffer.from(authorized.toString('utf8').replace('\nBefore\n', '\nHand-edited in a design session and merged.\n'));
  await writeFile(fixture.itemPath, edited);
  git(fixture.root, 'add', 'ledger/item.md');
  git(fixture.root, 'commit', '-qm', 'Out-of-protocol body edit');

  return {
    ...fixture,
    authorizedRevision: patched.envelope.result.item.revision,
    edited,
    editedRevision: sha256(edited),
  };
}

function adoptionEntry(overrides) {
  return {
    seq: 1,
    type: 'revision-adoption',
    ledger_namespace: NAMESPACE,
    item_id: ITEM_ID,
    from_revision: `sha256:${'1'.repeat(64)}`,
    to_revision: `sha256:${'2'.repeat(64)}`,
    adopted_by: 'operator-lee',
    adopted_at: '2026-08-17T10:00:00.000Z',
    git_commit: '0'.repeat(40),
    ...overrides,
  };
}

const malformedAdoptions = {
  'adopts its own from-revision': { to_revision: `sha256:${'1'.repeat(64)}` },
  'names no operator': { adopted_by: 42 },
  'names no commit': { git_commit: null },
  'belongs to another namespace': { ledger_namespace: 'wbns_ffffffffffffffffffffffffffffffff' },
  'carries non-string item-path evidence': { item_path: 7 },
};

for (const [label, overrides] of Object.entries(malformedAdoptions)) {
  test(`the journal rejects a revision-adoption entry that ${label}`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'wb-adoption-journal-'));
    const journalPath = claimJournalPath(root, NAMESPACE);
    await mkdir(path.dirname(journalPath), { recursive: true });
    await writeFile(journalPath, `${JSON.stringify(adoptionEntry(overrides))}\n`);

    await assert.rejects(replayClaimJournal(journalPath, NAMESPACE), (error) => (
      error.code === 'CLAIM_JOURNAL_INVALID'
        && error.reason === 'invalid-entry'
    ));
  });
}

test('the journal accepts a well-formed revision-adoption entry', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-adoption-journal-ok-'));
  const journalPath = claimJournalPath(root, NAMESPACE);
  await mkdir(path.dirname(journalPath), { recursive: true });
  await writeFile(journalPath, `${JSON.stringify(adoptionEntry({ item_path: 'item.md' }))}\n`);

  const replayed = await replayClaimJournal(journalPath, NAMESPACE);

  assert.equal(replayed.entries.length, 1);
  assert.equal(replayed.entries[0].type, 'revision-adoption');
});

test('an adoption recorded in the journal makes the committed bytes authorized', async () => {
  const fixture = await blockedByUnauthorizedRevision();
  const blocked = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');
  assert.equal(blocked.exit, 6, JSON.stringify(blocked.envelope));
  assert.equal(blocked.envelope.result.findings[0].reason, 'unauthorized-revision');

  const journalPath = claimJournalPath(
    path.join(fixture.root, '.git'),
    fixture.namespace,
  );
  await appendClaimEntry(journalPath, {
    type: 'revision-adoption',
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
    from_revision: fixture.authorizedRevision,
    to_revision: fixture.editedRevision,
    adopted_by: 'operator-lee',
    adopted_at: '2026-08-17T10:00:00.000Z',
    git_commit: git(fixture.root, 'rev-parse', 'HEAD'),
    item_path: 'item.md',
  });
  const replayed = await replayClaimJournal(journalPath, fixture.namespace);
  assert.equal(replayed.entries.at(-1).type, 'revision-adoption');

  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');

  assert.equal(verified.exit, 0, JSON.stringify(verified.envelope));
  assert.deepEqual(verified.envelope.result.findings, []);
});
