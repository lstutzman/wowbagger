import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { migrateSchema2 } from '../src/schema-migration.js';
import { withLedger } from './support.js';

const migrationScript = fileURLToPath(new URL('../scripts/migrate-schema-2.js', import.meta.url));
const fixtureRoot = new URL('../spec/fixtures/ready-selection/ledger/', import.meta.url);

const DONE_ID = 'wb_01KDWPVNG05FCBFC6R7R7CJANX';
const BACKLOG_ID = 'wb_01KE1VN3G0HV9ZDBB8BEASXBBG';
const DEPENDENT_ID = 'wb_01KDZ98CG0YH769STZ754EKXSZ';
const doneSource = readFileSync(new URL('01-foundation.md', fixtureRoot), 'utf8');
const backlogSource = readFileSync(new URL('02-alpha.md', fixtureRoot), 'utf8');
const standaloneBacklogSource = backlogSource.replace(`related: [${DONE_ID}]`, 'related: []');

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

test('applies only the schema scalar when explicitly requested', async () => {
  const source = [
    '---',
    'schema_version: 1 # keep this comment',
    `id: ${BACKLOG_ID}`,
    'title: "Keep exact migration bytes"',
    'kind: task',
    'x-policy:',
    '  score: 1.2300',
    'status: backlog',
    'created: 2026-01-03',
    'updated: 2026-01-03',
    'provenance:',
    '  source: "fixture/schema-migration"',
    '  recorded_at: "2026-01-03T12:00:00Z"',
    'depends_on: []',
    'related: []',
    '---',
    '',
    'Body bytes stay exact.',
    '',
  ].join('\r\n');
  const expected = source.replace('schema_version: 1', 'schema_version: 2');

  await withLedger({ 'item.md': source }, async (ledger) => {
    const result = runMigration('--ledger', ledger, '--apply');

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.match(result.stdout, new RegExp(`^CHANGED ledger/item\\.md \\(${BACKLOG_ID}\\): schema_version 1 -> 2$`, 'm'));
    assert.match(result.stdout, /^Summary: 1 item changed\.$/m);
    assert.equal(await readFile(path.join(ledger, 'item.md'), 'utf8'), expected);
  });
});

test('validates schema version 1 before changing stamps', async () => {
  const dependentSource = `---
schema_version: 1
id: ${DEPENDENT_ID}
title: "Retained schema 1 dependency"
kind: task
status: done
created: 2026-01-02
updated: 2026-01-03
completed: 2026-01-03
provenance:
  source: "fixture/schema-migration"
  recorded_at: "2026-01-02T12:00:00Z"
depends_on: [${DONE_ID}]
related: []
decisions:
  - action: complete
    date: 2026-01-03
    summary: "Record invalid schema 1 history."
    rationale: "The migration must refuse rather than reinterpret this state."
---
`;

  await withLedger({
    '01-prerequisite.md': doneSource,
    '02-dependent.md': dependentSource,
  }, async (ledger) => {
    const result = runMigration('--ledger', ledger, '--apply');

    assert.equal(result.status, 1);
    assert.match(result.stderr, /^ERROR \[invalid-schema-1\]:/);
    assert.match(result.stderr, /done-item-has-dependencies/);
    assert.doesNotMatch(result.stdout, /CHANGED|Summary:/);
    assert.equal(await readFile(path.join(ledger, '01-prerequisite.md'), 'utf8'), doneSource);
    assert.equal(await readFile(path.join(ledger, '02-dependent.md'), 'utf8'), dependentSource);
  });
});

test('refuses a mixed schema ledger as a partial migration state', async () => {
  const migratedDoneSource = doneSource.replace('schema_version: 1', 'schema_version: 2');

  await withLedger({
    '01-foundation.md': migratedDoneSource,
    '02-alpha.md': backlogSource,
  }, async (ledger) => {
    const result = runMigration('--ledger', ledger, '--apply');

    assert.equal(result.status, 1);
    assert.match(result.stderr, /^ERROR \[mixed-schema-versions\]:/);
    assert.match(result.stderr, /partial migration state/);
    assert.match(result.stderr, /Restore the complete ledger from the pre-migration backup or Git/);
    assert.match(result.stderr, /validate schema version 1, then rerun the dry run/);
    assert.doesNotMatch(result.stdout, /CHANGED|Summary:/);
    assert.equal(await readFile(path.join(ledger, '01-foundation.md'), 'utf8'), migratedDoneSource);
    assert.equal(await readFile(path.join(ledger, '02-alpha.md'), 'utf8'), backlogSource);
  });
});

test('refuses an already schema version 2 ledger without rewriting it', async () => {
  const migratedDoneSource = doneSource.replace('schema_version: 1', 'schema_version: 2');
  const migratedBacklogSource = backlogSource.replace('schema_version: 1', 'schema_version: 2');

  await withLedger({
    '01-foundation.md': migratedDoneSource,
    '02-alpha.md': migratedBacklogSource,
  }, async (ledger) => {
    const itemPath = path.join(ledger, '01-foundation.md');
    const before = await stat(itemPath);
    const result = runMigration('--ledger', ledger, '--apply');
    const after = await stat(itemPath);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /^ERROR \[already-schema-2\]:/);
    assert.match(result.stderr, /will not run again/);
    assert.match(result.stderr, /Validate the ledger as schema version 2/);
    assert.match(result.stderr, /restore the pre-migration backup or Git/);
    assert.doesNotMatch(result.stdout, /CHANGED|Summary:/);
    assert.equal(after.ino, before.ino);
    assert.equal(await readFile(itemPath, 'utf8'), migratedDoneSource);
  });
});

test('refuses migration while any item lock is held', async () => {
  await withLedger({
    '01-foundation.md': doneSource,
    '02-alpha.md': backlogSource,
  }, async (ledger) => {
    const itemPath = path.join(ledger, '02-alpha.md');
    const lockDirectory = path.join(ledger, '.wowbagger-locks');
    const lockName = `${BACKLOG_ID}.lock`;
    await mkdir(lockDirectory);
    await writeFile(path.join(lockDirectory, lockName), '{malformed lock metadata', 'utf8');
    const before = await stat(itemPath);

    const result = runMigration('--ledger', ledger, '--apply');
    const after = await stat(itemPath);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /^ERROR \[lock-held\]:/);
    assert.match(result.stderr, new RegExp(`\\.wowbagger-locks/${BACKLOG_ID}\\.lock`));
    assert.match(result.stderr, /requires a quiesced window/);
    assert.match(result.stderr, /audited manual recovery/);
    assert.doesNotMatch(result.stdout, /CHANGED|Summary:/);
    assert.equal(after.ino, before.ino);
    assert.equal(await readFile(itemPath, 'utf8'), backlogSource);
  });
});

test('reports loudly when the post-migration ledger does not validate', async () => {
  await withLedger({ 'item.md': standaloneBacklogSource }, async (ledger) => {
    let changedItems = 0;

    await assert.rejects(
      migrateSchema2(ledger, {
        apply: true,
        onItem: async (change) => {
          changedItems += 1;
          const migrated = await readFile(change.file, 'utf8');
          await writeFile(change.file, migrated.replace('status: backlog', 'status: broken'), 'utf8');
        },
      }),
      (error) => {
        assert.equal(error.code, 'post-validation-failed');
        assert.match(error.message, /after 1 of 1 item writes/);
        assert.match(error.message, /Restore the pre-migration backup or Git/);
        assert.ok(error.diagnostics.some((entry) => entry.code === 'unknown-status'));
        return true;
      },
    );

    assert.equal(changedItems, 1);
    const corrupted = await readFile(path.join(ledger, 'item.md'), 'utf8');
    assert.match(corrupted, /schema_version: 2/);
    assert.match(corrupted, /status: broken/);
  });
});

function runMigration(...argumentsList) {
  return spawnSync(process.execPath, [migrationScript, ...argumentsList], {
    encoding: 'utf8',
  });
}
