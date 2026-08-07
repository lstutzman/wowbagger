import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { isAlias, isSeq, parseDocument } from 'yaml';
import { runCli, withLedger } from './support.js';

test('create serializes nested and non-plain extension keys without changing their data', async () => {
  await withLedger({}, async (ledger) => {
    const requestPath = path.join(path.dirname(ledger), 'request.json');
    await writeFile(requestPath, JSON.stringify({
      id: 'wb_01Q45X474N28T5CY4GNF6YY4HM',
      item: {
        title: 'Preserve a structured extension through YAML serialization',
        kind: 'task',
        provenance: {
          source: 'test/mutation-hardening',
          recorded_at: '2030-01-10T12:34:56.789Z',
        },
        depends_on: [],
        'extension\nmultiline-key': {
          nested: {
            label: 'exact value',
          },
          rows: [
            { state: 'first', values: ['a', 'b'] },
            { state: 'second', values: [] },
          ],
        },
      },
      body: '',
    }));

    const result = runCli('create', '--ledger', ledger, '--input', requestPath, '--json');
    const output = JSON.parse(result.stdout);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(output.ok, true);
    const source = await readFile(path.join(ledger, 'wb_01Q45X474N28T5CY4GNF6YY4HM.md'), 'utf8');
    const data = parseDocument(source.split('\n---\n', 1)[0].replace(/^---\n/, '')).toJS();
    assert.deepEqual(data['extension\nmultiline-key'], {
      nested: { label: 'exact value' },
      rows: [
        { state: 'first', values: ['a', 'b'] },
        { state: 'second', values: [] },
      ],
    });
  });
});

test('create retains an extension JSON number without JavaScript precision coercion', async () => {
  await withLedger({}, async (ledger) => {
    const requestPath = path.join(path.dirname(ledger), 'request.json');
    await writeFile(requestPath, `{
  "id": "wb_01Q45X474N28T5CY4GNF6YY4HM",
  "item": {
    "title": "Keep an exact extension integer",
    "kind": "task",
    "provenance": {
      "source": "test/mutation-hardening",
      "recorded_at": "2030-01-10T12:34:56.789Z"
    },
    "depends_on": [],
    "exact_integer": 90071992547409939999
  },
  "body": ""
}`);

    const result = runCli('create', '--ledger', ledger, '--input', requestPath, '--json');

    assert.equal(result.status, 0, result.stderr);
    const source = await readFile(path.join(ledger, 'wb_01Q45X474N28T5CY4GNF6YY4HM.md'), 'utf8');
    assert.match(source, /^exact_integer: 90071992547409939999$/m);
  });
});

test('transition preserves CRLF extension comments and every body byte', async () => {
  const id = 'wb_01Q4G4Q3G004HMASW9NF6YY093';
  const body = '\r\nA CRLF body stays byte-for-byte intact.\r\n';
  const extension = 'future_extension:\r\n  exact_integer: 90071992547409939999\r\n  # Keep this comment attached to the extension.\r\n';
  const source = [
    '---',
    'schema_version: 1',
    `id: ${id}`,
    'title: "Preserve source layout"',
    'kind: task',
    'status: triage',
    'created: 2030-01-14',
    'updated: 2030-01-14',
    'provenance:',
    '  source: "test/mutation-hardening"',
    '  recorded_at: "2030-01-14T12:00:00Z"',
    'depends_on: []',
    'related: []',
    extension.trimEnd(),
    '---',
    '',
  ].join('\r\n') + body;

  await withLedger({ [`${id}.md`]: source }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
    assert.equal(inspected.status, 0, inspected.stderr);
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'transition.json');
    await writeFile(requestPath, JSON.stringify({
      id,
      expected_revision: revision,
      to_status: 'backlog',
      date: '2030-01-16',
      decision: {
        summary: 'Accept the CRLF item.',
        rationale: 'Its source representation is intentionally non-default.',
      },
    }));

    const result = runCli('transition', '--ledger', ledger, '--input', requestPath, '--json');
    assert.equal(result.status, 0, result.stderr);
    const rewritten = await readFile(path.join(ledger, `${id}.md`), 'utf8');
    assert.ok(rewritten.includes(extension));
    assert.ok(rewritten.endsWith(body));
  });
});

test('transition mutates quoted, spaced, and flow-style core mappings through YAML nodes', async () => {
  const id = 'wb_01Q4G4Q3G004HMASW9NF6YY093';
  const blockFields = [
    'schema_version: 1',
    `id: ${id}`,
    'title: "Mutate YAML syntax, not matching text"',
    'kind: task',
    'status: triage',
    'created: 2030-01-14',
    'updated: 2030-01-14',
    'provenance:',
    '  source: "test/mutation-hardening"',
    '  recorded_at: "2030-01-14T12:00:00Z"',
    'depends_on: []',
    'related: []',
  ];
  const cases = [
    ['quoted-key', blockFields.map((line) => line === 'status: triage' ? '"status": triage' : line).join('\n')],
    ['spaced-colon', blockFields.map((line) => line === 'status: triage' ? 'status : triage' : line).join('\n')],
    ['flow-mapping', `{ ${blockFields.filter((line) => !line.startsWith('  ')).map((line) => {
      if (line === 'provenance:') {
        return 'provenance: { source: "test/mutation-hardening", recorded_at: "2030-01-14T12:00:00Z" }';
      }
      return line;
    }).filter((line) => !line.startsWith('provenance:') || line.includes('{')).join(', ')} }`],
  ];

  for (const [name, frontmatter] of cases) {
    const body = `Body bytes for ${name}.\n`;
    const source = `---\n${frontmatter}\n---\n${body}`;
    await withLedger({ [`nested/${id}.md`]: source }, async (ledger) => {
      const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
      assert.equal(inspected.status, 0, `${name}: ${inspected.stderr}`);
      const revision = JSON.parse(inspected.stdout).result.item.revision;
      const requestPath = path.join(path.dirname(ledger), `${name}.json`);
      await writeFile(requestPath, JSON.stringify({
        id,
        expected_revision: revision,
        to_status: 'backlog',
        date: '2030-01-16',
        decision: {
          summary: `Accept ${name}.`,
          rationale: 'The controlled root fields must be mutated through parsed YAML nodes.',
        },
      }));

      const result = runCli('transition', '--ledger', ledger, '--input', requestPath, '--json');
      assert.equal(result.status, 0, `${name}: ${result.stderr}\n${result.stdout}`);
      const rewritten = await readFile(path.join(ledger, 'nested', `${id}.md`), 'utf8');
      const document = parseDocument(rewritten.split('\n---\n', 1)[0].replace(/^---\n/, ''), { schema: 'core' });
      const data = document.toJS();
      assert.equal(data.status, 'backlog', name);
      assert.equal(data.updated, '2030-01-16', name);
      assert.equal(data.decisions.at(-1).action, 'accept', name);
      assert.ok(rewritten.endsWith(body), name);
    });
  }
});

test('transition preserves extension comments, anchors, aliases, and hostile keys', async () => {
  const id = 'wb_01Q4G4Q3G004HMASW9NF6YY093';
  const body = 'Hostile extension body stays exact.\r\n';
  const source = [
    '---',
    'schema_version: 1',
    `id: ${id}`,
    'title: "Preserve YAML document nodes"',
    'kind: task',
    'status: triage',
    'created: 2030-01-14',
    'updated: 2030-01-14',
    'provenance:',
    '  source: "test/mutation-hardening"',
    '  recorded_at: "2030-01-14T12:00:00Z"',
    'depends_on: []',
    'related: []',
    '# Keep the extension comment.',
    'extension_anchor: &settings',
    '  enabled: true',
    '  nested: [one, two]',
    'extension_alias: *settings',
    '"__proto__":',
    '  constructor: "data, not an object prototype"',
    '"status\\nshadow": "untouched"',
    '---',
    '',
  ].join('\r\n') + body;

  await withLedger({ [`${id}.md`]: source }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'transition.json');
    await writeFile(requestPath, JSON.stringify({
      id,
      expected_revision: revision,
      to_status: 'backlog',
      date: '2030-01-16',
      decision: {
        summary: 'Accept the YAML node mutation.',
        rationale: 'Unknown extension nodes and their semantics are outside lifecycle control.',
      },
    }));

    const result = runCli('transition', '--ledger', ledger, '--input', requestPath, '--json');
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    const rewritten = await readFile(path.join(ledger, `${id}.md`), 'utf8');
    assert.ok(rewritten.includes('# Keep the extension comment.\r\n'));
    assert.match(rewritten, /&settings/);
    assert.match(rewritten, /\*settings/);
    assert.equal(rewritten.replaceAll('\r\n', '').includes('\n'), false);
    assert.ok(rewritten.endsWith(body));
    const document = parseDocument(rewritten.split('\r\n---\r\n', 1)[0].replace(/^---\r\n/, ''), { schema: 'core' });
    const data = document.toJS();
    assert.equal(data.status, 'backlog');
    assert.deepEqual(data.extension_alias, { enabled: true, nested: ['one', 'two'] });
    assert.deepEqual(data.__proto__, { constructor: 'data, not an object prototype' });
    assert.equal(data['status\nshadow'], 'untouched');
  });
});

test('transition refuses changing controlled anchors referenced by extension aliases', async () => {
  const id = 'wb_01Q4G4Q3G004HMASW9NF6YY093';
  const cases = [
    {
      name: 'status anchor',
      status: 'status: &workflow_status triage',
      updated: 'updated: 2030-01-14',
      alias: 'status_mirror: *workflow_status',
      field: 'status',
    },
    {
      name: 'updated anchor',
      status: 'status: triage',
      updated: 'updated: &workflow_updated 2030-01-14',
      alias: 'updated_mirror: *workflow_updated',
      field: 'updated',
    },
  ];

  for (const scenario of cases) {
    const source = [
      '---',
      'schema_version: 1',
      `id: ${id}`,
      'title: "Preserve aliases to controlled anchors"',
      'kind: task',
      scenario.status,
      'created: 2030-01-14',
      scenario.updated,
      'provenance:',
      '  source: "test/mutation-hardening"',
      '  recorded_at: "2030-01-14T12:00:00Z"',
      'depends_on: []',
      'related: []',
      scenario.alias,
      'extension_anchor: &independent {label: stable}',
      'extension_alias: *independent',
      '---',
      '',
      'Controlled-anchor aliases stay structural.',
      '',
    ].join('\n');

    await withLedger({ [`${id}.md`]: source }, async (ledger) => {
      const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
      const revision = JSON.parse(inspected.stdout).result.item.revision;
      const requestPath = path.join(path.dirname(ledger), 'transition.json');
      await writeFile(requestPath, JSON.stringify({
        id,
        expected_revision: revision,
        to_status: 'backlog',
        date: '2030-01-16',
        decision: {
          summary: 'Accept controlled-anchor alias preservation.',
          rationale: 'Extension aliases retain source identity when a controlled anchor changes.',
        },
      }));

      const result = runCli('transition', '--ledger', ledger, '--input', requestPath, '--json');
      const output = JSON.parse(result.stdout);
      assert.equal(result.status, 2, `${scenario.name}: ${result.stderr}\n${result.stdout}`);
      assert.equal(output.error.code, 'unsafe-yaml-mutation', scenario.name);
      assert.equal(
        output.error.message,
        'The mutation cannot safely edit YAML whose alias semantics cross an edited byte range. '
        + 'Hand-edit the item at details.path to remove the cross-field anchor or alias, run validate, then retry.',
        scenario.name,
      );
      assert.deepEqual(output.error.details, {
        id,
        path: `ledger/${id}.md`,
        field: scenario.field,
        reason: 'anchor-referenced-outside-field',
      });
      assert.equal(await readFile(path.join(ledger, `${id}.md`), 'utf8'), source, scenario.name);
    });
  }
});

test('transition appends to direct decisions but refuses an aliased decisions sequence', async () => {
  const id = 'wb_01Q4G4Q3G004HMASW9NF6YY093';
  const priorDecision = [
    '  - action: accept',
    '    date: 2030-01-14',
    '    summary: "Retain the prior decision."',
    '    rationale: "The prior evidence remains immutable."',
  ];
  const cases = [
    {
      name: 'direct sequence',
      decisionSource: ['decisions:', ...priorDecision],
      refusal: false,
    },
    {
      name: 'alias to extension sequence',
      decisionSource: [
        'shared_decisions: &shared_decisions',
        ...priorDecision,
        'shared_decisions_alias: *shared_decisions',
        'decisions: *shared_decisions',
      ],
      refusal: true,
    },
  ];

  for (const scenario of cases) {
    const source = [
      '---',
      'schema_version: 1',
      `id: ${id}`,
      'title: "Detach controlled decisions from extension aliases"',
      'kind: task',
      'status: triage',
      'created: 2030-01-14',
      'updated: 2030-01-14',
      'provenance:',
      '  source: "test/mutation-hardening"',
      '  recorded_at: "2030-01-14T12:00:00Z"',
      'depends_on: []',
      'related: []',
      ...scenario.decisionSource,
      '---',
      '',
    ].join('\n');

    await withLedger({ [`${id}.md`]: source }, async (ledger) => {
      const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
      const revision = JSON.parse(inspected.stdout).result.item.revision;
      const requestPath = path.join(path.dirname(ledger), 'transition.json');
      await writeFile(requestPath, JSON.stringify({
        id,
        expected_revision: revision,
        to_status: 'backlog',
        date: '2030-01-16',
        decision: {
          summary: 'Append only to controlled decisions.',
          rationale: 'Extension-owned decision evidence must remain unchanged.',
        },
      }));

      const result = runCli('transition', '--ledger', ledger, '--input', requestPath, '--json');
      const rewritten = await readFile(path.join(ledger, `${id}.md`), 'utf8');
      if (scenario.refusal) {
        const output = JSON.parse(result.stdout);
        assert.equal(result.status, 2, `${scenario.name}: ${result.stderr}\n${result.stdout}`);
        assert.equal(output.error.code, 'unsafe-yaml-mutation');
        assert.deepEqual(output.error.details, {
          id,
          path: `ledger/${id}.md`,
          field: 'decisions',
          reason: 'decisions-alias',
        });
        assert.equal(rewritten, source);
        return;
      }
      assert.equal(result.status, 0, `${scenario.name}: ${result.stderr}\n${result.stdout}`);
      const document = parseDocument(rewritten.split('\n---\n', 1)[0].replace(/^---\n/, ''), { schema: 'core' });
      const data = document.toJS();
      const decisions = document.get('decisions', true);
      assert.equal(isAlias(decisions), false, scenario.name);
      assert.equal(isSeq(decisions), true, scenario.name);
      assert.equal(decisions.items.length, 2, scenario.name);
      assert.equal(data.decisions.at(-1).summary, 'Append only to controlled decisions.', scenario.name);
      assert.ok(rewritten.includes(priorDecision.join('\n')), rewritten);
    });
  }
});

test('lock diagnostics distinguish invalid UTF-8 from invalid metadata shape', async () => {
  const id = 'wb_01Q4G4Q3G004HMASW9NF6YY093';
  const cases = [
    ['invalid-utf8', Buffer.from([0xff, 0xfe, 0xfd])],
    ['invalid-shape', Buffer.from(JSON.stringify({
      lock_version: 1,
      item_id: id,
      operation: 'transition',
      writer_id: 'bad-timestamp',
      started_at: '2030-99-99T99:99:99Z',
    }))],
  ];

  for (const [expectedDiagnostic, lockBytes] of cases) {
    await withLedger({ [`${id}.md`]: triageSource(id) }, async (ledger) => {
      const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
      const revision = JSON.parse(inspected.stdout).result.item.revision;
      const lockDirectory = path.join(ledger, '.wowbagger-locks');
      const requestPath = path.join(path.dirname(ledger), 'transition.json');
      await mkdir(lockDirectory);
      await writeFile(path.join(lockDirectory, `${id}.lock`), lockBytes);
      await writeFile(requestPath, JSON.stringify({
        id,
        expected_revision: revision,
        to_status: 'backlog',
        date: '2030-01-16',
        decision: {
          summary: 'Accept the locked item.',
          rationale: 'Exercise diagnostic classification only.',
        },
      }));

      const result = runCli('transition', '--ledger', ledger, '--input', requestPath, '--json');
      const output = JSON.parse(result.stdout);

      assert.equal(result.status, 4, result.stderr);
      assert.equal(output.error.code, 'lock-held');
      assert.equal(output.error.details.owner, null);
      assert.equal(output.error.details.owner_diagnostic, expectedDiagnostic);
    });
  }
});

test('non-symlink special lock occupants return invalid-shape without blocking', async () => {
  const id = 'wb_01Q4G4Q3G004HMASW9NF6YY093';
  for (const kind of ['directory', 'fifo', 'socket']) {
    await withLedger({ [`${id}.md`]: triageSource(id) }, async (ledger) => {
      const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
      const revision = JSON.parse(inspected.stdout).result.item.revision;
      const lockDirectory = path.join(ledger, '.wowbagger-locks');
      const lockPath = path.join(lockDirectory, `${id}.lock`);
      const requestPath = path.join(path.dirname(ledger), 'transition.json');
      await mkdir(lockDirectory);
      let server;
      if (kind === 'directory') {
        await mkdir(lockPath);
      } else if (kind === 'fifo') {
        const made = spawnSync('mkfifo', [lockPath], { encoding: 'utf8' });
        assert.equal(made.status, 0, made.stderr);
      } else {
        server = createServer();
        await new Promise((resolve, reject) => {
          server.once('error', reject);
          server.listen(lockPath, resolve);
        });
      }
      await writeFile(requestPath, JSON.stringify({
        id,
        expected_revision: revision,
        to_status: 'backlog',
        date: '2030-01-16',
        decision: {
          summary: 'Accept the occupied-lock item.',
          rationale: 'Exercise bounded no-follow diagnostics.',
        },
      }));

      try {
        const result = spawnSync(process.execPath, [
          fileURLToPath(new URL('../bin/wowbagger.js', import.meta.url)),
          'transition', '--ledger', ledger, '--input', requestPath, '--json',
        ], { encoding: 'utf8', timeout: 750 });

        assert.equal(result.error, undefined, `${kind}: ${result.error?.message}`);
        assert.equal(result.status, 4, `${kind}: ${result.stderr}`);
        const output = JSON.parse(result.stdout);
        assert.equal(output.error.code, 'lock-held');
        assert.equal(output.error.details.owner, null);
        assert.equal(output.error.details.owner_diagnostic, 'invalid-shape');
      } finally {
        await new Promise((resolve) => server?.close(resolve) ?? resolve());
      }
    });
  }
});

test('a temporary-file sync failure is classified before any final item is published', async () => {
  const id = 'wb_01Q45X474N28T5CY4GNF6YY4HM';
  await withLedger({}, async (ledger) => {
    const requestPath = path.join(path.dirname(ledger), 'request.json');
    await writeFile(requestPath, JSON.stringify({
      id,
      item: {
        title: 'Classify temporary sync failure',
        kind: 'task',
        provenance: {
          source: 'test/mutation-hardening',
          recorded_at: '2030-01-10T12:34:56.789Z',
        },
        depends_on: [],
      },
      body: '',
    }));

    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL('./mutation-runner.js', import.meta.url)),
      'create', '--ledger', ledger, '--input', requestPath, '--json',
    ], {
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        WOWBAGGER_TEST_SCENARIO: 'temporary-file-sync-fails',
      },
    });
    const output = JSON.parse(result.stdout);

    assert.equal(result.status, 6, result.stderr);
    assert.equal(output.error.code, 'operation-failed');
    assert.equal(output.error.details.operation, 'sync-temporary');
    assert.deepEqual((await readdir(ledger)).filter((entry) => entry.endsWith('.md')), []);
    assert.deepEqual((await readdir(ledger)).filter((entry) => entry.startsWith('.wowbagger-tmp-')), []);
  });
});

test('the production CLI ignores test fault-injection environment variables', async () => {
  const id = 'wb_01Q45X474N28T5CY4GNF6YY4HM';
  await withLedger({}, async (ledger) => {
    const requestPath = path.join(path.dirname(ledger), 'request.json');
    await writeFile(requestPath, JSON.stringify({
      id,
      item: {
        title: 'Keep test controls outside production',
        kind: 'task',
        provenance: {
          source: 'test/mutation-hardening',
          recorded_at: '2030-01-10T12:34:56.789Z',
        },
        depends_on: [],
      },
      body: '',
    }));

    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL('../bin/wowbagger.js', import.meta.url)),
      'create', '--ledger', ledger, '--input', requestPath, '--json',
    ], {
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        WOWBAGGER_TEST_SCENARIO: 'temporary-file-sync-fails',
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).state, 'committed');
  });
});

function triageSource(id) {
  return `---
schema_version: 1
id: ${id}
title: "Classify malformed lock metadata"
kind: task
status: triage
created: 2030-01-14
updated: 2030-01-14
provenance:
  source: "test/mutation-hardening"
  recorded_at: "2030-01-14T12:00:00Z"
depends_on: []
related: []
---
`;
}
