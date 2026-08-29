// test/create-journal-asymmetry.test.js
//
// Every mutation is journal-visible, `create` included. These vectors pin both
// halves of what that buys and what it costs at the public writer surface.
//
// The benefit: an allocation is fenced from the item's birth. A stale sibling
// worktree that cannot see a published item cannot hand that item's number out
// again, and an out-of-protocol overwrite of a freshly created item refuses
// with `unauthorized-revision` without waiting for a first transition.
//
// The cost: a create reconciles the whole repository, so an unauthorized
// revision on any coordinated item refuses it. A transition or patch still
// reconciles only its own item, which is why an unrelated guarded mutation
// still commits in the very checkout whose create just refused.
//
// Synchronize-and-retry recovery and the create phase profile are item #181
// Task 5; nothing here asserts them.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { claimJournalPath, replayClaimJournal } from '../src/claim-journal.js';

const CLI = fileURLToPath(new URL('../bin/wowbagger.js', import.meta.url));

function run(cwd, ...argumentsList) {
  const result = spawnSync(process.execPath, [CLI, ...argumentsList], {
    cwd,
    encoding: 'utf8',
  });
  return { envelope: JSON.parse(result.stdout), exit: result.status };
}

function git(root, ...argumentsList) {
  const result = spawnSync('git', argumentsList, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

const NAMESPACE = 'wbns_0123456789abcdef0123456789abcdef';
const SEED_ID = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';
const FIRST_ID = 'wb_01M01BFR000TXV22D7KZ6TQYH2';
const SECOND_ID = 'wb_01M01BFR000TXV22D7KZ6TQYH3';

// A provisioned single-item repository plus a sibling worktree branched from
// the same commit. The sibling shares the Git common directory, and therefore
// the claim journal, but not the checkout.
async function twoWorktreeRepository() {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-create-asymmetry-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Wowbagger Test');
  const ledger = path.join(root, 'ledger');
  await mkdir(path.join(ledger, '.wowbagger'), { recursive: true });
  await writeFile(path.join(ledger, '.wowbagger', 'namespace'), `${NAMESPACE}\n`);
  await writeFile(path.join(ledger, 'item.md'), `---\nschema_version: 2\nid: ${SEED_ID}\nnumber: 1\ntitle: "Seed"\nkind: task\nstatus: backlog\ncreated: 2026-08-06\nupdated: 2026-08-11\nprovenance:\n  source: "repository-backlog"\n  recorded_at: "2026-08-11T00:00:00Z"\ndepends_on: []\nrelated: []\ndecisions: []\n---\nSeed\n`);
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'Provisioned ledger');
  const siblingRoot = `${root}-sibling`;
  git(root, 'worktree', 'add', '-qb', 'sibling', siblingRoot);
  return { ledger, root, siblingLedger: path.join(siblingRoot, 'ledger'), siblingRoot };
}

async function createRequest(directory, name, id) {
  const requestPath = path.join(directory, name);
  await writeFile(requestPath, JSON.stringify({
    id,
    item: {
      title: 'New item',
      kind: 'task',
      provenance: { source: 'test', recorded_at: '2026-08-16T00:00:00Z' },
      depends_on: [],
    },
    body: 'New item\n',
  }));
  return requestPath;
}

// triage -> backlog is an accept and carries decision evidence.
// backlog -> in-progress is not a decision edge and must carry none.
async function transitionRequest(directory, name, id, expectedRevision, toStatus) {
  const requestPath = path.join(directory, name);
  await writeFile(requestPath, JSON.stringify({
    id,
    expected_revision: expectedRevision,
    to_status: toStatus,
    date: '2026-08-16',
    ...(toStatus === 'backlog' ? {
      decision: {
        summary: 'Accept the new item.',
        rationale: 'The new item is ready for work.',
      },
    } : {}),
  }));
  return requestPath;
}

// The hostile write: a direct filesystem overwrite of a published item, with
// no command and therefore no journal entry behind it.
async function overwriteOutsideTheProtocol(ledger, id) {
  const itemPath = path.join(ledger, `${id}.md`);
  const published = await readFile(itemPath, 'utf8');
  await writeFile(itemPath, published.replace('title: "New item"', 'title: "Hijacked"'));
}

// Both worktrees write one journal in the shared Git common directory. Reading
// it back through the replay path is also the grammar check: an entry the
// coordinator emitted that replay rejects throws here.
async function replayedEntries(root) {
  const { entries } = await replayClaimJournal(
    claimJournalPath(path.join(root, '.git'), NAMESPACE),
    NAMESPACE,
  );
  return entries;
}

test('an overwrite of a created, committed item refuses from the item\'s birth', async () => {
  const fixture = await twoWorktreeRepository();
  const created = run(
    fixture.root, 'create', '--ledger', fixture.ledger,
    '--input', await createRequest(fixture.root, 'create-first.json', FIRST_ID), '--json',
  );
  assert.equal(created.exit, 0, JSON.stringify(created.envelope));
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Add the created item');

  await overwriteOutsideTheProtocol(fixture.ledger, FIRST_ID);

  // Create is journal-visible from the item's birth, so the coordinator
  // already expects the revision it published and reports the overwrite.
  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');
  assert.equal(verified.exit, 6, JSON.stringify(verified.envelope));
  const [finding] = verified.envelope.result.findings;
  assert.equal(verified.envelope.result.findings.length, 1);
  assert.equal(finding.code, 'stale-write-detected');
  assert.equal(finding.item_id, FIRST_ID);
  assert.equal(finding.reason, 'unauthorized-revision');
  assert.equal(finding.expected_revision, created.envelope.result.item.revision);

  const next = run(
    fixture.root, 'create', '--ledger', fixture.ledger,
    '--input', await createRequest(fixture.root, 'create-second.json', SECOND_ID), '--json',
  );
  assert.equal(next.exit, 6, JSON.stringify(next.envelope));
  assert.equal(next.envelope.state, 'unchanged');
  assert.equal(next.envelope.error.code, 'claim-store-unavailable');
  assert.equal(next.envelope.error.details.reason, 'publication-reconciliation-required');
  await assert.rejects(
    access(path.join(fixture.ledger, `${SECOND_ID}.md`)),
    { code: 'ENOENT' },
  );
});

test('a create that authorizes but cannot publish records a replayable abort', async () => {
  const fixture = await twoWorktreeRepository();
  // The lock directory is the only thing create writes outside the item path,
  // so it exists before the ledger directory goes read-only. The create then
  // reaches publication and fails there, having already authorized the
  // allocation, which is the only public route to a create abort.
  await mkdir(path.join(fixture.ledger, '.wowbagger-locks'), { recursive: true });
  const input = await createRequest(fixture.root, 'create-first.json', FIRST_ID);
  await chmod(fixture.ledger, 0o555);
  let refused;
  try {
    refused = run(fixture.root, 'create', '--ledger', fixture.ledger, '--input', input, '--json');
  } finally {
    await chmod(fixture.ledger, 0o755);
  }
  assert.equal(refused.exit, 6, JSON.stringify(refused.envelope));
  assert.equal(refused.envelope.state, 'unchanged');
  assert.equal(refused.envelope.error.code, 'operation-failed');
  assert.equal(refused.envelope.error.details.operation, 'prepare-temporary');
  await assert.rejects(
    access(path.join(fixture.ledger, `${FIRST_ID}.md`)),
    { code: 'ENOENT' },
  );

  // The abort resolves the intent it opened, names create as its command, and
  // names no predecessor revision, because a create has none.
  const entries = (await replayedEntries(fixture.root))
    .filter((entry) => entry.item_id === FIRST_ID);
  assert.equal(entries.length, 2);
  const [intent, abort] = entries;
  assert.equal(intent.type, 'legacy-mutation-intent');
  assert.equal(intent.command, 'create-v1');
  assert.equal(intent.expected_revision, null);
  assert.equal(abort.type, 'legacy-mutation-abort');
  assert.equal(abort.command, 'create-v1');
  assert.equal(abort.observed_revision, null);
  assert.equal(abort.attempt_id, intent.attempt_id);
});

test('the same overwrite refuses once the item has a journal-visible transition', async () => {
  const fixture = await twoWorktreeRepository();
  const created = run(
    fixture.root, 'create', '--ledger', fixture.ledger,
    '--input', await createRequest(fixture.root, 'create-first.json', FIRST_ID), '--json',
  );
  assert.equal(created.exit, 0, JSON.stringify(created.envelope));
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Add the created item');

  // The first journal-visible mutation. From here the journal expects a
  // revision for this item, and the commit puts that revision in Git HEAD.
  const transitioned = run(
    fixture.root, 'transition', '--ledger', fixture.ledger,
    '--input', await transitionRequest(
      fixture.root, 'transition-first.json', FIRST_ID,
      created.envelope.result.item.revision, 'backlog',
    ),
    '--json',
  );
  assert.equal(transitioned.exit, 0, JSON.stringify(transitioned.envelope));
  const authorizedRevision = transitioned.envelope.result.item.revision;
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Transition the created item');
  assert.equal(run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json').exit, 0);

  await overwriteOutsideTheProtocol(fixture.ledger, FIRST_ID);

  const blocked = run(
    fixture.root, 'create', '--ledger', fixture.ledger,
    '--input', await createRequest(fixture.root, 'create-second.json', SECOND_ID), '--json',
  );

  assert.equal(blocked.exit, 6, JSON.stringify(blocked.envelope));
  assert.equal(blocked.envelope.state, 'unchanged');
  assert.equal(blocked.envelope.error.code, 'claim-store-unavailable');
  assert.equal(blocked.envelope.error.details.reason, 'publication-reconciliation-required');
  const [finding] = blocked.envelope.error.details.findings;
  assert.equal(blocked.envelope.error.details.findings.length, 1);
  assert.equal(finding.code, 'stale-write-detected');
  assert.equal(finding.item_id, FIRST_ID);
  assert.equal(finding.expected_revision, authorizedRevision);
  assert.notEqual(finding.actual_revision, authorizedRevision);
  assert.equal(finding.observed_surface, 'working-tree');
  assert.equal(finding.reason, 'unauthorized-revision');
  assert.equal(finding.expected_path, `${FIRST_ID}.md`);
  assert.equal(
    finding.remediation,
    `Restore the authorized revision at ${FIRST_ID}.md, then run claim-verify; that discards the edit. Or adopt the committed revision of ${FIRST_ID}.md with claim-adopt, then run claim-verify; that keeps the edit.`,
  );
});

test('a journaled create blocks stale sibling allocation but not an unrelated transition', async () => {
  const fixture = await twoWorktreeRepository();
  const created = run(
    fixture.root, 'create', '--ledger', fixture.ledger,
    '--input', await createRequest(fixture.root, 'create-first.json', FIRST_ID), '--json',
  );
  assert.equal(created.exit, 0, JSON.stringify(created.envelope));
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Add the created item');
  // The sibling checkout cannot see that commit, so its next number would
  // duplicate the one the root worktree already published.

  const siblingCreate = run(
    fixture.siblingRoot, 'create', '--ledger', fixture.siblingLedger,
    '--input', await createRequest(fixture.siblingRoot, 'create-sibling.json', SECOND_ID), '--json',
  );
  assert.equal(siblingCreate.exit, 6, JSON.stringify(siblingCreate.envelope));
  assert.equal(siblingCreate.envelope.namespace, 'ledger-mutation');
  assert.equal(siblingCreate.envelope.command, 'create-v1');
  assert.equal(siblingCreate.envelope.state, 'unchanged');
  assert.equal(siblingCreate.envelope.error.code, 'claim-store-unavailable');
  assert.equal(
    siblingCreate.envelope.error.details.reason,
    'publication-reconciliation-required',
  );
  await assert.rejects(
    access(path.join(fixture.siblingLedger, `${SECOND_ID}.md`)),
    { code: 'ENOENT' },
  );
  const finding = siblingCreate.envelope.error.details.findings.find(
    (entry) => entry.item_id === FIRST_ID,
  );
  assert.equal(finding.reason, 'worktree-synchronization-required');
  assert.equal(finding.code, 'stale-write-detected');
  assert.equal(finding.expected_revision, created.envelope.result.item.revision);
  assert.equal(finding.expected_path, `${FIRST_ID}.md`);
  assert.equal(finding.owner_unavailable, true);
  assert.equal(
    finding.remediation,
    `Ownership of ${FIRST_ID}.md revision ${created.envelope.result.item.revision} cannot be established from reachable refs; inspect reachable or dangling commits, restore or explicitly adopt reviewed bytes, then run claim-verify.`,
  );

  // The refusal names no attempt: reconciliation may append its clock, but no
  // entry and no file speaks for the second identity. The pair the root's
  // create emitted replays, which is what the sibling's refusal reasoned from.
  const entries = await replayedEntries(fixture.root);
  assert.deepEqual(entries.filter((entry) => entry.item_id === SECOND_ID), []);
  const first = entries.filter((entry) => entry.item_id === FIRST_ID);
  assert.equal(first.length, 2);
  const [intent, terminal] = first;
  assert.equal(intent.type, 'legacy-mutation-intent');
  assert.equal(intent.command, 'create-v1');
  assert.equal(intent.expected_revision, null);
  assert.equal(intent.candidate_revision, created.envelope.result.item.revision);
  assert.equal(intent.item_path, `${FIRST_ID}.md`);
  assert.equal(terminal.type, 'legacy-mutation');
  assert.equal(terminal.command, 'create-v1');
  assert.equal(terminal.attempt_id, intent.attempt_id);
  assert.equal(terminal.committed_revision, created.envelope.result.item.revision);

  const seedRevision = run(
    fixture.siblingRoot, 'inspect', '--ledger', fixture.siblingLedger,
    '--number', '1', '--json',
  ).envelope.result.item.revision;
  const siblingTransition = run(
    fixture.siblingRoot, 'transition', '--ledger', fixture.siblingLedger,
    '--input', await transitionRequest(
      fixture.siblingRoot, 'transition-sibling.json', SEED_ID, seedRevision, 'in-progress',
    ),
    '--json',
  );
  assert.equal(siblingTransition.exit, 0, JSON.stringify(siblingTransition.envelope));
  assert.equal(siblingTransition.envelope.state, 'committed');
});

test('a stale revision of an item this checkout holds does not block create', async () => {
  const fixture = await twoWorktreeRepository();
  // The root worktree publishes a new revision of the seed item and commits.
  // The sibling still holds the seed at its previous revision, so its view of
  // that item is stale. Its number is not: an item's number is immutable, and
  // the sibling holds the item, so the allocation it reads is complete.
  const seedRevision = run(
    fixture.root, 'inspect', '--ledger', fixture.ledger, '--number', '1', '--json',
  ).envelope.result.item.revision;
  const transitioned = run(
    fixture.root, 'transition', '--ledger', fixture.ledger,
    '--input', await transitionRequest(
      fixture.root, 'transition-seed.json', SEED_ID, seedRevision, 'in-progress',
    ),
    '--json',
  );
  assert.equal(transitioned.exit, 0, JSON.stringify(transitioned.envelope));
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Transition the seed item');

  const siblingCreate = run(
    fixture.siblingRoot, 'create', '--ledger', fixture.siblingLedger,
    '--input', await createRequest(fixture.siblingRoot, 'create-sibling.json', SECOND_ID), '--json',
  );
  assert.equal(siblingCreate.exit, 0, JSON.stringify(siblingCreate.envelope));
  assert.equal(siblingCreate.envelope.state, 'committed');
  assert.equal(siblingCreate.envelope.result.item.core.number, 2);
});
