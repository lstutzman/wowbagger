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
async function blockedByUnauthorizedRevision({ claimBeforeEdit = false, edit } = {}) {
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

  let claim = null;
  if (claimBeforeEdit) {
    const acquirePath = path.join(fixture.root, 'acquire.json');
    await writeFile(acquirePath, JSON.stringify({
      ledger_namespace: fixture.namespace,
      item_id: ITEM_ID,
      owner_id: 'agent-designer',
      lease_duration_ms: 86400000,
      expected: { last_epoch: '0', active: null },
    }));
    const acquired = run(
      fixture.root,
      'claim', 'acquire', '--ledger', fixture.ledger, '--input', acquirePath, '--json',
    );
    assert.equal(acquired.exit, 0, JSON.stringify(acquired.envelope));
    claim = acquired.envelope.result.claim;
  }

  const edited = Buffer.from(
    edit
      ? edit(authorized.toString('utf8'))
      : authorized.toString('utf8').replace('\nBefore\n', '\nHand-edited in a design session and merged.\n'),
  );
  await writeFile(fixture.itemPath, edited);
  git(fixture.root, 'add', 'ledger/item.md');
  git(fixture.root, 'commit', '-qm', 'Out-of-protocol body edit');

  return {
    ...fixture,
    authorizedRevision: patched.envelope.result.item.revision,
    claim,
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

async function adoptRequest(fixture, overrides = {}) {
  const requestPath = path.join(fixture.root, `adopt-${Object.keys(overrides).join('-') || 'default'}.json`);
  await writeFile(requestPath, JSON.stringify({
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
    from_revision: fixture.authorizedRevision,
    to_revision: fixture.editedRevision,
    adopted_by: 'operator-lee',
    ...overrides,
  }));
  return requestPath;
}

test('one adoption clears the block, keeps the edited bytes, and leaves updated untouched', async () => {
  const fixture = await blockedByUnauthorizedRevision();
  assert.equal(
    run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json').exit,
    6,
  );

  const adopted = run(
    fixture.root,
    'claim-adopt', '--ledger', fixture.ledger, '--input', await adoptRequest(fixture), '--json',
  );

  assert.equal(adopted.exit, 0, JSON.stringify(adopted.envelope));
  assert.deepEqual(Object.keys(adopted.envelope), [
    'ok', 'namespace', 'command', 'contract_version', 'state', 'result',
  ]);
  assert.equal(adopted.envelope.namespace, 'work-claim');
  assert.equal(adopted.envelope.command, 'claim-adopt');
  assert.equal(adopted.envelope.contract_version, 1);
  assert.equal(adopted.envelope.state, 'committed');
  assert.deepEqual(Object.keys(adopted.envelope.result).sort(), [
    'adopted_at', 'adopted_by', 'from_revision', 'item_id', 'ledger_namespace', 'to_revision',
  ]);
  assert.equal(adopted.envelope.result.from_revision, fixture.authorizedRevision);
  assert.equal(adopted.envelope.result.to_revision, fixture.editedRevision);
  assert.equal(adopted.envelope.result.adopted_by, 'operator-lee');
  assert.match(adopted.envelope.result.adopted_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

  // The reviewed, merged bytes survive byte for byte, and no field the protocol
  // owns is rewritten: adoption touches the journal, never the item.
  assert.deepEqual(await readFile(fixture.itemPath), fixture.edited);
  assert.match(fixture.edited.toString('utf8'), /^updated: 2026-08-11$/m);

  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');
  assert.equal(verified.exit, 0, JSON.stringify(verified.envelope));
  assert.deepEqual(verified.envelope.result.findings, []);

  const replayed = await replayClaimJournal(
    claimJournalPath(path.join(fixture.root, '.git'), fixture.namespace),
    fixture.namespace,
  );
  const journaled = replayed.entries.filter((entry) => entry.type === 'revision-adoption');
  assert.equal(journaled.length, 1);
  assert.equal(journaled[0].from_revision, fixture.authorizedRevision);
  assert.equal(journaled[0].to_revision, fixture.editedRevision);
  assert.equal(journaled[0].adopted_by, 'operator-lee');
  assert.equal(journaled[0].adopted_at, adopted.envelope.result.adopted_at);
  assert.equal(journaled[0].git_commit, git(fixture.root, 'rev-parse', 'HEAD'));
  assert.equal(journaled[0].item_path, 'item.md');
});

test('an unauthorized-revision finding names both the destructive and the non-destructive remedy', async () => {
  const fixture = await blockedByUnauthorizedRevision();

  const blocked = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');

  assert.equal(blocked.exit, 6, JSON.stringify(blocked.envelope));
  const finding = blocked.envelope.result.findings[0];
  assert.equal(finding.reason, 'unauthorized-revision');
  assert.equal(
    finding.remediation,
    'Restore the authorized revision at item.md, then run claim-verify; that discards the edit. Or adopt the committed revision of item.md with claim-adopt, then run claim-verify; that keeps the edit.',
  );
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

test('a second adoption with a stale revision witness refuses', async () => {
  const fixture = await blockedByUnauthorizedRevision();
  const requestPath = await adoptRequest(fixture);
  assert.equal(
    run(fixture.root, 'claim-adopt', '--ledger', fixture.ledger, '--input', requestPath, '--json').exit,
    0,
  );

  const replayed = run(
    fixture.root,
    'claim-adopt', '--ledger', fixture.ledger, '--input', requestPath, '--json',
  );

  assert.equal(replayed.exit, 4, JSON.stringify(replayed.envelope));
  assert.equal(replayed.envelope.state, 'unchanged');
  assert.equal(replayed.envelope.error.code, 'adoption-witness-mismatch');
  assert.equal(
    replayed.envelope.error.message,
    'The adoption witness no longer names the authorized revision.',
  );
  assert.deepEqual(replayed.envelope.error.details, {
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
    authorized_revision: fixture.editedRevision,
    requested_from_revision: fixture.authorizedRevision,
  });
  assert.equal(
    run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json').exit,
    0,
  );
});

test('adoption refuses while an active claim holds the item', async () => {
  const fixture = await blockedByUnauthorizedRevision({ claimBeforeEdit: true });

  const refused = run(
    fixture.root,
    'claim-adopt', '--ledger', fixture.ledger, '--input', await adoptRequest(fixture), '--json',
  );

  assert.equal(refused.exit, 4, JSON.stringify(refused.envelope));
  assert.equal(refused.envelope.state, 'unchanged');
  assert.equal(refused.envelope.error.code, 'claim-held');
  assert.equal(refused.envelope.error.message, 'The item has an unexpired active claim.');
  assert.deepEqual(refused.envelope.error.details, {
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
    observed_at: refused.envelope.error.details.observed_at,
    last_epoch: fixture.claim.epoch,
    active: fixture.claim,
  });
  const replayed = await replayClaimJournal(
    claimJournalPath(path.join(fixture.root, '.git'), fixture.namespace),
    fixture.namespace,
  );
  assert.deepEqual(replayed.entries.filter((entry) => entry.type === 'revision-adoption'), []);
});

test('adoption refuses bytes that are not committed at Git HEAD', async () => {
  const fixture = await blockedByUnauthorizedRevision();
  const uncommitted = Buffer.from(`${fixture.edited.toString('utf8')}\nStill only in the working tree.\n`);
  await writeFile(fixture.itemPath, uncommitted);

  const refused = run(
    fixture.root,
    'claim-adopt', '--ledger', fixture.ledger, '--input',
    await adoptRequest(fixture, { to_revision: sha256(uncommitted) }), '--json',
  );

  assert.equal(refused.exit, 4, JSON.stringify(refused.envelope));
  assert.equal(refused.envelope.state, 'unchanged');
  assert.equal(refused.envelope.error.code, 'adoption-revision-uncommitted');
  assert.equal(
    refused.envelope.error.message,
    'The adopted revision is not committed at Git HEAD.',
  );
  assert.deepEqual(refused.envelope.error.details, {
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
    requested_to_revision: sha256(uncommitted),
    observed_surface: 'git-head',
    observed_revision: fixture.editedRevision,
  });
});

test('adoption refuses a revision the operator did not commit into their own worktree', async () => {
  const fixture = await blockedByUnauthorizedRevision();
  // The committed bytes are the adopted ones, but the operator has kept a
  // further uncommitted change on top. Adopting would authorize a revision the
  // operator is not actually looking at.
  await writeFile(fixture.itemPath, Buffer.from(`${fixture.edited.toString('utf8')}\nUnstaged.\n`));

  const refused = run(
    fixture.root,
    'claim-adopt', '--ledger', fixture.ledger, '--input', await adoptRequest(fixture), '--json',
  );

  assert.equal(refused.exit, 4, JSON.stringify(refused.envelope));
  assert.equal(refused.envelope.error.code, 'adoption-revision-uncommitted');
  assert.equal(refused.envelope.error.details.observed_surface, 'working-tree');
});

test('adoption refuses bytes that leave the complete ledger invalid', async () => {
  const fixture = await blockedByUnauthorizedRevision({
    edit: (source) => source.replace(
      'depends_on: []',
      'depends_on: [wb_01KZBMBEZKPE7D15HKW9Q3GSZW]',
    ),
  });

  const refused = run(
    fixture.root,
    'claim-adopt', '--ledger', fixture.ledger, '--input', await adoptRequest(fixture), '--json',
  );

  assert.equal(refused.exit, 3, JSON.stringify(refused.envelope));
  assert.equal(refused.envelope.state, 'unchanged');
  assert.equal(refused.envelope.error.code, 'adoption-ledger-invalid');
  assert.equal(
    refused.envelope.error.message,
    'The complete ledger is invalid with the adopted revision.',
  );
  assert.equal(refused.envelope.error.details.item_id, ITEM_ID);
  assert.ok(refused.envelope.error.details.errors.length > 0);
});

test('adoption refuses on a ledger with no provisioned namespace', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-adoption-unbound-'));
  git(root, 'init', '-q');
  const ledger = path.join(root, 'ledger');
  await mkdir(ledger);
  const requestPath = path.join(root, 'adopt.json');
  await writeFile(requestPath, JSON.stringify({
    ledger_namespace: NAMESPACE,
    item_id: ITEM_ID,
    from_revision: `sha256:${'1'.repeat(64)}`,
    to_revision: `sha256:${'2'.repeat(64)}`,
    adopted_by: 'operator-lee',
  }));

  const refused = run(root, 'claim-adopt', '--ledger', ledger, '--input', requestPath, '--json');

  assert.equal(refused.exit, 6, JSON.stringify(refused.envelope));
  assert.equal(refused.envelope.error.code, 'claim-store-unavailable');
  assert.equal(refused.envelope.error.details.reason, 'ledger-namespace-unbound');
});

test('adoption refuses a request naming a namespace this endpoint does not serve', async () => {
  const fixture = await blockedByUnauthorizedRevision();

  const refused = run(
    fixture.root,
    'claim-adopt', '--ledger', fixture.ledger, '--input',
    await adoptRequest(fixture, { ledger_namespace: 'wbns_ffffffffffffffffffffffffffffffff' }), '--json',
  );

  assert.equal(refused.exit, 2, JSON.stringify(refused.envelope));
  assert.equal(refused.envelope.error.code, 'ledger-namespace-unbound');
});

test('adoption opens no fence hole: a later out-of-protocol edit still refuses', async () => {
  const fixture = await blockedByUnauthorizedRevision();
  assert.equal(
    run(fixture.root, 'claim-adopt', '--ledger', fixture.ledger, '--input', await adoptRequest(fixture), '--json').exit,
    0,
  );
  const drifted = Buffer.from(fixture.edited.toString('utf8').replace('priority: 1', 'priority: 3'));
  await writeFile(fixture.itemPath, drifted);
  git(fixture.root, 'add', 'ledger/item.md');
  git(fixture.root, 'commit', '-qm', 'Second out-of-protocol edit');

  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');

  assert.equal(verified.exit, 6, JSON.stringify(verified.envelope));
  assert.equal(verified.envelope.result.findings[0].reason, 'unauthorized-revision');
  assert.equal(verified.envelope.result.findings[0].expected_revision, fixture.editedRevision);
  assert.equal(verified.envelope.result.findings[0].actual_revision, sha256(drifted));
});

test('claim-adopt refuses a malformed request before touching the journal', async () => {
  const fixture = await blockedByUnauthorizedRevision();

  const refused = run(
    fixture.root,
    'claim-adopt', '--ledger', fixture.ledger, '--input',
    await adoptRequest(fixture, { adopted_by: '' }), '--json',
  );

  assert.equal(refused.exit, 2, JSON.stringify(refused.envelope));
  assert.equal(refused.envelope.namespace, 'work-claim');
  assert.equal(refused.envelope.command, 'claim-adopt');
  assert.equal(refused.envelope.error.code, 'invalid-request');
});
