import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { nextItemNumber } from '../src/mutation.js';
import { validateLedger } from '../src/validate.js';
import { runCli, withLedger } from './support.js';

// A short human handle. The ULID stays canonical and is what identity,
// publication, and the filename use; number is what a person says out loud.

function item(id, extra = {}) {
  return {
    path: `${id}.md`,
    data: {
      schema_version: 1,
      id,
      title: 'Numbered item',
      kind: 'task',
      status: 'backlog',
      created: '2026-08-01',
      updated: '2026-08-01',
      provenance: { source: 'test', recorded_at: '2026-08-01T00:00:00.000Z' },
      depends_on: [],
      related: [],
      ...extra,
    },
  };
}

function errorsFor(items) {
  return validateLedger({ errors: [], items }).errors
    .filter((error) => error.field === 'number');
}

test('accepts a ledger whose items carry no number', () => {
  assert.deepEqual(errorsFor([item('wb_01KZAAAAAAAAAAAAAAAAAAAAAA')]), []);
});

function schema2Item(id, extra = {}) {
  return item(id, { schema_version: 2, decisions: [], ...extra });
}

test('requires a number on a schema-2 item', () => {
  const errors = errorsFor([schema2Item('wb_01KZAAAAAAAAAAAAAAAAAAAAAA')]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'missing-number');
});

test('accepts a schema-2 item that carries a number', () => {
  assert.deepEqual(errorsFor([schema2Item('wb_01KZAAAAAAAAAAAAAAAAAAAAAA', { number: 1 })]), []);
});

test('accepts distinct positive integer numbers', () => {
  assert.deepEqual(errorsFor([
    item('wb_01KZAAAAAAAAAAAAAAAAAAAAAA', { number: 1 }),
    item('wb_01KZBBBBBBBBBBBBBBBBBBBBBB', { number: 2 }),
  ]), []);
});

test('refuses a number shared by two items, flagging each', () => {
  // A collision is recoverable — unlike a ULID collision — but it must be
  // surfaced rather than silently picking one item.
  const errors = errorsFor([
    item('wb_01KZAAAAAAAAAAAAAAAAAAAAAA', { number: 7 }),
    item('wb_01KZBBBBBBBBBBBBBBBBBBBBBB', { number: 7 }),
  ]);

  assert.equal(errors.length, 2);
  assert.ok(errors.every((error) => error.code === 'duplicate-number'));
});

test('refuses a number that is not a positive integer', () => {
  for (const bad of [0, -1, 1.5, '3', null]) {
    const errors = errorsFor([item('wb_01KZAAAAAAAAAAAAAAAAAAAAAA', { number: bad })]);
    assert.equal(errors.length, 1, `expected one error for ${JSON.stringify(bad)}`);
    assert.equal(errors[0].code, 'invalid-number');
  }
});

// The assignment rule (docs/design/2026-08-15-number-identity.md, D2): on a
// schema-2 ledger the core assigns `1 + max(existing numbers)`, or 1 when none
// exist. Numbers are allocated once and never recycled, so a number a terminal
// item still carries keeps counting and the gap it leaves stays a gap.

const A_ID = 'wb_01KZAAAAAAAAAAAAAAAAAAAAAA';
const B_ID = 'wb_01KZBBBBBBBBBBBBBBBBBBBBBB';
const C_ID = 'wb_01KZCCCCCCCCCCCCCCCCCCCCCC';
const CREATED_ID = 'wb_01KZDDDDDDDDDDDDDDDDDDDDDD';

test('assigns 1 when the ledger holds no numbered item', () => {
  assert.equal(nextItemNumber([]), 1);
});

test('assigns one past the highest number whatever order the items arrive in', () => {
  assert.equal(nextItemNumber([
    item(A_ID, { number: 3 }),
    item(B_ID, { number: 1 }),
    item(C_ID, { number: 2 }),
  ]), 4);
});

test('never fills a gap below the highest number', () => {
  // 2 and 3 are free integers, and the rule still says 5. Numbering is
  // allocation, not the smallest available slot.
  assert.equal(nextItemNumber([
    item(A_ID, { number: 1 }),
    item(B_ID, { number: 4 }),
  ]), 5);
});

test('counts a killed item, so the number it holds is never reissued', () => {
  assert.equal(nextItemNumber([
    item(A_ID, { number: 1 }),
    item(B_ID, { number: 9, status: 'killed', killed: '2026-08-02' }),
  ]), 10);
});

test('counts an archived item, so archiving does not free its number', () => {
  assert.equal(nextItemNumber([
    item(A_ID, { number: 6, status: 'archived', archived: '2026-08-02' }),
  ]), 7);
});

test('skips a legacy item that carries no number at all', () => {
  assert.equal(nextItemNumber([
    item(A_ID),
    item(B_ID, { number: 2 }),
  ]), 3);
});

test('create assigns the highest number plus one across a gap', async () => {
  await withLedger({
    [`${A_ID}.md`]: schema2Source(A_ID, 1),
    [`${B_ID}.md`]: schema2Source(B_ID, 4),
  }, async (ledger) => {
    const created = await create(ledger, CREATED_ID);

    assert.equal(created.ok, true, JSON.stringify(created));
    assert.equal(created.result.item.core.number, 5);
  });
});

test('create after the highest-numbered item is killed still goes past it', async () => {
  await withLedger({
    [`${A_ID}.md`]: schema2Source(A_ID, 1),
    [`${B_ID}.md`]: killedSchema2Source(B_ID, 3),
  }, async (ledger) => {
    const created = await create(ledger, CREATED_ID);

    assert.equal(created.ok, true, JSON.stringify(created));
    assert.equal(created.result.item.core.number, 4);
  });
});

test('create refuses while another writer holds the number-index lock', async () => {
  // The number is read and assigned under NUMBER_INDEX_LOCK_ID, so a create
  // that cannot take that lock must refuse rather than assign from a ledger
  // another writer is about to extend.
  await withLedger({ [`${A_ID}.md`]: schema2Source(A_ID, 1) }, async (ledger) => {
    await holdNumberIndexLock(ledger);

    const created = await create(ledger, CREATED_ID);

    assert.equal(created.ok, false, JSON.stringify(created));
    assert.equal(created.error.code, 'lock-held');
    assert.equal(created.error.details.lock_path, '.wowbagger-locks/__number-index__.lock');
    assert.equal(created.error.details.owner.writer_id, 'test-item-number-writer');
    await assert.rejects(readFile(path.join(ledger, `${CREATED_ID}.md`)));
  });
});

test('a schema-1 create is not held by the number-index lock', async () => {
  // The other direction: schema 1 assigns no number, so it must not contend for
  // the number index at all.
  await withLedger({ [`${A_ID}.md`]: schema1Source(A_ID) }, async (ledger) => {
    await holdNumberIndexLock(ledger);

    const created = await create(ledger, CREATED_ID);

    assert.equal(created.ok, true, JSON.stringify(created));
    assert.equal(created.result.item.core.number, undefined);
  });
});

test('the migration numbers unnumbered items from 1 in ledger order', async () => {
  await withLedger({
    '01-first.md': schema1Source(A_ID),
    '02-second.md': schema1Source(B_ID),
  }, async (ledger) => {
    const migration = runMigration('--ledger', ledger, '--apply');

    assert.equal(migration.status, 0, migration.stderr);
    assert.equal(await numberOf(ledger, '01-first.md'), 1);
    assert.equal(await numberOf(ledger, '02-second.md'), 2);
  });
});

test('the migration continues past a number a schema-1 item already carries', async () => {
  await withLedger({
    '01-first.md': schema1Source(A_ID, 'number: 5\n'),
    '02-second.md': schema1Source(B_ID),
  }, async (ledger) => {
    const migration = runMigration('--ledger', ledger, '--apply');

    assert.equal(migration.status, 0, migration.stderr);
    assert.equal(await numberOf(ledger, '01-first.md'), 5);
    assert.equal(await numberOf(ledger, '02-second.md'), 6);
  });
});

const migrationScript = fileURLToPath(new URL('../scripts/migrate-schema-2.js', import.meta.url));

function schema1Source(id, extra = '') {
  return `---
schema_version: 1
id: ${id}
${extra}title: "Numbered ledger item"
kind: task
status: backlog
created: 2026-08-06
updated: 2026-08-06
provenance:
  source: "test/item-number"
  recorded_at: "2026-08-06T00:00:00Z"
depends_on: []
related: []
---

Body bytes stay exact.
`;
}

function schema2Source(id, number) {
  return schema1Source(id, `number: ${number}\n`)
    .replace('schema_version: 1', 'schema_version: 2')
    .replace('related: []\n', 'related: []\ndecisions: []\n');
}

function killedSchema2Source(id, number) {
  return schema2Source(id, number)
    .replace('status: backlog\n', 'status: killed\n')
    .replace('updated: 2026-08-06\n', 'updated: 2026-08-07\nkilled: 2026-08-07\n')
    .replace('decisions: []\n', `decisions:
  - action: kill
    date: 2026-08-07
    summary: "Kill it."
    rationale: "Fixture."
`);
}

async function create(ledger, id) {
  const requestPath = path.join(path.dirname(ledger), `create-${id}.json`);
  await writeFile(requestPath, JSON.stringify({
    id,
    item: {
      title: 'Take the next number',
      kind: 'task',
      provenance: {
        source: 'test/item-number',
        recorded_at: '2026-08-02T00:00:00Z',
      },
      depends_on: [],
    },
    body: '\nA created item.\n',
  }));
  const result = runCli('create', '--ledger', ledger, '--input', requestPath, '--json');
  return JSON.parse(result.stdout);
}

async function holdNumberIndexLock(ledger) {
  const lockDirectory = path.join(ledger, '.wowbagger-locks');
  await mkdir(lockDirectory, { recursive: true });
  await writeFile(path.join(lockDirectory, '__number-index__.lock'), `${JSON.stringify({
    lock_version: 1,
    item_id: '__number-index__',
    operation: 'create',
    writer_id: 'test-item-number-writer',
    started_at: '2026-08-02T00:00:00.000Z',
  })}\n`);
}

async function numberOf(ledger, file) {
  const source = await readFile(path.join(ledger, file), 'utf8');
  const match = /^number: (\d+)$/m.exec(source);
  return match ? Number(match[1]) : null;
}

function runMigration(...argumentsList) {
  return spawnSync(process.execPath, [migrationScript, ...argumentsList], {
    encoding: 'utf8',
  });
}
