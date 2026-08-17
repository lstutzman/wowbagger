import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { runCli, withLedger } from './support.js';

// Fixture identity. The created date equals the UTC date the ID encodes, which
// the ledger contract requires.
const ITEM = 'wb_01Q4ZK3DG020ANANANANANANAM';
const CREATED = '2030-01-20';

function itemSource(body) {
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
    '  source: "fixture/patch-body-append"',
    `  recorded_at: "${CREATED}T12:00:00Z"`,
    'depends_on: []',
    'related: []',
    '---',
  ].join('\n') + `\n${body}`;
}

// The frontmatter region is every byte through the closing delimiter's newline.
// An append must leave it identical except for the updated line, so the pin is
// a byte compare, not a parsed-field compare.
function frontmatterRegion(source) {
  const closing = source.indexOf('\n---\n', source.indexOf('\n'));
  assert.notEqual(closing, -1, source);
  return source.slice(0, closing + '\n---\n'.length);
}

function inspectRevision(ledger, id) {
  const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
  assert.equal(inspected.status, 0, inspected.stderr);
  return JSON.parse(inspected.stdout).result.item.revision;
}

async function runPatch(ledger, request) {
  const requestPath = path.join(path.dirname(ledger), 'patch-append-request.json');
  await writeFile(requestPath, JSON.stringify(request));
  return runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');
}

test('a body append adds bytes after the current body and keeps every byte before them', async () => {
  const body = '\nThe legacy card said backlog.\n';
  const before = itemSource(body);
  await withLedger({ [`${ITEM}.md`]: before }, async (ledger) => {
    const result = await runPatch(ledger, {
      id: ITEM,
      expected_revision: inspectRevision(ledger, ITEM),
      date: '2030-01-22',
      set: { body_append: '\n## Ledger-only\n\nMirror cannot follow the title.\n' },
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const item = JSON.parse(result.stdout).result.item;
    assert.equal(item.body, `${body}\n## Ledger-only\n\nMirror cannot follow the title.\n`);
    assert.equal(item.core.updated, '2030-01-22');
    const after = Buffer.from(item.source_base64, 'base64').toString('utf8');
    assert.equal(
      frontmatterRegion(after),
      frontmatterRegion(before).replace(`updated: ${CREATED}`, 'updated: 2030-01-22'),
    );
  });
});

test('one request naming both body and body_append is refused for the exclusivity', async () => {
  const before = itemSource('\nThe legacy card said backlog.\n');
  await withLedger({ [`${ITEM}.md`]: before }, async (ledger) => {
    const result = await runPatch(ledger, {
      id: ITEM,
      expected_revision: inspectRevision(ledger, ITEM),
      date: '2030-01-22',
      set: { body: '\nReplacement.\n', body_append: '\nAddition.\n' },
    });

    assert.equal(result.status, 2, result.stdout);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error.code, 'invalid-request');
    assert.equal(envelope.state, 'unchanged');
    assert.deepEqual(envelope.error.details.issues, [{
      path: '/set',
      code: 'invalid-value',
      message: 'Set members body and body_append are mutually exclusive; name one.',
    }]);
  });
});

test('a body append refuses null, because appending nothing is the empty string', async () => {
  const before = itemSource('\nThe legacy card said backlog.\n');
  await withLedger({ [`${ITEM}.md`]: before }, async (ledger) => {
    const result = await runPatch(ledger, {
      id: ITEM,
      expected_revision: inspectRevision(ledger, ITEM),
      date: '2030-01-22',
      set: { body_append: null },
    });

    assert.equal(result.status, 2, result.stdout);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.state, 'unchanged');
    assert.deepEqual(envelope.error.details.issues, [{
      path: '/set/body_append',
      code: 'invalid-value',
      message: 'Set member body_append must be a string; use the empty string to append nothing.',
    }]);
  });
});

test('a body append refuses a value that is not a string', async () => {
  const before = itemSource('\nThe legacy card said backlog.\n');
  await withLedger({ [`${ITEM}.md`]: before }, async (ledger) => {
    const result = await runPatch(ledger, {
      id: ITEM,
      expected_revision: inspectRevision(ledger, ITEM),
      date: '2030-01-22',
      set: { body_append: ['\nAddition.\n'] },
    });

    assert.equal(result.status, 2, result.stdout);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.state, 'unchanged');
    assert.deepEqual(envelope.error.details.issues, [{
      path: '/set/body_append',
      code: 'invalid-type',
      message: 'Set member body_append must be a string.',
    }]);
  });
});

// The consumer's worked case, adapted. Their ledger item carried a block that
// exists nowhere upstream, and the mirror regenerated the body from the source
// alone. This pins the safe alternative: append never has to read the upstream
// source, so every ledger-only byte survives by construction.
test('an append preserves a ledger-only block that regenerating from the source would destroy', async () => {
  const ledgerOnly = [
    '',
    'Mirrored from PC-1475.',
    '',
    '## Title intent (ledger-only)',
    '',
    'The upstream card was renamed; patch refuses title, so the mirror',
    'records the divergence here instead.',
    '',
  ].join('\n');
  const regenerated = '\nMirrored from PC-1475.\n';
  await withLedger({ [`${ITEM}.md`]: itemSource(ledgerOnly) }, async (ledger) => {
    // What the near-miss did: regenerate from the source alone. The core
    // accepts it and the ledger-only block is gone. This is documented
    // behavior, not a defect - section 9 places the merge on the consumer.
    const replaced = await runPatch(ledger, {
      id: ITEM,
      expected_revision: inspectRevision(ledger, ITEM),
      date: '2030-01-22',
      set: { body: regenerated },
    });
    assert.equal(replaced.status, 0, replaced.stdout);
    const destroyed = JSON.parse(replaced.stdout).result.item.body;
    assert.equal(destroyed, regenerated);
    assert.ok(!destroyed.includes('Title intent'), destroyed);
  });

  // The alternative the same consumer can reach for: append the addition and
  // never name the existing bytes at all.
  await withLedger({ [`${ITEM}.md`]: itemSource(ledgerOnly) }, async (ledger) => {
    const appended = await runPatch(ledger, {
      id: ITEM,
      expected_revision: inspectRevision(ledger, ITEM),
      date: '2030-01-22',
      set: { body_append: '## Upstream note\n\nCard moved to done.\n' },
    });
    assert.equal(appended.status, 0, appended.stdout);
    const body = JSON.parse(appended.stdout).result.item.body;
    assert.equal(body, `${ledgerOnly}## Upstream note\n\nCard moved to done.\n`);
    assert.ok(body.startsWith(ledgerOnly), body);
  });
});
