import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';

export function readRegularFixture(root, relativePath) {
  const parts = safeParts(relativePath);
  const rootPath = resolve(root);
  const rootStat = lstatSync(rootPath);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error('fixture root must be a real directory');
  }
  const canonicalRoot = realpathSync(rootPath);
  let current = canonicalRoot;
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`fixture path contains a symlink: ${relativePath}`);
    }
    if (!isWithin(canonicalRoot, realpathSync(current))) {
      throw new Error(`fixture path escapes root: ${relativePath}`);
    }
    if (index < parts.length - 1 && !stat.isDirectory()) {
      throw new Error(`fixture path component is not a directory: ${relativePath}`);
    }
    if (index === parts.length - 1 && !stat.isFile()) {
      throw new Error(`fixture path is not a regular file: ${relativePath}`);
    }
  }

  const descriptor = openSync(current, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    if (!fstatSync(descriptor).isFile()) {
      throw new Error(`fixture path is not a regular file: ${relativePath}`);
    }
    return readFileSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function safeParts(relativePath) {
  if (
    typeof relativePath !== 'string'
    || relativePath.length === 0
    || isAbsolute(relativePath)
    || relativePath.includes('\\')
    || relativePath.includes('\0')
  ) {
    throw new Error('fixture path must be a safe relative path');
  }
  const parts = relativePath.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error('fixture path must be a safe relative path');
  }
  return parts;
}

function isWithin(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}
