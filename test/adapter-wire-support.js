import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';

// Shared wire-test scaffolding: spawns an adapter entrypoint for real so
// assertions exercise the actual process boundary, and asserts the §3.3
// wire shape — exactly one JSON object, one trailing LF, nothing else.

export function spawnEntrypoint(entrypoint, args, stdinInput) {
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [entrypoint, ...args], { encoding: 'buffer' });
    let stdout = Buffer.alloc(0);
    child.stdout.on('data', (chunk) => { stdout = Buffer.concat([stdout, chunk]); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout }));
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
