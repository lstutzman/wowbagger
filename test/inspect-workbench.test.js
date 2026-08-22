import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runCli, withLedger } from './support.js';

// The contract version the workbench projection is negotiated under. Written as
// a literal, never imported from src: a test that reads the production constant
// cannot notice the constant moving.
const CORE_CONTRACT_VERSION = 5;

// The advertised workbench bounds, as literals for the same reason.
const PROJECTION_VERSION = 1;
const MAX_RESPONSE_BYTES = 65536;

function item({
  id,
  number,
  title,
  kind = 'task',
  status = 'backlog',
  priority,
  parent,
  created = '2026-08-01',
  updated = '2026-08-02',
  dependsOn = [],
  related = [],
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
    ...(parent === undefined ? [] : [`parent: ${parent}`]),
    ...(completed === undefined ? [] : [`completed: ${completed}`]),
    `created: ${created}`,
    `updated: ${updated}`,
    'provenance:',
    '  source: "test/inspect-workbench"',
    '  recorded_at: "2026-08-01T00:00:00Z"',
    `depends_on: ${JSON.stringify(dependsOn)}`,
    `related: ${JSON.stringify(related)}`,
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
const TASK = 'wb_01KYX9XP00000000000000000A';

const FIXTURE_SOURCES = {
  'task.md': item({ id: TASK, number: 1, title: 'Backlog task', priority: 1 }),
};

// The lifecycle fixture: an epic in backlog with one live dependency, one
// nonterminal child, and one dependent task, beside one terminal task. Between
// them they hold every observed refusal an option can carry.
const EPIC = 'wb_01KYZWAD00000000000000000A';
const CHILD = 'wb_01KZ2EQ400000000000000000A';
const DEPENDENT = 'wb_01KZ2EQ400000000000000000B';
const LIVE = 'wb_01KZ513V00000000000000000A';
const TERMINAL = 'wb_01KZ513V00000000000000000B';

const LIFECYCLE_SOURCES = {
  'epic.md': item({
    id: EPIC, number: 10, title: 'Epic in backlog', kind: 'epic', created: '2026-08-02', updated: '2026-08-05', dependsOn: [LIVE],
  }),
  'child.md': item({
    id: CHILD, number: 11, title: 'Child in progress', status: 'in-progress', parent: EPIC, created: '2026-08-03', updated: '2026-08-03',
  }),
  'dependent.md': item({
    id: DEPENDENT, number: 12, title: 'Dependent task', created: '2026-08-03', updated: '2026-08-03', dependsOn: [EPIC],
  }),
  'live.md': item({
    id: LIVE, number: 13, title: 'Live dependency', created: '2026-08-04', updated: '2026-08-04',
  }),
  'terminal.md': item({
    id: TERMINAL, number: 14, title: 'Terminal task', status: 'done', created: '2026-08-04', updated: '2026-08-04', completed: '2026-08-04',
  }),
};

function workbench(ledger, ...argumentsList) {
  const result = runCli('inspect', '--ledger', ledger, ...argumentsList, '--json');
  return { result, envelope: JSON.parse(result.stdout) };
}

test('--workbench without --as-of is a deterministic invalid request', async () => {
  await withLedger(FIXTURE_SOURCES, async (ledger) => {
    const { result, envelope } = workbench(ledger, '--id', TASK, '--workbench');

    assert.equal(result.status, 2, result.stdout);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.command, 'inspect');
    assert.equal(envelope.contract_version, CORE_CONTRACT_VERSION);
    assert.equal(envelope.error.code, 'invalid-request');
    assert.deepEqual(envelope.error.details.issues, [{
      path: '/arguments',
      code: 'missing-argument',
      message: 'Argument --as-of is required with --workbench.',
    }]);
  });
});

test('--as-of without --workbench is refused rather than silently ignored', async () => {
  await withLedger(FIXTURE_SOURCES, async (ledger) => {
    const { result, envelope } = workbench(ledger, '--id', TASK, '--as-of', '2026-08-22');

    assert.equal(result.status, 2, result.stdout);
    assert.deepEqual(envelope.error.details.issues, [{
      path: '/arguments',
      code: 'conflicting-argument',
      message: 'Argument --as-of is accepted only with --workbench.',
    }]);
  });
});

test('--as-of must be an ISO calendar date', async () => {
  await withLedger(FIXTURE_SOURCES, async (ledger) => {
    const { result, envelope } = workbench(ledger, '--id', TASK, '--workbench', '--as-of', '22-08-2026');

    assert.equal(result.status, 2, result.stdout);
    assert.deepEqual(envelope.error.details.issues, [{
      path: '/arguments',
      code: 'invalid-value',
      message: 'Argument --as-of must be an ISO calendar date.',
    }]);
  });
});

test('the workbench projection answers under its own result member', async () => {
  await withLedger(FIXTURE_SOURCES, async (ledger) => {
    const { result, envelope } = workbench(ledger, '--id', TASK, '--workbench', '--as-of', '2026-08-22');

    assert.equal(result.status, 0, result.stdout);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, 'inspect');
    assert.equal(envelope.contract_version, CORE_CONTRACT_VERSION);
    assert.deepEqual(Object.keys(envelope.result), ['workbench']);
    assert.equal(envelope.result.workbench.projection_version, PROJECTION_VERSION);
    assert.equal(envelope.result.workbench.as_of, '2026-08-22');
  });
});

test('the item projection carries bounded identity, lifecycle, and readiness', async () => {
  await withLedger(FIXTURE_SOURCES, async (ledger) => {
    const { result, envelope } = workbench(ledger, '--id', TASK, '--workbench', '--as-of', '2026-08-22');
    const lossless = JSON.parse(runCli('inspect', '--ledger', ledger, '--id', TASK, '--json').stdout);

    assert.equal(result.status, 0, result.stdout);
    assert.deepEqual(envelope.result.workbench.item, {
      id: TASK,
      number: 1,
      title: 'Backlog task',
      title_truncated: false,
      kind: 'task',
      status: 'backlog',
      priority: 1,
      created: '2026-08-01',
      updated: '2026-08-02',
      revision: lossless.result.item.revision,
      ready: true,
      depends_on: { entries: [], total: 0, truncated: false },
      related: { entries: [], total: 0, truncated: false },
    });
  });
});

const EMPTY_COLLECTION = { entries: [], total: 0, truncated: false };

test('transition options name every allowed target with its generated action', async () => {
  await withLedger(FIXTURE_SOURCES, async (ledger) => {
    const { result, envelope } = workbench(ledger, '--id', TASK, '--workbench', '--as-of', '2026-08-22');

    assert.equal(result.status, 0, result.stdout);
    assert.deepEqual(envelope.result.workbench.transition_options, [
      {
        to_status: 'archived',
        action: 'archive',
        decision_required: true,
        minimum_date: '2026-08-02',
        enabled: true,
        precondition_issues: EMPTY_COLLECTION,
        blockers: EMPTY_COLLECTION,
      },
      {
        to_status: 'deferred',
        action: 'defer',
        decision_required: true,
        minimum_date: '2026-08-02',
        enabled: true,
        precondition_issues: EMPTY_COLLECTION,
        blockers: EMPTY_COLLECTION,
      },
      {
        to_status: 'in-progress',
        action: null,
        decision_required: false,
        minimum_date: '2026-08-02',
        enabled: true,
        precondition_issues: EMPTY_COLLECTION,
        blockers: EMPTY_COLLECTION,
      },
      {
        to_status: 'killed',
        action: 'kill',
        decision_required: true,
        minimum_date: '2026-08-02',
        enabled: true,
        precondition_issues: EMPTY_COLLECTION,
        blockers: EMPTY_COLLECTION,
      },
    ]);
  });
});

test('the projection names the snapshot it observed and disclaims exclusive authority', async () => {
  await withLedger(FIXTURE_SOURCES, async (ledger) => {
    const { result, envelope } = workbench(ledger, '--id', TASK, '--workbench', '--as-of', '2026-08-22');
    const projection = envelope.result.workbench;

    assert.equal(result.status, 0, result.stdout);
    assert.deepEqual(Object.keys(projection), [
      'projection_version', 'as_of', 'snapshot', 'observation', 'item', 'transition_options',
    ]);
    assert.deepEqual(Object.keys(projection.snapshot), ['revision', 'item_count']);
    assert.match(projection.snapshot.revision, /^sha256:[0-9a-f]{64}$/);
    assert.equal(projection.snapshot.item_count, 1);
    assert.deepEqual(projection.observation, {
      authority: 'observed-snapshot',
      rechecked_by: ['revision', 'lock', 'claim-fence', 'reconciliation', 'candidate-validation'],
    });
  });
});

test('a terminal item offers no lifecycle target', async () => {
  await withLedger(LIFECYCLE_SOURCES, async (ledger) => {
    const { result, envelope } = workbench(ledger, '--id', TERMINAL, '--workbench', '--as-of', '2026-08-22');

    assert.equal(result.status, 0, result.stdout);
    assert.equal(envelope.result.workbench.item.status, 'done');
    assert.deepEqual(envelope.result.workbench.transition_options, []);
  });
});

test('an epic reports its observed precondition issues and disposition blockers', async () => {
  await withLedger(LIFECYCLE_SOURCES, async (ledger) => {
    const { result, envelope } = workbench(ledger, '--number', '10', '--workbench', '--as-of', '2026-08-22');
    const options = envelope.result.workbench.transition_options;

    assert.equal(result.status, 0, result.stdout);
    assert.deepEqual(options.map((option) => option.to_status), [
      'archived', 'deferred', 'done', 'killed',
    ]);
    assert.deepEqual(options.map((option) => option.enabled), [false, true, false, false]);
    // Every option is dated from the item's own dates: updated is later than
    // created here, so the minimum legal date is updated.
    assert.deepEqual(new Set(options.map((option) => option.minimum_date)), new Set(['2026-08-05']));

    const completion = options.find((option) => option.to_status === 'done');
    assert.equal(completion.action, 'complete');
    assert.equal(completion.decision_required, true);
    assert.deepEqual(completion.precondition_issues, {
      entries: [
        {
          code: 'live-dependencies',
          field: 'depends_on',
          message: 'Completion requires every depends_on target to be done.',
          related_ids: { entries: [LIVE], total: 1, truncated: false },
        },
        {
          code: 'nonterminal-children',
          field: 'parent',
          message: 'Epic completion requires every direct child to be done or killed.',
          related_ids: { entries: [CHILD], total: 1, truncated: false },
        },
      ],
      total: 2,
      truncated: false,
    });
    assert.deepEqual(completion.blockers, EMPTY_COLLECTION);

    const killed = options.find((option) => option.to_status === 'killed');
    assert.deepEqual(killed.blockers, {
      entries: [
        { code: 'child-disposition', item_id: CHILD, field: 'parent' },
        { code: 'dependent-disposition', item_id: DEPENDENT, field: 'depends_on' },
      ],
      total: 2,
      truncated: false,
    });
    assert.deepEqual(killed.precondition_issues, EMPTY_COLLECTION);
  });
});

test('a child item projects its parent and its blocked readiness', async () => {
  await withLedger(LIFECYCLE_SOURCES, async (ledger) => {
    const { envelope } = workbench(ledger, '--id', CHILD, '--workbench', '--as-of', '2026-08-22');

    assert.equal(envelope.result.workbench.item.parent, EPIC);
    assert.equal(envelope.result.workbench.item.ready, false);
    assert.deepEqual(
      envelope.result.workbench.transition_options.map((option) => option.to_status),
      ['backlog', 'done', 'killed'],
    );
  });
});

// The advertised entry bound, and one more than it, so every bounded collection
// is exercised on both sides of the cut.
const MAX_COLLECTION_ENTRIES = 50;
const WIDE_COUNT = 60;
const MAX_TITLE_CHARACTERS = 120;

// A ULID's first ten characters carry its timestamp, so every generated ID here
// keeps the 2026-08-04 prefix and varies only the random tail.
const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function wideId(index) {
  const tail = `${ULID_ALPHABET[Math.floor(index / 32)]}${ULID_ALPHABET[index % 32]}`;
  return `wb_01KZ513V00${'0'.repeat(14)}${tail}`;
}

const WIDE_BLOCKED = wideId(WIDE_COUNT);
const WIDE_DEPENDENT = wideId(WIDE_COUNT + 1);
const WIDE_MIDDLE = Array.from({ length: WIDE_COUNT }, (unused, index) => wideId(index));

// `WIDE_DEPENDENT` depends on all sixty middle items, and every middle item
// depends on `WIDE_BLOCKED`: one ledger holds an oversized relation list, an
// oversized related-ID list, and an oversized blocker list.
const WIDE_SOURCES = {
  'blocked.md': item({
    id: WIDE_BLOCKED, number: 1, title: 'Blocked by many', created: '2026-08-04', updated: '2026-08-04',
  }),
  ...Object.fromEntries(WIDE_MIDDLE.map((id, index) => [`middle-${index}.md`, item({
    id, number: index + 2, title: `Middle ${index}`, created: '2026-08-04', updated: '2026-08-04', dependsOn: [WIDE_BLOCKED],
  })])),
  'dependent.md': item({
    id: WIDE_DEPENDENT,
    number: WIDE_COUNT + 2,
    title: 'W'.repeat(MAX_TITLE_CHARACTERS + 10),
    status: 'in-progress',
    created: '2026-08-04',
    updated: '2026-08-04',
    dependsOn: WIDE_MIDDLE,
  }),
};

test('every variable-size field is bounded and says what it left out', async () => {
  await withLedger(WIDE_SOURCES, async (ledger) => {
    const { result, envelope } = workbench(ledger, '--id', WIDE_DEPENDENT, '--workbench', '--as-of', '2026-08-22');
    const projection = envelope.result.workbench;

    assert.equal(result.status, 0, result.stdout);
    assert.equal(projection.item.title.length, MAX_TITLE_CHARACTERS);
    assert.equal(projection.item.title_truncated, true);
    assert.equal(projection.item.depends_on.entries.length, MAX_COLLECTION_ENTRIES);
    assert.equal(projection.item.depends_on.total, WIDE_COUNT);
    assert.equal(projection.item.depends_on.truncated, true);

    const completion = projection.transition_options.find((option) => option.to_status === 'done');
    const live = completion.precondition_issues.entries[0];
    assert.equal(live.code, 'live-dependencies');
    assert.equal(live.related_ids.entries.length, MAX_COLLECTION_ENTRIES);
    assert.equal(live.related_ids.total, WIDE_COUNT);
    assert.equal(live.related_ids.truncated, true);
  });
});

test('an oversized blocker list is bounded the same way', async () => {
  await withLedger(WIDE_SOURCES, async (ledger) => {
    const { envelope } = workbench(ledger, '--id', WIDE_BLOCKED, '--workbench', '--as-of', '2026-08-22');
    const killed = envelope.result.workbench.transition_options
      .find((option) => option.to_status === 'killed');

    assert.equal(killed.enabled, false);
    assert.equal(killed.blockers.entries.length, MAX_COLLECTION_ENTRIES);
    assert.equal(killed.blockers.total, WIDE_COUNT);
    assert.equal(killed.blockers.truncated, true);
  });
});

test('an invalid ledger refuses the projection and attaches no item', async () => {
  const broken = {
    ...FIXTURE_SOURCES,
    'broken.md': item({ id: 'wb_01KYZWAD00000000000000000A', number: 2, title: 'Broken', status: 'nonsense', created: '2026-08-02', updated: '2026-08-02' }),
  };
  await withLedger(broken, async (ledger) => {
    const { result, envelope } = workbench(ledger, '--id', TASK, '--workbench', '--as-of', '2026-08-22');
    const lossless = JSON.parse(runCli('inspect', '--ledger', ledger, '--id', TASK, '--json').stdout);

    assert.equal(result.status, 3, result.stdout);
    assert.equal(envelope.error.code, 'ledger-invalid');
    assert.deepEqual(Object.keys(envelope.error.details), ['validation_errors']);
    assert.ok(envelope.error.details.validation_errors.length > 0);
    // The default read still shows the operator the bytes it tells them to
    // repair around. The workbench read cannot: an affordance derived from an
    // unvalidated ledger would be a judgement this core has not made.
    assert.ok(lossless.error.details.item);
  });
});

test('an unresolved selector is item-not-found with the selector the caller used', async () => {
  await withLedger(FIXTURE_SOURCES, async (ledger) => {
    const byNumber = workbench(ledger, '--number', '999', '--workbench', '--as-of', '2026-08-22');
    const byId = workbench(ledger, '--id', 'wb_01KZ513V00000000000000000A', '--workbench', '--as-of', '2026-08-22');

    assert.equal(byNumber.result.status, 2, byNumber.result.stdout);
    assert.equal(byNumber.envelope.error.code, 'item-not-found');
    assert.deepEqual(byNumber.envelope.error.details, { number: 999 });
    assert.equal(byId.result.status, 2, byId.result.stdout);
    assert.deepEqual(byId.envelope.error.details, { id: 'wb_01KZ513V00000000000000000A' });
  });
});

test('capabilities advertise the workbench projection and its exact bounds', () => {
  const result = runCli('capabilities', '--json');
  const envelope = JSON.parse(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(envelope.result.operations.inspect, {
    supported: true,
    write_scope: 'none',
    cas_scope: 'none',
    workbench: { supported: true, projection_version: PROJECTION_VERSION },
  });
  assert.equal(envelope.result.limits.max_workbench_title_characters, MAX_TITLE_CHARACTERS);
  assert.equal(envelope.result.limits.max_workbench_collection_entries, MAX_COLLECTION_ENTRIES);
  assert.equal(envelope.result.limits.max_workbench_response_bytes, MAX_RESPONSE_BYTES);

  // The workbench members join the advertised list; nothing already advertised
  // moves or disappears.
  assert.deepEqual(Object.keys(envelope.result.limits), [
    'max_item_source_bytes',
    'default_list_page_size',
    'max_list_page_size',
    'max_list_title_characters',
    'max_list_response_bytes',
    'max_workbench_title_characters',
    'max_workbench_collection_entries',
    'max_workbench_response_bytes',
    'multi_item_atomicity',
    'cross_clone_coordination',
    'cross_worktree_coordination',
    'cross_machine_coordination',
    'noncooperating_writer_protection',
    'automatic_stale_lock_breaking',
  ]);
});

// The bounded collections above keep every real projection far inside the
// advertised response bound, so the fail-closed path is reachable only through
// the fixture scenario. It is executed rather than assumed: a promise nobody has
// seen kept is a promise nobody has evidence for.
test('a projection over the advertised response bound is refused whole', async () => {
  await withLedger(FIXTURE_SOURCES, async (ledger) => {
    const runner = fileURLToPath(new URL('./mutation-runner.js', import.meta.url));
    const result = spawnSync(process.execPath, [
      runner, 'inspect', '--ledger', ledger, '--id', TASK, '--workbench', '--as-of', '2026-08-22', '--json',
    ], {
      encoding: 'utf8',
      env: { ...process.env, WOWBAGGER_TEST_SCENARIO: 'workbench-response-exceeds-bound' },
    });
    const envelope = JSON.parse(result.stdout);

    assert.equal(result.status, 2, result.stdout);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.command, 'inspect');
    assert.equal(envelope.error.code, 'workbench-response-too-large');
    assert.deepEqual(envelope.error.details, {
      id: TASK,
      max_workbench_response_bytes: MAX_RESPONSE_BYTES,
      response_bytes: MAX_RESPONSE_BYTES + 1,
    });
  });
});

// The whole status vocabulary, so the sweep below asks about targets the
// projection does not advertise as well as the ones it does.
const ALL_STATUSES = [
  'archived', 'backlog', 'deferred', 'done', 'in-progress', 'killed', 'triage',
];

// Strips the projection's bounded-collection wrapper so an option's issues can
// be compared against the refusal `transition` writes, which carries the same
// vocabulary as plain arrays.
function unwrapIssues(collection) {
  return collection.entries.map((entry) => ({
    ...entry,
    related_ids: entry.related_ids.entries,
  }));
}

async function transitionTo(ledger, request) {
  const requestPath = path.join(path.dirname(ledger), 'transition.json');
  await writeFile(requestPath, JSON.stringify(request));
  const result = runCli('transition', '--ledger', ledger, '--input', requestPath, '--json');
  return { result, envelope: JSON.parse(result.stdout) };
}

// The acceptance criterion the affordance exists for: the projection and the
// mutation share one lifecycle definition, so no advertised edge, action,
// precondition, or blocker may differ from what `transition` actually does. The
// sweep dispatches every real transition against a fresh ledger.
test('every projected option matches what transition does with it', async () => {
  const items = Object.values(LIFECYCLE_SOURCES).length;
  assert.equal(items, 5);

  for (const subject of [EPIC, CHILD, DEPENDENT, LIVE, TERMINAL]) {
    const projected = await withLedger(LIFECYCLE_SOURCES, (ledger) => (
      workbench(ledger, '--id', subject, '--workbench', '--as-of', '2026-08-22').envelope.result.workbench
    ));

    for (const toStatus of ALL_STATUSES) {
      const option = projected.transition_options.find((entry) => entry.to_status === toStatus);
      const request = {
        id: subject,
        expected_revision: projected.item.revision,
        to_status: toStatus,
        date: projected.transition_options[0]?.minimum_date ?? '2026-08-22',
        ...(option?.decision_required
          ? { decision: { summary: 'Sweep the edge.', rationale: 'Differential guard.' } }
          : {}),
      };
      const { result, envelope } = await withLedger(LIFECYCLE_SOURCES, (ledger) => (
        transitionTo(ledger, request)
      ));
      const label = `${subject} -> ${toStatus}`;

      if (option === undefined) {
        // An unadvertised target must be an edge the mutation refuses as one.
        assert.equal(result.status, 2, `${label}: ${result.stdout}`);
        assert.equal(envelope.error.code, 'transition-precondition-failed', label);
        assert.ok(
          envelope.error.details.issues.some((issue) => issue.code === 'invalid-edge'),
          `${label}: ${result.stdout}`,
        );
        continue;
      }

      assert.ok(
        !(envelope.error?.details?.issues ?? []).some((issue) => issue.code === 'invalid-edge'),
        `${label} is advertised but refused as an invalid edge: ${result.stdout}`,
      );

      if (option.enabled) {
        assert.equal(result.status, 0, `${label} is advertised as enabled: ${result.stdout}`);
        assert.equal(envelope.result.item.core.status, toStatus, label);
        assert.equal(
          (envelope.result.item.core.decisions ?? []).at(-1)?.action ?? null,
          option.action,
          `${label}: generated action`,
        );
        continue;
      }

      if (option.blockers.total > 0) {
        assert.equal(envelope.error.code, 'atomic-scope-required', `${label}: ${result.stdout}`);
        assert.deepEqual(envelope.error.details.blockers, option.blockers.entries, label);
        assert.deepEqual(
          envelope.error.details.precondition_issues,
          unwrapIssues(option.precondition_issues),
          label,
        );
        continue;
      }

      assert.equal(envelope.error.code, 'transition-precondition-failed', `${label}: ${result.stdout}`);
      assert.deepEqual(envelope.error.details.issues, unwrapIssues(option.precondition_issues), label);
    }
  }
});

test('inspect help states the opt-in workbench read and its observed semantics', () => {
  const help = runCli('inspect', '--help');

  assert.equal(help.status, 0, help.stderr);
  assert.ok(help.stdout.includes(
    'Usage: wowbagger inspect --ledger <dir> (--id <id> | --number <n>) --json [--workbench --as-of YYYY-MM-DD]',
  ), help.stdout);
  assert.match(help.stdout, /--workbench returns a bounded lifecycle projection/);
  assert.match(help.stdout, /observation, not a lease/);
});

test('a default inspect carries no workbench member', async () => {
  await withLedger(FIXTURE_SOURCES, async (ledger) => {
    const result = runCli('inspect', '--ledger', ledger, '--id', TASK, '--json');
    const envelope = JSON.parse(result.stdout);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(Object.keys(envelope), ['ok', 'command', 'contract_version', 'result']);
    assert.deepEqual(Object.keys(envelope.result), ['item']);
    assert.equal(Object.hasOwn(envelope.result, 'workbench'), false);
    assert.deepEqual(Object.keys(envelope.result.item), [
      'id', 'path', 'revision', 'source_encoding', 'source_media_type', 'source_base64',
      'core', 'body',
    ]);
  });
});
