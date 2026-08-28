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
