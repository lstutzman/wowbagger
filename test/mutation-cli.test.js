import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runCli, withLedger } from './support.js';

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

test('inspect keeps every frontmatter field under item core', () => {
  const result = runCli(
    'inspect',
    '--ledger',
    fileURLToPath(new URL('ledger', inspectFixture)),
    '--id',
    'wb_01Q4837BM01W70T30B184GG1R6',
    '--json',
  );
  const item = JSON.parse(result.stdout).result.item;

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(Object.keys(item).sort(), [
    'body',
    'core',
    'path',
    'revision',
    'source_base64',
    'source_encoding',
    'source_media_type',
  ]);
  assert.equal(item.core.id, 'wb_01Q4837BM01W70T30B184GG1R6');
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

test('create reports the triage status it assigned without promoting it onto item', async () => {
  const fixture = new URL('../spec/fixtures/mutations/create/', import.meta.url);
  await withLedger({}, async (ledger) => {
    const requestPath = path.join(path.dirname(ledger), 'request.json');
    await writeFile(requestPath, readFileSync(fileURLToPath(new URL('request.json', fixture))));

    const result = runCli('create', '--ledger', ledger, '--input', requestPath, '--json');
    const output = JSON.parse(result.stdout);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(output.result.item.core.status, 'triage');
    assert.equal(Object.hasOwn(output.result.item, 'assigned_status'), false);
    assert.equal(Object.hasOwn(output.result.item, 'status'), false);
  });
});

test('create refusing a caller-supplied status names triage and the accepting transition', async () => {
  const fixture = new URL('../spec/fixtures/mutations/create/', import.meta.url);
  await withLedger({}, async (ledger) => {
    const request = JSON.parse(readFileSync(fileURLToPath(new URL('request.json', fixture)), 'utf8'));
    request.item.status = 'backlog';
    const requestPath = path.join(path.dirname(ledger), 'request.json');
    await writeFile(requestPath, JSON.stringify(request));

    const result = runCli('create', '--ledger', ledger, '--input', requestPath, '--json');
    const output = JSON.parse(result.stdout);
    const statusIssue = output.error.details.issues.find((entry) => entry.path === '/item/status');

    assert.equal(result.status, 2);
    assert.match(statusIssue.message, /triage/);
    assert.match(statusIssue.message, /transition/);
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
    ['inspect', ['--ledger', 'ledger', '--json'], [{ path: '/arguments', code: 'missing-argument', message: 'Argument --id is required.' }]],
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
    ['patch', ['--ledger', 'ledger', '--json'], [{ path: '/arguments', code: 'missing-argument', message: 'Argument --input is required.' }]],
    ['patch', ['--ledger', 'ledger', '--input', 'request.json', '--json', '--mystery'], [{ path: '/arguments/6', code: 'unknown-argument', message: 'Argument --mystery is not recognized.' }]],
    ['patch', ['--ledger', 'ledger', '--input', 'one.json', '--input', 'two.json', '--json'], [{ path: '/arguments/5', code: 'repeated-argument', message: 'Argument --input must not be repeated.' }]],
    ['patch', ['--ledger', 'ledger', '--input', '--json'], [{ path: '/arguments/3', code: 'missing-argument', message: 'Argument --input requires a value.' }]],
  ];

  for (const [command, argumentsList, issues] of cases) {
    const result = runCli(command, ...argumentsList);
    const expected = {
      ok: false,
      command,
      contract_version: 1,
      ...(command === 'create' || command === 'patch' || command === 'transition' ? { state: 'unchanged' } : {}),
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
    contract_version: 1,
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
