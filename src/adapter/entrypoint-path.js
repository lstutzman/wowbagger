import { hasControlCharacter, isSafeRelativeExecutable } from './manifest.js';

function rejected() {
  return { ok: false, error_code: 'path-rejected' };
}

function replaced() {
  return { ok: false, error_code: 'path-replaced' };
}

// The package root plus every cumulative parent segment (directories), then
// the full executable path (the final regular file), per contract section
// 3.1 / 4: "the package root, every parent component, and the final regular
// file are resolved no-follow and their stable identities are rechecked
// immediately before launch."
function componentsFor(executable) {
  const segments = executable.split('/');
  const components = ['.'];
  for (let index = 1; index < segments.length; index += 1) {
    components.push(segments.slice(0, index).join('/'));
  }
  components.push(executable);
  return components;
}

function isControlFreeNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0 && !hasControlCharacter(value);
}

function isIdentityMember(value) {
  return isControlFreeNonEmptyString(value) || (Number.isSafeInteger(value) && value >= 0);
}

// `identity` is a nonempty control-free opaque token, an exact POSIX
// { dev, ino } object, or an exact Windows { volume_id, file_id } object.
function isValidIdentity(identity) {
  if (isControlFreeNonEmptyString(identity)) {
    return true;
  }
  if (identity === null || typeof identity !== 'object' || Array.isArray(identity)) {
    return false;
  }
  const members = Object.keys(identity).sort().join(',');
  if (members === 'dev,ino') {
    return isIdentityMember(identity.dev) && isIdentityMember(identity.ino);
  }
  if (members === 'file_id,volume_id') {
    return isIdentityMember(identity.volume_id) && isIdentityMember(identity.file_id);
  }
  return false;
}

function identitiesEqual(a, b) {
  if (typeof a === 'string' || typeof b === 'string') {
    return a === b;
  }
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

// Every before/after snapshot is the exact object { kind, identity }. `kind`
// is the required portable kind for that position: `directory` for the
// package root and every parent, `regular-file` for the command executable.
function isValidSnapshot(snapshot, expectedKind) {
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return false;
  }
  if (Object.keys(snapshot).sort().join(',') !== 'identity,kind') {
    return false;
  }
  if (snapshot.kind !== expectedKind) {
    return false;
  }
  return isValidIdentity(snapshot.identity);
}

export function resolveEntrypointPath({ package_root: packageRoot, executable, before, after }) {
  if (typeof packageRoot !== 'string' || packageRoot === '') {
    return rejected();
  }
  if (!isSafeRelativeExecutable(executable)) {
    return rejected();
  }
  if (before === null || typeof before !== 'object' || after === null || typeof after !== 'object') {
    return rejected();
  }

  const components = componentsFor(executable);
  for (const component of components) {
    const expectedKind = component === executable ? 'regular-file' : 'directory';
    if (!isValidSnapshot(before[component], expectedKind) || !isValidSnapshot(after[component], expectedKind)) {
      return rejected();
    }
  }

  for (const component of components) {
    if (!identitiesEqual(before[component].identity, after[component].identity)) {
      return replaced();
    }
  }

  return { ok: true, path: `${packageRoot}/${executable}` };
}
