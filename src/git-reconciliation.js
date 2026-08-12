import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;
const GIT_ENVIRONMENT = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
);

export async function readGitHeadLedger(ledgerDirectory) {
  const root = (await gitText(ledgerDirectory, ['rev-parse', '--show-toplevel'])).trim();
  const relativeLedger = path.relative(root, await realpath(ledgerDirectory));
  if (relativeLedger.startsWith(`..${path.sep}`) || path.isAbsolute(relativeLedger)) {
    throw new Error(`ledger is outside the git worktree: ${relativeLedger}`);
  }
  let commit;
  try {
    commit = (await gitText(root, ['rev-parse', '--verify', 'HEAD'])).trim();
  } catch (error) {
    if (error?.code === 128) return { commit: null, items: new Map(), root };
    throw error;
  }
  const gitLedger = toGitPath(relativeLedger);
  const treeArguments = ['ls-tree', '-r', '-z', '--name-only', 'HEAD'];
  if (gitLedger !== '') treeArguments.push('--', gitLedger);
  const listing = await gitBuffer(root, treeArguments);
  const prefix = gitLedger === '' ? '' : `${gitLedger}/`;
  const files = listing.toString('utf8').split('\0')
    .filter((name) => (
      name.startsWith(prefix)
        && !name.slice(prefix.length).startsWith('.wowbagger/')
        && name.endsWith('.md')
    ));
  const items = new Map();
  for (const file of files) {
    const bytes = await gitBuffer(root, ['show', `HEAD:${file}`]);
    items.set(file.slice(prefix.length), bytes);
  }
  return { commit, items, root };
}

async function gitText(cwd, argumentsList) {
  const { stdout } = await execFileAsync('git', argumentsList, {
    cwd,
    encoding: 'utf8',
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    env: GIT_ENVIRONMENT,
  });
  return stdout;
}

async function gitBuffer(cwd, argumentsList) {
  const { stdout } = await execFileAsync('git', argumentsList, {
    cwd,
    encoding: 'buffer',
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    env: GIT_ENVIRONMENT,
  });
  return stdout;
}

function toGitPath(value) {
  return value.split(path.sep).join('/');
}
