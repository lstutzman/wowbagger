import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { runCli, withLedger } from './support.js';

// Fixture identity. The created date equals the UTC date the ID encodes, which
// the ledger contract requires.
const ITEM = 'wb_01Q4ZK3DG020ANANANANANANAM';
const CREATED = '2030-01-20';

function itemSource(title, body, { extra = [] } = {}) {
  return [
    '---',
    'schema_version: 1',
    `id: ${ITEM}`,
    `title: ${title}`,
    'kind: task',
    'status: backlog',
    `created: ${CREATED}`,
    `updated: ${CREATED}`,
    'provenance:',
    '  source: "fixture/patch-title"',
    `  recorded_at: "${CREATED}T12:00:00Z"`,
    'depends_on: []',
    'related: []',
    ...extra,
    '---',
  ].join('\n') + `\n${body}`;
}

function inspectRevision(ledger, id) {
  const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
  assert.equal(inspected.status, 0, inspected.stderr);
  return JSON.parse(inspected.stdout).result.item.revision;
}

async function runPatch(ledger, request) {
  const requestPath = path.join(path.dirname(ledger), 'patch-title-request.json');
  await writeFile(requestPath, JSON.stringify(request));
  return runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');
}

// The refusals a caller can hit without reading the ledger. Each one is a
// deterministic invalid-request issue at /set/title, so it costs no lock.
for (const [label, value] of [
  ['the empty string', ''],
  ['a whitespace-only string', '   '],
  ['a number', 3],
]) {
  test(`a title patch refuses ${label}`, async () => {
    const before = itemSource('"Mirror of a legacy card"', '\nThe mirrored card.\n');
    await withLedger({ [`${ITEM}.md`]: before }, async (ledger) => {
      const result = await runPatch(ledger, {
        id: ITEM,
        expected_revision: inspectRevision(ledger, ITEM),
        date: '2030-01-22',
        set: { title: value },
      });

      assert.equal(result.status, 2, result.stdout);
      const envelope = JSON.parse(result.stdout);
      assert.equal(envelope.error.code, 'invalid-request');
      assert.equal(envelope.state, 'unchanged');
      assert.deepEqual(envelope.error.details.issues, [{
        path: '/set/title',
        code: 'invalid-type',
        message: 'Set member title must be a non-empty string.',
      }]);
      assert.equal(await readFile(path.join(ledger, `${ITEM}.md`), 'utf8'), before);
    });
  });
}

test('one patch writes title, body, and relations in a single compare-and-swap', async () => {
  const other = 'wb_01Q4ZK3DG020ANANANANANANAN';
  const before = itemSource('"Mirrror of a legacy card"', '\nThe mirrored card.\n');
  const neighbour = [
    '---',
    'schema_version: 1',
    `id: ${other}`,
    'title: "The card this one relates to"',
    'kind: task',
    'status: backlog',
    `created: ${CREATED}`,
    `updated: ${CREATED}`,
    'provenance:',
    '  source: "fixture/patch-title"',
    `  recorded_at: "${CREATED}T12:00:00Z"`,
    'depends_on: []',
    'related: []',
    '---',
  ].join('\n') + '\nNeighbour.\n';

  await withLedger({ [`${ITEM}.md`]: before, [`${other}.md`]: neighbour }, async (ledger) => {
    const revision = inspectRevision(ledger, ITEM);
    const result = await runPatch(ledger, {
      id: ITEM,
      expected_revision: revision,
      date: '2030-01-22',
      set: {
        title: 'Mirror of a legacy card',
        related: [other],
        body: '\nThe corrected card.\n',
      },
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const item = JSON.parse(result.stdout).result.item;
    assert.equal(item.core.title, 'Mirror of a legacy card');
    assert.deepEqual(item.core.related, [other]);
    assert.equal(item.body, '\nThe corrected card.\n');
    assert.equal(item.core.updated, '2030-01-22');

    // One write, so one new revision: the request's own expected_revision is the
    // only precondition the three edits share.
    assert.notEqual(item.revision, revision);
    assert.equal(
      await readFile(path.join(ledger, `${ITEM}.md`), 'utf8'),
      before
        .replace('title: "Mirrror of a legacy card"', 'title: "Mirror of a legacy card"')
        .replace(`updated: ${CREATED}`, 'updated: 2030-01-22')
        .replace('related: []', `related: [ ${other} ]`)
        .replace('\nThe mirrored card.\n', '\nThe corrected card.\n'),
    );
    // The second edit of the same item needs the revision the first one produced.
    const stale = await runPatch(ledger, {
      id: ITEM,
      expected_revision: revision,
      date: '2030-01-23',
      set: { title: 'Never written' },
    });
    assert.equal(stale.status, 4, stale.stdout);
    assert.equal(JSON.parse(stale.stdout).error.code, 'revision-conflict');
  });
});

test('a title patch refuses a stale expected_revision and leaves the item alone', async () => {
  const before = itemSource('"Mirror of a legacy card"', '\nThe mirrored card.\n');
  await withLedger({ [`${ITEM}.md`]: before }, async (ledger) => {
    const result = await runPatch(ledger, {
      id: ITEM,
      expected_revision: `sha256:${'0'.repeat(64)}`,
      date: '2030-01-22',
      set: { title: 'Never written' },
    });

    assert.equal(result.status, 4, result.stdout);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error.code, 'revision-conflict');
    assert.equal(envelope.state, 'unchanged');
    assert.equal(await readFile(path.join(ledger, `${ITEM}.md`), 'utf8'), before);
  });
});

test('a title patch preserves anchors, aliases, comments, and extension members byte for byte', async () => {
  const before = itemSource('"Mirrror of a legacy card"', '\nThe mirrored card.\n', {
    extra: [
      '# the mirror keeps its own notes here',
      'mirror: &mirror',
      '  card: "PC-1475"',
      "  owner: 'field'",
      'audit:',
      '  - last: *mirror',
      '  - checked: 2030-01-20',
    ],
  });
  await withLedger({ [`${ITEM}.md`]: before }, async (ledger) => {
    const result = await runPatch(ledger, {
      id: ITEM,
      expected_revision: inspectRevision(ledger, ITEM),
      date: '2030-01-22',
      set: { title: 'Mirror of a legacy card' },
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(
      await readFile(path.join(ledger, `${ITEM}.md`), 'utf8'),
      before
        .replace('title: "Mirrror of a legacy card"', 'title: "Mirror of a legacy card"')
        .replace(`updated: ${CREATED}`, 'updated: 2030-01-22'),
    );
  });
});

test('a null title follows the removal convention onto candidate-invalid, because title is required', async () => {
  const before = itemSource('"Mirror of a legacy card"', '\nThe mirrored card.\n');
  await withLedger({ [`${ITEM}.md`]: before }, async (ledger) => {
    const result = await runPatch(ledger, {
      id: ITEM,
      expected_revision: inspectRevision(ledger, ITEM),
      date: '2030-01-22',
      set: { title: null },
    });

    assert.equal(result.status, 2, result.stdout);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error.code, 'candidate-invalid');
    assert.equal(envelope.state, 'unchanged');
    assert.ok(
      envelope.error.details.validation_errors.some((error) => (
        error.field === 'title' && error.code === 'missing-required-field'
      )),
      result.stdout,
    );
    assert.equal(await readFile(path.join(ledger, `${ITEM}.md`), 'utf8'), before);
  });
});

test('patch still refuses kind, which is create-once', async () => {
  const before = itemSource('"Mirror of a legacy card"', '\nThe mirrored card.\n');
  await withLedger({ [`${ITEM}.md`]: before }, async (ledger) => {
    const result = await runPatch(ledger, {
      id: ITEM,
      expected_revision: inspectRevision(ledger, ITEM),
      date: '2030-01-22',
      set: { title: 'Mirror of a legacy epic', kind: 'epic' },
    });

    assert.equal(result.status, 2, result.stdout);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error.code, 'invalid-request');
    assert.deepEqual(envelope.error.details.issues, [{
      path: '/set/kind',
      code: 'unknown-member',
      message: 'Set member kind is not allowed.',
    }]);
    assert.equal(await readFile(path.join(ledger, `${ITEM}.md`), 'utf8'), before);
  });
});

test('patch still refuses an extension member, which has no sanctioned path yet', async () => {
  const before = itemSource('"Mirror of a legacy card"', '\nThe mirrored card.\n', {
    extra: ['tier: "gold"'],
  });
  await withLedger({ [`${ITEM}.md`]: before }, async (ledger) => {
    const result = await runPatch(ledger, {
      id: ITEM,
      expected_revision: inspectRevision(ledger, ITEM),
      date: '2030-01-22',
      set: { tier: 'silver' },
    });

    assert.equal(result.status, 2, result.stdout);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error.code, 'invalid-request');
    assert.deepEqual(envelope.error.details.issues, [{
      path: '/set/tier',
      code: 'unknown-member',
      message: 'Set member tier is not allowed.',
    }]);
    assert.equal(await readFile(path.join(ledger, `${ITEM}.md`), 'utf8'), before);
  });
});

test('a title patch replaces the title, bumps updated, and leaves every other byte identical', async () => {
  const before = itemSource('"Mirrror of a legacy card"', '\nThe mirrored card.\n');
  await withLedger({ [`${ITEM}.md`]: before }, async (ledger) => {
    const result = await runPatch(ledger, {
      id: ITEM,
      expected_revision: inspectRevision(ledger, ITEM),
      date: '2030-01-22',
      set: { title: 'Mirror of a legacy card' },
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const item = JSON.parse(result.stdout).result.item;
    assert.equal(item.core.title, 'Mirror of a legacy card');
    assert.equal(item.core.updated, '2030-01-22');

    const published = await readFile(path.join(ledger, `${ITEM}.md`), 'utf8');
    assert.equal(
      published,
      before
        .replace('title: "Mirrror of a legacy card"', 'title: "Mirror of a legacy card"')
        .replace(`updated: ${CREATED}`, 'updated: 2030-01-22'),
    );
  });
});
