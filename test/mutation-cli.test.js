import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { linkDirectory, runCli, withLedger } from './support.js';

const capabilitiesFixture = new URL(
  '../spec/fixtures/mutations/capabilities/expected.json',
  import.meta.url,
);
const inspectFixture = new URL('../spec/fixtures/mutations/inspect/', import.meta.url);

test('capabilities reports the exact supported local mutation scope', () => {
  const result = runCli('capabilities', '--json');

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, `${JSON.stringify(JSON.parse(readFileSync(fileURLToPath(capabilitiesFixture), 'utf8')))}\n`);
});

test('capabilities separates mutation coordination from advisory cross-worktree claim visibility', () => {
  const result = runCli('capabilities', '--json');

  assert.equal(result.status, 0, result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.result.backend.coordination_scope, 'same-working-copy-cooperative-writers');
  assert.equal(envelope.result.limits.cross_worktree_coordination, false);
  assert.equal(envelope.result.operations.work_claim.supported, true);
});

test('inspect returns one lossless validated item from a single byte snapshot', () => {
  const result = runCli(
    'inspect',
    '--ledger',
    fileURLToPath(new URL('ledger', inspectFixture)),
    '--id',
    'wb_01Q4837BM01W70T30B184GG1R6',
    '--json',
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(
    result.stdout,
    `${JSON.stringify(JSON.parse(readFileSync(fileURLToPath(new URL('expected.json', inspectFixture)), 'utf8')))}\n`,
  );
});

test('inspect refuses an absent ID without returning a partial item', () => {
  const fixture = new URL('../spec/fixtures/mutations/inspect/', import.meta.url);
  const result = runCli(
    'inspect',
    '--ledger',
    fileURLToPath(new URL('ledger', fixture)),
    '--id',
    'wb_01Q4AZXNG0206CSK6CSK6CSK6C',
    '--json',
  );

  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(
    result.stdout,
    `${JSON.stringify(JSON.parse(readFileSync(fileURLToPath(new URL('expected-not-found.json', fixture)), 'utf8')))}\n`,
  );
});

test('inspect refusing an absent number echoes the number the caller asked for', () => {
  const fixture = new URL('../spec/fixtures/mutations/inspect-number-not-found/', import.meta.url);
  const result = runCli(
    'inspect',
    '--ledger',
    fileURLToPath(new URL('ledger', fixture)),
    '--number',
    '2',
    '--json',
  );

  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(
    result.stdout,
    `${JSON.stringify(JSON.parse(readFileSync(fileURLToPath(new URL('expected.json', fixture)), 'utf8')))}\n`,
  );
});

test('inspect fails closed when another ledger item is invalid', () => {
  const fixture = new URL('../spec/fixtures/mutations/inspect-invalid-ledger/', import.meta.url);
  const result = runCli(
    'inspect',
    '--ledger',
    fileURLToPath(new URL('ledger', fixture)),
    '--id',
    'wb_01Q4AZXNG0206CSK6CSK6CSK6C',
    '--json',
  );

  assert.equal(result.status, 3, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(
    result.stdout,
    `${JSON.stringify(JSON.parse(readFileSync(fileURLToPath(new URL('expected.json', fixture)), 'utf8')))}\n`,
  );
});

test('create atomically publishes the canonical caller-identified triage item', async () => {
  const fixture = new URL('../spec/fixtures/mutations/create/', import.meta.url);
  await withLedger({}, async (ledger) => {
    const requestPath = path.join(path.dirname(ledger), 'request.json');
    await writeFile(requestPath, readFileSync(fileURLToPath(new URL('request.json', fixture))));

    const result = runCli('create', '--ledger', ledger, '--input', requestPath, '--json');

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(
      result.stdout,
      `${JSON.stringify(JSON.parse(readFileSync(fileURLToPath(new URL('expected.json', fixture)), 'utf8')))}\n`,
    );
    assert.equal(
      await readFile(path.join(ledger, 'wb_01Q45X474N28T5CY4GNF6YY4HM.md'), 'utf8'),
      readFileSync(fileURLToPath(new URL('expected-item.md', fixture)), 'utf8'),
    );
  });
});

test('create derives the item path from a nested committed items-directory layout', async () => {
  const fixture = new URL('../spec/fixtures/mutations/create/', import.meta.url);
  await withLedger({
    '.wowbagger/layout.json': '{"layout_version":1,"items_directory":"backlog/items"}\n',
    'backlog/items/.keep': '',
  }, async (ledger) => {
    const requestPath = path.join(path.dirname(ledger), 'request.json');
    await writeFile(requestPath, readFileSync(fileURLToPath(new URL('request.json', fixture))));

    const result = runCli('create', '--ledger', ledger, '--input', requestPath, '--json');

    assert.equal(result.status, 0, result.stderr);
    const item = JSON.parse(result.stdout).result.item;
    assert.equal(item.path, 'backlog/items/wb_01Q45X474N28T5CY4GNF6YY4HM.md');
    assert.equal(
      await readFile(path.join(ledger, item.path), 'utf8'),
      readFileSync(fileURLToPath(new URL('expected-item.md', fixture)), 'utf8'),
    );
  });
});

test('create refuses an absent configured items directory by name before it locks or writes', async () => {
  const fixture = new URL('../spec/fixtures/mutations/create/', import.meta.url);
  await withLedger({
    '.wowbagger/layout.json': '{"layout_version":1,"items_directory":"backlog/items"}\n',
  }, async (ledger) => {
    const requestPath = path.join(path.dirname(ledger), 'request.json');
    await writeFile(requestPath, readFileSync(fileURLToPath(new URL('request.json', fixture))));

    const result = runCli('create', '--ledger', ledger, '--input', requestPath, '--json');

    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: false,
      command: 'create',
      contract_version: 4,
      state: 'unchanged',
      error: {
        code: 'items-directory-unavailable',
        message: 'The configured items directory is unavailable.',
        details: {
          id: 'wb_01Q45X474N28T5CY4GNF6YY4HM',
          path: 'backlog/items',
          reason: 'absent',
          remediation: 'Create the ledger directory backlog/items and commit it, then retry create.',
        },
      },
    });
    assert.deepEqual((await readdir(ledger)).sort(), ['.wowbagger']);
  });
});

test('create refuses a configured items directory occupied by a non-directory', async () => {
  const fixture = new URL('../spec/fixtures/mutations/create/', import.meta.url);
  await withLedger({
    '.wowbagger/layout.json': '{"layout_version":1,"items_directory":"items"}\n',
    items: 'not a directory\n',
  }, async (ledger) => {
    const requestPath = path.join(path.dirname(ledger), 'request.json');
    await writeFile(requestPath, readFileSync(fileURLToPath(new URL('request.json', fixture))));

    const result = runCli('create', '--ledger', ledger, '--input', requestPath, '--json');

    assert.equal(result.status, 2, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).error, {
      code: 'items-directory-unavailable',
      message: 'The configured items directory is unavailable.',
      details: {
        id: 'wb_01Q45X474N28T5CY4GNF6YY4HM',
        path: 'items',
        reason: 'not-a-directory',
        remediation: 'Replace items with a directory and commit it, then retry create.',
      },
    });
    assert.deepEqual((await readdir(ledger)).sort(), ['.wowbagger', 'items']);
  });
});

test('a symbolic link occupying the configured items directory stays ledger-invalid', async () => {
  const fixture = new URL('../spec/fixtures/mutations/create/', import.meta.url);
  await withLedger({
    '.wowbagger/layout.json': '{"layout_version":1,"items_directory":"items"}\n',
  }, async (ledger) => {
    // Any directory will do — the refusal is on the link, not its target —
    // so the fixture owns one rather than naming a POSIX-only absolute path.
    const elsewhere = path.join(path.dirname(ledger), 'elsewhere');
    await mkdir(elsewhere);
    await linkDirectory(elsewhere, path.join(ledger, 'items'));
    const requestPath = path.join(path.dirname(ledger), 'request.json');
    await writeFile(requestPath, readFileSync(fileURLToPath(new URL('request.json', fixture))));

    const result = runCli('create', '--ledger', ledger, '--input', requestPath, '--json');

    assert.equal(result.status, 3, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error.code, 'ledger-invalid');
    assert.deepEqual(envelope.error.details.validation_errors, [{
      path: 'ledger/items',
      field: 'path',
      code: 'symlink-not-allowed',
      message: 'Ledger entries must not be symbolic links.',
    }]);
  });
});

test('create assigns the next number as the item identity on a schema-2 ledger', async () => {
  await withLedger({}, async (ledger) => {
    const dir = path.dirname(ledger);
    const provenance = { source: 'test', recorded_at: '2030-01-10T00:00:00.000Z' };
    const reqA = path.join(dir, 'a.json');
    await writeFile(reqA, JSON.stringify({
      id: 'wb_01Q45X474N28T5CY4GNF6YY4HM',
      item: { title: 'A', kind: 'task', provenance, depends_on: [], related: [] },
      body: 'a',
    }));
    const a = JSON.parse(runCli('create', '--ledger', ledger, '--input', reqA, '--json').stdout);
    assert.equal(a.result.item.core.number, 1);

    const reqB = path.join(dir, 'b.json');
    await writeFile(reqB, JSON.stringify({
      id: 'wb_01Q4837BM01W70T30B184GG1R6',
      item: { title: 'B', kind: 'task', provenance, depends_on: [], related: [] },
      body: 'b',
    }));
    const b = JSON.parse(runCli('create', '--ledger', ledger, '--input', reqB, '--json').stdout);
    assert.equal(b.result.item.core.number, 2);
  });
});

const PRIORITISED_ID = 'wb_01Q45X474N28T5CY4GNF6YY4HM';

function prioritisedItemSource(id) {
  return [
    '---',
    'schema_version: 1',
    `id: ${id}`,
    'number: 7',
    'title: "Prioritised item"',
    'kind: task',
    'priority: 5',
    'status: backlog',
    'created: 2030-01-10',
    'updated: 2030-01-10',
    'provenance:',
    '  source: "fixture/mutations"',
    '  recorded_at: "2030-01-10T12:34:56.789Z"',
    'depends_on: []',
    'related: []',
    '---',
    '',
    'Body.',
    '',
  ].join('\n');
}

test('inspect reports number and priority inside core', async () => {
  await withLedger({ [`${PRIORITISED_ID}.md`]: prioritisedItemSource(PRIORITISED_ID) }, async (ledger) => {
    const result = runCli('inspect', '--ledger', ledger, '--id', PRIORITISED_ID, '--json');

    assert.equal(result.status, 0, result.stderr);
    const item = JSON.parse(result.stdout).result.item;
    assert.equal(item.core.number, 7);
    assert.equal(item.core.priority, 5);
  });
});

test('inspect resolves an item by its number identity', async () => {
  await withLedger({ [`${PRIORITISED_ID}.md`]: prioritisedItemSource(PRIORITISED_ID) }, async (ledger) => {
    const result = runCli('inspect', '--ledger', ledger, '--number', '7', '--json');

    assert.equal(result.status, 0, result.stderr);
    const item = JSON.parse(result.stdout).result.item;
    assert.equal(item.id, PRIORITISED_ID);
    assert.equal(item.core.number, 7);
  });
});

test('inspect reports item-not-found for an absent number', async () => {
  await withLedger({ [`${PRIORITISED_ID}.md`]: prioritisedItemSource(PRIORITISED_ID) }, async (ledger) => {
    const result = runCli('inspect', '--ledger', ledger, '--number', '999', '--json');

    assert.equal(result.status, 2, result.stdout);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error.code, 'item-not-found');
    assert.deepEqual(envelope.error.details, { number: 999 });
  });
});

test('inspect refuses when neither id nor number is supplied', async () => {
  await withLedger({ [`${PRIORITISED_ID}.md`]: prioritisedItemSource(PRIORITISED_ID) }, async (ledger) => {
    const result = runCli('inspect', '--ledger', ledger, '--json');

    assert.equal(result.status, 2, result.stdout);
    assert.equal(JSON.parse(result.stdout).error.code, 'invalid-request');
  });
});

test('the item level carries only addressing and payload members, never promoted frontmatter', async () => {
  await withLedger({ [`${PRIORITISED_ID}.md`]: prioritisedItemSource(PRIORITISED_ID) }, async (ledger) => {
    const result = runCli('inspect', '--ledger', ledger, '--id', PRIORITISED_ID, '--json');

    assert.equal(result.status, 0, result.stderr);
    const item = JSON.parse(result.stdout).result.item;
    assert.deepEqual(Object.keys(item).sort(), [
      'body',
      'core',
      'id',
      'path',
      'revision',
      'source_base64',
      'source_encoding',
      'source_media_type',
    ]);
    assert.equal(item.id, item.core.id);
  });
});

test('create refusal for caller-supplied status names the assigned status and the accepting transition', async () => {
  await withLedger({}, async (ledger) => {
    const requestPath = path.join(path.dirname(ledger), 'request.json');
    await writeFile(requestPath, JSON.stringify({
      id: 'wb_01Q45X474N28T5CY4GNF6YY4HM',
      item: {
        title: 'Demo',
        kind: 'task',
        status: 'backlog',
        provenance: { source: 'fixture/mutations', recorded_at: '2030-01-10T12:34:56.789Z' },
        depends_on: [],
      },
      body: '',
    }));

    const result = runCli('create', '--ledger', ledger, '--input', requestPath, '--json');

    assert.equal(result.status, 2, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error.code, 'invalid-request');
    const statusIssue = envelope.error.details.issues.find((entry) => entry.path === '/item/status');
    assert.equal(
      statusIssue.message,
      'Item member status is controlled by Wowbagger. Create assigns triage; a transition from triage to backlog accepts the item into ready.',
    );
  });
});

test('create refuses a malformed priority at the request level', async () => {
  await withLedger({}, async (ledger) => {
    const requestPath = path.join(path.dirname(ledger), 'request.json');
    await writeFile(requestPath, JSON.stringify({
      id: 'wb_01Q45X474N28T5CY4GNF6YY4HM',
      item: {
        title: 'Demo',
        kind: 'task',
        priority: 'high',
        provenance: { source: 'fixture/mutations', recorded_at: '2030-01-10T12:34:56.789Z' },
        depends_on: [],
      },
      body: '',
    }));

    const result = runCli('create', '--ledger', ledger, '--input', requestPath, '--json');

    assert.equal(result.status, 2, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error.code, 'invalid-request');
    assert.deepEqual(envelope.error.details.issues, [{
      path: '/item/priority',
      code: 'invalid-value',
      message: 'Item member priority must be a non-negative integer.',
    }]);
  });
});

test('create refuses any caller-supplied number because the core assigns the identity', async () => {
  await withLedger({}, async (ledger) => {
    const requestPath = path.join(path.dirname(ledger), 'request.json');
    await writeFile(requestPath, JSON.stringify({
      id: 'wb_01Q45X474N28T5CY4GNF6YY4HM',
      item: {
        title: 'Demo',
        kind: 'task',
        number: 0,
        provenance: { source: 'fixture/mutations', recorded_at: '2030-01-10T12:34:56.789Z' },
        depends_on: [],
      },
      body: '',
    }));

    const result = runCli('create', '--ledger', ledger, '--input', requestPath, '--json');

    assert.equal(result.status, 2, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error.code, 'invalid-request');
    assert.deepEqual(envelope.error.details.issues, [{
      path: '/item/number',
      code: 'invalid-value',
      message: 'Item member number is controlled by Wowbagger; it is the item identity, assigned at create.',
    }]);
  });
});

test('create serializes the assigned number and caller priority at their canonical frontmatter positions', async () => {
  await withLedger({}, async (ledger) => {
    const requestPath = path.join(path.dirname(ledger), 'request.json');
    await writeFile(requestPath, JSON.stringify({
      id: 'wb_01Q45X474N28T5CY4GNF6YY4HM',
      item: {
        title: 'Demo',
        kind: 'task',
        priority: 5,
        provenance: { source: 'fixture/mutations', recorded_at: '2030-01-10T12:34:56.789Z' },
        depends_on: [],
      },
      body: '',
    }));

    const result = runCli('create', '--ledger', ledger, '--input', requestPath, '--json');

    assert.equal(result.status, 0, result.stdout);
    const item = JSON.parse(result.stdout).result.item;
    const lines = Buffer.from(item.source_base64, 'base64').toString('utf8').split('\n');
    const idIndex = lines.findIndex((line) => line.startsWith('id:'));
    assert.equal(lines[idIndex + 1], 'number: 1');
    const kindIndex = lines.indexOf('kind: task');
    assert.equal(lines[kindIndex + 1], 'priority: 5');
  });
});

test('mutation argument validation consumes the value of a repeated option once', () => {
  const result = runCli(
    'create',
    '--ledger',
    'first-ledger',
    '--ledger',
    'second-ledger',
    '--input',
    'request.json',
    '--json',
  );
  const output = JSON.parse(result.stdout);

  assert.equal(result.status, 2, result.stderr);
  assert.equal(output.error.code, 'invalid-request');
  assert.deepEqual(output.error.details.issues, [{
    path: '/arguments/3',
    code: 'repeated-argument',
    message: 'Argument --ledger must not be repeated.',
  }]);
});

test('contract JSON commands return deterministic invalid-request envelopes for argument failures', () => {
  const id = 'wb_01Q4837BM01W70T30B184GG1R6';
  const cases = [
    ['capabilities', [], [{ path: '/arguments', code: 'missing-argument', message: 'Argument --json is required.' }]],
    ['capabilities', ['--mystery', '--json'], [{ path: '/arguments/1', code: 'unknown-argument', message: 'Argument --mystery is not recognized.' }]],
    ['capabilities', ['--json', '--json'], [{ path: '/arguments/2', code: 'repeated-argument', message: 'Argument --json must not be repeated.' }]],
    ['capabilities', ['--json', 'stray'], [{ path: '/arguments/2', code: 'unknown-argument', message: 'Argument stray is not recognized.' }]],
    ['inspect', ['--ledger', 'ledger', '--json'], [{ path: '/arguments', code: 'missing-argument', message: 'Exactly one of --id or --number is required.' }]],
    ['inspect', ['--ledger', 'ledger', '--id', id, '--json', '--mystery'], [{ path: '/arguments/6', code: 'unknown-argument', message: 'Argument --mystery is not recognized.' }]],
    ['inspect', ['--ledger', 'ledger', '--id', id, '--id', id, '--json'], [{ path: '/arguments/5', code: 'repeated-argument', message: 'Argument --id must not be repeated.' }]],
    ['inspect', ['--ledger', 'ledger', '--id', '--json'], [{ path: '/arguments/3', code: 'missing-argument', message: 'Argument --id requires a value.' }]],
    ['create', ['--ledger', 'ledger', '--json'], [{ path: '/arguments', code: 'missing-argument', message: 'Argument --input is required.' }]],
    ['create', ['--ledger', 'ledger', '--input', 'request.json', '--json', '--mystery'], [{ path: '/arguments/6', code: 'unknown-argument', message: 'Argument --mystery is not recognized.' }]],
    ['create', ['--ledger', 'ledger', '--input', 'one.json', '--input', 'two.json', '--json'], [{ path: '/arguments/5', code: 'repeated-argument', message: 'Argument --input must not be repeated.' }]],
    ['create', ['--ledger', 'ledger', '--input', '--json'], [{ path: '/arguments/3', code: 'missing-argument', message: 'Argument --input requires a value.' }]],
    ['transition', ['--ledger', 'ledger', '--json'], [{ path: '/arguments', code: 'missing-argument', message: 'Argument --input is required.' }]],
    ['transition', ['--ledger', 'ledger', '--input', 'request.json', '--json', '--mystery'], [{ path: '/arguments/6', code: 'unknown-argument', message: 'Argument --mystery is not recognized.' }]],
    ['transition', ['--ledger', 'ledger', '--input', 'one.json', '--input', 'two.json', '--json'], [{ path: '/arguments/5', code: 'repeated-argument', message: 'Argument --input must not be repeated.' }]],
    ['transition', ['--ledger', 'ledger', '--input', '--json'], [{ path: '/arguments/3', code: 'missing-argument', message: 'Argument --input requires a value.' }]],
  ];

  for (const [command, argumentsList, issues] of cases) {
    const result = runCli(command, ...argumentsList);
    const expected = {
      ok: false,
      command,
      contract_version: 4,
      ...(command === 'create' || command === 'transition' ? { state: 'unchanged' } : {}),
      error: {
        code: 'invalid-request',
        message: `The ${command} request is invalid.`,
        details: { issues },
      },
    };

    assert.equal(result.status, 2, `${command} ${argumentsList.join(' ')}: ${result.stderr}`);
    assert.equal(result.stderr, '', command);
    assert.equal(result.stdout, `${JSON.stringify(expected)}\n`, command);
  }
});

test('an unreadable mutation input is an invalid-request input issue before an ID is known', () => {
  const missing = path.join(process.cwd(), 'test', 'does-not-exist-request.json');
  const result = runCli('create', '--ledger', 'ledger', '--input', missing, '--json');
  const expected = {
    ok: false,
    command: 'create',
    contract_version: 4,
    state: 'unchanged',
    error: {
      code: 'invalid-request',
      message: 'The create request is invalid.',
      details: {
        issues: [{
          path: '/input',
          code: 'invalid-value',
          message: 'Request input could not be read.',
        }],
      },
    },
  };

  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, `${JSON.stringify(expected)}\n`);
});
