import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';

const NAMESPACE = /^wbns_[a-f0-9]{32}$/;

function namespaceFile(ledgerDirectory) {
  return path.join(path.resolve(ledgerDirectory), '.wowbagger', 'namespace');
}

export async function readNamespace(ledgerDirectory) {
  try {
    const text = await readFile(namespaceFile(ledgerDirectory), 'utf8');
    const value = text.trim();
    return NAMESPACE.test(value) ? value : null;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export async function provisionNamespace(ledgerDirectory) {
  const existing = await readNamespace(ledgerDirectory);
  if (existing) return { namespace: existing, created: false };
  await mkdir(path.dirname(namespaceFile(ledgerDirectory)), { recursive: true });
  const namespace = `wbns_${randomBytes(16).toString('hex')}`;
  const handle = await open(namespaceFile(ledgerDirectory), 'wx');
  try {
    await handle.writeFile(`${namespace}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  return { namespace, created: true };
}
