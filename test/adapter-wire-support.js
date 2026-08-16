import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';

// Shared wire-test scaffolding: spawns an adapter entrypoint for real so
// assertions exercise the actual process boundary, and asserts the §3.3
// wire shape — exactly one JSON object, one trailing LF, nothing else.

// §3.3 makes every entrypoint exit zero, so a non-zero exit is always a
// crash rather than a refusal. Reporting it as a bare code hides the child's
// stderr, which is the only place the crash explains itself; carry the
// stderr into the failure instead (item 106).
export function spawnEntrypoint(entrypoint, args, stdinInput) {
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [entrypoint, ...args], { encoding: 'buffer' });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    child.stdout.on('data', (chunk) => { stdout = Buffer.concat([stdout, chunk]); });
    child.stderr.on('data', (chunk) => { stderr = Buffer.concat([stderr, chunk]); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(
          `${entrypoint} ${args.join(' ')}: exited ${code}\nstderr:\n${stderr.toString('utf8')}`,
        ));
        return;
      }
      resolve({ code, stdout });
    });
    // The entrypoint can be gone before this write lands (it refuses an
    // unknown operation without reading stdin). An unhandled EPIPE here
    // would kill the test process instead of the child's real exit being
    // reported above.
    child.stdin.on('error', () => {});
    child.stdin.end(stdinInput);
  });
}

export function assertSingleJsonObject(stdout) {
  const text = stdout.toString('utf8');
  assert.equal(text.endsWith('\n'), true);
  const body = text.slice(0, -1);
  assert.equal(body.includes('\n'), false);
  return JSON.parse(body);
}
