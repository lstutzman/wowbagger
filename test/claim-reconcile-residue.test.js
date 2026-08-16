import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { claimReconcileLogPath } from '../src/claim-journal.js';

const CLI = fileURLToPath(new URL('../bin/wowbagger.js', import.meta.url));
const ITEM_ID = 'wb_01M01BFR000TXV22D7KZ6TQYH2';

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
  return result.stdout;
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

async function ledgerSnapshot(ledger) {
  const snapshot = new Map();
  const walk = async (directory, prefix) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name);
      const name = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await walk(child, name);
      else snapshot.set(name, sha256(await readFile(child)));
    }
  };
  await walk(ledger, '');
  return snapshot;
}

async function writeJson(file, value) {
  await writeFile(file, JSON.stringify(value));
  return file;
}

// A provisioned Git ledger holding one committed backlog item, with every
// coordinator surface already committed so the working tree starts clean.
async function committedLedger() {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-reconcile-residue-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Wowbagger Test');
  const ledger = path.join(root, 'ledger');
  await mkdir(ledger);
  const provisioned = run(root, 'provision', '--ledger', ledger, '--json');
  assert.equal(provisioned.exit, 0, JSON.stringify(provisioned.envelope));
  const namespace = provisioned.envelope.result.ledger_namespace;
  const created = run(root, 'create', '--ledger', ledger, '--input', await writeJson(
    path.join(root, 'create.json'),
    {
      id: ITEM_ID,
      item: {
        title: 'Residue item',
        kind: 'task',
        provenance: { source: 'test', recorded_at: '2026-08-16T00:00:00Z' },
        depends_on: [],
      },
      body: 'Residue\n',
    },
  ), '--json');
  assert.equal(created.exit, 0, JSON.stringify(created.envelope));
  const accepted = run(root, 'transition', '--ledger', ledger, '--input', await writeJson(
    path.join(root, 'accept.json'),
    {
      id: ITEM_ID,
      expected_revision: created.envelope.result.item.revision,
      to_status: 'backlog',
      date: '2026-08-16',
      decision: { summary: 'Accept the item.', rationale: 'Ready for work.' },
    },
  ), '--json');
  assert.equal(accepted.exit, 0, JSON.stringify(accepted.envelope));
  git(root, 'add', 'ledger');
  git(root, 'commit', '-qm', 'Commit the item and its coordinator surfaces');
  const verified = run(root, 'claim-verify', '--ledger', ledger, '--json');
  assert.equal(verified.exit, 0, JSON.stringify(verified.envelope));
  git(root, 'add', 'ledger');
  const staged = git(root, 'diff', '--cached', '--name-only');
  if (staged.trim() !== '') git(root, 'commit', '-qm', 'Record ledger reconciliation');
  assert.equal(git(root, 'status', '--porcelain', '--', 'ledger'), '');
  return { ledger, namespace, revision: accepted.envelope.result.item.revision, root };
}

test('a refused legacy transition leaves the ledger working tree byte-identical', async () => {
  const fixture = await committedLedger();
  const before = await ledgerSnapshot(fixture.ledger);

  const refused = run(fixture.root, 'transition', '--ledger', fixture.ledger, '--input', await writeJson(
    path.join(fixture.root, 'refused-transition.json'),
    {
      id: ITEM_ID,
      expected_revision: sha256(Buffer.from('stale')),
      to_status: 'done',
      date: '2026-08-16',
      decision: { summary: 'Complete the item.', rationale: 'The work is finished.' },
    },
  ), '--json');

  assert.equal(refused.exit, 4, JSON.stringify(refused.envelope));
  assert.equal(refused.envelope.ok, false);
  assert.equal(refused.envelope.state, 'unchanged');
  assert.equal(refused.envelope.error.code, 'revision-conflict');
  assert.deepEqual(await ledgerSnapshot(fixture.ledger), before);
  assert.equal(git(fixture.root, 'status', '--porcelain', '--', 'ledger'), '');
});

test('a refused legacy patch leaves the ledger working tree byte-identical', async () => {
  const fixture = await committedLedger();
  const before = await ledgerSnapshot(fixture.ledger);

  const refused = run(fixture.root, 'patch', '--ledger', fixture.ledger, '--input', await writeJson(
    path.join(fixture.root, 'refused-patch.json'),
    {
      id: ITEM_ID,
      expected_revision: sha256(Buffer.from('stale')),
      date: '2026-08-16',
      set: { priority: 1 },
    },
  ), '--json');

  assert.equal(refused.exit, 4, JSON.stringify(refused.envelope));
  assert.equal(refused.envelope.state, 'unchanged');
  assert.deepEqual(await ledgerSnapshot(fixture.ledger), before);
  assert.equal(git(fixture.root, 'status', '--porcelain', '--', 'ledger'), '');
});

test('a clean claim-verify leaves the ledger working tree byte-identical', async () => {
  const fixture = await committedLedger();
  const before = await ledgerSnapshot(fixture.ledger);

  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');

  assert.equal(verified.exit, 0, JSON.stringify(verified.envelope));
  assert.deepEqual(verified.envelope.result.findings, []);
  assert.deepEqual(await ledgerSnapshot(fixture.ledger), before);
  assert.equal(git(fixture.root, 'status', '--porcelain', '--', 'ledger'), '');
});

test('a successful legacy transition writes its mutation into the reconciliation log', async () => {
  const fixture = await committedLedger();
  const logPath = claimReconcileLogPath(fixture.ledger, fixture.namespace);
  const before = await readFile(logPath, 'utf8');

  const transitioned = run(fixture.root, 'transition', '--ledger', fixture.ledger, '--input', await writeJson(
    path.join(fixture.root, 'accepted-transition.json'),
    {
      id: ITEM_ID,
      expected_revision: fixture.revision,
      to_status: 'deferred',
      date: '2026-08-16',
      decision: { summary: 'Defer the item.', rationale: 'Other work comes first.' },
    },
  ), '--json');

  assert.equal(transitioned.exit, 0, JSON.stringify(transitioned.envelope));
  const after = await readFile(logPath, 'utf8');
  assert.notEqual(after, before);
  assert.match(after, /"type":"legacy-mutation-intent"/);
  assert.match(after, /"type":"legacy-mutation"/);
  assert.equal(
    git(fixture.root, 'status', '--porcelain', '--', 'ledger').trim().split('\n').length,
    2,
    'the item and its reconciliation log both belong to the post-mutation commit set',
  );
});

// The one documented exception: publish-claimed refusals that reach a durable
// terminal bind their operation identity forever, so the log records them.
test('a refused publish-claimed records its terminal outcome in the reconciliation log', async () => {
  const fixture = await committedLedger();
  const logPath = claimReconcileLogPath(fixture.ledger, fixture.namespace);
  const before = await readFile(logPath, 'utf8');
  const itemPath = path.join(fixture.ledger, `${ITEM_ID}.md`);
  const candidate = Buffer.from(
    (await readFile(itemPath, 'utf8')).replace('title: "Residue item"', 'title: "Unclaimed"'),
  );

  const refused = run(fixture.root, 'publish-claimed', '--ledger', fixture.ledger, '--input', await writeJson(
    path.join(fixture.root, 'unclaimed-publish.json'),
    {
      operation_id: 'pub_unclaimed_0001',
      ledger_namespace: fixture.namespace,
      item_id: ITEM_ID,
      claim_fence: {
        ledger_namespace: fixture.namespace,
        item_id: ITEM_ID,
        owner_id: 'agent-without-a-claim',
        epoch: '1',
      },
      expected_revision: fixture.revision,
      candidate_sha256: sha256(candidate),
      candidate_source_base64: candidate.toString('base64'),
    },
  ), '--json');

  assert.equal(refused.exit, 4, JSON.stringify(refused.envelope));
  assert.equal(refused.envelope.state, 'unchanged');
  assert.equal(refused.envelope.error.code, 'claim-fence-rejected');
  const after = await readFile(logPath, 'utf8');
  assert.notEqual(after, before);
  assert.match(after, /"type":"publish-final"/);
  assert.match(after, /"code":"claim-fence-rejected"/);
});

test('a dirty reconciliation log never refuses the next mutation', async () => {
  const fixture = await committedLedger();
  const logPath = claimReconcileLogPath(fixture.ledger, fixture.namespace);
  await writeFile(logPath, `${await readFile(logPath, 'utf8')}\nhand written residue\n`);
  assert.notEqual(git(fixture.root, 'status', '--porcelain', '--', 'ledger'), '');

  const patched = run(fixture.root, 'patch', '--ledger', fixture.ledger, '--input', await writeJson(
    path.join(fixture.root, 'after-residue.json'),
    {
      id: ITEM_ID,
      expected_revision: fixture.revision,
      date: '2026-08-16',
      set: { priority: 1 },
    },
  ), '--json');

  assert.equal(patched.exit, 0, JSON.stringify(patched.envelope));
});

test('an uncommitted item, not reconciliation-log residue, refuses the next mutation', async () => {
  const fixture = await committedLedger();
  const secondId = 'wb_01M01BFR000TXV22D7KZ6TQYH3';
  const created = run(fixture.root, 'create', '--ledger', fixture.ledger, '--input', await writeJson(
    path.join(fixture.root, 'second-create.json'),
    {
      id: secondId,
      item: {
        title: 'Second item',
        kind: 'task',
        provenance: { source: 'test', recorded_at: '2026-08-16T00:00:00Z' },
        depends_on: [],
      },
      body: 'Second\n',
    },
  ), '--json');
  assert.equal(created.exit, 0, JSON.stringify(created.envelope));
  const accepted = run(fixture.root, 'transition', '--ledger', fixture.ledger, '--input', await writeJson(
    path.join(fixture.root, 'second-accept.json'),
    {
      id: secondId,
      expected_revision: created.envelope.result.item.revision,
      to_status: 'backlog',
      date: '2026-08-16',
      decision: { summary: 'Accept the item.', rationale: 'Ready for work.' },
    },
  ), '--json');
  assert.equal(accepted.exit, 0, JSON.stringify(accepted.envelope));

  const blocked = run(fixture.root, 'patch', '--ledger', fixture.ledger, '--input', await writeJson(
    path.join(fixture.root, 'blocked-patch.json'),
    {
      id: ITEM_ID,
      expected_revision: fixture.revision,
      date: '2026-08-16',
      set: { priority: 1 },
    },
  ), '--json');

  assert.equal(blocked.exit, 6, JSON.stringify(blocked.envelope));
  assert.equal(blocked.envelope.error.code, 'claim-store-unavailable');
  assert.equal(blocked.envelope.error.details.reason, 'publication-reconciliation-required');
  assert.deepEqual(
    blocked.envelope.error.details.findings.map((finding) => [finding.item_id, finding.reason]),
    [[secondId, 'git-finalization-required']],
  );

  // Committing the item alone clears the refusal; the reconciliation log stays
  // dirty throughout, so it is not the surface the refusal runs through.
  git(fixture.root, 'add', `ledger/${secondId}.md`);
  git(fixture.root, 'commit', '-qm', 'Commit the second item only');
  assert.match(
    git(fixture.root, 'status', '--porcelain', '--', 'ledger'),
    /reconcile-/,
  );
  const patched = run(fixture.root, 'patch', '--ledger', fixture.ledger, '--input', path.join(fixture.root, 'blocked-patch.json'), '--json');
  assert.equal(patched.exit, 0, JSON.stringify(patched.envelope));
});
