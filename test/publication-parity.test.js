// Byte parity across the lock-coarsening stage (ledger item #122).
//
// `test/publication-parity-baseline.json` was recorded from the implementation
// that still took one item lock per ledger item, before the publication
// dropped its lock closure. Every publication outcome class must still produce
// the same response envelope, the same claim journal, and the same item bytes
// as that recording. A change to this file is a work-claim contract change,
// never routine fixture maintenance.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { publicationParityVectors } from './publication-parity-vectors.js';
import { publishClaimed } from '../src/claim-publication.js';
import { resolveGitCommonDir } from '../src/claim-store.js';

const BASELINE = fileURLToPath(new URL('./publication-parity-baseline.json', import.meta.url));

test('every publication outcome preserves the envelope, journal, and item bytes it had before coarsening', async () => {
  const baseline = JSON.parse(await readFile(BASELINE, 'utf8'));

  const vectors = await publicationParityVectors(publishClaimed, resolveGitCommonDir);

  assert.deepEqual(vectors.map(({ name }) => name), baseline.map(({ name }) => name));
  for (const [index, expected] of baseline.entries()) {
    assert.deepEqual(vectors[index], expected, `vector ${expected.name}`);
  }
});
