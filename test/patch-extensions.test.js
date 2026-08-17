// test/patch-extensions.test.js
//
// Item #118: the sanctioned patch path for consumer-owned extension members.
// A `set.extensions` container keeps the fail-closed `set` allowlist intact,
// and a committed per-ledger declaration decides which members it may name.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { runCli, withLedger } from './support.js';

const ITEM = 'wb_01Q4ZK3DG020ANANANANANANAM';
const CREATED = '2030-01-20';

// The mirrored item a consumer keeps in step with an external card. Its
// identifier field rides an extension member, and two more extension nodes —
// one anchored, one aliasing it — stand in for everything the patch must not
// touch.
function itemSource({ extra = [] } = {}) {
  return [
    '---',
    'schema_version: 1',
    `id: ${ITEM}`,
    'title: "Mirror of the external card"',
    'kind: task',
    'status: backlog',
    `created: ${CREATED}`,
    `updated: ${CREATED}`,
    'provenance:',
    '  source: "fixture/patch-extensions"',
    `  recorded_at: "${CREATED}T12:00:00Z"`,
    'depends_on: []',
    'related: []',
    '# the mirror keeps its own notes here',
    'mirror: &mirror',
    '  card: "PC-1475"',
    'audit:',
    '  - last: *mirror',
    ...extra,
    '---',
  ].join('\n') + '\nThe mirrored card.\n';
}

const DECLARATION = JSON.stringify({
  extensions_version: 1,
  members: {
    external_id: 'string',
    tier: 'string',
    sequence: 'integer',
    verified: 'boolean',
    tags: 'string-list',
    mirror: 'string',
  },
});

function inspectRevision(ledger) {
  const inspected = runCli('inspect', '--ledger', ledger, '--id', ITEM, '--json');
  assert.equal(inspected.status, 0, inspected.stderr);
  return JSON.parse(inspected.stdout).result.item.revision;
}

async function runPatch(ledger, set, date = '2030-01-22') {
  const requestPath = path.join(path.dirname(ledger), 'patch-extensions-request.json');
  await writeFile(requestPath, JSON.stringify({
    id: ITEM,
    expected_revision: inspectRevision(ledger),
    date,
    set,
  }));
  return runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');
}

test('a set.extensions container naming no member is refused at its own pointer', async () => {
  const before = itemSource();
  await withLedger({
    [`${ITEM}.md`]: before,
    '.wowbagger/extensions.json': DECLARATION,
  }, async (ledger) => {
    const result = await runPatch(ledger, { extensions: {} });

    assert.equal(result.status, 2, result.stdout);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error.code, 'invalid-request');
    assert.equal(envelope.state, 'unchanged');
    assert.deepEqual(envelope.error.details.issues, [{
      path: '/set/extensions',
      code: 'invalid-value',
      message: 'Set member extensions must name at least one extension member.',
    }]);
    assert.equal(await readFile(path.join(ledger, `${ITEM}.md`), 'utf8'), before);
  });
});

// Fail closed on the ledger, not on a hardcoded list: a ledger that declares
// nothing has no patchable extension member at all, and the refusal names the
// declaration that is missing rather than the member that was asked for.
test('a ledger with no extension declaration refuses every extension patch', async () => {
  const before = itemSource();
  await withLedger({ [`${ITEM}.md`]: before }, async (ledger) => {
    const result = await runPatch(ledger, { extensions: { external_id: 'PC-1475' } });

    assert.equal(result.status, 2, result.stdout);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error.code, 'patch-precondition-failed');
    assert.equal(envelope.state, 'unchanged');
    assert.equal(envelope.error.details.id, ITEM);
    assert.deepEqual(envelope.error.details.issues, [{
      code: 'extension-declaration-missing',
      field: 'extensions',
      message: 'The ledger declares no patchable extension members; .wowbagger/extensions.json is absent.',
      related_ids: [],
    }]);
    assert.equal(await readFile(path.join(ledger, `${ITEM}.md`), 'utf8'), before);
  });
});

test('a malformed extension declaration refuses every extension patch and names itself', async () => {
  const before = itemSource();
  await withLedger({
    [`${ITEM}.md`]: before,
    '.wowbagger/extensions.json': '{"extensions_version":1,"members":{"external_id":"uuid"}}',
  }, async (ledger) => {
    const result = await runPatch(ledger, { extensions: { external_id: 'PC-1475' } });

    assert.equal(result.status, 2, result.stdout);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error.code, 'patch-precondition-failed');
    assert.deepEqual(envelope.error.details.issues, [{
      code: 'extension-declaration-invalid',
      field: 'extensions',
      message: 'The ledger extension declaration at .wowbagger/extensions.json is not a valid version 1 declaration.',
      related_ids: [],
    }]);
    assert.equal(await readFile(path.join(ledger, `${ITEM}.md`), 'utf8'), before);
  });
});

// A declaration is an allowlist, not a hint: the container may only name what
// it declares, so a typo inside the container fails closed exactly as a typo
// outside it does.
test('an undeclared member is refused, named by the issue field', async () => {
  const before = itemSource();
  await withLedger({
    [`${ITEM}.md`]: before,
    '.wowbagger/extensions.json': DECLARATION,
  }, async (ledger) => {
    const result = await runPatch(ledger, { extensions: { externl_id: 'PC-1475' } });

    assert.equal(result.status, 2, result.stdout);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error.code, 'patch-precondition-failed');
    assert.deepEqual(envelope.error.details.issues, [{
      code: 'extension-not-declared',
      field: 'externl_id',
      message: 'The ledger extension declaration does not declare this member.',
      related_ids: [],
    }]);
    assert.equal(await readFile(path.join(ledger, `${ITEM}.md`), 'utf8'), before);
  });
});

// Obstacle 2 of the contract's ownership section: unvalidated caller JSON must
// never reach frontmatter. The declared type is the whole schema, and every
// shape outside it is refused before the serializer sees it.
for (const [label, member, value] of [
  ['a number for a declared string', 'external_id', 7],
  ['a string for a declared integer', 'sequence', '3'],
  ['a string for a declared boolean', 'verified', 'true'],
  ['a non-string entry in a declared string list', 'tags', ['mirror', 4]],
  ['a nested map for a declared string', 'external_id', { card: 'PC-1475' }],
  ['a nested list for a declared string list', 'tags', [['mirror']]],
]) {
  test(`an extension value is refused: ${label}`, async () => {
    const before = itemSource();
    await withLedger({
      [`${ITEM}.md`]: before,
      '.wowbagger/extensions.json': DECLARATION,
    }, async (ledger) => {
      const result = await runPatch(ledger, { extensions: { [member]: value } });

      assert.equal(result.status, 2, result.stdout);
      const envelope = JSON.parse(result.stdout);
      assert.equal(envelope.error.code, 'patch-precondition-failed');
      assert.deepEqual(envelope.error.details.issues, [{
        code: 'extension-value-invalid',
        field: member,
        message: 'The value does not match the type the ledger extension declaration gives this member.',
        related_ids: [],
      }]);
      assert.equal(await readFile(path.join(ledger, `${ITEM}.md`), 'utf8'), before);
    });
  });
}

// The wrong case: the consumer's identifier field carries the wrong value and
// there was no repair verb for it. The correction rewrites that member's scalar
// in place and nothing else — the anchored node, the alias bound to it, the
// comment, and the body all survive byte for byte.
test('a wrong consumer identifier field is corrected in place, leaving every other byte', async () => {
  const before = itemSource({ extra: ['external_id: "PC-1470"'] });
  await withLedger({
    [`${ITEM}.md`]: before,
    '.wowbagger/extensions.json': DECLARATION,
  }, async (ledger) => {
    const result = await runPatch(ledger, { extensions: { external_id: 'PC-1475' } });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.state, 'committed');
    assert.equal(envelope.result.item.core.updated, '2030-01-22');

    const after = await readFile(path.join(ledger, `${ITEM}.md`), 'utf8');
    assert.equal(after, before
      .replace(`updated: ${CREATED}`, 'updated: 2030-01-22')
      .replace('external_id: "PC-1470"', 'external_id: "PC-1475"'));
    // The correction is only observable through the item source: extension
    // members are absent from the lossless core view by construction.
    assert.equal(Object.hasOwn(envelope.result.item.core, 'external_id'), false);
    assert.equal(
      Buffer.from(envelope.result.item.source_base64, 'base64').toString('utf8'),
      after,
    );
  });
});

// The missing case: the member is absent, so there is nothing to rewrite in
// place. It is appended after the item's last frontmatter member, because an
// extension member has no canonical position the core may claim.
test('a missing consumer identifier field is added after the last frontmatter member', async () => {
  const before = itemSource();
  await withLedger({
    [`${ITEM}.md`]: before,
    '.wowbagger/extensions.json': DECLARATION,
  }, async (ledger) => {
    const result = await runPatch(ledger, { extensions: { external_id: 'PC-1475' } });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const after = await readFile(path.join(ledger, `${ITEM}.md`), 'utf8');
    assert.equal(after, before
      .replace(`updated: ${CREATED}`, 'updated: 2030-01-22')
      .replace('\n---\nThe mirrored card.\n', '\nexternal_id: PC-1475\n---\nThe mirrored card.\n'));
  });
});

// Obstacle 3, answered by refusal rather than by a silent rewrite: replacing an
// anchored node would change every node bound to it.
test('a member the item writes with an anchor is refused rather than replaced', async () => {
  const before = itemSource();
  await withLedger({
    [`${ITEM}.md`]: before,
    '.wowbagger/extensions.json': DECLARATION,
  }, async (ledger) => {
    const result = await runPatch(ledger, { extensions: { mirror: 'PC-1475' } });

    assert.equal(result.status, 2, result.stdout);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error.code, 'patch-precondition-failed');
    assert.deepEqual(envelope.error.details.issues, [{
      code: 'extension-anchored',
      field: 'mirror',
      message: 'The item writes this member with a YAML anchor or alias, so it cannot be replaced whole.',
      related_ids: [],
    }]);
    assert.equal(await readFile(path.join(ledger, `${ITEM}.md`), 'utf8'), before);
  });
});
