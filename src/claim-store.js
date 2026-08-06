import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function resolveGitCommonDir(startDir) {
  let current = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(current, '.git');
    let info = null;
    try {
      info = await stat(candidate);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (info?.isDirectory()) return candidate;
    if (info?.isFile()) {
      const text = await readFile(candidate, 'utf8');
      const match = /^gitdir:\s*(.+)\s*$/m.exec(text);
      if (!match) return null;
      const gitDir = path.resolve(current, match[1].trim());
      try {
        const commonText = await readFile(path.join(gitDir, 'commondir'), 'utf8');
        return path.resolve(gitDir, commonText.trim());
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        return gitDir;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function claimStorePath(commonDir, namespace) {
  return path.join(commonDir, 'wowbagger', `claims-${namespace}.json`);
}

export function emptyClaimState(namespace) {
  return { schema_version: 1, ledger_namespace: namespace, clock_floor: null, claims: [] };
}

export async function readClaimState(storePath, namespace) {
  try {
    const parsed = JSON.parse(await readFile(storePath, 'utf8'));
    if (parsed?.ledger_namespace !== namespace) return emptyClaimState(namespace);
    return parsed;
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyClaimState(namespace);
    throw error;
  }
}

export async function writeClaimState(storePath, state) {
  await mkdir(path.dirname(storePath), { recursive: true });
  const ordered = {
    ...state,
    claims: [...state.claims].sort((left, right) => (left.item_id < right.item_id ? -1 : left.item_id > right.item_id ? 1 : 0)),
  };
  const temporary = `${storePath}.tmp`;
  const handle = await open(temporary, 'w');
  try {
    await handle.writeFile(`${JSON.stringify(ordered, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, storePath);
}

export async function withClaimLock(storePath, fn) {
  await mkdir(path.dirname(storePath), { recursive: true });
  const lockPath = `${storePath}.lock`;
  let handle;
  try {
    handle = await open(lockPath, 'wx');
  } catch (error) {
    if (error?.code === 'EEXIST') {
      const held = new Error('claim store lock is held');
      held.code = 'CLAIM_LOCK_HELD';
      throw held;
    }
    throw error;
  }
  try {
    return await fn();
  } finally {
    await handle.close();
    await rm(lockPath, { force: true });
  }
}
