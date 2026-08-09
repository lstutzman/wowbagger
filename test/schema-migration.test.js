import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { withLedger } from './support.js';

const migrationScript = fileURLToPath(new URL('../scripts/migrate-schema-2.js', import.meta.url));
const fixtureRoot = new URL('../spec/fixtures/ready-selection/ledger/', import.meta.url);

const DONE_ID = 'wb_01KDWPVNG05FCBFC6R7R7CJANX';
const BACKLOG_ID = 'wb_01KE1VN3G0HV9ZDBB8BEASXBBG';
const doneSource = readFileSync(new URL('01-foundation.md', fixtureRoot), 'utf8');
const backlogSource = readFileSync(new URL('02-alpha.md', fixtureRoot), 'utf8');

test('dry run reports every schema stamp and writes nothing by default', async () => {
  await withLedger({
    '01-foundation.md': doneSource,
    '02-alpha.md': backlogSource,
  }, async (ledger) => {
    const result = runMigration('--ledger', ledger);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, [
      'NOTICE: This is a quiesced-window maintenance operation. Take a backup before --apply; recovery uses that backup and Git, not the mutation contract.',
      'NOTICE: Schema 1 cleanup history is unrecoverable. Prerequisites previously moved from depends_on to related stay there; no dependency is inferred.',
      `WOULD CHANGE ledger/01-foundation.md (${DONE_ID}): schema_version 1 -> 2`,
      `WOULD CHANGE ledger/02-alpha.md (${BACKLOG_ID}): schema_version 1 -> 2`,
      'Summary: 2 items would change; 0 files written (dry run).',
      '',
    ].join('\n'));
    assert.equal(await readFile(path.join(ledger, '01-foundation.md'), 'utf8'), doneSource);
    assert.equal(await readFile(path.join(ledger, '02-alpha.md'), 'utf8'), backlogSource);
  });
});

function runMigration(...argumentsList) {
  return spawnSync(process.execPath, [migrationScript, ...argumentsList], {
    encoding: 'utf8',
  });
}
