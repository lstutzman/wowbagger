import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
// Git answers `GIT_DIR` and its siblings before it answers `cwd`, so an
// inherited value would report a repository the caller never named.
const GIT_ENVIRONMENT = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
);

// Every worktree of one repository owns a private Git directory: the common
// directory itself for the main worktree, `<common>/worktrees/<name>` for a
// linked one. Anything a single worktree must not share with its siblings
// belongs there. Git resolves it; nothing here parses a `.git` file.
export async function resolvePrivateGitDir(directory) {
  const { stdout } = await execFileAsync('git', ['rev-parse', '--absolute-git-dir'], {
    cwd: path.resolve(directory),
    encoding: 'utf8',
    env: GIT_ENVIRONMENT,
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

// The registered worktrees of one repository, as Git itself reports them.
// `--porcelain -z` terminates every attribute with NUL and separates records
// with one extra NUL, so a worktree path holding a newline still parses; the
// newline-delimited spelling cannot promise that. Git emits `worktree <path>`
// first, then `HEAD <oid>` and either `branch <ref>` or `detached`, plus the
// bare, locked, and prunable markers where they apply. An attribute before the
// first `worktree` line cannot exist, and one that does belongs to no record.
export async function listWorktrees(directory) {
  const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain', '-z'], {
    cwd: path.resolve(directory),
    encoding: 'utf8',
    env: GIT_ENVIRONMENT,
    maxBuffer: 16 * 1024 * 1024,
  });
  const worktrees = [];
  let record = null;
  for (const field of stdout.split('\0')) {
    if (field === '') {
      if (record) worktrees.push(record);
      record = null;
      continue;
    }
    const boundary = field.indexOf(' ');
    const name = boundary === -1 ? field : field.slice(0, boundary);
    const value = boundary === -1 ? '' : field.slice(boundary + 1);
    if (name === 'worktree') {
      record = {
        path: value,
        head: null,
        branch: null,
        detached: false,
        bare: false,
        locked: false,
        prunable: false,
      };
      continue;
    }
    if (!record) continue;
    if (name === 'HEAD') record.head = value;
    else if (name === 'branch') record.branch = value;
    else if (name === 'detached') record.detached = true;
    else if (name === 'bare') record.bare = true;
    else if (name === 'locked') record.locked = true;
    else if (name === 'prunable') record.prunable = true;
  }
  if (record) worktrees.push(record);
  return worktrees;
}
