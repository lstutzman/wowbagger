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
          assert.deepEqual(
            changedLines(source, rewritten),
            changedLines(source, expected),
            `${shape.name}: bytes changed outside the mutation ranges`,
          );
          assert.equal(rewritten, expected, `${shape.name}: unexpected output bytes`);
        });
      });
    }
  }
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
        '# CRLF final frontmatter comment',
      ], '\r\n', '\r\nCRLF body stays exact.\r\n'),
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
  const insertion = shape.decisionIndent
    ? decisionItem(decision, shape.decisionIndent, newline)
    : `decisions:${newline}${decisionItem(decision, '  ', newline)}`;
  assert.equal(expected.includes(marker), true, `${shape.name}: missing decision marker`);
  return expected.replace(marker, `${insertion}${marker}`);
}

function decisionItem(decision, indent, newline) {
  const fieldIndent = `${indent}  `;
  return [
    `${indent}- action: ${decision.action}`,
    `${fieldIndent}date: ${MUTATION_DATE}`,
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

function changedLines(before, after) {
  const left = linesWithTerminators(before);
  const right = linesWithTerminators(after);
  const lengths = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1));
  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      lengths[leftIndex][rightIndex] = left[leftIndex] === right[rightIndex]
        ? lengths[leftIndex + 1][rightIndex + 1] + 1
        : Math.max(lengths[leftIndex + 1][rightIndex], lengths[leftIndex][rightIndex + 1]);
    }
  }

  const changes = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length || rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
    } else if (rightIndex === right.length
      || (leftIndex < left.length && lengths[leftIndex + 1][rightIndex] >= lengths[leftIndex][rightIndex + 1])) {
      changes.push({ operation: 'delete', bytes: left[leftIndex] });
      leftIndex += 1;
    } else {
      changes.push({ operation: 'insert', bytes: right[rightIndex] });
      rightIndex += 1;
    }
  }
  return changes;
}

function linesWithTerminators(source) {
  return source.match(/[^\r\n]*(?:\r\n|\n)|[^\r\n]+$/g) ?? [];
}
