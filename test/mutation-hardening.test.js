import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
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

test('patch and transition preserve one leading UTF-8 BOM', async () => {
  const id = 'wb_01Q4G4Q3G004HMASW9NF6YY099';
  const source = `\uFEFF${triageSource(id)}`;
  await withLedger({ [`${id}.md`]: source }, async (ledger) => {
    const itemPath = path.join(ledger, `${id}.md`);
    const patchPath = path.join(path.dirname(ledger), 'patch-bom.json');
    await writeFile(patchPath, JSON.stringify({
      id,
      expected_revision: `sha256:${createHash('sha256').update(source).digest('hex')}`,
      date: '2030-01-15',
      set: { priority: 1 },
    }));

    const patched = runCli('patch', '--ledger', ledger, '--input', patchPath, '--json');
    assert.equal(patched.status, 0, `${patched.stderr}\n${patched.stdout}`);
    assertSingleUtf8Bom(await readFile(itemPath));

    const patchedRevision = JSON.parse(patched.stdout).result.item.revision;
    const transitionPath = path.join(path.dirname(ledger), 'transition-bom.json');
    await writeFile(transitionPath, JSON.stringify({
      id,
      expected_revision: patchedRevision,
      to_status: 'backlog',
      date: '2030-01-16',
      decision: {
        summary: 'Accept the BOM item.',
        rationale: 'The encoding marker must remain unchanged.',
      },
    }));

    const transitioned = runCli('transition', '--ledger', ledger, '--input', transitionPath, '--json');
    assert.equal(transitioned.status, 0, `${transitioned.stderr}\n${transitioned.stdout}`);
    assertSingleUtf8Bom(await readFile(itemPath));
  });
});

test('patch and transition preserve restrictive item permissions', async () => {
  const id = 'wb_01Q4G4Q3G004HMASW9NF6YY09A';
  await withLedger({ [`${id}.md`]: triageSource(id) }, async (ledger) => {
    const itemPath = path.join(ledger, `${id}.md`);
    await chmod(itemPath, 0o600);
    const patchPath = path.join(path.dirname(ledger), 'patch-mode.json');
    const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
    assert.equal(inspected.status, 0, inspected.stderr);
    await writeFile(patchPath, JSON.stringify({
      id,
      expected_revision: JSON.parse(inspected.stdout).result.item.revision,
      date: '2030-01-15',
      set: { priority: 1 },
    }));

    const patched = runCli('patch', '--ledger', ledger, '--input', patchPath, '--json');
    assert.equal(patched.status, 0, `${patched.stderr}\n${patched.stdout}`);
    assert.equal((await stat(itemPath)).mode & 0o777, 0o600);

    const transitionPath = path.join(path.dirname(ledger), 'transition-mode.json');
    await writeFile(transitionPath, JSON.stringify({
      id,
      expected_revision: JSON.parse(patched.stdout).result.item.revision,
      to_status: 'backlog',
      date: '2030-01-16',
      decision: {
        summary: 'Accept the permission-preserving item.',
        rationale: 'A mutation must not make a private ledger item readable.',
      },
    }));

    const transitioned = runCli('transition', '--ledger', ledger, '--input', transitionPath, '--json');
    assert.equal(transitioned.status, 0, `${transitioned.stderr}\n${transitioned.stdout}`);
    assert.equal((await stat(itemPath)).mode & 0o777, 0o600);
  });
});

test('patch reapplies source special permission bits after writing', async () => {
  const id = 'wb_01Q4G4Q3G004HMASW9NF6YY09B';
  await withLedger({ [`${id}.md`]: triageSource(id) }, async (ledger) => {
    const itemPath = path.join(ledger, `${id}.md`);
    await chmod(itemPath, 0o4700);
    const patchPath = path.join(path.dirname(ledger), 'patch-special-mode.json');
    const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
    assert.equal(inspected.status, 0, inspected.stderr);
    await writeFile(patchPath, JSON.stringify({
      id,
      expected_revision: JSON.parse(inspected.stdout).result.item.revision,
      date: '2030-01-15',
      set: { priority: 1 },
    }));

    const patched = runCli('patch', '--ledger', ledger, '--input', patchPath, '--json');

    assert.equal(patched.status, 0, `${patched.stderr}\n${patched.stdout}`);
    assert.equal((await stat(itemPath)).mode & 0o7777, 0o4700);
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

test('transition preserves aliases to changing controlled anchors without changing independent extensions', async () => {
  const id = 'wb_01Q4G4Q3G004HMASW9NF6YY093';
  const cases = [
    {
      name: 'status anchor',
      status: 'status: &workflow_status triage',
      updated: 'updated: 2030-01-14',
      alias: 'status_mirror: *workflow_status',
      aliasField: 'status_mirror',
      expected: 'backlog',
    },
    {
      name: 'updated anchor',
      status: 'status: triage',
      updated: 'updated: &workflow_updated 2030-01-14',
      alias: 'updated_mirror: *workflow_updated',
      aliasField: 'updated_mirror',
      expected: '2030-01-16',
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
      assert.equal(result.status, 0, `${scenario.name}: ${result.stderr}\n${result.stdout}`);
      const rewritten = await readFile(path.join(ledger, `${id}.md`), 'utf8');
      const document = parseDocument(rewritten.split('\n---\n', 1)[0].replace(/^---\n/, ''), { schema: 'core' });
      const data = document.toJS();
      assert.match(rewritten, new RegExp(`\\*workflow_${scenario.aliasField.replace('_mirror', '')}`));
      assert.equal(data[scenario.aliasField], scenario.expected, scenario.name);
      assert.equal(document.get('extension_anchor', true).anchor, 'independent');
      assert.equal(document.get('extension_alias', true).source, 'independent');
      assert.deepEqual(data.extension_anchor, { label: 'stable' });
      assert.deepEqual(data.extension_alias, { label: 'stable' });
    });
  }
});

test('patch preserves extension values when removing an anchored priority', async () => {
  const id = 'wb_01Q4G4Q3G004HMASW9NF6YY094';
  const source = [
    '---',
    'schema_version: 1',
    `id: ${id}`,
    'number: 7',
    'title: "Remove an anchored controlled field"',
    'kind: task',
    'priority: &item_priority 3',
    'status: backlog',
    'created: 2030-01-14',
    'updated: 2030-01-14',
    'provenance:',
    '  source: "test/mutation-hardening"',
    '  recorded_at: "2030-01-14T12:00:00Z"',
    'depends_on: []',
    'related: []',
    'priority_mirror: *item_priority',
    '---',
    '',
  ].join('\n');

  await withLedger({ [`${id}.md`]: source }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'patch.json');
    await writeFile(requestPath, JSON.stringify({
      id,
      expected_revision: revision,
      date: '2030-01-16',
      set: { priority: null },
    }));

    const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');

    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    const rewritten = await readFile(path.join(ledger, `${id}.md`), 'utf8');
    const document = parseDocument(rewritten.split('\n---\n', 1)[0].replace(/^---\n/, ''), { schema: 'core' });
    const data = document.toJS();
    assert.equal(Object.hasOwn(data, 'priority'), false);
    assert.equal(data.priority_mirror, 3);
    assert.doesNotMatch(rewritten, /\*item_priority/);
  });
});

test('patch keeps an anchored relation list resolvable when it replaces the list', async () => {
  const id = 'wb_01Q4G4Q3G004HMASW9NF6YY09C';
  const other = 'wb_01Q4G4Q3G004HMASW9NF6YY094';
  const source = [
    '---',
    'schema_version: 1',
    `id: ${id}`,
    'title: "Preserve an anchored relation list"',
    'kind: task',
    'status: backlog',
    'created: 2030-01-14',
    'updated: 2030-01-14',
    'provenance:',
    '  source: "test/mutation-hardening"',
    '  recorded_at: "2030-01-14T12:00:00Z"',
    'depends_on: []',
    'related: &item_related []',
    'related_mirror: *item_related',
    '---',
    '',
  ].join('\n');
  const neighbour = [
    '---',
    'schema_version: 1',
    `id: ${other}`,
    'title: "Relation target"',
    'kind: task',
    'status: backlog',
    'created: 2030-01-14',
    'updated: 2030-01-14',
    'provenance:',
    '  source: "test/mutation-hardening"',
    '  recorded_at: "2030-01-14T12:00:00Z"',
    'depends_on: []',
    'related: []',
    '---',
    '',
  ].join('\n');

  await withLedger({ [`${id}.md`]: source, [`${other}.md`]: neighbour }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
    const requestPath = path.join(path.dirname(ledger), 'patch-anchored-relations.json');
    await writeFile(requestPath, JSON.stringify({
      id,
      expected_revision: JSON.parse(inspected.stdout).result.item.revision,
      date: '2030-01-16',
      set: { related: [other] },
    }));

    const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');

    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    const rewritten = await readFile(path.join(ledger, `${id}.md`), 'utf8');
    const document = parseDocument(rewritten.split('\n---\n', 1)[0].replace(/^---\n/, ''), { schema: 'core' });
    const data = document.toJS();
    assert.deepEqual(data.related, [other]);
    assert.deepEqual(data.related_mirror, [other]);
    assert.match(rewritten, /related: &item_related/);
  });
});

test('patch preserves aliases bound to a reused anchor name', async () => {
  const id = 'wb_01Q4G4Q3G004HMASW9NF6YY09B';
  const source = [
    '---',
    'schema_version: 1',
    `id: ${id}`,
    'priority: &shared 3',
    'title: "Preserve reused anchors"',
    'kind: task',
    'status: backlog',
    'created: 2030-01-14',
    'updated: 2030-01-14',
    'provenance:',
    '  source: "test/mutation-hardening"',
    '  recorded_at: "2030-01-14T12:00:00Z"',
    'depends_on: []',
    'related: []',
    'priority_mirror: *shared',
    'extension_anchor: &shared "extension value"',
    'extension_mirror: *shared',
    '---',
    '',
  ].join('\n');

  await withLedger({ [`${id}.md`]: source }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
    const requestPath = path.join(path.dirname(ledger), 'patch-reused-anchor.json');
    await writeFile(requestPath, JSON.stringify({
      id,
      expected_revision: JSON.parse(inspected.stdout).result.item.revision,
      date: '2030-01-16',
      set: { priority: null },
    }));

    const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');

    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    const rewritten = await readFile(path.join(ledger, `${id}.md`), 'utf8');
    const document = parseDocument(rewritten.split('\n---\n', 1)[0].replace(/^---\n/, ''), { schema: 'core' });
    const data = document.toJS();
    assert.equal(data.priority_mirror, 3);
    assert.equal(data.extension_anchor, 'extension value');
    assert.equal(data.extension_mirror, 'extension value');
  });
});

test('transition preserves extension values when removing an anchored lifecycle date', async () => {
  const id = 'wb_01Q4G4Q3G004HMASW9NF6YY095';
  const source = [
    '---',
    'schema_version: 1',
    `id: ${id}`,
    'title: "Restore an item with an anchored lifecycle date"',
    'kind: task',
    'status: archived',
    'created: 2030-01-14',
    'updated: 2030-01-15',
    'archived: &archive_date 2030-01-15',
    'provenance:',
    '  source: "test/mutation-hardening"',
    '  recorded_at: "2030-01-14T12:00:00Z"',
    'depends_on: []',
    'related: []',
    'archive_mirror: *archive_date',
    'decisions:',
    '  - action: archive',
    '    date: 2030-01-15',
    '    summary: "Archive the item."',
    '    rationale: "The item is no longer active."',
    '---',
    '',
  ].join('\n');

  await withLedger({ [`${id}.md`]: source }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'transition-restore.json');
    await writeFile(requestPath, JSON.stringify({
      id,
      expected_revision: revision,
      to_status: 'backlog',
      date: '2030-01-16',
      decision: {
        summary: 'Restore the archived item.',
        rationale: 'The lifecycle date is no longer active, but its extension value remains data.',
      },
    }));

    const result = runCli('transition', '--ledger', ledger, '--input', requestPath, '--json');

    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    const rewritten = await readFile(path.join(ledger, `${id}.md`), 'utf8');
    const document = parseDocument(rewritten.split('\n---\n', 1)[0].replace(/^---\n/, ''), { schema: 'core' });
    const data = document.toJS();
    assert.equal(Object.hasOwn(data, 'archived'), false);
    assert.equal(data.archive_mirror, '2030-01-15');
    assert.doesNotMatch(rewritten, /\*archive_date/);
  });
});

test('transition appends to direct and aliased controlled decision sequences without mutating extensions', async () => {
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
      assertExtensions() {},
    },
    {
      name: 'alias to extension sequence',
      decisionSource: [
        'shared_decisions: &shared_decisions',
        ...priorDecision,
        'shared_decisions_alias: *shared_decisions',
        'decisions: *shared_decisions',
      ],
      assertExtensions(document, data) {
        const shared = document.get('shared_decisions', true);
        const sharedAlias = document.get('shared_decisions_alias', true);
        assert.equal(shared.anchor, 'shared_decisions');
        assert.equal(isSeq(shared), true);
        assert.equal(shared.items.length, 1);
        assert.equal(isAlias(sharedAlias), true);
        assert.equal(sharedAlias.source, 'shared_decisions');
        assert.deepEqual(data.shared_decisions_alias, data.shared_decisions);
      },
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
      assert.equal(result.status, 0, `${scenario.name}: ${result.stderr}\n${result.stdout}`);
      const rewritten = await readFile(path.join(ledger, `${id}.md`), 'utf8');
      const document = parseDocument(rewritten.split('\n---\n', 1)[0].replace(/^---\n/, ''), { schema: 'core' });
      const data = document.toJS();
      const decisions = document.get('decisions', true);
      assert.equal(isAlias(decisions), false, scenario.name);
      assert.equal(isSeq(decisions), true, scenario.name);
      assert.equal(decisions.items.length, 2, scenario.name);
      assert.equal(data.decisions.at(-1).summary, 'Append only to controlled decisions.', scenario.name);
      scenario.assertExtensions(document, data);
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

test('patch returns a JSON envelope when candidate serialization fails', async () => {
  const id = 'wb_01Q4G4Q3G004HMASW9NF6YY096';
  const source = triageSource(id);
  await withLedger({ [`${id}.md`]: source }, async (ledger) => {
    const requestPath = path.join(path.dirname(ledger), 'patch-serialization.json');
    await writeFile(requestPath, JSON.stringify({
      id,
      expected_revision: `sha256:${createHash('sha256').update(source).digest('hex')}`,
      date: '2030-01-16',
      set: { priority: 1 },
    }));

    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL('./mutation-runner.js', import.meta.url)),
      'patch', '--ledger', ledger, '--input', requestPath, '--json',
    ], {
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        WOWBAGGER_TEST_SCENARIO: 'candidate-serialization-fails',
      },
    });

    assert.equal(result.status, 6, `${result.stderr}\n${result.stdout}`);
    const output = JSON.parse(result.stdout);
    assert.equal(output.error.code, 'operation-failed');
    assert.equal(output.error.details.operation, 'serialize-candidate');
    assert.equal(output.error.details.reason, 'serialization-failed');
    assert.equal(await readFile(path.join(ledger, `${id}.md`), 'utf8'), source);
  });
});
test('transition returns a JSON envelope when candidate serialization fails', async () => {
  const id = 'wb_01Q4G4Q3G004HMASW9NF6YY097';
  const source = triageSource(id);
  await withLedger({ [`${id}.md`]: source }, async (ledger) => {
    const requestPath = path.join(path.dirname(ledger), 'transition-serialization.json');
    await writeFile(requestPath, JSON.stringify({
      id,
      expected_revision: `sha256:${createHash('sha256').update(source).digest('hex')}`,
      to_status: 'backlog',
      date: '2030-01-16',
      decision: {
        summary: 'Serialize the transition candidate.',
        rationale: 'Exercise structured handling of a serializer failure.',
      },
    }));

    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL('./mutation-runner.js', import.meta.url)),
      'transition', '--ledger', ledger, '--input', requestPath, '--json',
    ], {
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        WOWBAGGER_TEST_SCENARIO: 'candidate-serialization-fails',
      },
    });

    assert.equal(result.status, 6, `${result.stderr}\n${result.stdout}`);
    const output = JSON.parse(result.stdout);
    assert.equal(output.error.code, 'operation-failed');
    assert.equal(output.error.details.operation, 'serialize-candidate');
    assert.equal(output.error.details.reason, 'serialization-failed');
    assert.equal(await readFile(path.join(ledger, `${id}.md`), 'utf8'), source);
  });
});


test('create returns a JSON envelope when candidate serialization fails', async () => {
  const id = 'wb_01Q4G4Q3G004HMASW9NF6YY098';
  await withLedger({}, async (ledger) => {
    const requestPath = path.join(path.dirname(ledger), 'create-serialization.json');
    await writeFile(requestPath, JSON.stringify({
      id,
      item: {
        title: 'Serialize the create candidate',
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
        WOWBAGGER_TEST_SCENARIO: 'candidate-serialization-fails',
      },
    });

    assert.equal(result.status, 6, `${result.stderr}\n${result.stdout}`);
    const output = JSON.parse(result.stdout);
    assert.equal(output.error.code, 'operation-failed');
    assert.equal(output.error.details.operation, 'serialize-candidate');
    assert.equal(output.error.details.reason, 'serialization-failed');
    assert.deepEqual((await readdir(ledger)).filter((entry) => entry.endsWith('.md')), []);
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

function assertSingleUtf8Bom(bytes) {
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  assert.deepEqual(bytes.subarray(0, bom.length), bom);
  assert.equal(bytes.indexOf(bom, bom.length), -1);
}

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
