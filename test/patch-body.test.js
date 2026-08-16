import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { runCli, withLedger } from './support.js';

// Fixture identity. The created date equals the UTC date the ID encodes, which
// the ledger contract requires.
const ITEM = 'wb_01Q4ZK3DG020ANANANANANANAM';
const CREATED = '2030-01-20';

function itemSource(body, { extra = [] } = {}) {
  return [
    '---',
    'schema_version: 1',
    `id: ${ITEM}`,
    'title: "Mirror of a legacy card"',
    'kind: task',
    'status: backlog',
    `created: ${CREATED}`,
    `updated: ${CREATED}`,
    'provenance:',
    '  source: "fixture/patch-body"',
    `  recorded_at: "${CREATED}T12:00:00Z"`,
    'depends_on: []',
    'related: []',
    ...extra,
    '---',
  ].join('\n') + `\n${body}`;
}

// The frontmatter region is every byte through the closing delimiter's newline.
// A body patch must leave it identical except for the updated line, so the pin
// is a byte compare, not a parsed-field compare.
function frontmatterRegion(source) {
  const closing = source.indexOf('\n---\n', source.indexOf('\n'));
  assert.notEqual(closing, -1, source);
  return source.slice(0, closing + '\n---\n'.length);
}

function bodyRegion(source) {
  return source.slice(frontmatterRegion(source).length);
}

function inspectRevision(ledger, id) {
  const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
  assert.equal(inspected.status, 0, inspected.stderr);
  return JSON.parse(inspected.stdout).result.item.revision;
}

async function runPatch(ledger, request) {
  const requestPath = path.join(path.dirname(ledger), 'patch-body-request.json');
  await writeFile(requestPath, JSON.stringify(request));
  return runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');
}

test('a body patch replaces the body bytes and rewrites no other frontmatter byte', async () => {
  const before = itemSource('\nThe legacy card said backlog.\n');
  await withLedger({ [`${ITEM}.md`]: before }, async (ledger) => {
    const result = await runPatch(ledger, {
      id: ITEM,
      expected_revision: inspectRevision(ledger, ITEM),
      date: '2030-01-22',
      set: { body: '\nThe legacy card now says done.\n' },
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const item = JSON.parse(result.stdout).result.item;
    assert.equal(item.body, '\nThe legacy card now says done.\n');
    assert.equal(item.core.updated, '2030-01-22');

    const published = await readFile(path.join(ledger, `${ITEM}.md`), 'utf8');
    assert.equal(bodyRegion(published), '\nThe legacy card now says done.\n');
    assert.equal(
      frontmatterRegion(published),
      frontmatterRegion(before).replace(`updated: ${CREATED}`, 'updated: 2030-01-22'),
    );
  });
});

test('a body patch refuses null, because removing a body means the empty string', async () => {
  const before = itemSource('\nMirror body.\n');
  await withLedger({ [`${ITEM}.md`]: before }, async (ledger) => {
    const revision = inspectRevision(ledger, ITEM);

    const result = await runPatch(ledger, {
      id: ITEM,
      expected_revision: revision,
      date: '2030-01-22',
      set: { body: null },
    });

    assert.equal(result.status, 2, result.stdout);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error.code, 'invalid-request');
    assert.equal(envelope.state, 'unchanged');
    assert.deepEqual(envelope.error.details.issues, [{
      path: '/set/body',
      code: 'invalid-value',
      message: 'Set member body must be a string; use the empty string to remove the body.',
    }]);
    assert.equal(await readFile(path.join(ledger, `${ITEM}.md`), 'utf8'), before);
  });
});

test('a body patch refuses a body that is not a string', async () => {
  const before = itemSource('\nMirror body.\n');
  await withLedger({ [`${ITEM}.md`]: before }, async (ledger) => {
    const result = await runPatch(ledger, {
      id: ITEM,
      expected_revision: inspectRevision(ledger, ITEM),
      date: '2030-01-22',
      set: { body: 3 },
    });

    assert.equal(result.status, 2, result.stdout);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error.code, 'invalid-request');
    assert.deepEqual(envelope.error.details.issues, [{
      path: '/set/body',
      code: 'invalid-type',
      message: 'Set member body must be a string.',
    }]);
    assert.equal(await readFile(path.join(ledger, `${ITEM}.md`), 'utf8'), before);
  });
});

test('the empty body leaves no byte after the closing delimiter', async () => {
  const before = itemSource('\nMirror body.\n');
  await withLedger({ [`${ITEM}.md`]: before }, async (ledger) => {
    const result = await runPatch(ledger, {
      id: ITEM,
      expected_revision: inspectRevision(ledger, ITEM),
      date: '2030-01-22',
      set: { body: '' },
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(JSON.parse(result.stdout).result.item.body, '');
    const published = await readFile(path.join(ledger, `${ITEM}.md`), 'utf8');
    assert.equal(bodyRegion(published), '');
    assert.ok(published.endsWith('---\n'), JSON.stringify(published));
  });
});

test('a body patch refuses a stale expected_revision and leaves the item alone', async () => {
  const before = itemSource('\nMirror body.\n');
  await withLedger({ [`${ITEM}.md`]: before }, async (ledger) => {
    const stale = `sha256:${'0'.repeat(64)}`;

    const result = await runPatch(ledger, {
      id: ITEM,
      expected_revision: stale,
      date: '2030-01-22',
      set: { body: 'never written\n' },
    });

    assert.equal(result.status, 4, result.stdout);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error.code, 'revision-conflict');
    assert.equal(envelope.state, 'unchanged');
    assert.equal(await readFile(path.join(ledger, `${ITEM}.md`), 'utf8'), before);
  });
});

test('one patch writes a body and a frontmatter field together', async () => {
  const before = itemSource('\nMirror body.\n');
  await withLedger({ [`${ITEM}.md`]: before }, async (ledger) => {
    const result = await runPatch(ledger, {
      id: ITEM,
      expected_revision: inspectRevision(ledger, ITEM),
      date: '2030-01-22',
      set: { priority: 4, related: [], body: 'Card and priority moved together.\n' },
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const item = JSON.parse(result.stdout).result.item;
    assert.equal(item.core.priority, 4);
    assert.deepEqual(item.core.related, []);
    assert.equal(item.body, 'Card and priority moved together.\n');

    const published = await readFile(path.join(ledger, `${ITEM}.md`), 'utf8');
    assert.equal(bodyRegion(published), 'Card and priority moved together.\n');
    assert.equal(
      frontmatterRegion(published),
      frontmatterRegion(before)
        .replace(`updated: ${CREATED}`, 'updated: 2030-01-22')
        .replace('kind: task\n', 'kind: task\npriority: 4\n'),
    );
  });
});

test('a body patch preserves anchors, aliases, comments, and extension members byte for byte', async () => {
  const before = itemSource('\nMirror body.\n', {
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
      set: { body: 'No leading blank line.\n' },
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const published = await readFile(path.join(ledger, `${ITEM}.md`), 'utf8');
    assert.equal(bodyRegion(published), 'No leading blank line.\n');
    assert.equal(
      frontmatterRegion(published),
      frontmatterRegion(before).replace(`updated: ${CREATED}`, 'updated: 2030-01-22'),
    );
  });
});
