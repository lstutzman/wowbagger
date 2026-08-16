import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { runCli, withLedger } from './support.js';

// Fixture identities. Each created date equals the UTC date encoded by the ID,
// which the ledger contract requires.
const PREREQUISITE = 'wb_01Q4ZK3DG020ANANANANANANAM';
const DEPENDENT = 'wb_01Q525G4G020B6CSK6CSK6CSK5';
const THIRD = 'wb_01Q525G4G020B7CSK7CSK7CSK7';
const CREATED = {
  [PREREQUISITE]: '2030-01-20',
  [DEPENDENT]: '2030-01-21',
  [THIRD]: '2030-01-21',
};

function itemSource(id, {
  schemaVersion = 1, number = null, status = 'backlog', dependsOn = [], related = [],
} = {}) {
  const created = CREATED[id];
  return [
    '---',
    `schema_version: ${schemaVersion}`,
    `id: ${id}`,
    ...(number === null ? [] : [`number: ${number}`]),
    `title: "Item ${id}"`,
    'kind: task',
    `status: ${status}`,
    `created: ${created}`,
    `updated: ${created}`,
    'provenance:',
    '  source: "fixture/patch-relations"',
    `  recorded_at: "${created}T12:00:00Z"`,
    `depends_on: [${dependsOn.join(', ')}]`,
    `related: [${related.join(', ')}]`,
    '---',
    '',
    'Body.',
    '',
  ].join('\n');
}

function inspectRevision(ledger, id) {
  const inspected = runCli('inspect', '--ledger', ledger, '--id', id, '--json');
  assert.equal(inspected.status, 0, inspected.stderr);
  return JSON.parse(inspected.stdout).result.item.revision;
}

async function runPatch(ledger, request) {
  const requestPath = path.join(path.dirname(ledger), 'patch-request.json');
  await writeFile(requestPath, JSON.stringify(request));
  return runCli('patch', '--ledger', ledger, '--input', requestPath, '--json');
}

test('patch replaces the depends_on list', async () => {
  await withLedger({
    [`${PREREQUISITE}.md`]: itemSource(PREREQUISITE),
    [`${DEPENDENT}.md`]: itemSource(DEPENDENT, { dependsOn: [PREREQUISITE] }),
  }, async (ledger) => {
    const revision = inspectRevision(ledger, DEPENDENT);

    const result = await runPatch(ledger, {
      id: DEPENDENT,
      expected_revision: revision,
      date: '2030-01-22',
      set: { depends_on: [] },
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const item = JSON.parse(result.stdout).result.item;
    assert.deepEqual(item.core.depends_on, []);
    assert.equal(item.core.updated, '2030-01-22');
    const source = Buffer.from(item.source_base64, 'base64').toString('utf8');
    assert.ok(source.includes('depends_on: []'), source);
  });
});

test('patch keeps the sequence style an existing relation list was written in', async () => {
  const blockRelated = itemSource(DEPENDENT)
    .replace('related: []', `related:\n  - ${THIRD}`);
  await withLedger({
    [`${PREREQUISITE}.md`]: itemSource(PREREQUISITE),
    [`${THIRD}.md`]: itemSource(THIRD),
    [`${DEPENDENT}.md`]: blockRelated,
  }, async (ledger) => {
    const revision = inspectRevision(ledger, DEPENDENT);

    const result = await runPatch(ledger, {
      id: DEPENDENT,
      expected_revision: revision,
      date: '2030-01-22',
      set: { related: [PREREQUISITE] },
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const item = JSON.parse(result.stdout).result.item;
    assert.deepEqual(item.core.related, [PREREQUISITE]);
    const source = Buffer.from(item.source_base64, 'base64').toString('utf8');
    assert.ok(source.includes(`related:\n  - ${PREREQUISITE}\n`), source);
  });
});

test('patch replaces an existing flow relation list in place', async () => {
  await withLedger({
    [`${PREREQUISITE}.md`]: itemSource(PREREQUISITE),
    [`${DEPENDENT}.md`]: itemSource(DEPENDENT),
  }, async (ledger) => {
    const revision = inspectRevision(ledger, DEPENDENT);

    const result = await runPatch(ledger, {
      id: DEPENDENT,
      expected_revision: revision,
      date: '2030-01-22',
      set: { related: [PREREQUISITE] },
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const item = JSON.parse(result.stdout).result.item;
    assert.deepEqual(item.core.related, [PREREQUISITE]);
    const source = Buffer.from(item.source_base64, 'base64').toString('utf8');
    assert.ok(source.includes(`related: [ ${PREREQUISITE} ]`), source);
  });
});

test('patch refuses a relations value that is not a list', async () => {
  await withLedger({ [`${DEPENDENT}.md`]: itemSource(DEPENDENT) }, async (ledger) => {
    const revision = inspectRevision(ledger, DEPENDENT);

    const result = await runPatch(ledger, {
      id: DEPENDENT,
      expected_revision: revision,
      date: '2030-01-22',
      set: { depends_on: PREREQUISITE },
    });

    assert.equal(result.status, 2, result.stdout);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error.code, 'invalid-request');
    assert.equal(envelope.state, 'unchanged');
    assert.deepEqual(envelope.error.details.issues, [{
      path: '/set/depends_on',
      code: 'invalid-type',
      message: 'Set member depends_on must be an array or null.',
    }]);
    assert.equal(inspectRevision(ledger, DEPENDENT), revision);
  });
});

test('patch refuses a relations entry that is not a canonical item ID', async () => {
  await withLedger({ [`${DEPENDENT}.md`]: itemSource(DEPENDENT) }, async (ledger) => {
    const revision = inspectRevision(ledger, DEPENDENT);

    const result = await runPatch(ledger, {
      id: DEPENDENT,
      expected_revision: revision,
      date: '2030-01-22',
      set: { related: ['not-an-item-id'] },
    });

    assert.equal(result.status, 2, result.stdout);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error.code, 'invalid-request');
    assert.deepEqual(envelope.error.details.issues, [{
      path: '/set/related/0',
      code: 'invalid-value',
      message: 'Set member related entries must be canonical Wowbagger item IDs.',
    }]);
    assert.equal(inspectRevision(ledger, DEPENDENT), revision);
  });
});

test('patch with null removes the optional related field', async () => {
  await withLedger({
    [`${PREREQUISITE}.md`]: itemSource(PREREQUISITE),
    [`${DEPENDENT}.md`]: itemSource(DEPENDENT, { related: [PREREQUISITE] }),
  }, async (ledger) => {
    const revision = inspectRevision(ledger, DEPENDENT);

    const result = await runPatch(ledger, {
      id: DEPENDENT,
      expected_revision: revision,
      date: '2030-01-22',
      set: { related: null },
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const item = JSON.parse(result.stdout).result.item;
    assert.deepEqual(item.core.related, []);
    const source = Buffer.from(item.source_base64, 'base64').toString('utf8');
    assert.ok(!source.includes('related:'), source);
  });
});

test('patch refuses null on the required depends_on field as candidate-invalid', async () => {
  await withLedger({ [`${DEPENDENT}.md`]: itemSource(DEPENDENT) }, async (ledger) => {
    const revision = inspectRevision(ledger, DEPENDENT);

    const result = await runPatch(ledger, {
      id: DEPENDENT,
      expected_revision: revision,
      date: '2030-01-22',
      set: { depends_on: null },
    });

    assert.equal(result.status, 2, result.stdout);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error.code, 'candidate-invalid');
    assert.equal(envelope.state, 'unchanged');
    const codes = envelope.error.details.validation_errors.map((entry) => entry.code);
    assert.ok(codes.includes('missing-required-field'), result.stdout);
    assert.equal(inspectRevision(ledger, DEPENDENT), revision);
  });
});

test('patch refuses a dangling depends_on reference as candidate-invalid', async () => {
  await withLedger({ [`${DEPENDENT}.md`]: itemSource(DEPENDENT) }, async (ledger) => {
    const revision = inspectRevision(ledger, DEPENDENT);

    const result = await runPatch(ledger, {
      id: DEPENDENT,
      expected_revision: revision,
      date: '2030-01-22',
      set: { depends_on: [THIRD] },
    });

    assert.equal(result.status, 2, result.stdout);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error.code, 'candidate-invalid');
    assert.equal(envelope.state, 'unchanged');
    const codes = envelope.error.details.validation_errors.map((entry) => entry.code);
    assert.deepEqual(codes, ['unresolved-dependency']);
    assert.equal(inspectRevision(ledger, DEPENDENT), revision);
  });
});

test('patch refuses a depends_on edit that creates a cycle as candidate-invalid', async () => {
  await withLedger({
    [`${PREREQUISITE}.md`]: itemSource(PREREQUISITE, { dependsOn: [DEPENDENT] }),
    [`${DEPENDENT}.md`]: itemSource(DEPENDENT),
  }, async (ledger) => {
    const revision = inspectRevision(ledger, DEPENDENT);

    const result = await runPatch(ledger, {
      id: DEPENDENT,
      expected_revision: revision,
      date: '2030-01-22',
      set: { depends_on: [PREREQUISITE] },
    });

    assert.equal(result.status, 2, result.stdout);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error.code, 'candidate-invalid');
    assert.equal(envelope.state, 'unchanged');
    const codes = envelope.error.details.validation_errors.map((entry) => entry.code);
    assert.ok(codes.includes('dependency-cycle'), result.stdout);
    assert.equal(inspectRevision(ledger, DEPENDENT), revision);
  });
});

function doneSchemaTwoSource(id, number) {
  const created = CREATED[id];
  return [
    '---',
    'schema_version: 2',
    `id: ${id}`,
    `number: ${number}`,
    `title: "Item ${id}"`,
    'kind: task',
    'status: done',
    `created: ${created}`,
    `updated: ${created}`,
    `completed: ${created}`,
    'provenance:',
    '  source: "fixture/patch-relations"',
    `  recorded_at: "${created}T12:00:00Z"`,
    'depends_on: []',
    'related: []',
    'decisions:',
    '  - action: complete',
    `    date: ${created}`,
    '    summary: "Completed."',
    '    rationale: "The fictional work finished."',
    '---',
    '',
    'Body.',
    '',
  ].join('\n');
}

test('patch refuses a depends_on edit that breaks the schema-2 done-dependency rule', async () => {
  await withLedger({
    [`${THIRD}.md`]: doneSchemaTwoSource(THIRD, 3),
    [`${DEPENDENT}.md`]: itemSource(DEPENDENT, { schemaVersion: 2, number: 2 }),
  }, async (ledger) => {
    const revision = inspectRevision(ledger, THIRD);

    const result = await runPatch(ledger, {
      id: THIRD,
      expected_revision: revision,
      date: CREATED[THIRD],
      set: { depends_on: [DEPENDENT] },
    });

    assert.equal(result.status, 2, result.stdout);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error.code, 'candidate-invalid');
    assert.equal(envelope.state, 'unchanged');
    const codes = envelope.error.details.validation_errors.map((entry) => entry.code);
    assert.deepEqual(codes, ['done-item-has-dependencies']);
    assert.equal(inspectRevision(ledger, THIRD), revision);
  });
});

async function runTransition(ledger, request) {
  const requestPath = path.join(path.dirname(ledger), 'transition-request.json');
  await writeFile(requestPath, JSON.stringify(request));
  return runCli('transition', '--ledger', ledger, '--input', requestPath, '--json');
}

test('the dependent-disposition kill completes in band after patch re-scopes the dependent', async () => {
  await withLedger({
    [`${PREREQUISITE}.md`]: itemSource(PREREQUISITE),
    [`${DEPENDENT}.md`]: itemSource(DEPENDENT, { dependsOn: [PREREQUISITE] }),
  }, async (ledger) => {
    const kill = (revision) => runTransition(ledger, {
      id: PREREQUISITE,
      expected_revision: revision,
      to_status: 'killed',
      date: '2030-01-22',
      decision: {
        summary: 'Kill the fictional prerequisite.',
        rationale: 'The fictional prerequisite is no longer needed.',
      },
    });

    const blocked = await kill(inspectRevision(ledger, PREREQUISITE));
    assert.equal(blocked.status, 5, blocked.stdout);
    const blockers = JSON.parse(blocked.stdout).error.details.blockers;
    assert.deepEqual(blockers, [{
      code: 'dependent-disposition',
      item_id: DEPENDENT,
      field: 'depends_on',
    }]);

    const rescoped = await runPatch(ledger, {
      id: DEPENDENT,
      expected_revision: inspectRevision(ledger, DEPENDENT),
      date: '2030-01-22',
      set: { depends_on: [], related: [PREREQUISITE] },
    });
    assert.equal(rescoped.status, 0, `${rescoped.stdout}\n${rescoped.stderr}`);
    const rescopedItem = JSON.parse(rescoped.stdout).result.item;
    assert.deepEqual(rescopedItem.core.depends_on, []);
    assert.deepEqual(rescopedItem.core.related, [PREREQUISITE]);

    const killed = await kill(inspectRevision(ledger, PREREQUISITE));
    assert.equal(killed.status, 0, `${killed.stdout}\n${killed.stderr}`);
    assert.equal(JSON.parse(killed.stdout).result.item.core.status, 'killed');

    const validated = runCli('validate', '--ledger', ledger, '--json');
    assert.equal(validated.status, 0, validated.stdout);
    assert.equal(JSON.parse(validated.stdout).valid, true);
  });
});

test('patch inserts an absent related list directly after depends_on', async () => {
  const withoutRelated = itemSource(DEPENDENT).replace('related: []\n', '');
  await withLedger({
    [`${PREREQUISITE}.md`]: itemSource(PREREQUISITE),
    [`${DEPENDENT}.md`]: withoutRelated,
  }, async (ledger) => {
    const revision = inspectRevision(ledger, DEPENDENT);

    const result = await runPatch(ledger, {
      id: DEPENDENT,
      expected_revision: revision,
      date: '2030-01-22',
      set: { related: [PREREQUISITE] },
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const lines = Buffer.from(JSON.parse(result.stdout).result.item.source_base64, 'base64')
      .toString('utf8').split('\n');
    assert.equal(lines[lines.indexOf('depends_on: []') + 1], `related: [ ${PREREQUISITE} ]`);
  });
});

test('patch replaces a relation list written as an alias', async () => {
  const aliased = itemSource(DEPENDENT)
    .replace('related: []', 'related: *shared')
    .replace('depends_on: []', 'depends_on: []\nshared_relations: &shared []');
  await withLedger({
    [`${PREREQUISITE}.md`]: itemSource(PREREQUISITE),
    [`${DEPENDENT}.md`]: aliased,
  }, async (ledger) => {
    const revision = inspectRevision(ledger, DEPENDENT);

    const result = await runPatch(ledger, {
      id: DEPENDENT,
      expected_revision: revision,
      date: '2030-01-22',
      set: { related: [PREREQUISITE] },
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const item = JSON.parse(result.stdout).result.item;
    assert.deepEqual(item.core.related, [PREREQUISITE]);
    const source = Buffer.from(item.source_base64, 'base64').toString('utf8');
    assert.ok(source.includes(`related: [ ${PREREQUISITE} ]`), source);
    assert.ok(source.includes('shared_relations: &shared []'), source);
  });
});
