import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runCli, withLedger } from './support.js';

// The contract version the bounded list operation is negotiated under. Written
// as a literal, never imported from src: a test that reads the production
// constant cannot notice the constant moving.
const CORE_CONTRACT_VERSION = 5;

// The advertised list bounds, as literals for the same reason.
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const MAX_TITLE_CHARACTERS = 120;
const MAX_RESPONSE_BYTES = 131072;

function item({
  id,
  number,
  title,
  kind = 'task',
  status = 'backlog',
  priority,
  created = '2026-08-01',
  updated = '2026-08-02',
  dependsOn = [],
  completed,
  body = 'Body.\n',
}) {
  const lines = [
    '---',
    'schema_version: 2',
    `id: ${id}`,
    ...(number === undefined ? [] : [`number: ${number}`]),
    `title: ${JSON.stringify(title)}`,
    `kind: ${kind}`,
    `status: ${status}`,
    ...(priority === undefined ? [] : [`priority: ${priority}`]),
    ...(completed === undefined ? [] : [`completed: ${completed}`]),
    `created: ${created}`,
    `updated: ${updated}`,
    'provenance:',
    '  source: "repository-backlog"',
    '  recorded_at: "2026-08-01T00:00:00Z"',
    `depends_on: ${JSON.stringify(dependsOn)}`,
    'related: []',
    ...(completed === undefined ? ['decisions: []'] : [
      'decisions:',
      '  - action: complete',
      `    date: ${completed}`,
      '    summary: "Complete."',
      '    rationale: "Fixture."',
    ]),
    '---',
    '',
  ];
  return `${lines.join('\n')}${body}`;
}

// Every fixture ID encodes the item's own created date; validation refuses a
// mismatch, so the ID and the created date are chosen together.
const ONE_ID = 'wb_01KYX9XP005JTTAP6D1RDC0EQS';

// Two items share every sort key but their ID, so every order this file asserts
// also pins the immutable-ID tie-break.
const ALPHA_A = 'wb_01KYX9XP00000000000000000A';
const ALPHA_B = 'wb_01KYX9XP00000000000000000B';
const BETA = 'wb_01KYZWAD00000000000000000A';
const GAMMA = 'wb_01KZ2EQ400000000000000000A';
const DELTA = 'wb_01KZ513V00000000000000000A';

const FIXTURE_SOURCES = {
  'alpha-a.md': item({
    id: ALPHA_A, number: 1, title: 'Alpha ledger tool', priority: 0, created: '2026-08-01', updated: '2026-08-01',
  }),
  'alpha-b.md': item({
    id: ALPHA_B, number: 2, title: 'Alpha ledger tool', priority: 0, created: '2026-08-01', updated: '2026-08-01',
  }),
  'beta.md': item({
    id: BETA, number: 3, title: 'Beta report', kind: 'epic', status: 'triage', created: '2026-08-02', updated: '2026-08-05',
  }),
  'gamma.md': item({
    id: GAMMA, number: 4, title: 'Gamma ledger', status: 'done', priority: 2, created: '2026-08-03', updated: '2026-08-03', completed: '2026-08-03',
  }),
  'delta.md': item({
    id: DELTA, number: 5, title: 'Delta blocked', created: '2026-08-04', updated: '2026-08-04', dependsOn: [BETA],
  }),
};

// Ready: the two Alpha items. Beta is an epic in triage, Gamma is done, and
// Delta waits on Beta.
function withFixture(callback) {
  return withLedger(FIXTURE_SOURCES, callback);
}

function idsOf(envelope) {
  return envelope.result.items.map((row) => row.id);
}

async function withQuery(query, callback) {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'wowbagger-list-'));
  const file = path.join(temporaryDirectory, 'query.json');
  try {
    await writeFile(file, JSON.stringify(query), 'utf8');
    return await callback(file);
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

// One list invocation against one ledger: writes the query to a temporary file
// and returns the parsed envelope alongside the raw process result.
async function list(ledger, query) {
  return withQuery(query, (file) => {
    const result = runCli('list', '--ledger', ledger, '--input', file, '--json');
    return { result, envelope: JSON.parse(result.stdout) };
  });
}

function revisionOf(text) {
  return `sha256:${createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')}`;
}

test('list returns one bounded row for each item in a valid ledger', async () => {
  const source = item({ id: ONE_ID, number: 7, title: 'Bound the list query', priority: 1 });

  await withLedger({ 'one.md': source }, async (ledger) => {
    const { result, envelope } = await list(ledger, {
      query_version: 1,
      as_of: '2026-08-21',
      sort: { field: 'number', direction: 'ascending' },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, 'list');
    assert.equal(envelope.contract_version, CORE_CONTRACT_VERSION);
    assert.deepEqual(envelope.result.items, [{
      id: ONE_ID,
      number: 7,
      title: 'Bound the list query',
      title_truncated: false,
      kind: 'task',
      status: 'backlog',
      priority: 1,
      created: '2026-08-01',
      updated: '2026-08-02',
      revision: revisionOf(source),
      ready: true,
    }]);
  });
});

test('list refuses a query that does not match query version 1', async () => {
  await withLedger({ 'one.md': item({ id: ONE_ID, number: 7, title: 'One' }) }, async (ledger) => {
    const { result, envelope } = await list(ledger, {
      query_version: 2,
      filters: { status: [], done: true },
      sort: { field: 'body', direction: 'sideways' },
      page_size: 0,
      colour: 'violet',
    });

    assert.equal(result.status, 2, result.stderr);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.command, 'list');
    assert.equal(envelope.contract_version, CORE_CONTRACT_VERSION);
    assert.equal(envelope.error.code, 'invalid-request');
    assert.equal(envelope.result, undefined);
    assert.deepEqual(envelope.error.details.issues, [
      { path: '/as_of', code: 'missing-member', message: 'Required member as_of is missing.' },
      { path: '/colour', code: 'unknown-member', message: 'Request member colour is not allowed.' },
      { path: '/filters/done', code: 'unknown-member', message: 'Filter member done is not allowed.' },
      {
        path: '/filters/status',
        code: 'invalid-value',
        message: 'Filter member status must be a non-empty array of distinct item statuses.',
      },
      {
        path: '/page_size',
        code: 'invalid-value',
        message: `Member page_size must be an integer from 1 to ${MAX_PAGE_SIZE}.`,
      },
      { path: '/query_version', code: 'invalid-value', message: 'Member query_version must be 1.' },
      {
        path: '/sort/direction',
        code: 'invalid-value',
        message: 'Sort member direction must be ascending or descending.',
      },
      {
        path: '/sort/field',
        code: 'invalid-value',
        message: 'Sort member field must be one of created, id, number, priority, status, title, updated.',
      },
    ]);
  });
});

const BY_NUMBER = { field: 'number', direction: 'ascending' };

test('list filters narrow the snapshot conjunctively', async () => {
  await withFixture(async (ledger) => {
    const cases = [
      [{ status: ['backlog'] }, [ALPHA_A, ALPHA_B, DELTA]],
      [{ status: ['triage', 'done'] }, [BETA, GAMMA]],
      [{ kind: ['epic'] }, [BETA]],
      [{ number: [4, 1] }, [ALPHA_A, GAMMA]],
      [{ ready: true }, [ALPHA_A, ALPHA_B]],
      [{ ready: false }, [BETA, GAMMA, DELTA]],
      [{ status: ['backlog'], ready: true }, [ALPHA_A, ALPHA_B]],
      [{ status: ['backlog'], kind: ['epic'] }, []],
    ];

    for (const [filters, expected] of cases) {
      const { result, envelope } = await list(ledger, {
        query_version: 1,
        as_of: '2026-08-21',
        filters,
        sort: BY_NUMBER,
      });

      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(idsOf(envelope), expected, JSON.stringify(filters));
      assert.equal(envelope.result.snapshot.item_count, 5);
    }
  });
});

test('title_contains matches the full title as a case-sensitive substring', async () => {
  const longTitle = `${'z'.repeat(MAX_TITLE_CHARACTERS)}needle`;

  await withLedger({
    ...FIXTURE_SOURCES,
    'long.md': item({
      id: 'wb_01KZ7KGJ00000000000000000A', number: 6, title: longTitle, created: '2026-08-05', updated: '2026-08-05',
    }),
  }, async (ledger) => {
    const cases = [
      ['ledger', [ALPHA_A, ALPHA_B, GAMMA]],
      ['Ledger', []],
      ['Alpha ledger tool', [ALPHA_A, ALPHA_B]],
      // The excerpt stops before `needle`; the filter still reads the whole
      // stored title.
      ['needle', ['wb_01KZ7KGJ00000000000000000A']],
    ];

    for (const [titleContains, expected] of cases) {
      const { result, envelope } = await list(ledger, {
        query_version: 1,
        as_of: '2026-08-21',
        filters: { title_contains: titleContains },
        sort: BY_NUMBER,
      });

      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(idsOf(envelope), expected, titleContains);
    }
  });
});

// Ascending puts a present value before an absent one; descending is the exact
// reverse of the ascending primary comparison. The ID tie-break stays ascending
// in both directions, so a full traversal is stable.
test('every sort field orders the snapshot and ties break on immutable ID', async () => {
  await withFixture(async (ledger) => {
    const cases = [
      ['number', 'ascending', [ALPHA_A, ALPHA_B, BETA, GAMMA, DELTA]],
      ['number', 'descending', [DELTA, GAMMA, BETA, ALPHA_B, ALPHA_A]],
      ['id', 'ascending', [ALPHA_A, ALPHA_B, BETA, GAMMA, DELTA]],
      ['id', 'descending', [DELTA, GAMMA, BETA, ALPHA_B, ALPHA_A]],
      ['created', 'ascending', [ALPHA_A, ALPHA_B, BETA, GAMMA, DELTA]],
      ['created', 'descending', [DELTA, GAMMA, BETA, ALPHA_A, ALPHA_B]],
      ['updated', 'ascending', [ALPHA_A, ALPHA_B, GAMMA, DELTA, BETA]],
      ['updated', 'descending', [BETA, DELTA, GAMMA, ALPHA_A, ALPHA_B]],
      ['title', 'ascending', [ALPHA_A, ALPHA_B, BETA, DELTA, GAMMA]],
      ['title', 'descending', [GAMMA, DELTA, BETA, ALPHA_A, ALPHA_B]],
      ['status', 'ascending', [ALPHA_A, ALPHA_B, DELTA, GAMMA, BETA]],
      ['status', 'descending', [BETA, GAMMA, ALPHA_A, ALPHA_B, DELTA]],
      // Beta and Delta carry no priority, so they sort last ascending and
      // first descending, still ordered by ID between themselves.
      ['priority', 'ascending', [ALPHA_A, ALPHA_B, GAMMA, BETA, DELTA]],
      ['priority', 'descending', [BETA, DELTA, GAMMA, ALPHA_A, ALPHA_B]],
    ];

    for (const [field, direction, expected] of cases) {
      const { result, envelope } = await list(ledger, {
        query_version: 1,
        as_of: '2026-08-21',
        sort: { field, direction },
      });

      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(idsOf(envelope), expected, `${field} ${direction}`);
    }
  });
});

// The row's title is an excerpt; the order is not. Two items whose titles agree
// on the first `max_list_title_characters` code points and diverge after them
// must order by their full stored titles, not collapse onto the ID tie-break.
test('a title sort orders by the full stored title, not the bounded excerpt', async () => {
  const shared = 'z'.repeat(MAX_TITLE_CHARACTERS);

  await withLedger({
    // The lower ID carries the title that sorts last, so an order that fell
    // through to the ID tie-break would return these two the other way around.
    'later.md': item({
      id: ALPHA_A, number: 1, title: `${shared}zzz`, created: '2026-08-01', updated: '2026-08-01',
    }),
    'earlier.md': item({
      id: ALPHA_B, number: 2, title: `${shared}aaa`, created: '2026-08-01', updated: '2026-08-01',
    }),
  }, async (ledger) => {
    const ascending = await list(ledger, {
      query_version: 1,
      as_of: '2026-08-21',
      sort: { field: 'title', direction: 'ascending' },
    });
    const descending = await list(ledger, {
      query_version: 1,
      as_of: '2026-08-21',
      sort: { field: 'title', direction: 'descending' },
    });

    assert.equal(ascending.result.status, 0, ascending.result.stderr);
    assert.deepEqual(idsOf(ascending.envelope), [ALPHA_B, ALPHA_A]);
    assert.equal(descending.result.status, 0, descending.result.stderr);
    assert.deepEqual(idsOf(descending.envelope), [ALPHA_A, ALPHA_B]);

    // Both rows still project the same truncated excerpt, which is exactly why
    // the excerpt cannot be the sort key.
    for (const row of ascending.envelope.result.items) {
      assert.equal(row.title, shared);
      assert.equal(row.title_truncated, true);
    }
  });
});

test('cursor pagination visits every matching item exactly once', async () => {
  await withFixture(async (ledger) => {
    const first = await list(ledger, {
      query_version: 1,
      as_of: '2026-08-21',
      sort: BY_NUMBER,
      page_size: 2,
    });

    assert.equal(first.result.status, 0, first.result.stderr);
    assert.deepEqual(idsOf(first.envelope), [ALPHA_A, ALPHA_B]);
    assert.equal(first.envelope.result.page.size, 2);
    assert.equal(first.envelope.result.page.offset, 0);
    assert.equal(first.envelope.result.page.returned, 2);
    assert.equal(first.envelope.result.page.matched, 5);
    assert.equal(first.envelope.result.page.has_more, true);
    assert.equal(typeof first.envelope.result.page.next_cursor, 'string');

    const seen = [...idsOf(first.envelope)];
    let cursor = first.envelope.result.page.next_cursor;
    let pages = 1;
    while (cursor !== null) {
      const next = await list(ledger, {
        query_version: 1,
        as_of: '2026-08-21',
        sort: BY_NUMBER,
        page_size: 2,
        cursor,
      });
      assert.equal(next.result.status, 0, next.result.stderr);
      assert.equal(next.envelope.result.snapshot.revision, first.envelope.result.snapshot.revision);
      seen.push(...idsOf(next.envelope));
      cursor = next.envelope.result.page.next_cursor;
      pages += 1;
    }

    assert.equal(pages, 3);
    assert.deepEqual(seen, [ALPHA_A, ALPHA_B, BETA, GAMMA, DELTA]);
    assert.equal(new Set(seen).size, seen.length);
  });
});

test('an omitted page size uses the advertised default and needs no cursor', async () => {
  await withFixture(async (ledger) => {
    const { result, envelope } = await list(ledger, {
      query_version: 1,
      as_of: '2026-08-21',
      sort: BY_NUMBER,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(envelope.result.page, {
      size: DEFAULT_PAGE_SIZE,
      offset: 0,
      returned: 5,
      matched: 5,
      has_more: false,
      next_cursor: null,
    });
  });
});

test('a ledger mutation between pages refuses the old cursor', async () => {
  await withFixture(async (ledger) => {
    const first = await list(ledger, {
      query_version: 1,
      as_of: '2026-08-21',
      sort: BY_NUMBER,
      page_size: 2,
    });
    const cursor = first.envelope.result.page.next_cursor;

    await writeFile(
      path.join(ledger, 'extra.md'),
      item({
        id: 'wb_01KZ7KGJ00000000000000000A', number: 6, title: 'Extra', created: '2026-08-05', updated: '2026-08-05',
      }),
      'utf8',
    );

    const { result, envelope } = await list(ledger, {
      query_version: 1,
      as_of: '2026-08-21',
      sort: BY_NUMBER,
      page_size: 2,
      cursor,
    });

    assert.equal(result.status, 4, result.stderr);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.result, undefined);
    assert.equal(envelope.error.code, 'list-snapshot-changed');
    assert.equal(
      envelope.error.message,
      'The ledger snapshot the cursor was issued against is no longer current.',
    );
    assert.equal(envelope.error.details.mismatch, 'snapshot');
    assert.equal(envelope.error.details.cursor_snapshot_revision, first.envelope.result.snapshot.revision);
    assert.notEqual(envelope.error.details.current_snapshot_revision, first.envelope.result.snapshot.revision);
  });
});

test('a cursor replayed under a different query is refused', async () => {
  await withFixture(async (ledger) => {
    const first = await list(ledger, {
      query_version: 1,
      as_of: '2026-08-21',
      sort: BY_NUMBER,
      page_size: 2,
    });

    const { result, envelope } = await list(ledger, {
      query_version: 1,
      as_of: '2026-08-21',
      sort: { field: 'number', direction: 'descending' },
      page_size: 2,
      cursor: first.envelope.result.page.next_cursor,
    });

    assert.equal(result.status, 4, result.stderr);
    assert.equal(envelope.error.code, 'list-snapshot-changed');
    assert.equal(envelope.error.details.mismatch, 'query');
    assert.equal(envelope.result, undefined);
  });
});

test('a cursor this core did not issue is an invalid request', async () => {
  const forged = [
    'not-a-cursor',
    Buffer.from('{"v":1}', 'utf8').toString('base64url'),
    Buffer.from(JSON.stringify({ v: 2, q: 'x', s: 'y', o: 2 }), 'utf8').toString('base64url'),
    Buffer.from(JSON.stringify({ v: 1, q: 'x', s: 'y', o: 0 }), 'utf8').toString('base64url'),
  ];

  await withFixture(async (ledger) => {
    for (const cursor of forged) {
      const { result, envelope } = await list(ledger, {
        query_version: 1,
        as_of: '2026-08-21',
        sort: BY_NUMBER,
        cursor,
      });

      assert.equal(result.status, 2, `${cursor}: ${result.stderr}`);
      assert.equal(envelope.error.code, 'invalid-request');
      assert.deepEqual(envelope.error.details.issues, [{
        path: '/cursor',
        code: 'invalid-value',
        message: 'Member cursor must be a cursor issued by a previous list response.',
      }]);
    }
  });
});

test('an invalid ledger refuses with no rows beside the error', async () => {
  await withLedger({
    ...FIXTURE_SOURCES,
    'broken.md': item({
      id: 'wb_01KZ7KGJ00000000000000000A', number: 6, title: 'Broken', created: '2026-08-04', updated: '2026-08-05',
    }),
  }, async (ledger) => {
    const { result, envelope } = await list(ledger, {
      query_version: 1,
      as_of: '2026-08-21',
      sort: BY_NUMBER,
    });

    assert.equal(result.status, 3, result.stderr);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.command, 'list');
    assert.equal(envelope.contract_version, CORE_CONTRACT_VERSION);
    assert.equal(envelope.error.code, 'ledger-invalid');
    assert.equal(envelope.error.message, 'The configured ledger is invalid.');
    assert.equal(envelope.result, undefined);
    assert.equal(envelope.error.details.items, undefined);
    assert.ok(envelope.error.details.validation_errors.length > 0);
  });
});

test('an empty ledger lists nothing and still witnesses its snapshot', async () => {
  await withLedger({}, async (ledger) => {
    const { result, envelope } = await list(ledger, {
      query_version: 1,
      as_of: '2026-08-21',
      sort: BY_NUMBER,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(envelope.result.items, []);
    assert.equal(envelope.result.snapshot.item_count, 0);
    assert.match(envelope.result.snapshot.revision, /^sha256:[0-9a-f]{64}$/);
    assert.deepEqual(envelope.result.page, {
      size: DEFAULT_PAGE_SIZE,
      offset: 0,
      returned: 0,
      matched: 0,
      has_more: false,
      next_cursor: null,
    });
  });
});

test('the title projection is bounded by code point and flags truncation', async () => {
  // An astral character is two UTF-16 code units and one code point; the
  // excerpt must never split it.
  const exact = '\u{1F5FA}'.repeat(MAX_TITLE_CHARACTERS);
  const over = `${exact}\u{1F5FA}tail`;

  await withLedger({
    'exact.md': item({
      id: ALPHA_A, number: 1, title: exact, created: '2026-08-01', updated: '2026-08-01',
    }),
    'over.md': item({
      id: ALPHA_B, number: 2, title: over, created: '2026-08-01', updated: '2026-08-01',
    }),
  }, async (ledger) => {
    const { result, envelope } = await list(ledger, {
      query_version: 1,
      as_of: '2026-08-21',
      sort: BY_NUMBER,
    });

    assert.equal(result.status, 0, result.stderr);
    const [first, second] = envelope.result.items;
    assert.equal(first.title, exact);
    assert.equal(first.title_truncated, false);
    assert.equal(second.title, exact);
    assert.equal(second.title_truncated, true);
    assert.equal([...second.title].length, MAX_TITLE_CHARACTERS);
  });
});

// The same created date for every item, so each ID needs only a distinct
// Crockford suffix.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function wideLedger(count) {
  // Twelve JSON bytes per astral code point, so a full-width page of these
  // rows cannot fit the advertised response bound.
  const title = '\u{1F5FA}'.repeat(MAX_TITLE_CHARACTERS);
  const sources = {};
  for (let index = 0; index < count; index += 1) {
    const suffix = `${CROCKFORD[Math.floor(index / 32)]}${CROCKFORD[index % 32]}`;
    sources[`wide-${index}.md`] = item({
      id: `wb_01KYX9XP0000000000000000${suffix}`,
      number: index + 1,
      title,
      created: '2026-08-01',
      updated: '2026-08-01',
    });
  }
  return sources;
}

test('a page whose exact rows exceed the response bound refuses rather than truncating', async () => {
  await withLedger(wideLedger(MAX_PAGE_SIZE), async (ledger) => {
    const refused = await list(ledger, {
      query_version: 1,
      as_of: '2026-08-21',
      sort: BY_NUMBER,
      page_size: MAX_PAGE_SIZE,
    });

    assert.equal(refused.result.status, 2, refused.result.stderr);
    assert.equal(refused.envelope.ok, false);
    assert.equal(refused.envelope.result, undefined);
    assert.equal(refused.envelope.error.code, 'list-response-too-large');
    assert.equal(
      refused.envelope.error.message,
      'The requested page does not fit the supported list response byte limit.',
    );
    assert.equal(refused.envelope.error.details.max_list_response_bytes, MAX_RESPONSE_BYTES);
    assert.equal(refused.envelope.error.details.page_size, MAX_PAGE_SIZE);
    assert.ok(refused.envelope.error.details.response_bytes > MAX_RESPONSE_BYTES);

    const accepted = await list(ledger, {
      query_version: 1,
      as_of: '2026-08-21',
      sort: BY_NUMBER,
      page_size: 20,
    });

    assert.equal(accepted.result.status, 0, accepted.result.stderr);
    assert.equal(accepted.envelope.result.page.returned, 20);
    assert.ok(Buffer.byteLength(accepted.result.stdout, 'utf8') <= MAX_RESPONSE_BYTES);
  });
});

test('capabilities negotiates core contract version 5 and advertises the list bounds', () => {
  const result = runCli('capabilities', '--json');

  assert.equal(result.status, 0, result.stderr);
  const envelope = JSON.parse(result.stdout);

  assert.equal(envelope.contract_version, CORE_CONTRACT_VERSION);
  assert.deepEqual(envelope.result.operations.list, {
    supported: true,
    write_scope: 'none',
    cas_scope: 'none',
    query_version: 1,
  });
  assert.equal(envelope.result.limits.default_list_page_size, DEFAULT_PAGE_SIZE);
  assert.equal(envelope.result.limits.max_list_page_size, MAX_PAGE_SIZE);
  assert.equal(envelope.result.limits.max_list_title_characters, MAX_TITLE_CHARACTERS);
  assert.equal(envelope.result.limits.max_list_response_bytes, MAX_RESPONSE_BYTES);

  // The list members join an existing envelope; nothing already advertised
  // moves or disappears.
  assert.deepEqual(Object.keys(envelope.result.operations), [
    'inspect', 'list', 'create', 'transition', 'patch', 'work_claim',
  ]);
  assert.deepEqual(Object.keys(envelope.result.limits), [
    'max_item_source_bytes',
    'default_list_page_size',
    'max_list_page_size',
    'max_list_title_characters',
    'max_list_response_bytes',
    'multi_item_atomicity',
    'cross_clone_coordination',
    'cross_worktree_coordination',
    'cross_machine_coordination',
    'noncooperating_writer_protection',
    'automatic_stale_lock_breaking',
  ]);
});

test('list appears in the global help and states its own usage', () => {
  const help = runCli('--help');
  const listHelp = runCli('list', '--help');

  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /^ {2}list {9}List a validated ledger as bounded, paginated item summaries\.$/m);
  assert.equal(listHelp.status, 0, listHelp.stderr);
  assert.match(listHelp.stdout, /Usage: wowbagger list --ledger <dir> --input <json-file\|-> --json/);
});
