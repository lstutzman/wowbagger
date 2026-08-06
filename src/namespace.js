import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';

const NAMESPACE = /^wbns_[a-f0-9]{32}$/;

function namespaceFile(repoRoot) {
  return path.join(repoRoot, '.wowbagger', 'namespace');
}

export async function readNamespace(repoRoot) {
  try {
    const text = await readFile(namespaceFile(repoRoot), 'utf8');
    const value = text.trim();
    return NAMESPACE.test(value) ? value : null;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export async function provisionNamespace(repoRoot) {
  const existing = await readNamespace(repoRoot);
  if (existing) return { namespace: existing, created: false };
  await mkdir(path.dirname(namespaceFile(repoRoot)), { recursive: true });
  const namespace = `wbns_${randomBytes(16).toString('hex')}`;
  const handle = await open(namespaceFile(repoRoot), 'wx');
  try {
    await handle.writeFile(`${namespace}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  return { namespace, created: true };
}
