import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { proposeExtensionDeclaration } from '../src/extension-provision.js';
import { runCli, withLedger } from './support.js';

const BLOCK_ITEM = 'wb_01Q4ZK3DG020ANANANANANANAM';
const FLOW_ITEM = 'wb_01Q45X474N28T5CY4GNF6YY4HM';
const RUNNER = fileURLToPath(new URL('./mutation-runner.js', import.meta.url));

function itemSource({ id, created, tags }) {
  return [
    '---',
    'schema_version: 1',
    `id: ${id}`,
    'title: "Mirrored item"',
    'kind: task',
    'status: backlog',
    `created: ${created}`,
    `updated: ${created}`,
    'provenance:',
    '  source: "fixture/extension-provision"',
    `  recorded_at: "${created}T12:00:00Z"`,
    'depends_on: []',
    'related: []',
    ...tags,
    '---',
    'Mirror body.',
    '',
  ].join('\n');
}

async function writeRequest(ledger, members = { tags: 'string-list' }) {
  const requestPath = path.join(path.dirname(ledger), 'extension-provision-request.json');
  await writeFile(requestPath, JSON.stringify({ members }));
  return requestPath;
}

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function runCliScenario(scenario, ...argumentsList) {
  return spawnSync(process.execPath, [RUNNER, ...argumentsList], {
    encoding: 'utf8',
    env: { ...process.env, WOWBAGGER_TEST_SCENARIO: scenario },
  });
}

function ledger(items) {
  return { items: items.map((data) => ({ data })) };
}

test('proposes an explicit declaration for uniform existing extensions', () => {
  const result = proposeExtensionDeclaration({
    ledger: ledger([{ tags: ['bug'] }, { tags: ['tax'] }]),
    members: { tags: 'string-list' },
  });
  assert.deepEqual(result, {
    ok: true,
    declaration: { extensions_version: 1, members: { tags: 'string-list' } },
    source: '{"extensions_version":1,"members":{"tags":"string-list"}}\n',
    counts: { tags: 2 },
  });
});

test('rejects mixed extension types instead of inferring authority', () => {
  const result = proposeExtensionDeclaration({
    ledger: ledger([{ tier: 1 }, { tier: 'gold' }]),
    members: { tier: 'string' },
  });
  assert.deepEqual(result, { ok: false, error: { code: 'extension-type-conflict', member: 'tier', type: 'string' } });
});

test('rejects every incompatible historical tag value', () => {
  for (const [label, tags] of [
    ['scalar', 'legacy'],
    ['null', null],
    ['map', { value: 'legacy' }],
    ['nested list', [['legacy']]],
    ['mixed list', ['legacy', 7]],
  ]) {
    const result = proposeExtensionDeclaration({
      ledger: ledger([{ tags }]),
      members: { tags: 'string-list' },
    });

    assert.deepEqual(
      result,
      { ok: false, error: { code: 'extension-type-conflict', member: 'tags', type: 'string-list' } },
      label,
    );
  }
});

test('dry-run proposes existing block and flow tags without changing ledger bytes', async () => {
  const blockSource = itemSource({
    id: BLOCK_ITEM,
    created: '2030-01-20',
    tags: ['tags:', '  - "bug"', '  - "mirror"'],
  });
  const flowSource = itemSource({
    id: FLOW_ITEM,
    created: '2030-01-10',
    tags: ['tags: [legacy]'],
  });
  await withLedger({
    [`${BLOCK_ITEM}.md`]: blockSource,
    [`${FLOW_ITEM}.md`]: flowSource,
  }, async (ledger) => {
    const requestPath = await writeRequest(ledger);

    const result = runCli(
      'extensions-provision',
      '--ledger',
      ledger,
      '--input',
      requestPath,
      '--json',
      '--dry-run',
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      command: 'extensions-provision',
      contract_version: 5,
      result: {
        dry_run: true,
        output: '.wowbagger/extensions.json',
        source: '{"extensions_version":1,"members":{"tags":"string-list"}}\n',
        members: { tags: 'string-list' },
        counts: { tags: 2 },
      },
    });
    assert.equal(await readFile(path.join(ledger, `${BLOCK_ITEM}.md`), 'utf8'), blockSource);
    assert.equal(await readFile(path.join(ledger, `${FLOW_ITEM}.md`), 'utf8'), flowSource);
    assert.equal(await pathExists(path.join(ledger, '.wowbagger', 'extensions.json')), false);
  });
});

test('dry-run refuses an invalid ledger before proposing a declaration', async () => {
  const validSource = itemSource({
    id: BLOCK_ITEM,
    created: '2030-01-20',
    tags: ['tags:', '  - "bug"'],
  });
  await withLedger({
    [`${BLOCK_ITEM}.md`]: validSource,
    'broken.md': '---\ntitle: [unterminated\n---\n',
  }, async (ledger) => {
    const requestPath = await writeRequest(ledger);

    const result = runCli(
      'extensions-provision',
      '--ledger',
      ledger,
      '--input',
      requestPath,
      '--json',
      '--dry-run',
    );

    assert.equal(result.status, 3, result.stdout);
    assert.equal(result.stderr, '');
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.command, 'extensions-provision');
    assert.equal(envelope.contract_version, 5);
    assert.equal(envelope.error.code, 'ledger-invalid');
    assert.equal(envelope.error.message, 'The configured ledger is invalid.');
    assert.ok(envelope.error.details.validation_errors.length > 0);
    assert.equal(await readFile(path.join(ledger, `${BLOCK_ITEM}.md`), 'utf8'), validSource);
    assert.equal(await pathExists(path.join(ledger, '.wowbagger', 'extensions.json')), false);
  });
});

test('provision creates one declaration idempotently without changing item bytes', async () => {
  const item = itemSource({
    id: BLOCK_ITEM,
    created: '2030-01-20',
    tags: ['tags:', '  - "bug"'],
  });
  await withLedger({ [`${BLOCK_ITEM}.md`]: item }, async (ledger) => {
    const requestPath = await writeRequest(ledger);
    const argumentsList = [
      'extensions-provision',
      '--ledger',
      ledger,
      '--input',
      requestPath,
      '--json',
    ];

    const created = runCli(...argumentsList);

    assert.equal(created.status, 0, created.stderr);
    assert.equal(created.stderr, '');
    assert.equal(JSON.parse(created.stdout).state, 'committed');
    assert.equal(
      await readFile(path.join(ledger, '.wowbagger', 'extensions.json'), 'utf8'),
      '{"extensions_version":1,"members":{"tags":"string-list"}}\n',
    );
    assert.equal(await readFile(path.join(ledger, `${BLOCK_ITEM}.md`), 'utf8'), item);

    const repeated = runCli(...argumentsList);

    assert.equal(repeated.status, 0, repeated.stderr);
    assert.equal(repeated.stdout, created.stdout);
    assert.equal(await readFile(path.join(ledger, `${BLOCK_ITEM}.md`), 'utf8'), item);
  });
});

test('provision refuses a different existing declaration without changing it or item bytes', async () => {
  const item = itemSource({
    id: BLOCK_ITEM,
    created: '2030-01-20',
    tags: ['tags:', '  - "bug"'],
  });
  const declaration = '{"extensions_version":1,"members":{"tier":"string"}}\n';
  await withLedger({
    [`${BLOCK_ITEM}.md`]: item,
    '.wowbagger/extensions.json': declaration,
  }, async (ledger) => {
    const requestPath = await writeRequest(ledger);

    const result = runCli(
      'extensions-provision',
      '--ledger',
      ledger,
      '--input',
      requestPath,
      '--json',
    );

    assert.equal(result.status, 4, result.stdout);
    assert.equal(result.stderr, '');
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.state, 'unchanged');
    assert.equal(envelope.error.code, 'extension-declaration-conflict');
    assert.equal(
      await readFile(path.join(ledger, '.wowbagger', 'extensions.json'), 'utf8'),
      declaration,
    );
    assert.equal(await readFile(path.join(ledger, `${BLOCK_ITEM}.md`), 'utf8'), item);
  });
});

test('provision treats reordered declaration members as the same declaration', async () => {
  const item = itemSource({
    id: BLOCK_ITEM,
    created: '2030-01-20',
    tags: ['tier: "gold"', 'tags: [bug]'],
  });
  const declaration =
    '{"extensions_version":1,"members":{"tier":"string","tags":"string-list"}}\n';
  await withLedger({
    [`${BLOCK_ITEM}.md`]: item,
    '.wowbagger/extensions.json': declaration,
  }, async (ledger) => {
    const requestPath = await writeRequest(ledger, {
      tier: 'string',
      tags: 'string-list',
    });

    const result = runCli(
      'extensions-provision',
      '--ledger',
      ledger,
      '--input',
      requestPath,
      '--json',
    );

    assert.equal(result.status, 0, result.stdout);
    assert.equal(result.stderr, '');
    assert.equal(JSON.parse(result.stdout).state, 'committed');
    assert.equal(
      await readFile(path.join(ledger, '.wowbagger', 'extensions.json'), 'utf8'),
      declaration,
    );
    assert.equal(await readFile(path.join(ledger, `${BLOCK_ITEM}.md`), 'utf8'), item);
  });
});

test('provision accepts an identical declaration won by a concurrent writer', async () => {
  const item = itemSource({
    id: BLOCK_ITEM,
    created: '2030-01-20',
    tags: ['tags: [bug]'],
  });
  const winner =
    '{\n  "extensions_version": 1,\n  "members": {"tags":"string-list"}\n}\n';
  await withLedger({ [`${BLOCK_ITEM}.md`]: item }, async (ledger) => {
    const requestPath = await writeRequest(ledger);

    const result = runCliScenario(
      'extension-provision-concurrent-same',
      'extensions-provision',
      '--ledger',
      ledger,
      '--input',
      requestPath,
      '--json',
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stderr, '');
    assert.equal(JSON.parse(result.stdout).state, 'committed');
    assert.equal(
      await readFile(path.join(ledger, '.wowbagger', 'extensions.json'), 'utf8'),
      winner,
    );
    assert.equal(await readFile(path.join(ledger, `${BLOCK_ITEM}.md`), 'utf8'), item);
  });
});

test('provision refuses a different declaration won by a concurrent writer', async () => {
  const item = itemSource({
    id: BLOCK_ITEM,
    created: '2030-01-20',
    tags: ['tags: [bug]'],
  });
  const winner = '{"extensions_version":1,"members":{"tier":"string"}}\n';
  await withLedger({ [`${BLOCK_ITEM}.md`]: item }, async (ledger) => {
    const requestPath = await writeRequest(ledger);

    const result = runCliScenario(
      'extension-provision-concurrent-different',
      'extensions-provision',
      '--ledger',
      ledger,
      '--input',
      requestPath,
      '--json',
    );

    assert.equal(result.status, 4, result.stderr || result.stdout);
    assert.equal(result.stderr, '');
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.state, 'unchanged');
    assert.equal(envelope.error.code, 'extension-declaration-conflict');
    assert.equal(
      await readFile(path.join(ledger, '.wowbagger', 'extensions.json'), 'utf8'),
      winner,
    );
    assert.equal(await readFile(path.join(ledger, `${BLOCK_ITEM}.md`), 'utf8'), item);
  });
});

test('provision refuses a symlinked metadata directory without writing outside the ledger', {
  skip: process.platform === 'win32',
}, async () => {
  const item = itemSource({
    id: BLOCK_ITEM,
    created: '2030-01-20',
    tags: ['tags: [bug]'],
  });
  await withLedger({ [`${BLOCK_ITEM}.md`]: item }, async (ledger) => {
    const outside = path.join(path.dirname(ledger), 'outside-metadata');
    await mkdir(outside);
    await symlink(outside, path.join(ledger, '.wowbagger'), 'dir');
    const requestPath = await writeRequest(ledger);

    const result = runCli(
      'extensions-provision',
      '--ledger',
      ledger,
      '--input',
      requestPath,
      '--json',
    );

    assert.equal(result.status, 3, result.stderr || result.stdout);
    assert.equal(result.stderr, '');
    assert.equal(JSON.parse(result.stdout).error.code, 'ledger-invalid');
    assert.equal(await pathExists(path.join(outside, 'extensions.json')), false);
    assert.equal(await readFile(path.join(ledger, `${BLOCK_ITEM}.md`), 'utf8'), item);
  });
});
