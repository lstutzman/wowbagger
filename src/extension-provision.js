import { CORE_OWNED_FIELDS } from './mutation.js';
import { EXTENSION_VALUE_TYPES, RESERVED_EXTENSION_MEMBERS, extensionValueMatches } from './extensions.js';

const MEMBER_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;
const TYPES = new Set(EXTENSION_VALUE_TYPES);
const RESERVED = new Set(RESERVED_EXTENSION_MEMBERS);

export function proposeExtensionDeclaration({ ledger, members }) {
  if (members === null || typeof members !== 'object' || Array.isArray(members)) {
    return { ok: false, error: { code: 'invalid-extension-selection' } };
  }
  const proposed = {};
  const counts = {};
  for (const [name, type] of Object.entries(members).sort(([left], [right]) => left.localeCompare(right))) {
    if (!MEMBER_NAME.test(name) || RESERVED.has(name) || CORE_OWNED_FIELDS.has(name) || !TYPES.has(type)) {
      return { ok: false, error: { code: 'invalid-extension-selection', member: name } };
    }
    let count = 0;
    for (const item of ledger.items) {
      if (!Object.hasOwn(item.data, name)) continue;
      count += 1;
      if (!extensionValueMatches(type, item.data[name])) {
        return { ok: false, error: { code: 'extension-type-conflict', member: name, type } };
      }
    }
    if (count === 0) return { ok: false, error: { code: 'extension-member-absent', member: name } };
    proposed[name] = type;
    counts[name] = count;
  }
  if (Object.keys(proposed).length === 0) return { ok: false, error: { code: 'invalid-extension-selection' } };
  const source = `${JSON.stringify({ extensions_version: 1, members: proposed })}\n`;
  return { ok: true, declaration: { extensions_version: 1, members: proposed }, source, counts };
}
