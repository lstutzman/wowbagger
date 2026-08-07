import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { runCli, withLedger } from './support.js';

const MUTATION_DATE = '2030-01-16';
const PATCH_TITLE = 'Preserve only the requested ledger bytes';
const DECISIONS = {
  patch: {
    action: 'record',
    summary: 'Change only the requested title.',
    rationale: 'Every other frontmatter byte belongs to the author.',
  },
  transition: {
    action: 'accept',
    summary: 'Accept without rebuilding the frontmatter.',
    rationale: 'Only lifecycle metadata and the new decision may change.',
  },
};

test('patch and transition preserve every byte outside changed frontmatter fields', async (t) => {
  for (const shape of corpus()) {
    for (const command of ['patch', 'transition']) {
      await t.test(`${command}: ${shape.name}`, async () => {
        const targetId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
        const parentId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
        const relatedId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
        const source = shape.source({ targetId, parentId, relatedId });
        const supportingItems = shape.supportingItems?.({ parentId, relatedId }) ?? {};

        await withLedger({ [`${targetId}.md`]: source, ...supportingItems }, async (ledger) => {
          const inspected = runCli('inspect', '--ledger', ledger, '--id', targetId, '--json');
          assert.equal(inspected.status, 0, `${shape.name}: ${inspected.stderr}\n${inspected.stdout}`);
          const revision = JSON.parse(inspected.stdout).result.item.revision;
          const requestPath = path.join(path.dirname(ledger), `${command}-${shape.name}.json`);
          await writeFile(requestPath, JSON.stringify(requestFor(command, targetId, revision)));

          const result = runCli(command, '--ledger', ledger, '--input', requestPath, '--json');
          assert.equal(result.status, 0, `${shape.name}: ${result.stderr}\n${result.stdout}`);

          const rewritten = await readFile(path.join(ledger, `${targetId}.md`), 'utf8');
          const expected = expectedSource(source, shape, command);
          assert.equal(rewritten, expected, `${shape.name}: unexpected output bytes`);
        });
      });
    }
  }
});

test('byte corpus covers field insertion, removal, idempotent clear, and terminal dates', async (t) => {
  await t.test('patch inserts, removes, then leaves an already-absent field unchanged', async () => {
    const targetId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
    const marker = '# after patch hard paths\n';
    const source = item([
      'schema_version: 1',
      `id: ${targetId}`,
      'operator_early: "stay above title"',
      'title: Exercise patch hard paths',
      'kind: task',
      'status: backlog',
      'created: 2030-01-14',
      'updated: 2030-01-14',
      'provenance:',
      '  source: byte-corpus',
      '  recorded_at: "2030-01-14T12:00:00Z"',
      'depends_on: []',
      'related: []',
      marker.trimEnd(),
    ], '\n', 'Patch hard-path body stays exact.\n');
    const steps = [
      {
        date: '2030-01-16',
        patch: { priority: 3 },
        state: 'committed',
        summary: 'Insert the absent priority.',
        rationale: 'The insertion path must preserve every other byte.',
        updateExpected(expected) {
          expected = replaceLine(expected, 'updated: 2030-01-14', 'updated: 2030-01-16', '\n');
          return expected.replace(marker,
            `priority: 3\ndecisions:\n${decisionItem({
              action: 'record',
              date: this.date,
              summary: this.summary,
              rationale: this.rationale,
            }, '  ', '\n')}${marker}`);
        },
      },
      {
        date: '2030-01-17',
        patch: { priority: null },
        state: 'committed',
        summary: 'Remove the present priority.',
        rationale: 'The removal path must preserve every other byte.',
        updateExpected(expected) {
          expected = replaceLine(expected, 'updated: 2030-01-16', 'updated: 2030-01-17', '\n');
          expected = expected.replace('priority: 3\n', '');
          return expected.replace(marker, `${decisionItem({
            action: 'record',
            date: this.date,
            summary: this.summary,
            rationale: this.rationale,
          }, '  ', '\n')}${marker}`);
        },
      },
      {
        date: '2030-01-18',
        patch: { number: null },
        state: 'unchanged',
        summary: 'Clear the already-absent number.',
        rationale: 'The idempotent clear path must preserve every other byte.',
        updateExpected(expected) {
          return expected;
        },
      },
    ];

    await withLedger({ [`${targetId}.md`]: source }, async (ledger) => {
      let expected = source;
      for (const step of steps) {
        const inspected = runCli('inspect', '--ledger', ledger, '--id', targetId, '--json');
        const revision = JSON.parse(inspected.stdout).result.item.revision;
        const requestPath = path.join(path.dirname(ledger), `patch-${step.date}.json`);
        await writeFile(requestPath, JSON.stringify({
          id: targetId,
          expected_revision: revision,
          patch: step.patch,
          date: step.date,
          decision: { summary: step.summary, rationale: step.rationale },
        }));

        const result = runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');
        const output = JSON.parse(result.stdout);
        expected = step.updateExpected(expected);
        assert.equal(result.status, 0, `${step.date}: ${result.stderr}\n${result.stdout}`);
        assert.equal(output.state, step.state, step.date);
        if (step.state === 'unchanged') {
          assert.equal(output.result.item.revision, revision, step.date);
        } else {
          assert.notEqual(output.result.item.revision, revision, step.date);
        }
        assert.equal(await readFile(path.join(ledger, `${targetId}.md`), 'utf8'), expected, step.date);
      }
    });
  });

  await t.test('transition inserts a terminal date into an absent field', async () => {
    const targetId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
    const marker = 'operator_late: "stay after decisions"\n';
    const source = item([
      'schema_version: 1',
      `id: ${targetId}`,
      'operator_early: "stay above title"',
      'title: Exercise terminal insertion',
      'kind: task',
      'status: in-progress',
      'created: 2030-01-14',
      'updated: 2030-01-14',
      'provenance:',
      '  source: byte-corpus',
      '  recorded_at: "2030-01-14T12:00:00Z"',
      'depends_on: []',
      'related: []',
      marker.trimEnd(),
    ], '\n', 'Terminal insertion body stays exact.\n');
    const summary = 'Complete the terminal insertion item.';
    const rationale = 'The completed date must be the only new terminal field.';

    await withLedger({ [`${targetId}.md`]: source }, async (ledger) => {
      const inspected = runCli('inspect', '--ledger', ledger, '--id', targetId, '--json');
      const revision = JSON.parse(inspected.stdout).result.item.revision;
      const requestPath = path.join(path.dirname(ledger), 'transition-terminal.json');
      await writeFile(requestPath, JSON.stringify({
        id: targetId,
        expected_revision: revision,
        to_status: 'done',
        date: MUTATION_DATE,
        decision: { summary, rationale },
      }));

      const result = runCli('transition', '--ledger', ledger, '--input', requestPath, '--json');
      let expected = replaceLine(source, 'status: in-progress', 'status: done', '\n');
      expected = replaceLine(expected, 'updated: 2030-01-14',
        `updated: ${MUTATION_DATE}\ncompleted: ${MUTATION_DATE}`.trimEnd(), '\n');
      expected = expected.replace(marker,
        `decisions:\n${decisionItem({ action: 'complete', summary, rationale }, '  ', '\n')}${marker}`);

      assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
      assert.equal(await readFile(path.join(ledger, `${targetId}.md`), 'utf8'), expected);
    });
  });

  await t.test('transition restore removes the present archived date', async () => {
    const targetId = runCli('mint-id', '--date', '2030-01-14').stdout.trim();
    const marker = '# after four-space decisions\n';
    const source = item([
      'schema_version: 1',
      `id: ${targetId}`,
      'title: Exercise terminal removal',
      'kind: task',
      'status: archived',
      'created: 2030-01-14',
      'updated: 2030-01-16',
      'archived: 2030-01-16',
      'provenance:',
      '  source: byte-corpus',
      '  recorded_at: "2030-01-14T12:00:00Z"',
      'depends_on: []',
      'related: []',
      'decisions:',
      '    - action: archive',
      '      date: 2030-01-16',
      '      summary: "Keep the first archive record."',
      '      rationale: "Its bytes are append-only."',
      '    - action: archive',
      '      date: 2030-01-16',
      '      summary: "Keep the second archive record."',
      '      rationale: "Its bytes are append-only too."',
      marker.trimEnd(),
    ], '\n', 'Terminal removal body stays exact.\n');
    const summary = 'Restore the archived item.';
    const rationale = 'Restore must remove only the archived date.';

    await withLedger({ [`${targetId}.md`]: source }, async (ledger) => {
      const inspected = runCli('inspect', '--ledger', ledger, '--id', targetId, '--json');
      const revision = JSON.parse(inspected.stdout).result.item.revision;
      const requestPath = path.join(path.dirname(ledger), 'transition-restore.json');
      await writeFile(requestPath, JSON.stringify({
        id: targetId,
        expected_revision: revision,
        to_status: 'backlog',
        date: '2030-01-18',
        decision: { summary, rationale },
      }));

      const result = runCli('transition', '--ledger', ledger, '--input', requestPath, '--json');
      let expected = replaceLine(source, 'status: archived', 'status: backlog', '\n');
      expected = replaceLine(expected, 'updated: 2030-01-16', 'updated: 2030-01-18', '\n');
      expected = expected.replace('archived: 2030-01-16\n', '');
      expected = expected.replace(marker,
        `${decisionItem({ action: 'restore', date: '2030-01-18', summary, rationale }, '    ', '\n')}${marker}`);

      assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
      assert.equal(await readFile(path.join(ledger, `${targetId}.md`), 'utf8'), expected);
    });
  });
});

function corpus() {
  return [
    {
      name: 'irregular-flow-and-scalar-styles',
      newline: '\n',
      oldTitle: 'title: "Keep irregular flow bytes"',
      newTitle: `title: "${PATCH_TITLE}"`,
      decisionMarker: 'operator_flow: [bug, stripe]',
      source: ({ targetId }) => item([
        'schema_version: 1',
        `id: ${targetId}`,
        'title: "Keep irregular flow bytes"',
        'kind: task',
        'status: triage',
        'created: 2030-01-14',
        'updated: 2030-01-14',
        'provenance: {source: "byte corpus",recorded_at: "2030-01-14T12:00:00Z"}',
        'depends_on: [ ]',
        'operator_flow: [bug, stripe]',
        'operator_empty: [ ]',
        'operator_map: {a: 1,b: 2}',
        "operator_single: 'single quoted'",
        'operator_double: "double quoted"',
        'operator_plain: unquoted',
        'operator_tagged_scalar: !!str 42',
        'operator_tagged_sequence: !!seq [bug, stripe]',
      ], '\n', 'Flow body stays exact.\n'),
    },
    {
      name: 'nested-comments-anchors-tags-and-all-optional-fields',
      newline: '\n',
      oldTitle: "title: !!str 'Keep structured bytes' # trailing title comment",
      newTitle: `title: !!str '${PATCH_TITLE}' # trailing title comment`,
      decisionMarker: '# final frontmatter comment',
      decisionIndent: '    ',
      source: ({ targetId, parentId, relatedId }) => item([
        '# document-level comment',
        'schema_version: 1',
        `id: ${targetId}`,
        "title: !!str 'Keep structured bytes' # trailing title comment",
        'kind: task',
        'status: triage',
        'created: 2030-01-14',
        'updated: 2030-01-14',
        '# before provenance',
        'provenance:',
        '    source: byte-corpus',
        '    recorded_at: "2030-01-14T12:00:00Z"',
        '    operator_note: # comment inside a nested map',
        '        labels: [one, two]',
        'depends_on: []',
        `related: [${relatedId}]`,
        `parent: ${parentId}`,
        'snoozed_until: 2030-01-14',
        'priority: 4',
        'number: 27',
        'operator_anchor: &settings',
        '    enabled: true',
        '    nested:',
        '        - one',
        '        # comment inside a nested sequence',
        '        - two',
        'operator_alias: *settings',
        'operator_map: !!map {a: 1,b: 2} # trailing collection comment',
        'operator_sequence: !!seq [bug, stripe]',
        'decisions:',
        "    - action: 'record'",
        '      date: 2030-01-14',
        '      summary: "Keep the first record exactly."',
        "      rationale: 'Its quoting is durable.'",
        '    - action: record',
        '      date: 2030-01-14',
        "      summary: 'Keep the second record exactly.'",
        '      rationale: Its indentation is durable.',
        '# final frontmatter comment',
      ], '\n', '\nStructured body stays exact.\n'),
      supportingItems: ({ parentId, relatedId }) => ({
        [`${parentId}.md`]: supportItem(parentId, 'epic'),
        [`${relatedId}.md`]: supportItem(relatedId, 'task'),
      }),
    },
    {
      name: 'every-optional-field-omitted',
      newline: '\n',
      oldTitle: 'title: Keep plain scalar bytes',
      newTitle: `title: ${PATCH_TITLE}`,
      decisionMarker: '# before operator extension',
      source: ({ targetId }) => item([
        'schema_version: 1',
        `id: ${targetId}`,
        'title: Keep plain scalar bytes',
        'kind: task',
        'status: triage',
        'created: 2030-01-14',
        'updated: 2030-01-14',
        'provenance:',
        '  source: byte-corpus',
        '  recorded_at: 2030-01-14T12:00:00Z',
        'depends_on: []',
        '# before operator extension',
        'operator_plain: still untouched',
      ], '\n', 'No optional metadata is present.\n'),
    },
    {
      name: 'crlf-with-trailing-comment',
      newline: '\r\n',
      oldTitle: 'title: "Keep CRLF bytes"',
      newTitle: `title: "${PATCH_TITLE}"`,
      decisionMarker: '# CRLF final frontmatter comment',
      decisionIndent: '  ',
      source: ({ targetId }) => item([
        'schema_version: 1',
        `id: ${targetId}`,
        'title: "Keep CRLF bytes"',
        'kind: task',
        'status: triage',
        'created: 2030-01-14',
        'updated: 2030-01-14',
        'provenance:',
        '  source: "byte-corpus"',
        '  recorded_at: "2030-01-14T12:00:00Z"',
        'depends_on: []',
        'operator_flow: [bug, stripe] # CRLF trailing key comment',
        'decisions:',
        '  - action: record',
        '    date: 2030-01-14',
        '    summary: "Keep the CRLF record."',
        '    rationale: "Its line terminators are durable."',
        '  - action: record',
        '    date: 2030-01-14',
        '    summary: "Keep the second CRLF record."',
        '    rationale: "Its two-space indentation is durable."',
        '# CRLF final frontmatter comment',
      ], '\r\n', '\r\nCRLF body stays exact.\r\n'),
    },
    {
      name: 'zero-indent-multi-record-decisions',
      newline: '\n',
      oldTitle: 'title: Keep zero-indent decisions',
      newTitle: `title: ${PATCH_TITLE}`,
      decisionMarker: '# after zero-indent decisions',
      decisionIndent: '',
      source: ({ targetId }) => item([
        'schema_version: 1',
        `id: ${targetId}`,
        'title: Keep zero-indent decisions',
        'kind: task',
        'status: triage',
        'created: 2030-01-14',
        'updated: 2030-01-14',
        'provenance:',
        '  source: byte-corpus',
        '  recorded_at: "2030-01-14T12:00:00Z"',
        'depends_on: []',
        'decisions:',
        '- action: record',
        '  date: 2030-01-14',
        '  summary: "Keep the first zero-indent record."',
        '  rationale: "Its bytes are append-only."',
        '- action: record',
        '  date: 2030-01-14',
        '  summary: "Keep the second zero-indent record."',
        '  rationale: "Its bytes are append-only too."',
        '# after zero-indent decisions',
      ], '\n', 'Zero-indent decisions stay exact.\n'),
    },
    {
      name: 'early-extension-with-two-space-decisions',
      newline: '\n',
      oldTitle: 'title: Keep early extension placement',
      newTitle: `title: ${PATCH_TITLE}`,
      decisionMarker: '# after two-space decisions',
      decisionIndent: '  ',
      source: ({ targetId }) => item([
        'schema_version: 1',
        `id: ${targetId}`,
        'operator_early: "stay above title"',
        'title: Keep early extension placement',
        'kind: task',
        'status: triage',
        'created: 2030-01-14',
        'updated: 2030-01-14',
        'provenance:',
        '  source: byte-corpus',
        '  recorded_at: "2030-01-14T12:00:00Z"',
        'depends_on: []',
        'decisions:',
        '  - action: record',
        '    date: 2030-01-14',
        '    summary: "Keep the first two-space record."',
        '    rationale: "Its bytes are append-only."',
        '  - action: record',
        '    date: 2030-01-14',
        '    summary: "Keep the second two-space record."',
        '    rationale: "Its bytes are append-only too."',
        '# after two-space decisions',
      ], '\n', 'Early extension placement stays exact.\n'),
    },
  ];
}

function requestFor(command, id, revision) {
  const decision = DECISIONS[command];
  return command === 'patch'
    ? {
        id,
        expected_revision: revision,
        patch: { title: PATCH_TITLE },
        date: MUTATION_DATE,
        decision: { summary: decision.summary, rationale: decision.rationale },
      }
    : {
        id,
        expected_revision: revision,
        to_status: 'backlog',
        date: MUTATION_DATE,
        decision: { summary: decision.summary, rationale: decision.rationale },
      };
}

function expectedSource(source, shape, command) {
  const newline = shape.newline;
  let expected = source;
  if (command === 'patch') {
    expected = replaceLine(expected, shape.oldTitle, shape.newTitle, newline);
  } else {
    expected = replaceLine(expected, 'status: triage', 'status: backlog', newline);
  }
  expected = replaceLine(expected, 'updated: 2030-01-14', `updated: ${MUTATION_DATE}`, newline);

  const marker = `${shape.decisionMarker}${newline}`;
  const decision = DECISIONS[command];
  const insertion = Object.hasOwn(shape, 'decisionIndent')
    ? decisionItem(decision, shape.decisionIndent, newline)
    : `decisions:${newline}${decisionItem(decision, '  ', newline)}`;
  assert.equal(expected.includes(marker), true, `${shape.name}: missing decision marker`);
  return expected.replace(marker, `${insertion}${marker}`);
}

function decisionItem(decision, indent, newline) {
  const fieldIndent = `${indent}  `;
  return [
    `${indent}- action: ${decision.action}`,
    `${fieldIndent}date: ${decision.date ?? MUTATION_DATE}`,
    `${fieldIndent}summary: "${decision.summary}"`,
    `${fieldIndent}rationale: "${decision.rationale}"`,
    '',
  ].join(newline);
}

function replaceLine(source, oldLine, newLine, newline) {
  const oldBytes = `${oldLine}${newline}`;
  assert.equal(source.split(oldBytes).length, 2, `expected one ${oldLine} line`);
  return source.replace(oldBytes, `${newLine}${newline}`);
}

function item(frontmatterLines, newline, body) {
  return ['---', ...frontmatterLines, '---', ''].join(newline) + body;
}

function supportItem(id, kind) {
  return item([
    'schema_version: 1',
    `id: ${id}`,
    `title: Supporting ${kind}`,
    `kind: ${kind}`,
    'status: backlog',
    'created: 2030-01-14',
    'updated: 2030-01-14',
    'provenance:',
    '  source: byte-corpus',
    '  recorded_at: "2030-01-14T12:00:00Z"',
    'depends_on: []',
  ], '\n', '');
}
