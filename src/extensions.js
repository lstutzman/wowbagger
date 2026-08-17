import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

// The committed per-ledger extension declaration. It sits beside layout.json
// because it is the same class of artifact: core-owned ledger structure the
// caller names through --ledger, never a discovered configuration walk.
export const EXTENSION_DECLARATION_PATH = '.wowbagger/extensions.json';

// The declared value types. This is deliberately not a schema engine: a
// member is one scalar or one flat list of strings, because those are the
// shapes a whole-value replace can serialize without inventing nesting the
// item never carried. A consumer whose extension member is a map keeps it as
// a reviewable hand-edit; the boundary is stated, not discovered.
export const EXTENSION_VALUE_TYPES = Object.freeze([
  'string',
  'integer',
  'boolean',
  'string-list',
]);

// Names a declaration may never claim. Every one of these is core-owned or
// create-once, so declaring one would smuggle a member past the ownership
// table through a file the core reads. src/mutation.js pins that this set is
// exactly its own core-owned field set.
export const RESERVED_EXTENSION_MEMBERS = Object.freeze([
  'schema_version',
  'id',
  'title',
  'kind',
  'status',
  'created',
  'updated',
  'parent',
  'snoozed_until',
  'completed',
  'killed',
  'archived',
  'deferred',
  'provenance',
  'depends_on',
  'related',
  'decisions',
  'body',
  'number',
  'priority',
]);

const RESERVED = new Set(RESERVED_EXTENSION_MEMBERS);
const TYPES = new Set(EXTENSION_VALUE_TYPES);
// A member name must be a plain YAML key the serializer can write unquoted and
// read back as the same string, so the pattern is narrow on purpose.
const MEMBER_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

// The declaration's own shape. Absence and malformation are both fail-closed:
// `null` here means no member is patchable, and the caller says which of the
// two it was.
export function parseExtensionDeclaration(source) {
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    return null;
  }
  if (value === null || Array.isArray(value) || typeof value !== 'object') return null;
  if (Object.keys(value).sort().join(',') !== 'extensions_version,members') return null;
  if (value.extensions_version !== 1) return null;
  const members = value.members;
  if (members === null || Array.isArray(members) || typeof members !== 'object') return null;
  const names = Object.keys(members);
  if (names.length === 0) return null;
  for (const name of names) {
    if (!MEMBER_NAME.test(name) || RESERVED.has(name) || !TYPES.has(members[name])) return null;
  }
  return { extensions_version: 1, members: { ...members } };
}

// Reads the declaration from the ledger the caller named. The result says
// which of the three states the ledger is in, because the patch refusal names
// a different cause for each.
export async function loadExtensionDeclaration(ledgerDirectory) {
  const file = path.join(path.resolve(ledgerDirectory), ...EXTENSION_DECLARATION_PATH.split('/'));
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    // A missing file, a missing `.wowbagger` directory, and a symlink in
    // either position are all "this ledger declares nothing patchable", except
    // that only the first is an honest absence.
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      return { declared: false, declaration: null };
    }
    return { declared: true, declaration: null };
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) return { declared: true, declaration: null };
    const source = UTF8_DECODER.decode(await handle.readFile());
    const declaration = parseExtensionDeclaration(source);
    return { declared: true, declaration };
  } catch {
    return { declared: true, declaration: null };
  } finally {
    await handle.close();
  }
}

// Whether a requested value matches the type the ledger declared for that
// member. `null` never reaches here: it is the removal convention every
// patchable frontmatter field shares.
export function extensionValueMatches(type, value) {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return typeof value === 'number' && Number.isSafeInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'string-list':
      return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
    default:
      return false;
  }
}
