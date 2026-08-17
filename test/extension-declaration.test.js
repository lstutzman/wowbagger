// test/extension-declaration.test.js
//
// The committed per-ledger extension declaration: the artifact that decides
// which extension members `patch` may write. It is deliberately small, and
// every way of getting it wrong fails closed.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  EXTENSION_VALUE_TYPES,
  RESERVED_EXTENSION_MEMBERS,
  extensionValueMatches,
  loadExtensionDeclaration,
  parseExtensionDeclaration,
} from '../src/extensions.js';
import { CORE_OWNED_FIELDS } from '../src/mutation.js';

async function withLedgerRoot(files, callback) {
  const root = await mkdtemp(path.join(tmpdir(), 'wowbagger-extensions-'));
  try {
    for (const [relative, source] of Object.entries(files)) {
      const destination = path.join(root, relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, source, 'utf8');
    }
    return await callback(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

// A name that stops being core-owned would silently become declarable, which
// would let a committed file smuggle a member past the ownership table.
test('the reserved names are exactly the core-owned frontmatter members', () => {
  assert.deepEqual(
    [...RESERVED_EXTENSION_MEMBERS].sort(),
    [...CORE_OWNED_FIELDS].sort(),
  );
});

test('a declaration naming one member per declared type parses', () => {
  const members = Object.fromEntries(EXTENSION_VALUE_TYPES.map((type, index) => [`member_${index}`, type]));
  const parsed = parseExtensionDeclaration(JSON.stringify({ extensions_version: 1, members }));
  assert.deepEqual(parsed, { extensions_version: 1, members });
});

for (const [label, source] of [
  ['invalid JSON', '{'],
  ['a JSON array', '[]'],
  ['a JSON string', '"external_id"'],
  ['null', 'null'],
  ['a missing members map', '{"extensions_version":1}'],
  ['a missing version', '{"members":{"external_id":"string"}}'],
  ['an unknown member of its own', '{"extensions_version":1,"members":{},"strict":true}'],
  ['a future version', '{"extensions_version":2,"members":{"external_id":"string"}}'],
  ['a string version', '{"extensions_version":"1","members":{"external_id":"string"}}'],
  ['an empty members map', '{"extensions_version":1,"members":{}}'],
  ['a members array', '{"extensions_version":1,"members":["external_id"]}'],
  ['an undeclared value type', '{"extensions_version":1,"members":{"external_id":"uuid"}}'],
  ['a nested value type', '{"extensions_version":1,"members":{"external_id":{"type":"string"}}}'],
  ['a member name that is not a plain YAML key', '{"extensions_version":1,"members":{"external id":"string"}}'],
  ['a member name that starts with a digit', '{"extensions_version":1,"members":{"1id":"string"}}'],
  ['an empty member name', '{"extensions_version":1,"members":{"":"string"}}'],
]) {
  test(`a declaration is refused: ${label}`, () => {
    assert.equal(parseExtensionDeclaration(source), null);
  });
}

test('a declaration may never claim a core-owned member', () => {
  for (const member of RESERVED_EXTENSION_MEMBERS) {
    assert.equal(
      parseExtensionDeclaration(JSON.stringify({ extensions_version: 1, members: { [member]: 'string' } })),
      null,
      `${member} must stay undeclarable`,
    );
  }
});

test('the declared types accept exactly their own shapes', () => {
  assert.equal(extensionValueMatches('string', 'PC-1475'), true);
  assert.equal(extensionValueMatches('string', 4), false);
  assert.equal(extensionValueMatches('integer', 4), true);
  assert.equal(extensionValueMatches('integer', -4), true);
  assert.equal(extensionValueMatches('integer', 1.5), false);
  assert.equal(extensionValueMatches('integer', '4'), false);
  assert.equal(extensionValueMatches('boolean', false), true);
  assert.equal(extensionValueMatches('boolean', 0), false);
  assert.equal(extensionValueMatches('string-list', []), true);
  assert.equal(extensionValueMatches('string-list', ['mirror']), true);
  assert.equal(extensionValueMatches('string-list', ['mirror', 4]), false);
  assert.equal(extensionValueMatches('string-list', [['mirror']]), false);
  assert.equal(extensionValueMatches('string-list', 'mirror'), false);
  assert.equal(extensionValueMatches('map', { card: 'PC-1475' }), false);
});

test('a ledger with no metadata directory declares nothing, honestly', async () => {
  await withLedgerRoot({}, async (root) => {
    assert.deepEqual(await loadExtensionDeclaration(root), { declared: false, declaration: null });
  });
});

test('a metadata directory with no declaration declares nothing, honestly', async () => {
  await withLedgerRoot({ '.wowbagger/layout.json': '{"layout_version":1,"items_directory":"items"}' }, async (root) => {
    assert.deepEqual(await loadExtensionDeclaration(root), { declared: false, declaration: null });
  });
});

test('a valid declaration loads', async () => {
  await withLedgerRoot({
    '.wowbagger/extensions.json': '{"extensions_version":1,"members":{"external_id":"string"}}',
  }, async (root) => {
    assert.deepEqual(await loadExtensionDeclaration(root), {
      declared: true,
      declaration: { extensions_version: 1, members: { external_id: 'string' } },
    });
  });
});

// A present-but-unusable declaration is a different fact from an absent one,
// and the patch refusal names each of them differently.
test('a malformed declaration is declared but unusable', async () => {
  await withLedgerRoot({ '.wowbagger/extensions.json': '{' }, async (root) => {
    assert.deepEqual(await loadExtensionDeclaration(root), { declared: true, declaration: null });
  });
});

test('a declaration that is a directory is declared but unusable', async () => {
  await withLedgerRoot({ '.wowbagger/extensions.json/occupant.txt': 'occupied\n' }, async (root) => {
    assert.deepEqual(await loadExtensionDeclaration(root), { declared: true, declaration: null });
  });
});

test('a symlinked declaration is never followed', async () => {
  await withLedgerRoot({
    'elsewhere.json': '{"extensions_version":1,"members":{"external_id":"string"}}',
    '.wowbagger/layout.json': '{"layout_version":1,"items_directory":"items"}',
  }, async (root) => {
    await symlink(path.join(root, 'elsewhere.json'), path.join(root, '.wowbagger', 'extensions.json'));
    assert.deepEqual(await loadExtensionDeclaration(root), { declared: true, declaration: null });
  });
});

test('non-UTF-8 declaration bytes are declared but unusable', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wowbagger-extensions-'));
  try {
    await mkdir(path.join(root, '.wowbagger'));
    await writeFile(path.join(root, '.wowbagger', 'extensions.json'), Buffer.from([0xff, 0xfe, 0x00]));
    assert.deepEqual(await loadExtensionDeclaration(root), { declared: true, declaration: null });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
