// test/patch-extensions-consumer-trap.test.js
//
// The field trap item #118 exists to kill. A consumer's own identifier field
// rides a permitted extension member, and correcting a wrong one — or adding a
// missing one — had no repair verb at all. On a provisioned ledger the
// hand-edit that filled the gap is a stale write: the next guarded mutation
// refuses exit 6 with an `unauthorized-revision` finding, and every later
// mutation stays blocked until an operator reconciles by hand.
//
// Both halves are pinned here, for both the wrong and the missing case, so the
// in-band correction is not a tautology.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const CLI = fileURLToPath(new URL('../bin/wowbagger.js', import.meta.url));
const ITEM_ID = 'wb_01M01BFR000TXV22D7KZ6TQYH2';
const NEXT_ID = 'wb_01M01BFR000TXV22D7KZ6TQYH3';
const WRONG_CARD = 'PC-1470';
const RIGHT_CARD = 'PC-1475';
const DECLARATION = `${JSON.stringify({
  extensions_version: 1,
  members: { external_id: 'string' },
}, null, 2)}\n`;
const TAGS_DECLARATION = '{"extensions_version":1,"members":{"tags":"string-list"}}\n';

function run(cwd, ...argumentsList) {
  const result = spawnSync(process.execPath, [CLI, ...argumentsList], { cwd, encoding: 'utf8' });
  return { envelope: JSON.parse(result.stdout), exit: result.status };
}

function git(root, ...argumentsList) {
  const result = spawnSync('git', argumentsList, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function requestFile(root, name, request) {
  const file = path.join(root, name);
  await writeFile(file, JSON.stringify(request));
  return file;
}

function itemPath(ledger) {
  return path.join(ledger, `${ITEM_ID}.md`);
}

function frontmatter(source) {
  return parse(source.split('\n---\n')[0].replace(/^---\n/, ''), { schema: 'core' });
}

// A provisioned ledger that declares exactly one patchable extension member,
// committed like every other piece of ledger structure.
async function provisionedRepository({ declare = true } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-extensions-trap-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Wowbagger Test');
  const ledger = path.join(root, 'ledger');
  await mkdir(ledger);
  const provisioned = run(root, 'provision', '--ledger', ledger, '--json');
  assert.equal(provisioned.exit, 0, JSON.stringify(provisioned.envelope));
  if (declare) {
    await writeFile(path.join(ledger, '.wowbagger', 'extensions.json'), DECLARATION);
  }
  git(root, 'add', '.');
  git(root, 'commit', '-qm', declare
    ? 'Provision the ledger and declare its extension members'
    : 'Provision the ledger');
  return { ledger, root };
}

// A mirrored item, accepted into the backlog so the claim journal knows its
// authorized revision. `item` carries whatever extension members the case
// needs, because create preserves them and nothing else can write them.
async function mirroredItem(fixture, item) {
  const created = run(fixture.root, 'create', '--ledger', fixture.ledger, '--input',
    await requestFile(fixture.root, 'create.json', {
      id: ITEM_ID,
      item: {
        title: 'Mirror of the external card',
        kind: 'task',
        provenance: { source: 'consumer-mirror', recorded_at: '2026-08-17T00:00:00Z' },
        depends_on: [],
        ...item,
      },
      body: 'Mirrored from the external card.\n',
    }), '--json');
  assert.equal(created.exit, 0, JSON.stringify(created.envelope));
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Mirror the external card');

  const accepted = run(fixture.root, 'transition', '--ledger', fixture.ledger, '--input',
    await requestFile(fixture.root, 'accept.json', {
      id: ITEM_ID,
      expected_revision: created.envelope.result.item.revision,
      to_status: 'backlog',
      date: '2026-08-17',
      decision: {
        summary: 'Accept the mirrored card.',
        rationale: 'The external card is ready for work.',
      },
    }), '--json');
  assert.equal(accepted.exit, 0, JSON.stringify(accepted.envelope));
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Accept the mirrored card');
  assert.equal(run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json').exit, 0);
  return accepted.envelope.result.item.revision;
}

async function createNext(fixture) {
  return run(fixture.root, 'create', '--ledger', fixture.ledger, '--input',
    await requestFile(fixture.root, 'create-next.json', {
      id: NEXT_ID,
      item: {
        title: 'A later item',
        kind: 'task',
        provenance: { source: 'consumer-mirror', recorded_at: '2026-08-17T00:00:00Z' },
        depends_on: [],
      },
      body: 'A later item.\n',
    }), '--json');
}

for (const [label, seeded, handEdit] of [
  [
    'wrong',
    { external_id: WRONG_CARD },
    (published) => published.replace(WRONG_CARD, RIGHT_CARD),
  ],
  [
    'missing',
    {},
    (published) => published.replace('\n---\n', `\nexternal_id: ${RIGHT_CARD}\n---\n`),
  ],
]) {
  test(`the out-of-protocol repair of a ${label} identifier field is the trap: it blocks every later mutation`, async () => {
    const fixture = await provisionedRepository();
    const authorized = await mirroredItem(fixture, seeded);

    // The only route a consumer had before set.extensions existed.
    const published = await readFile(itemPath(fixture.ledger), 'utf8');
    const edited = handEdit(published);
    assert.notEqual(edited, published, 'the hand-edit fixture must actually change the item');
    await writeFile(itemPath(fixture.ledger), edited);
    git(fixture.root, 'add', 'ledger');
    git(fixture.root, 'commit', '-qm', 'Correct the identifier field by hand');

    const blocked = await createNext(fixture);
    assert.equal(blocked.exit, 6, JSON.stringify(blocked.envelope));
    assert.equal(blocked.envelope.state, 'unchanged');
    assert.equal(blocked.envelope.error.details.reason, 'publication-reconciliation-required');
    const [finding] = blocked.envelope.error.details.findings;
    assert.equal(finding.reason, 'unauthorized-revision');
    assert.equal(finding.item_id, ITEM_ID);
    assert.equal(finding.expected_revision, authorized);
  });

  test(`the same ${label} identifier field is corrected in band with no unauthorized-revision aftermath`, async () => {
    const fixture = await provisionedRepository();
    const authorized = await mirroredItem(fixture, seeded);

    const patched = run(fixture.root, 'patch', '--ledger', fixture.ledger, '--input',
      await requestFile(fixture.root, 'patch-extensions.json', {
        id: ITEM_ID,
        expected_revision: authorized,
        date: '2026-08-17',
        set: { extensions: { external_id: RIGHT_CARD } },
      }), '--json');

    assert.equal(patched.exit, 0, JSON.stringify(patched.envelope));
    assert.equal(patched.envelope.state, 'committed');
    const source = Buffer.from(patched.envelope.result.item.source_base64, 'base64').toString('utf8');
    assert.equal(frontmatter(source).external_id, RIGHT_CARD);
    git(fixture.root, 'add', 'ledger');
    git(fixture.root, 'commit', '-qm', 'Correct the identifier field through patch');

    // No aftermath: reconciliation finds nothing, and the ledger is still valid.
    const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');
    assert.equal(verified.exit, 0, JSON.stringify(verified.envelope));
    assert.deepEqual(verified.envelope.result.findings, []);
    assert.equal(verified.envelope.result.ledger_validation.valid, true);

    // And the next mutation proceeds, which is the property the trap destroyed.
    const next = await createNext(fixture);
    assert.equal(next.exit, 0, JSON.stringify(next.envelope));
    assert.equal(next.envelope.state, 'committed');
  });
}

test('existing tagged mirror bootstraps its declaration before correcting tags in band', async () => {
  const fixture = await provisionedRepository({ declare: false });
  const authorized = await mirroredItem(fixture, { tags: ['partners'] });

  const domainCorrection = run(fixture.root, 'patch', '--ledger', fixture.ledger, '--input',
    await requestFile(fixture.root, 'patch-domain.json', {
      id: ITEM_ID,
      expected_revision: authorized,
      date: '2026-08-17',
      set: {
        title: 'Corrected external card mirror',
        body: 'Corrected mirrored content.\n',
      },
    }), '--json');
  assert.equal(domainCorrection.exit, 0, JSON.stringify(domainCorrection.envelope));
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Correct mirror domain fields');

  const provisionRequest = await requestFile(fixture.root, 'provision-tags.json', {
    members: { tags: 'string-list' },
  });
  const dryRun = run(
    fixture.root,
    'extensions-provision',
    '--ledger',
    fixture.ledger,
    '--input',
    provisionRequest,
    '--json',
    '--dry-run',
  );
  assert.equal(dryRun.exit, 0, JSON.stringify(dryRun.envelope));
  assert.equal(dryRun.envelope.result.source, TAGS_DECLARATION);

  const provisioned = run(
    fixture.root,
    'extensions-provision',
    '--ledger',
    fixture.ledger,
    '--input',
    provisionRequest,
    '--json',
  );
  assert.equal(provisioned.exit, 0, JSON.stringify(provisioned.envelope));
  assert.equal(
    await readFile(path.join(fixture.ledger, '.wowbagger', 'extensions.json'), 'utf8'),
    TAGS_DECLARATION,
  );
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Authorize mirrored tags');

  const inspected = run(
    fixture.root,
    'inspect',
    '--ledger',
    fixture.ledger,
    '--id',
    ITEM_ID,
    '--json',
  );
  assert.equal(inspected.exit, 0, JSON.stringify(inspected.envelope));
  const patched = run(fixture.root, 'patch', '--ledger', fixture.ledger, '--input',
    await requestFile(fixture.root, 'patch-tags.json', {
      id: ITEM_ID,
      expected_revision: inspected.envelope.result.item.revision,
      date: '2026-08-17',
      set: { extensions: { tags: ['corrected'] } },
    }), '--json');
  assert.equal(patched.exit, 0, JSON.stringify(patched.envelope));
  const source = Buffer.from(patched.envelope.result.item.source_base64, 'base64').toString('utf8');
  assert.deepEqual(frontmatter(source).tags, ['corrected']);
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Correct mirror tags through patch');

  const verified = run(fixture.root, 'claim-verify', '--ledger', fixture.ledger, '--json');
  assert.equal(verified.exit, 0, JSON.stringify(verified.envelope));
  assert.deepEqual(verified.envelope.result.findings, []);
  assert.equal(verified.envelope.result.ledger_validation.valid, true);

  const next = await createNext(fixture);
  assert.equal(next.exit, 0, JSON.stringify(next.envelope));
  assert.equal(next.envelope.state, 'committed');
});
