import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { provisionNamespace, readNamespace } from '../src/namespace.js';

test('provision creates a canonical namespace and reads it back', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-ns-'));
  const first = await provisionNamespace(root);
  assert.equal(first.created, true);
  assert.match(first.namespace, /^wbns_[a-f0-9]{32}$/);
  assert.equal(await readNamespace(root), first.namespace);
  const onDisk = await readFile(path.join(root, '.wowbagger', 'namespace'), 'utf8');
  assert.equal(onDisk, `${first.namespace}\n`);
});

test('provision never rebinds an existing namespace', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-ns-'));
  const first = await provisionNamespace(root);
  const second = await provisionNamespace(root);
  assert.equal(second.created, false);
  assert.equal(second.namespace, first.namespace);
});

test('an absent namespace reads as null rather than throwing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-ns-'));
  assert.equal(await readNamespace(root), null);
});
