import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { parseDocument } from 'yaml';
import { mapProcessOutcome } from '../spec/adapter-reference.js';
import { validatePatchRequest } from '../src/mutation.js';
import { runCli, withLedger } from './support.js';

test('patch changes priority and records why under a guarded replacement', async () => {
  const id = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const body = '\nThe body stays byte-for-byte exact.\n';
  const source = itemSource(id, body);

  await withLedger({ [`${id}.md`]: source }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'patch.json');
    await writeFile(requestPath, JSON.stringify({
      id,
      expected_revision: revision,
      patch: { priority: 3 },
      date: '2030-01-16',
      decision: {
        summary: 'Raise the fictional survey priority.',
        rationale: 'The survey now blocks the next planning pass.',
      },
    }));

    const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    const output = JSON.parse(result.stdout);
    const rewritten = await readFile(path.join(ledger, `${id}.md`), 'utf8');
    const data = parseDocument(frontmatter(rewritten), { schema: 'core' }).toJS();

    assert.equal(result.stderr, '');
    assert.equal(data.priority, 3);
    assert.equal(data.updated, '2030-01-16');
    assert.deepEqual(data.decisions.at(-1), {
      action: 'record',
      date: '2030-01-16',
      summary: 'Raise the fictional survey priority.',
      rationale: 'The survey now blocks the next planning pass.',
    });
    assert.ok(rewritten.endsWith(body));
    assert.equal(Object.hasOwn(output.result.item, 'priority'), false);
    assert.equal(Object.hasOwn(output.result.item.core, 'priority'), false);
    assert.deepEqual(await readdir(path.join(ledger, '.wowbagger-locks')), []);
  });
});

test('patch commits when optional related is absent without adding it', async () => {
  const id = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const source = itemSource(id).replace('related: []\n', '');

  await withLedger({ [`${id}.md`]: source }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'patch-without-related.json');
    await writeFile(requestPath, JSON.stringify({
      id,
      expected_revision: revision,
      patch: { priority: 3 },
      date: '2030-01-16',
      decision: {
        summary: 'Rank the fictional survey.',
        rationale: 'An omitted optional relation list must not block the patch.',
      },
    }));

    const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');
    const rewritten = await readFile(path.join(ledger, `${id}.md`), 'utf8');

    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    assert.equal(parseDocument(frontmatter(rewritten), { schema: 'core' }).has('related'), false);
  });
});

test('patch refuses an anchored scalar and leaves aliased fields unchanged', async () => {
  const id = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const source = itemSource(id, '', [
    'priority: &rank 3',
    'number: *rank',
  ]);

  await withLedger({ [`${id}.md`]: source }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'patch-anchored.json');
    await writeFile(requestPath, JSON.stringify({
      id,
      expected_revision: revision,
      patch: { priority: 5 },
      date: '2030-01-16',
      decision: {
        summary: 'Raise only the fictional survey priority.',
        rationale: 'The number alias must not follow the requested priority change.',
      },
    }));

    const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');
    const output = JSON.parse(result.stdout);

    assert.equal(result.status, 2, `${result.stderr}\n${result.stdout}`);
    assert.equal(output.state, 'unchanged');
    assert.equal(output.error.code, 'unsafe-yaml-mutation');
    assert.equal(
      output.error.message,
      'The mutation cannot safely edit YAML whose alias semantics cross an edited byte range. '
      + 'Hand-edit the item at details.path to remove the cross-field anchor or alias, run validate, then retry.',
    );
    assert.deepEqual(output.error.details, {
      id,
      path: `ledger/${id}.md`,
      field: 'priority',
      reason: 'anchor-referenced-outside-field',
    });
    assert.equal(await readFile(path.join(ledger, `${id}.md`), 'utf8'), source);
  });
});

test('patch classifies an anchor on a changed field key as unsafe YAML', async () => {
  const id = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const source = itemSource(id, '', [
    '&rank_key priority: 3',
    'operator_key: *rank_key',
  ]);

  await withLedger({ [`${id}.md`]: source }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'patch-key-anchor.json');
    await writeFile(requestPath, JSON.stringify({
      id,
      expected_revision: revision,
      patch: { priority: 5 },
      date: '2030-01-16',
      decision: {
        summary: 'Raise the key-anchored priority.',
        rationale: 'The refusal class must identify a permanent YAML shape.',
      },
    }));

    const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');
    const output = JSON.parse(result.stdout);

    assert.equal(result.status, 2, `${result.stderr}\n${result.stdout}`);
    assert.equal(output.error.code, 'unsafe-yaml-mutation');
    assert.deepEqual(output.error.details, {
      id,
      path: `ledger/${id}.md`,
      field: 'priority',
      reason: 'anchor-referenced-outside-field',
    });
    assert.equal(await readFile(path.join(ledger, `${id}.md`), 'utf8'), source);
  });
});

test('patch removes a field without moving or deleting its preceding operator comment', async () => {
  const id = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const source = itemSource(id, '', [
    '# operator note: keep this ranked above the rest',
    'priority: 3 # removed with its field',
  ]);

  await withLedger({ [`${id}.md`]: source }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'patch-commented.json');
    await writeFile(requestPath, JSON.stringify({
      id,
      expected_revision: revision,
      patch: { priority: null },
      date: '2030-01-16',
      decision: {
        summary: 'Remove the fictional survey priority.',
        rationale: 'A field removal must not silently delete the operator note.',
      },
    }));

    const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');
    const rewritten = await readFile(path.join(ledger, `${id}.md`), 'utf8');

    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    assert.equal(rewritten.includes('# operator note: keep this ranked above the rest\n'), true);
    assert.ok(rewritten.includes(
      '# operator note: keep this ranked above the rest\ndecisions:\n',
    ), rewritten);
    assert.equal(rewritten.includes('# removed with its field'), false, rewritten);
    assert.equal(parseDocument(frontmatter(rewritten), { schema: 'core' }).has('priority'), false);
    assert.equal(rewritten.endsWith('---\n'), true);
  });
});

test('patch preserves a document-level trailing comment at the end of frontmatter', async () => {
  const id = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const source = itemSource(id).replace(
    'related: []\n',
    'related: []\n# trailing note that matters to a human\n',
  );

  await withLedger({ [`${id}.md`]: source }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'patch-document-comment.json');
    await writeFile(requestPath, JSON.stringify({
      id,
      expected_revision: revision,
      patch: { title: 'Survey the fictional southern lights' },
      date: '2030-01-16',
      decision: {
        summary: 'Correct the fictional survey title.',
        rationale: 'The human note must stay in its original location.',
      },
    }));

    const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');
    const rewritten = await readFile(path.join(ledger, `${id}.md`), 'utf8');

    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    assert.equal(parseDocument(frontmatter(rewritten), { schema: 'core' }).get('title'), 'Survey the fictional southern lights');
    assert.ok(rewritten.includes(
      '    rationale: "The human note must stay in its original location."\n'
      + '# trailing note that matters to a human\n---\n',
    ), rewritten);
  });
});

test('patch refuses when derived updated is anchored into an extension value', async () => {
  const id = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const source = itemSource(id)
    .replace('updated: 2030-01-14', 'updated: &original_date 2030-01-14')
    .replace('related: []', 'related: []\noperator_date: *original_date');

  await withLedger({ [`${id}.md`]: source }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'patch-extension-alias.json');
    await writeFile(requestPath, JSON.stringify({
      id,
      expected_revision: revision,
      patch: { priority: 5 },
      date: '2030-01-16',
      decision: {
        summary: 'Raise the fictional survey priority.',
        rationale: 'The operator date is outside the requested patch.',
      },
    }));

    const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');
    const output = JSON.parse(result.stdout);

    assert.equal(result.status, 2, `${result.stderr}\n${result.stdout}`);
    assert.equal(output.state, 'unchanged');
    assert.equal(output.error.code, 'unsafe-yaml-mutation');
    assert.deepEqual(output.error.details, {
      id,
      path: `ledger/${id}.md`,
      field: 'updated',
      reason: 'anchor-referenced-outside-field',
    });
    assert.equal(await readFile(path.join(ledger, `${id}.md`), 'utf8'), source);
  });
});

test('patch preserves the YAML identity of a plain unpatched extension', async () => {
  const id = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const source = itemSource(id, '', ['operator_note: stable']);

  await withLedger({ [`${id}.md`]: source }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'patch-plain-extension.json');
    await writeFile(requestPath, JSON.stringify({
      id,
      expected_revision: revision,
      patch: { priority: 5 },
      date: '2030-01-16',
      decision: {
        summary: 'Rank the fictional survey.',
        rationale: 'The operator extension is outside the requested patch.',
      },
    }));

    const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');
    const rewritten = await readFile(path.join(ledger, `${id}.md`), 'utf8');

    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    assert.ok(rewritten.includes('operator_note: stable\n'), rewritten);
  });
});

test('patch returns an unchanged envelope for an anchor nested in a patched sequence', async () => {
  const id = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const oldDependencyId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const newDependencyId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const source = itemSource(id)
    .replace('depends_on: []', `depends_on:\n  - &dep ${oldDependencyId}`)
    .replace('related: []', 'related: []\noperator_watch: *dep');

  await withLedger({
    [`${id}.md`]: source,
    [`${oldDependencyId}.md`]: itemSource(oldDependencyId),
    [`${newDependencyId}.md`]: itemSource(newDependencyId),
  }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'patch-nested-anchor.json');
    await writeFile(requestPath, JSON.stringify({
      id,
      expected_revision: revision,
      patch: { depends_on: [newDependencyId] },
      date: '2030-01-16',
      decision: {
        summary: 'Replace the fictional dependency.',
        rationale: 'The anchored dependency must not escape the patch refusal.',
      },
    }));

    const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');

    assert.notEqual(result.stdout, '', `missing JSON envelope; stderr: ${result.stderr}`);
    const output = JSON.parse(result.stdout);
    assert.equal(result.status, 2, `${result.stderr}\n${result.stdout}`);
    assert.equal(output.state, 'unchanged');
    assert.equal(output.error.code, 'unsafe-yaml-mutation');
    assert.equal(
      output.error.message,
      'The mutation cannot safely edit YAML whose alias semantics cross an edited byte range. '
      + 'Hand-edit the item at details.path to remove the cross-field anchor or alias, run validate, then retry.',
    );
    assert.deepEqual(output.error.details, {
      id,
      path: `ledger/${id}.md`,
      field: 'depends_on',
      reason: 'anchor-referenced-outside-field',
    });
    assert.equal(await readFile(path.join(ledger, `${id}.md`), 'utf8'), source);
  });
});

test('patch inserts an absent scalar before the decisions history', async () => {
  const id = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const source = itemSource(id, '', [
    'decisions:',
    '  - action: record',
    '    date: 2030-01-14',
    '    summary: "Record the initial fictional ranking."',
    '    rationale: "The initial ranking needs an audit record."',
  ]);

  await withLedger({ [`${id}.md`]: source }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'patch-insert-order.json');
    await writeFile(requestPath, JSON.stringify({
      id,
      expected_revision: revision,
      patch: { priority: 2 },
      date: '2030-01-16',
      decision: {
        summary: 'Set the fictional survey priority.',
        rationale: 'Planning metadata belongs before the decision history.',
      },
    }));

    const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');
    const rewritten = await readFile(path.join(ledger, `${id}.md`), 'utf8');

    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    assert.ok(rewritten.includes('related: []\npriority: 2\ndecisions:\n'), rewritten);
  });
});

test('patch inserts parent after identity when related is absent', async () => {
  const id = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const parentId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const source = itemSource(id).replace('related: []\n', '');

  await withLedger({
    [`${id}.md`]: source,
    [`${parentId}.md`]: itemSource(parentId, '', [], 'epic'),
  }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'patch-parent-without-related.json');
    await writeFile(requestPath, JSON.stringify({
      id,
      expected_revision: revision,
      patch: { parent: parentId },
      date: '2030-01-16',
      decision: {
        summary: 'Attach the fictional survey to its epic.',
        rationale: 'The parent must be inserted after the item identity.',
      },
    }));

    const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');
    const rewritten = await readFile(path.join(ledger, `${id}.md`), 'utf8');

    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    assert.ok(rewritten.startsWith(`---\nschema_version: 1\nid: ${id}\n`), rewritten);
    assert.ok(rewritten.includes(`depends_on: []\nparent: ${parentId}\ndecisions:\n`), rewritten);
  });
});

test('patch inserts absent fields after later controlled fields when an extension appears early', async () => {
  const id = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const source = itemSource(id).replace(
    `id: ${id}\n`,
    `id: ${id}\noperator_x: keep this early\n`,
  );

  await withLedger({ [`${id}.md`]: source }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'patch-early-extension.json');
    await writeFile(requestPath, JSON.stringify({
      id,
      expected_revision: revision,
      patch: { priority: 3 },
      date: '2030-01-16',
      decision: {
        summary: 'Rank the early-extension item.',
        rationale: 'Controlled insertion order must ignore extension placement.',
      },
    }));

    const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');
    const rewritten = await readFile(path.join(ledger, `${id}.md`), 'utf8');

    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    assert.ok(
      rewritten.indexOf('operator_x: keep this early\n') < rewritten.indexOf('title:'),
      rewritten,
    );
    assert.ok(rewritten.indexOf('related: []\n') < rewritten.indexOf('priority: 3\n'), rewritten);
    assert.ok(rewritten.indexOf('priority: 3\n') < rewritten.indexOf('decisions:\n'), rewritten);
  });
});

test('patch rejects non-integer JSON spellings that coerce to integers', async () => {
  for (const literal of ['7.0', '1e2']) {
    const id = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
    const source = itemSource(id);

    await withLedger({ [`${id}.md`]: source }, async (ledger) => {
      const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
      const revision = JSON.parse(inspected.stdout).result.item.revision;
      const requestPath = path.join(path.dirname(ledger), 'patch-non-integer-token.json');
      await writeFile(requestPath, `{
  "id": ${JSON.stringify(id)},
  "expected_revision": ${JSON.stringify(revision)},
  "patch": {"number": ${literal}},
  "date": "2030-01-16",
  "decision": {
    "summary": "Set the fictional survey number.",
    "rationale": "Only an integer JSON token satisfies the patch contract."
  }
}`);

      const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');
      const output = JSON.parse(result.stdout);

      assert.equal(result.status, 2, `${literal}: ${result.stderr}\n${result.stdout}`);
      assert.equal(output.state, 'unchanged', result.stdout);
      assert.equal(output.error.code, 'invalid-request');
      assert.deepEqual(output.error.details.issues, [{
        path: '/patch/number',
        code: 'invalid-type',
        message: 'Patch member number must be null or a positive integer.',
      }]);
      assert.equal(await readFile(path.join(ledger, `${id}.md`), 'utf8'), source);
    });
  }
});

test('patch rejects negative zero instead of writing it to the ledger', async () => {
  const id = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const source = itemSource(id);

  await withLedger({ [`${id}.md`]: source }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'patch-negative-zero.json');
    await writeFile(requestPath, `{
  "id": ${JSON.stringify(id)},
  "expected_revision": ${JSON.stringify(revision)},
  "patch": {"priority": -0},
  "date": "2030-01-16",
  "decision": {
    "summary": "Set the fictional survey priority.",
    "rationale": "Negative zero is not a canonical non-negative integer token."
  }
}`);

    const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');
    const output = JSON.parse(result.stdout);

    assert.equal(result.status, 2, `${result.stderr}\n${result.stdout}`);
    assert.equal(output.state, 'unchanged');
    assert.equal(output.error.code, 'invalid-request');
    assert.deepEqual(output.error.details.issues, [{
      path: '/patch/priority',
      code: 'invalid-type',
      message: 'Patch member priority must be null or a non-negative integer.',
    }]);
    assert.equal(await readFile(path.join(ledger, `${id}.md`), 'utf8'), source);
  });
});

test('patch request validation rejects programmatic numeric negative zero', () => {
  const issues = validatePatchRequest({
    id: 'wb_01Q4EVGR000000000000000000',
    expected_revision: `sha256:${'a'.repeat(64)}`,
    patch: { priority: -0 },
    date: '2030-01-16',
    decision: {
      summary: 'Set the fictional survey priority.',
      rationale: 'Numeric negative zero is outside the patch contract.',
    },
  });

  assert.deepEqual(issues, [{
    path: '/patch/priority',
    code: 'invalid-type',
    message: 'Patch member priority must be null or a non-negative integer.',
  }]);
});

// A backend that silently discards every patch can return exactly the envelope
// an honest no-op returns. The only thing separating them is whether the
// requested values are actually in effect, so the oracle must check that or it
// certifies the discarding backend as conformant.
test('adapter oracle refuses an unchanged patch whose requested value is not in effect', () => {
  const id = 'wb_01Q4EVGR000000000000000000';
  const source = ['---', 'schema_version: 1', `id: ${id}`, 'title: "Ranked survey"',
    'kind: task', 'status: backlog', 'created: 2030-01-14', 'updated: 2030-01-14',
    'provenance:', '  source: "fixture"', '  recorded_at: "2030-01-14T10:00:00Z"',
    'depends_on: []', 'related: []', 'number: 12', '---', '', 'Body.', ''].join('\n');
  const revision = `sha256:${createHash('sha256').update(source).digest('hex')}`;
  const item = {
    path: `ledger/${id}.md`,
    revision,
    source_encoding: 'base64',
    source_media_type: 'text/markdown; charset=utf-8',
    source_base64: Buffer.from(source).toString('base64'),
    core: {
      schema_version: 1,
      id,
      title: 'Ranked survey',
      kind: 'task',
      status: 'backlog',
      created: '2030-01-14',
      updated: '2030-01-14',
      provenance: { source: 'fixture', recorded_at: '2030-01-14T10:00:00Z' },
      depends_on: [],
      related: [],
    },
    body: '\nBody.\n',
  };
  const envelope = {
    ok: true, command: 'patch', contract_version: 1, state: 'unchanged', result: { item },
  };

  const judge = (requestedNumber) => mapProcessOutcome({
    adapter_contract_version: 1,
    request_id: 'patch-unchanged-oracle-0001',
    command: 'patch',
    core_request: { command: 'patch', ledger: 'ledger', input_base64: '' },
    mutation_input: Buffer.from(JSON.stringify({
      id,
      expected_revision: revision,
      patch: { number: requestedNumber },
      date: '2030-01-16',
      decision: { summary: 'Confirm the rank.', rationale: 'The value may already hold.' },
    })),
    item_id: id,
    expected_revision: revision,
    process: {
      started: true,
      process_tree_contained: true,
      orphaned: false,
      exit_code: 0,
      signal: null,
      timed_out: false,
      stdout_complete: true,
      stderr_complete: true,
      stdout_base64: Buffer.from(`${JSON.stringify(envelope)}\n`).toString('base64'),
      stderr_base64: '',
    },
  });

  // 12 is genuinely already in effect, so the unchanged envelope is honest.
  assert.equal(judge(12), null);
  // 99 is not: the same envelope now describes a patch that was dropped.
  assert.equal(judge(99)?.error?.code, 'mutation-outcome-unknown');
});

test('adapter oracle accepts invalid-request for a patch carrying negative zero', () => {
  const id = 'wb_01Q4EVGR000000000000000000';
  const revision = `sha256:${'a'.repeat(64)}`;
  const requestSource = `{
  "id": ${JSON.stringify(id)},
  "expected_revision": ${JSON.stringify(revision)},
  "patch": {"priority": -0},
  "date": "2030-01-16",
  "decision": {
    "summary": "Set the fictional survey priority.",
    "rationale": "Negative zero is outside the patch contract."
  }
}`;
  const envelope = {
    ok: false,
    command: 'patch',
    contract_version: 1,
    state: 'unchanged',
    error: {
      code: 'invalid-request',
      message: 'The patch request is invalid.',
      details: {
        issues: [{
          path: '/patch/priority',
          code: 'invalid-type',
          message: 'Patch member priority must be null or a non-negative integer.',
        }],
      },
    },
  };
  const result = mapProcessOutcome({
    adapter_contract_version: 1,
    request_id: 'patch-negative-zero-oracle-0001',
    command: 'patch',
    core_request: { command: 'patch', ledger: 'ledger', input_base64: '' },
    mutation_input: Buffer.from(requestSource),
    item_id: id,
    expected_revision: revision,
    process: {
      started: true,
      process_tree_contained: true,
      orphaned: false,
      exit_code: 2,
      signal: null,
      timed_out: false,
      stdout_complete: true,
      stderr_complete: true,
      stdout_base64: Buffer.from(`${JSON.stringify(envelope)}\n`).toString('base64'),
      stderr_base64: '',
    },
  });
  const programmaticResult = mapProcessOutcome({
    adapter_contract_version: 1,
    request_id: 'patch-numeric-negative-zero-oracle-0001',
    command: 'patch',
    core_request: { command: 'patch', ledger: 'ledger', input_base64: '' },
    mutation_request: {
      id,
      expected_revision: revision,
      patch: { priority: -0 },
      date: '2030-01-16',
      decision: {
        summary: 'Set the fictional survey priority.',
        rationale: 'Numeric negative zero is outside the patch contract.',
      },
    },
    item_id: id,
    expected_revision: revision,
    process: {
      started: true,
      process_tree_contained: true,
      orphaned: false,
      exit_code: 2,
      signal: null,
      timed_out: false,
      stdout_complete: true,
      stderr_complete: true,
      stdout_base64: Buffer.from(`${JSON.stringify(envelope)}\n`).toString('base64'),
      stderr_base64: '',
    },
  });

  assert.equal(result, null);
  assert.equal(programmaticResult, null);
});

test('adapter oracle accepts the permanent unsafe YAML refusal code', () => {
  const id = 'wb_01Q4EVGR000000000000000000';
  const revision = `sha256:${'a'.repeat(64)}`;
  const request = {
    id,
    expected_revision: revision,
    patch: { title: 'Rank the fictional harbor survey' },
    date: '2030-01-16',
    decision: {
      summary: 'Replace the fictional survey title.',
      rationale: 'The source carries YAML that patch must not rewrite.',
    },
  };
  const message = 'The mutation cannot safely edit YAML whose alias semantics cross an edited byte range. '
    + 'Hand-edit the item at details.path to remove the cross-field anchor or alias, run validate, then retry.';
  const envelope = {
    ok: false,
    command: 'patch',
    contract_version: 1,
    state: 'unchanged',
    error: {
      code: 'unsafe-yaml-mutation',
      message,
      details: {
        id,
        path: `ledger/${id}.md`,
        field: 'title',
        reason: 'anchor-referenced-outside-field',
      },
    },
  };
  const result = mapProcessOutcome({
    adapter_contract_version: 1,
    request_id: 'patch-permanent-refusal-oracle-0001',
    command: 'patch',
    core_request: { command: 'patch', ledger: 'ledger', input_base64: '' },
    mutation_input: Buffer.from(JSON.stringify(request)),
    item_id: id,
    expected_revision: revision,
    process: {
      started: true,
      process_tree_contained: true,
      orphaned: false,
      exit_code: 2,
      signal: null,
      timed_out: false,
      stdout_complete: true,
      stderr_complete: true,
      stdout_base64: Buffer.from(`${JSON.stringify(envelope)}\n`).toString('base64'),
      stderr_base64: '',
    },
  });

  assert.equal(result, null);

  const miscoded = structuredClone(envelope);
  miscoded.error.code = 'candidate-invalid';
  miscoded.error.details = {
    id,
    validation_errors: [{
      path: `ledger/${id}.md`,
      field: 'parent',
      code: 'unresolved-parent',
      message: `Parent ${id} does not resolve to an item in the configured ledger.`,
    }],
  };
  const rejected = mapProcessOutcome({
    adapter_contract_version: 1,
    request_id: 'patch-miscoded-permanent-refusal-0001',
    command: 'patch',
    core_request: { command: 'patch', ledger: 'ledger', input_base64: '' },
    mutation_input: Buffer.from(JSON.stringify(request)),
    item_id: id,
    expected_revision: revision,
    process: {
      started: true,
      process_tree_contained: true,
      orphaned: false,
      exit_code: 2,
      signal: null,
      timed_out: false,
      stdout_complete: true,
      stderr_complete: true,
      stdout_base64: Buffer.from(`${JSON.stringify(miscoded)}\n`).toString('base64'),
      stderr_base64: '',
    },
  });
  assert.notEqual(rejected, null);
});

test('adapter oracle accepts an internal serializer operation failure', () => {
  const id = 'wb_01Q4EVGR000000000000000000';
  const revision = `sha256:${'a'.repeat(64)}`;
  const request = {
    id,
    expected_revision: revision,
    patch: { title: 'Exercise the serializer boundary' },
    date: '2030-01-16',
    decision: {
      summary: 'Exercise the serializer boundary.',
      rationale: 'An internal failure is not invalid item data.',
    },
  };
  const envelope = {
    ok: false,
    command: 'patch',
    contract_version: 1,
    state: 'unchanged',
    error: {
      code: 'operation-failed',
      message: 'The mutation operation failed before a commit was established.',
      details: {
        id,
        operation: 'serialize-candidate',
        reason: 'internal-error',
        recovery_artifacts: [],
        recovery_artifacts_truncated: false,
      },
    },
  };

  const result = mapProcessOutcome({
    adapter_contract_version: 1,
    request_id: 'patch-serializer-failure-oracle-0001',
    command: 'patch',
    core_request: { command: 'patch', ledger: 'ledger', input_base64: '' },
    mutation_input: Buffer.from(JSON.stringify(request)),
    item_id: id,
    expected_revision: revision,
    process: {
      started: true,
      process_tree_contained: true,
      orphaned: false,
      exit_code: 6,
      signal: null,
      timed_out: false,
      stdout_complete: true,
      stderr_complete: true,
      stdout_base64: Buffer.from(`${JSON.stringify(envelope)}\n`).toString('base64'),
      stderr_base64: '',
    },
  });

  assert.equal(result, null);
});

test('patch replaces existing values for every patchable field', async () => {
  const targetId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const oldParentId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const newParentId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const oldDependencyId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const newDependencyId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const source = itemSource(targetId, '\nThe replacement body stays exact.\n', [
    `parent: ${oldParentId}`,
    'priority: 8',
    'number: 12',
  ]).replace('depends_on: []', `depends_on: [${oldDependencyId}]`);

  await withLedger({
    [`${targetId}.md`]: source,
    [`${oldParentId}.md`]: itemSource(oldParentId, '', [], 'epic'),
    [`${newParentId}.md`]: itemSource(newParentId, '', [], 'epic'),
    [`${oldDependencyId}.md`]: itemSource(oldDependencyId),
    [`${newDependencyId}.md`]: itemSource(newDependencyId),
  }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', targetId, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'patch-existing-fields.json');
    await writeFile(requestPath, JSON.stringify({
      id: targetId,
      expected_revision: revision,
      patch: {
        priority: 2,
        number: 7,
        parent: newParentId,
        depends_on: [newDependencyId],
        title: 'Survey the fictional replacement corridor',
      },
      date: '2030-01-16',
      decision: {
        summary: 'Replace the fictional survey metadata.',
        rationale: 'Every requested field now has a new reviewed value.',
      },
    }));

    const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');
    const rewritten = await readFile(path.join(ledger, `${targetId}.md`), 'utf8');
    const data = parseDocument(frontmatter(rewritten), { schema: 'core' }).toJS();

    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    assert.equal(data.priority, 2);
    assert.equal(data.number, 7);
    assert.equal(data.parent, newParentId);
    assert.deepEqual(data.depends_on, [newDependencyId]);
    assert.equal(data.title, 'Survey the fictional replacement corridor');
    assert.ok(rewritten.endsWith('\nThe replacement body stays exact.\n'));
  });
});

test('patch changes title, number, parent, and dependencies in one item', async () => {
  const targetId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const oldParentId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const newParentId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const dependencyId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const target = itemSource(targetId, '', [`parent: ${oldParentId}`]);

  await withLedger({
    [`${targetId}.md`]: target,
    [`${oldParentId}.md`]: itemSource(oldParentId, '', [], 'epic'),
    [`${newParentId}.md`]: itemSource(newParentId, '', [], 'epic'),
    [`${dependencyId}.md`]: itemSource(dependencyId),
  }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', targetId, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'patch-fields.json');
    await writeFile(requestPath, JSON.stringify({
      id: targetId,
      expected_revision: revision,
      patch: {
        title: 'Survey the fictional aurora corridor',
        number: 7,
        parent: newParentId,
        depends_on: [dependencyId],
      },
      date: '2030-01-17',
      decision: {
        summary: 'Correct the survey metadata.',
        rationale: 'The corrected title and relations match the planning record.',
      },
    }));

    const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    const rewritten = await readFile(path.join(ledger, `${targetId}.md`), 'utf8');
    const data = parseDocument(frontmatter(rewritten), { schema: 'core' }).toJS();

    assert.equal(data.title, 'Survey the fictional aurora corridor');
    assert.equal(data.number, 7);
    assert.equal(data.parent, newParentId);
    assert.deepEqual(data.depends_on, [dependencyId]);
    assert.equal(data.decisions.at(-1).action, 'record');
  });
});

test('patch removes optional priority, number, and parent with null', async () => {
  const targetId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const parentId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const target = itemSource(targetId, '', [
    'number: 12',
    `parent: ${parentId}`,
    'priority: 4',
  ]);

  await withLedger({
    [`${targetId}.md`]: target,
    [`${parentId}.md`]: itemSource(parentId, '', [], 'epic'),
  }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', targetId, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'patch-remove.json');
    await writeFile(requestPath, JSON.stringify({
      id: targetId,
      expected_revision: revision,
      patch: { priority: null, number: null, parent: null },
      date: '2030-01-18',
      decision: {
        summary: 'Clear optional planning metadata.',
        rationale: 'The item no longer has a parent, number, or explicit priority.',
      },
    }));

    const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    const rewritten = await readFile(path.join(ledger, `${targetId}.md`), 'utf8');
    const data = parseDocument(frontmatter(rewritten), { schema: 'core' }).toJS();

    assert.equal(Object.hasOwn(data, 'priority'), false);
    assert.equal(Object.hasOwn(data, 'number'), false);
    assert.equal(Object.hasOwn(data, 'parent'), false);
  });
});

// The no-op case is asserted by 'patch returns an unchanged success when every
// requested value is in effect' in this file, which drives the same request and
// pins the revision, the bytes, and the absence of an appended decision.

test('patch refuses an invalid proposed ledger and leaves target bytes unchanged', async () => {
  const targetId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const missingParentId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const source = itemSource(targetId);

  await withLedger({ [`${targetId}.md`]: source }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', targetId, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'patch-invalid.json');
    await writeFile(requestPath, JSON.stringify({
      id: targetId,
      expected_revision: revision,
      patch: { parent: missingParentId },
      date: '2030-01-19',
      decision: {
        summary: 'Attach the item to the missing epic.',
        rationale: 'This synthetic request must fail complete-ledger validation.',
      },
    }));

    const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');
    const output = JSON.parse(result.stdout);

    assert.equal(result.status, 2, `${result.stderr}\n${result.stdout}`);
    assert.equal(output.state, 'unchanged');
    assert.equal(output.error.code, 'candidate-invalid');
    assert.equal(output.error.details.validation_errors[0].code, 'unresolved-parent');
    assert.equal(await readFile(path.join(ledger, `${targetId}.md`), 'utf8'), source);
  });
});

test('patch refuses a stale revision and leaves target bytes unchanged', async () => {
  const targetId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const source = itemSource(targetId);

  await withLedger({ [`${targetId}.md`]: source }, async (ledger) => {
    const requestPath = path.join(path.dirname(ledger), 'patch-stale.json');
    await writeFile(requestPath, JSON.stringify({
      id: targetId,
      expected_revision: `sha256:${'0'.repeat(64)}`,
      patch: { priority: 1 },
      date: '2030-01-20',
      decision: {
        summary: 'Apply a stale priority change.',
        rationale: 'The stale compare-and-swap witness must refuse this write.',
      },
    }));

    const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');
    const output = JSON.parse(result.stdout);

    assert.equal(result.status, 4, `${result.stderr}\n${result.stdout}`);
    assert.equal(output.state, 'unchanged');
    assert.equal(output.error.code, 'revision-conflict');
    assert.equal(output.error.details.expected_revision, `sha256:${'0'.repeat(64)}`);
    assert.equal(await readFile(path.join(ledger, `${targetId}.md`), 'utf8'), source);
  });
});

test('patch refuses while the target per-ID lock is held', async () => {
  const targetId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const source = itemSource(targetId);

  await withLedger({ [`${targetId}.md`]: source }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', targetId, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const lockDirectory = path.join(ledger, '.wowbagger-locks');
    const lockPath = path.join(lockDirectory, `${targetId}.lock`);
    const lockSource = `${JSON.stringify({
      lock_version: 1,
      item_id: targetId,
      operation: 'patch',
      writer_id: 'held-patch-writer',
      started_at: '2030-01-20T12:00:00Z',
    })}\n`;
    const requestPath = path.join(path.dirname(ledger), 'patch-locked.json');
    await mkdir(lockDirectory);
    await writeFile(lockPath, lockSource);
    await writeFile(requestPath, JSON.stringify({
      id: targetId,
      expected_revision: revision,
      patch: { priority: 2 },
      date: '2030-01-20',
      decision: {
        summary: 'Change priority while another writer holds the lock.',
        rationale: 'The per-ID lock must serialize cooperative patch writers.',
      },
    }));

    const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');
    const output = JSON.parse(result.stdout);

    assert.equal(result.status, 4, `${result.stderr}\n${result.stdout}`);
    assert.equal(output.error.code, 'lock-held');
    assert.equal(output.error.details.owner.operation, 'patch');
    assert.equal(await readFile(path.join(ledger, `${targetId}.md`), 'utf8'), source);
    assert.equal(await readFile(lockPath, 'utf8'), lockSource);
  });
});

test('patch refuses when reparenting would require changing a done epic rollup', async () => {
  const childId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const epicId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const child = killedChildSource(childId, epicId);
  const epic = doneEpicSource(epicId, childId);

  await withLedger({ [`${childId}.md`]: child, [`${epicId}.md`]: epic }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', childId, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'patch-multi-item.json');
    await writeFile(requestPath, JSON.stringify({
      id: childId,
      expected_revision: revision,
      patch: { parent: null },
      date: '2030-01-16',
      decision: {
        summary: 'Remove the child from its completed epic.',
        rationale: 'Changing the child set would also require a new epic rollup.',
      },
    }));

    const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');
    const output = JSON.parse(result.stdout);

    assert.equal(result.status, 5, `${result.stderr}\n${result.stdout}`);
    assert.equal(output.state, 'unchanged');
    assert.equal(output.error.code, 'atomic-scope-required');
    assert.deepEqual(output.error.details, {
      id: childId,
      blockers: [{ code: 'child-disposition', item_id: epicId, field: 'parent' }],
      precondition_issues: [],
    });
    assert.equal(await readFile(path.join(ledger, `${childId}.md`), 'utf8'), child);
    assert.equal(await readFile(path.join(ledger, `${epicId}.md`), 'utf8'), epic);
  });
});

test('patch requires decision evidence for every frontmatter change', async () => {
  const targetId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const source = itemSource(targetId);

  await withLedger({ [`${targetId}.md`]: source }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', targetId, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'patch-no-decision.json');
    await writeFile(requestPath, JSON.stringify({
      id: targetId,
      expected_revision: revision,
      patch: { priority: 5 },
      date: '2030-01-20',
    }));

    const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');

    assert.equal(result.status, 2, `${result.stderr}\n${result.stdout}`);
    assert.deepEqual(JSON.parse(result.stdout).error.details.issues, [{
      path: '/decision',
      code: 'missing-member',
      message: 'Required member decision is missing.',
    }]);
    assert.equal(await readFile(path.join(ledger, `${targetId}.md`), 'utf8'), source);
  });
});

test('patch rejects a frontmatter field outside the exact patchable set', async () => {
  const targetId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const source = itemSource(targetId);

  await withLedger({ [`${targetId}.md`]: source }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', targetId, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'patch-status.json');
    await writeFile(requestPath, JSON.stringify({
      id: targetId,
      expected_revision: revision,
      patch: { status: 'done' },
      date: '2030-01-20',
      decision: {
        summary: 'Try to bypass transition.',
        rationale: 'Status changes belong only to the transition operation.',
      },
    }));

    const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');

    assert.equal(result.status, 2, `${result.stderr}\n${result.stdout}`);
    assert.deepEqual(JSON.parse(result.stdout).error.details.issues, [{
      path: '/patch/status',
      code: 'unknown-member',
      message: 'Patch member status is not allowed.',
    }]);
    assert.equal(await readFile(path.join(ledger, `${targetId}.md`), 'utf8'), source);
  });
});

test('mutation vectors cover committed patch and required guarded refusals', async () => {
  const fixtureRoot = new URL('../spec/fixtures/mutations/', import.meta.url);
  const outcomes = [];
  const candidateValidationCodes = [];
  for (const directory of await readdir(fixtureRoot, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    const directoryUrl = new URL(`${directory.name}/`, fixtureRoot);
    for (const file of await readdir(directoryUrl)) {
      if (!file.startsWith('manifest') || !file.endsWith('.json')) continue;
      const manifest = JSON.parse(await readFile(new URL(file, directoryUrl), 'utf8'));
      if (manifest.argv[0] !== 'patch') continue;
      const expected = JSON.parse(await readFile(
        new URL(manifest.expected.stdout.json_file, directoryUrl),
        'utf8',
      ));
      outcomes.push(expected.ok ? expected.state : expected.error.code);
      if (expected.error?.code === 'candidate-invalid') {
        candidateValidationCodes.push(...expected.error.details.validation_errors
          .map((error) => error.code));
      }
    }
  }

  assert.deepEqual(outcomes.sort(), [
    'atomic-scope-required',
    'candidate-invalid',
    'candidate-invalid',
    'committed',
    'invalid-request',
    'invalid-request',
    'lock-held',
    'revision-conflict',
    // Pins the CLI's unchanged bytes. NOTE: this vector lives under
    // spec/fixtures/mutations/, which is byte-compared only — it does NOT reach
    // the oracle's unchanged-patch branch. That branch is covered in-repo by
    // 'adapter oracle refuses an unchanged patch whose requested value is not in
    // effect'; third-party certification through spec/fixtures/adapters/ still
    // does not exercise it. Tracked as a ledger item.
    'unchanged',
    'unsafe-yaml-mutation',
  ]);
  assert.deepEqual(candidateValidationCodes.sort(), [
    'mutation-successor-mismatch',
    'unresolved-parent',
  ]);
});

// A patch that would change nothing is refused rather than published. There is
// exactly one success exit, so no request can reach it without passing every
// check on the way; and no decision is appended for a change that did not occur.
// The unchanged result is determined last. A no-op request on an item that
// refuses every real patch must report THAT refusal, not a bland success —
// otherwise a caller can use a cheap no-op to probe patchability and get a
// false green. This is the ordering the contract promises.
test('a no-op patch reports an unsafe-YAML refusal rather than success', async () => {
  const targetId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  // A no-op still edits updated and decisions, so anchoring updated puts the
  // unsafe-YAML refusal in the path of a request that changes nothing else.
  const target = itemSource(targetId, '', ['mirror: *when'])
    .replace(/^updated: (.*)$/m, 'updated: &when $1');

  await withLedger({ [`${targetId}.md`]: target }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', targetId, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'patch-noop-unsafe.json');
    await writeFile(requestPath, JSON.stringify({
      id: targetId,
      expected_revision: revision,
      patch: { number: null },
      date: '2030-01-18',
      decision: { summary: 'No-op on an unsafe item.', rationale: 'The stronger refusal must win.' },
    }));

    const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');
    const output = JSON.parse(result.stdout);

    assert.equal(result.status, 2, `${result.stderr}\n${result.stdout}`);
    assert.equal(output.error.code, 'unsafe-yaml-mutation');
    assert.equal(await readFile(path.join(ledger, `${targetId}.md`), 'utf8'), target);
  });
});

test('a patch mixing a no-op field with a real change commits the real change', async () => {
  const targetId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const target = itemSource(targetId, '', ['priority: 4']);

  await withLedger({ [`${targetId}.md`]: target }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', targetId, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'patch-mixed.json');
    await writeFile(requestPath, JSON.stringify({
      id: targetId,
      expected_revision: revision,
      // number: null is already true; priority genuinely changes.
      patch: { number: null, priority: 9 },
      date: '2030-01-18',
      decision: { summary: 'Raise priority.', rationale: 'One requested value is already in effect.' },
    }));

    const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');
    const output = JSON.parse(result.stdout);
    const rewritten = await readFile(path.join(ledger, `${targetId}.md`), 'utf8');

    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    assert.equal(output.state, 'committed');
    assert.match(rewritten, /^priority: 9$/m);
    assert.equal(/^number:/m.test(rewritten), false);
  });
});

test('patch returns an unchanged success when every requested value is in effect', async () => {
  const targetId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const target = itemSource(targetId, '', ['priority: 4']);

  await withLedger({ [`${targetId}.md`]: target }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', targetId, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'patch-noop.json');
    await writeFile(requestPath, JSON.stringify({
      id: targetId,
      expected_revision: revision,
      patch: { number: null },
      date: '2030-01-18',
      decision: {
        summary: 'Clear a number that is not there.',
        rationale: 'The request asks for a state the item already has.',
      },
    }));

    const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');
    const output = JSON.parse(result.stdout);

    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    assert.equal(output.ok, true);
    assert.equal(output.state, 'unchanged');
    assert.equal(output.result.item.revision, revision);
    assert.equal(await readFile(path.join(ledger, `${targetId}.md`), 'utf8'), target);

    const after = runCli('inspect', '--ledger', ledger, '--id', targetId, '--json');
    assert.equal(JSON.parse(after.stdout).result.item.revision, revision);
  });
});

test('patch refusing a no-op still refuses an unpatchable ledger first', async () => {
  const targetId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const missingParent = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
  const target = itemSource(targetId, '', ['priority: 4']);

  await withLedger({ [`${targetId}.md`]: target }, async (ledger) => {
    const inspected = runCli('inspect', '--ledger', ledger, '--id', targetId, '--json');
    const revision = JSON.parse(inspected.stdout).result.item.revision;
    const requestPath = path.join(path.dirname(ledger), 'patch-noop-and-real.json');
    await writeFile(requestPath, JSON.stringify({
      id: targetId,
      expected_revision: revision,
      // number: null is a no-op; parent names an item that does not exist.
      patch: { number: null, parent: missingParent },
      date: '2030-01-18',
      decision: { summary: 'Mixed request.', rationale: 'One no-op and one real change.' },
    }));

    const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');
    const output = JSON.parse(result.stdout);

    assert.equal(result.status, 2, `${result.stderr}\n${result.stdout}`);
    assert.equal(output.error.code, 'candidate-invalid');
    assert.equal(await readFile(path.join(ledger, `${targetId}.md`), 'utf8'), target);
  });
});

function itemSource(id, body = '', extraFrontmatter = [], kind = 'task') {
  return `---
schema_version: 1
id: ${id}
title: "Survey the fictional northern lights"
kind: ${kind}
status: backlog
created: 2030-01-14
updated: 2030-01-14
provenance:
  source: "test/patch-cli"
  recorded_at: "2030-01-14T12:00:00Z"
depends_on: []
related: []
${extraFrontmatter.length > 0 ? `${extraFrontmatter.join('\n')}\n` : ''}---
${body}`;
}

function frontmatter(source) {
  return source.split('\n---\n', 1)[0].replace(/^---\n/, '');
}

function killedChildSource(id, parent) {
  return `---
schema_version: 1
id: ${id}
title: "Close the fictional child survey"
kind: task
status: killed
created: 2030-01-14
updated: 2030-01-16
killed: 2030-01-16
provenance:
  source: "test/patch-cli"
  recorded_at: "2030-01-14T12:00:00Z"
depends_on: []
related: []
parent: ${parent}
decisions:
  - action: kill
    date: 2030-01-16
    summary: "Close the child survey."
    rationale: "The synthetic survey is no longer needed."
---
`;
}

function doneEpicSource(id, child) {
  return `---
schema_version: 1
id: ${id}
title: "Complete the fictional survey epic"
kind: epic
status: done
created: 2030-01-14
updated: 2030-01-17
completed: 2030-01-17
provenance:
  source: "test/patch-cli"
  recorded_at: "2030-01-14T12:00:00Z"
depends_on: []
related: []
decisions:
  - action: complete
    date: 2030-01-17
    summary: "Complete the survey epic."
    rationale: "Every direct child has reached a terminal state."
    rollup:
      - id: ${child}
        status: killed
---
`;
}
