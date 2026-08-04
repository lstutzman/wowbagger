import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const cli = fileURLToPath(new URL('../bin/wowbagger.js', import.meta.url));

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
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

export function runCli(...argumentsList) {
  return spawnSync(process.execPath, [cli, ...argumentsList], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
}
