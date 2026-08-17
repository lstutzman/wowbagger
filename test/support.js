import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const cli = fileURLToPath(new URL('../bin/wowbagger.js', import.meta.url));

// win32 has no FIFO and no socket that lives at a filesystem path, so a case
// whose fixture is one of those is not a case that platform can run. Cases say
// so with this rather than failing on the runner, where the failure would read
// as the core refusing something it does not refuse. Every case carrying it is
// coverage win32 does not obtain — the list belongs in one place for that
// reason, not for convenience.
export const hasPosixSpecialFiles = process.platform !== 'win32';

// The same fact as a `node:test` options object, for a case that is nothing but
// a special file. A case that is only partly one asks `hasPosixSpecialFiles`
// directly rather than reading a skip reason back out of this.
export const posixSpecialFilesOnly = hasPosixSpecialFiles
  ? {}
  : { skip: 'win32 has no FIFO or socket at a filesystem path' };

// A symlink to a directory needs an explicit type on win32, where the default
// is `file` and a file-type link to a directory does not resolve as one. The
// type is `junction` rather than `dir` because win32 creates a junction without
// the symlink privilege, and Node reports either as a symbolic link, which is
// all these fixtures need. `symlink` ignores the type on POSIX.
//
// win32 resolves a junction target against the current directory rather than
// against the link, so a relative target would silently point somewhere else
// there. It is refused here instead of translated: the caller knows which
// directory it meant.
export function linkDirectory(target, linkPath) {
  if (!path.isAbsolute(target)) {
    throw new Error(`linkDirectory needs an absolute target, received ${target}`);
  }
  return symlink(target, linkPath, 'junction');
}

export async function withLedger(files, callback) {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-test-'));
  const ledger = path.join(temporaryDirectory, 'ledger');
  await mkdir(ledger);

  try {
    for (const [relativePath, source] of Object.entries(files)) {
      const destination = path.join(ledger, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, source, 'utf8');
    }

    return await callback(ledger);
  } finally {
    // win32 releases child-held file handles asynchronously; bounded retries
    // keep teardown from racing them. No effect elsewhere.
    await rm(temporaryDirectory, { force: true, recursive: true, maxRetries: 10, retryDelay: 50 });
  }
}

export function runCli(...argumentsList) {
  return spawnSync(process.execPath, [cli, ...argumentsList], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
}
