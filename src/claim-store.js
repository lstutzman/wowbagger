import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { link, mkdir, open, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const GIT_ENVIRONMENT = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
);

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

export async function resolveVerifiedGitCommonDir(startDir) {
  const discovered = await resolveGitCommonDir(startDir);
  if (!discovered) return null;
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      {
        cwd: path.resolve(startDir),
        encoding: 'utf8',
        env: GIT_ENVIRONMENT,
        maxBuffer: 1024 * 1024,
      },
    );
    const [reported, expected] = await Promise.all([
      realpath(stdout.trim()),
      realpath(discovered),
    ]);
    return reported === expected ? discovered : null;
  } catch {
    return null;
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
  const directory = path.dirname(storePath);
  await mkdir(directory, { recursive: true });
  const lockPath = `${storePath}.lock`;
  const recoveryPath = `${lockPath}.recovery`;
  const owner = { version: 1, pid: process.pid, token: randomUUID() };
  const candidatePath = `${lockPath}.${owner.token}.candidate`;
  const candidate = await open(candidatePath, 'wx');
  try {
    await candidate.writeFile(`${JSON.stringify(owner)}\n`, 'utf8');
    await candidate.sync();
  } finally {
    await candidate.close();
  }

  try {
    await acquireClaimLock(candidatePath, lockPath, recoveryPath);
    try {
      return await fn();
    } finally {
      if ((await readLockOwner(lockPath))?.token === owner.token) {
        await rm(lockPath, { force: true });
      }
    }
  } finally {
    await rm(candidatePath, { force: true });
  }
}

async function acquireClaimLock(candidatePath, lockPath, recoveryPath) {
  for (;;) {
    const recoveryOwner = await readLockOwner(recoveryPath);
    if (recoveryOwner) {
      if (!isDeadProcess(recoveryOwner.pid)) throw claimLockHeld();
      await rm(recoveryPath, { force: true });
      continue;
    }
    try {
      await link(candidatePath, lockPath);
      return;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }

    try {
      await link(candidatePath, recoveryPath);
    } catch (error) {
      if (error?.code === 'EEXIST') continue;
      throw error;
    }
    try {
      const lockOwner = await readLockOwner(lockPath);
      if (!lockOwner || !isDeadProcess(lockOwner.pid)) throw claimLockHeld();
      await rm(lockPath, { force: true });
    } finally {
      await rm(recoveryPath, { force: true });
    }
  }
}

async function readLockOwner(lockPath) {
  let source;
  try {
    source = await readFile(lockPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  try {
    const owner = JSON.parse(source);
    if (owner?.version !== 1
      || !Number.isSafeInteger(owner.pid)
      || owner.pid <= 0
      || typeof owner.token !== 'string'
      || owner.token.length === 0) {
      throw new Error('invalid lock owner');
    }
    return owner;
  } catch {
    throw claimLockHeld();
  }
}

function isDeadProcess(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error?.code === 'ESRCH';
  }
}

function claimLockHeld() {
  const error = new Error('claim store lock is held');
  error.code = 'CLAIM_LOCK_HELD';
  return error;
}
