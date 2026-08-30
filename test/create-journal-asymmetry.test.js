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
// The escape: a refusal spends neither the request identity nor a number.
// Synchronize the stale sibling's Git, let `claim-verify` clear, and the very
// same create request commits the next number. Two live processes cannot both
// hold the namespace lock, so the one that arrives second refuses instead of
// allocating beside the first.
//
// The create phase profile is `test/create-phase-profile.test.js`.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  access, chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { claimJournalPath, replayClaimJournal } from '../src/claim-journal.js';

const CLI = fileURLToPath(new URL('../bin/wowbagger.js', import.meta.url));
// The scenario runner is the only way to reach a bounded test checkpoint. It
// calls the same public `runCli` this file's `run` calls; the checkpoint is a
// module argument no CLI flag can supply.
const TEST_CLI = fileURLToPath(new URL('./mutation-runner.js', import.meta.url));

// Every wait below is a condition against a wall clock. This ceiling is what a
// stalled child is allowed to cost, never a delay a passing run pays.
const WAIT_DEADLINE_MS = 30_000;

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
// A well-formed reference to an item no ledger here holds.
const ABSENT_ID = 'wb_01M01BFR000TXV22D7KZ6TQYH4';

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

// A mutation in its own process group. The group is what teardown signals, so
// a checkpoint this test never releases, and anything the child itself
// started, dies with the test rather than outliving it.
function spawnMutation(cwd, scenario, argumentsList) {
  const child = spawn(process.execPath, [scenario ? TEST_CLI : CLI, ...argumentsList], {
    cwd,
    detached: true,
    env: scenario ? { ...process.env, WOWBAGGER_TEST_SCENARIO: scenario } : process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  const closed = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (status, signal) => resolve({
      signal,
      status,
      stderr: Buffer.concat(stderr).toString('utf8'),
      stdout: Buffer.concat(stdout).toString('utf8'),
    }));
  });
  return { child, closed };
}

// Signalling the negated PID reaches the whole group. `ESRCH` is the answer
// that the group is already gone, which is the only other outcome allowed.
function signalGroup(child, signal) {
  try {
    process.kill(-child.pid, signal);
    return true;
  } catch (error) {
    assert.equal(error.code, 'ESRCH', `signalling ${child.pid} failed: ${error.code}`);
    return false;
  }
}

// The child's envelope, or its death at the deadline. A run that never returns
// is killed rather than allowed to hold the suite open, and the kill is a
// named failure instead of a timeout with no explanation.
async function settledMutation(handle) {
  const timer = setTimeout(() => signalGroup(handle.child, 'SIGKILL'), WAIT_DEADLINE_MS);
  let result;
  try {
    result = await handle.closed;
  } finally {
    clearTimeout(timer);
  }
  assert.equal(result.signal, null, `child ${handle.child.pid} was killed at the deadline`);
  assert.equal(result.stderr, '');
  return { envelope: JSON.parse(result.stdout), exit: result.status };
}

// Teardown, and the proof of it: every group is signalled, every child is
// reaped, and no group answers afterwards.
async function shutDownMutations(handles) {
  for (const handle of handles) signalGroup(handle.child, 'SIGKILL');
  await Promise.all(handles.map((handle) => handle.closed));
  for (const handle of handles) {
    assert.equal(
      signalGroup(handle.child, 0),
      false,
      `process group ${handle.child.pid} outlived the test`,
    );
  }
}

// Condition-based, never a fixed sleep: the marker is written under the lock
// the successor has to find held, so its existence is the only signal that
// starting the successor now proves anything.
async function waitForMarker(file) {
  const deadline = Date.now() + WAIT_DEADLINE_MS;
  while (Date.now() < deadline) {
    try {
      await lstat(file);
      return;
    } catch (error) {
      assert.equal(error.code, 'ENOENT');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`Timed out waiting for ${path.basename(file)}`);
}

// The number every item file in one checkout carries. Two rows for one number
// across the two checkouts is the duplicate allocation this fence prevents.
async function publishedNumbers(ledger) {
  const names = (await readdir(ledger)).filter((name) => name.endsWith('.md'));
  const numbers = await Promise.all(names.map(async (name) => {
    const source = await readFile(path.join(ledger, name), 'utf8');
    return Number(/^number: (\d+)$/mu.exec(source)[1]);
  }));
  return numbers.sort((left, right) => left - right);
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

test('a create that authorizes but cannot publish records a replayable abort', { skip: process.platform === 'win32' && 'Windows does not enforce POSIX mode bits' }, async () => {
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

test('an uncommitted create blocks the next create with the commit remedy', async () => {
  const fixture = await twoWorktreeRepository();
  const created = run(
    fixture.root, 'create', '--ledger', fixture.ledger,
    '--input', await createRequest(fixture.root, 'create-first.json', FIRST_ID), '--json',
  );
  assert.equal(created.exit, 0, JSON.stringify(created.envelope));

  // Git holds no revision at all for the new item, so its allocation exists
  // only in this working tree. Every mutation is committed before the next one
  // begins, and create is no exception.
  const next = run(
    fixture.root, 'create', '--ledger', fixture.ledger,
    '--input', await createRequest(fixture.root, 'create-second.json', SECOND_ID), '--json',
  );
  assert.equal(next.exit, 6, JSON.stringify(next.envelope));
  assert.equal(next.envelope.namespace, 'ledger-mutation');
  assert.equal(next.envelope.command, 'create-v1');
  assert.equal(next.envelope.state, 'unchanged');
  assert.equal(next.envelope.error.code, 'claim-store-unavailable');
  assert.equal(next.envelope.error.details.reason, 'publication-reconciliation-required');
  assert.deepEqual(next.envelope.error.details.findings, [{
    code: 'stale-write-detected',
    item_id: FIRST_ID,
    actual_revision: null,
    expected_revision: created.envelope.result.item.revision,
    observed_surface: 'git-head',
    reason: 'git-finalization-required',
    expected_path: `${FIRST_ID}.md`,
    remediation: `Commit ${FIRST_ID}.md in Git, then run claim-verify.`,
  }]);
  await assert.rejects(
    access(path.join(fixture.ledger, `${SECOND_ID}.md`)),
    { code: 'ENOENT' },
  );

  // The commit is the whole remedy: nothing else changes, and the next create
  // proceeds.
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Add the created item');
  const afterCommit = run(
    fixture.root, 'create', '--ledger', fixture.ledger,
    '--input', await createRequest(fixture.root, 'create-second.json', SECOND_ID), '--json',
  );
  assert.equal(afterCommit.exit, 0, JSON.stringify(afterCommit.envelope));
  assert.equal(afterCommit.envelope.state, 'committed');
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

// A refusal the create would have returned anyway must leave no attempt behind.
// The request shape is well formed, so parsing accepts it; only whole-ledger
// candidate validation can see that the dependency resolves to nothing. That
// puts the check on the far side of request parsing and the near side of
// `authorize`, and this vector is what holds it there.
test('a candidate-invalid create publishes no item and opens no intent', async () => {
  const fixture = await twoWorktreeRepository();
  const before = await replayedEntries(fixture.root);
  const requestPath = path.join(fixture.root, 'create-dangling-dependency.json');
  await writeFile(requestPath, JSON.stringify({
    id: FIRST_ID,
    item: {
      title: 'New item',
      kind: 'task',
      provenance: { source: 'test', recorded_at: '2026-08-16T00:00:00Z' },
      depends_on: [ABSENT_ID],
    },
    body: 'New item\n',
  }));

  const refused = run(
    fixture.root, 'create', '--ledger', fixture.ledger, '--input', requestPath, '--json',
  );

  // Exit 2 is the request-domain refusal: the ledger is untouched and the
  // caller's own bytes are what has to change.
  assert.equal(refused.exit, 2, JSON.stringify(refused.envelope));
  assert.equal(refused.envelope.state, 'unchanged');
  assert.equal(refused.envelope.error.code, 'candidate-invalid');
  assert.equal(
    refused.envelope.error.details.validation_errors.some(
      (entry) => entry.code === 'unresolved-dependency',
    ),
    true,
    JSON.stringify(refused.envelope.error.details.validation_errors),
  );
  await assert.rejects(
    access(path.join(fixture.ledger, `${FIRST_ID}.md`)),
    { code: 'ENOENT' },
  );

  // Nothing in the journal speaks for the requested identity: no intent, and
  // therefore no terminal or abort resolving one. Reconciliation may still
  // append its own clock, which names no item.
  const after = await replayedEntries(fixture.root);
  assert.deepEqual(after.filter((entry) => entry.item_id === FIRST_ID), []);
  assert.equal(
    after.some((entry) => entry.type === 'legacy-mutation-intent'
      && entry.item_id === FIRST_ID),
    false,
  );
  assert.deepEqual(
    after.slice(before.length).map((entry) => entry.type).filter((type) => type !== 'clock'),
    [],
  );
});

// The refusal is a barrier, not a consumption. The stale sibling's request is
// well formed and its identity is untouched by being refused, so once the
// checkout can see what it was missing the very same bytes commit — at the
// next number, not at the number the refusal was protecting.
//
// This is the whole escape hatch the fence owes its caller: synchronize Git,
// clear `claim-verify`, retry. Nothing here is a new request.
test('a refused stale create commits the same request after synchronization clears it', async () => {
  const fixture = await twoWorktreeRepository();
  const branch = git(fixture.root, 'branch', '--show-current');
  const created = run(
    fixture.root, 'create', '--ledger', fixture.ledger,
    '--input', await createRequest(fixture.root, 'create-first.json', FIRST_ID), '--json',
  );
  assert.equal(created.exit, 0, JSON.stringify(created.envelope));
  assert.equal(created.envelope.result.item.core.number, 2);
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Add the created item and its log');

  // One request path, used twice: the refusal and the success are the same
  // bytes and the same request ID, which is what makes this a retry.
  const requestPath = await createRequest(fixture.siblingRoot, 'create-sibling.json', SECOND_ID);
  const refused = run(
    fixture.siblingRoot, 'create', '--ledger', fixture.siblingLedger,
    '--input', requestPath, '--json',
  );
  assert.equal(refused.exit, 6, JSON.stringify(refused.envelope));
  assert.equal(refused.envelope.state, 'unchanged');
  assert.equal(refused.envelope.error.code, 'claim-store-unavailable');
  assert.equal(refused.envelope.error.details.reason, 'publication-reconciliation-required');
  await assert.rejects(
    access(path.join(fixture.siblingLedger, `${SECOND_ID}.md`)),
    { code: 'ENOENT' },
  );

  // Reconciliation projects the shared journal into a tracked log, and this
  // stale checkout's refused run left one behind as an untracked file. Git
  // refuses to overwrite an untracked path with a merged one, and the derived
  // copy is the one that gives way: the published log is authoritative and the
  // next command in this checkout rewrites it regardless.
  await rm(path.join(fixture.siblingLedger, '.wowbagger', `reconcile-${NAMESPACE}.md`));
  git(fixture.siblingRoot, 'merge', '-q', '--no-edit', branch);
  const verified = run(
    fixture.siblingRoot, 'claim-verify', '--ledger', fixture.siblingLedger, '--json',
  );
  assert.equal(verified.exit, 0, JSON.stringify(verified.envelope));
  assert.deepEqual(verified.envelope.result.findings, []);

  const retried = run(
    fixture.siblingRoot, 'create', '--ledger', fixture.siblingLedger,
    '--input', requestPath, '--json',
  );

  assert.equal(retried.exit, 0, JSON.stringify(retried.envelope));
  assert.equal(retried.envelope.state, 'committed');
  assert.equal(retried.envelope.result.item.id, SECOND_ID);
  // Three, not two: the refusal protected the number the root worktree had
  // already published, and spent nothing of its own.
  assert.equal(retried.envelope.result.item.core.number, 3);
  assert.deepEqual(await publishedNumbers(fixture.siblingLedger), [1, 2, 3]);

  const validated = run(
    fixture.siblingRoot, 'validate', '--ledger', fixture.siblingLedger, '--json',
  );
  assert.equal(validated.exit, 0, JSON.stringify(validated.envelope));
  assert.deepEqual(validated.envelope, { valid: true, errors: [] });
});

// Two live processes, and the overlap is forced rather than hoped for: the
// first is paused holding the namespace lock, and the marker it writes under
// that lock is the condition the second waits on. Started together instead,
// they would collide only when the machine chose to interleave them, and a
// correct engine would fail the assertion on a quiet box (ledger item #106).
test('a create refuses while a sibling worktree holds the namespace lock', async () => {
  const fixture = await twoWorktreeRepository();
  const token = 'create-contention';
  const acquired = path.join(fixture.ledger, `.wowbagger-test-${token}-acquired`);
  const allowSuccessor = path.join(fixture.ledger, `.wowbagger-test-${token}-allow-successor`);
  // Both requests exist before either process starts: the successor must not
  // pay for its own setup inside the window the holder is paused in.
  const holderRequest = await createRequest(fixture.root, 'create-holder.json', FIRST_ID);
  const arrivalRequest = await createRequest(fixture.siblingRoot, 'create-arrival.json', SECOND_ID);

  const holder = spawnMutation(fixture.root, `pause-after-lock-acquired:${token}`, [
    'create', '--ledger', fixture.ledger, '--input', holderRequest, '--json',
  ]);
  const started = [holder];
  try {
    await waitForMarker(acquired);
    const arrival = spawnMutation(fixture.siblingRoot, null, [
      'create', '--ledger', fixture.siblingLedger, '--input', arrivalRequest, '--json',
    ]);
    started.push(arrival);

    const refused = await settledMutation(arrival);

    // Exact, not either documented reason: the marker proves the holder still
    // owns the lock, so the successor can only have been refused by it.
    assert.equal(refused.exit, 6, JSON.stringify(refused.envelope));
    assert.equal(refused.envelope.namespace, 'ledger-mutation');
    assert.equal(refused.envelope.command, 'create-v1');
    assert.equal(refused.envelope.state, 'unchanged');
    assert.equal(refused.envelope.error.code, 'claim-store-unavailable');
    assert.equal(refused.envelope.error.details.reason, 'claim-store-locked');
    await assert.rejects(
      access(path.join(fixture.siblingLedger, `${SECOND_ID}.md`)),
      { code: 'ENOENT' },
    );

    await writeFile(allowSuccessor, 'continue\n');
    const held = await settledMutation(holder);

    assert.equal(held.exit, 0, JSON.stringify(held.envelope));
    assert.equal(held.envelope.state, 'committed');
    assert.equal(held.envelope.result.item.core.number, 2);
    // One item and one number two across the pair. The refusal left the
    // sibling exactly as it found it.
    assert.deepEqual(await publishedNumbers(fixture.ledger), [1, 2]);
    assert.deepEqual(await publishedNumbers(fixture.siblingLedger), [1]);
    assert.deepEqual(
      (await replayedEntries(fixture.root)).filter((entry) => entry.item_id === SECOND_ID),
      [],
    );
  } finally {
    await shutDownMutations(started);
  }
});
