import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import Ajv2020Module from 'ajv/dist/2020.js';

import { runCli, withLedger } from './support.js';
import {
  DEFAULT_LIST_PAGE_SIZE,
  MAX_ITEM_SOURCE_BYTES,
  MAX_LIST_PAGE_SIZE,
  MAX_LIST_RESPONSE_BYTES,
  MAX_LIST_TITLE_CHARACTERS,
  MAX_WORKBENCH_COLLECTION_ENTRIES,
  MAX_WORKBENCH_RESPONSE_BYTES,
  MAX_WORKBENCH_TITLE_CHARACTERS,
} from '../src/limits.js';
import { LIFECYCLE_STATUSES } from '../src/lifecycle.js';
import { DECISION_ACTIONS } from '../src/validate.js';

const Ajv2020 = Ajv2020Module.default ?? Ajv2020Module;

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const schemaDirectory = path.join(projectRoot, 'schemas');
const manifest = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));

function readJson(...segments) {
  return JSON.parse(readFileSync(path.join(projectRoot, ...segments), 'utf8'));
}

const index = readJson('schemas', 'index.json');
const schemaFiles = readdirSync(schemaDirectory)
  .filter((entry) => entry.endsWith('.json') && entry !== 'index.json')
  .sort();
const schemas = new Map(schemaFiles.map((file) => [file, readJson('schemas', file)]));

// One registry serves every assertion: a schema that cannot be added beside its
// siblings is a broken $id or a broken $ref, and that is a failure of the
// published set rather than of one file.
function registry() {
  const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
  for (const schema of schemas.values()) ajv.addSchema(schema);
  return ajv;
}

const ajv = registry();

function validatorFor(file) {
  const validate = ajv.getSchema(schemas.get(file).$id);
  assert.ok(validate, `${file} must be resolvable by its $id`);
  return validate;
}

function accepts(file, instance, label) {
  const validate = validatorFor(file);
  assert.ok(validate(instance), `${file} must accept ${label}: ${ajv.errorsText(validate.errors)}`);
}

function rejects(file, instance, label) {
  const validate = validatorFor(file);
  assert.equal(validate(instance), false, `${file} must reject ${label}`);
}

function fixture(...segments) {
  return readJson('spec', 'fixtures', ...segments);
}

// Every core-domain fixture the mutation vectors already pin. The envelope
// schema answers for all of them; the per-command schemas answer for their own.
const coreFixtures = [
  'candidate-invalid-create/expected.json',
  'candidate-invalid-transition/expected.json',
  'capabilities/expected.json',
  'child-disposition/expected.json',
  'combined-blockers/expected.json',
  'date-rollback/expected.json',
  'dependent-disposition/expected.json',
  'epic-complete/expected.json',
  'inspect/expected.json',
  'inspect/expected-not-found.json',
  'inspect-invalid-ledger/expected.json',
  'inspect-number-not-found/expected.json',
  'list-empty/expected.json',
  'list-invalid-ledger/expected.json',
  'list-page/expected.json',
  'list-response-too-large/expected.json',
  'list-stale-cursor/expected.json',
  'lock-held/expected.json',
  'multi-item-required/expected.json',
  'operation-failed/expected.json',
  'patch-body/expected.json',
  'patch-relations/expected.json',
  'patch-title/expected.json',
  'restore/expected.json',
  'stale-revision-conflict/expected.json',
  'task-terminal/expected.json',
  'transition-success/expected.json',
  'workbench-epic-blocked/expected.json',
  'workbench-invalid-ledger/expected.json',
  'workbench-task-options/expected.json',
  'workbench-terminal/expected.json',
].map((relative) => [relative, fixture('mutations', ...relative.split('/'))]);

// The fence refusals are nested inside work-claim transcripts, so they are
// lifted by their namespace rather than named file by file.
function ledgerMutationRefusals() {
  const found = [];
  const walk = (node) => {
    if (Array.isArray(node)) {
      for (const entry of node) walk(entry);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    if (node.namespace === 'ledger-mutation') found.push(node);
    for (const value of Object.values(node)) walk(value);
  };
  for (const relative of [
    ['work-claims', 'legacy-write-refusals', 'manifest.json'],
    ['mutation-refusals', 'uncommitted-prior-mutation', 'manifest.json'],
  ]) walk(fixture(...relative));
  return found;
}

test('every published schema is a standards-valid 2020-12 schema', () => {
  assert.ok(schemaFiles.length > 0, 'the package must publish schemas');
  const metaValidate = ajv.getSchema('https://json-schema.org/draft/2020-12/schema');
  for (const [file, schema] of schemas) {
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema', file);
    assert.ok(typeof schema.$id === 'string' && schema.$id.length > 0, `${file} needs an $id`);
    assert.ok(metaValidate(schema), `${file} is not a valid 2020-12 schema: ${ajv.errorsText(metaValidate.errors)}`);
  }
});

test('the schema index names every shipped schema with its domain and version', () => {
  assert.equal(index.schema_index_version, 1);
  assert.deepEqual(
    index.schemas.map((entry) => entry.file).sort(),
    schemaFiles,
    'the index and the directory must name the same schemas',
  );
  for (const entry of index.schemas) {
    assert.deepEqual(
      Object.keys(entry).sort(),
      ['domain', 'file', 'summary', 'version'],
      `${entry.file} index entry members`,
    );
    assert.equal(entry.$id ?? schemas.get(entry.file).$id, schemas.get(entry.file).$id);
    assert.ok(entry.summary.length > 0, `${entry.file} needs a summary`);
  }
  const byDomain = new Map(index.schemas.map((entry) => [entry.file, entry]));
  assert.equal(byDomain.get('core-envelope.json').domain, 'core');
  assert.equal(byDomain.get('core-envelope.json').version, 5);
  assert.equal(byDomain.get('bare-ready-result.json').domain, 'bare-result');
  assert.equal(byDomain.get('bare-ready-result.json').version, null);
  assert.equal(byDomain.get('ledger-mutation-refusal.json').domain, 'ledger-mutation');
  assert.equal(byDomain.get('ledger-mutation-refusal.json').version, 1);
  assert.equal(byDomain.get('core-list-query.json').domain, 'core-list-query');
  assert.equal(byDomain.get('core-list-query.json').version, 1);
});

test('the package ships and exports the schemas', () => {
  assert.ok(manifest.files.includes('schemas'), 'schemas must ship');
  assert.equal(manifest.exports['./schemas/*.json'], './schemas/*.json');
  assert.equal(manifest.devDependencies?.ajv?.startsWith('^8'), true, 'the validator is test-only');
  assert.equal(manifest.dependencies.ajv, undefined, 'the validator must not be a runtime dependency');
});

test('the core envelope schema accepts every normative core fixture', () => {
  for (const [relative, instance] of coreFixtures) {
    accepts('core-envelope.json', instance, relative);
  }
});

test('the per-command schemas accept their own normative fixtures', () => {
  accepts('core-capabilities-response.json', fixture('mutations', 'capabilities', 'expected.json'), 'capabilities');
  accepts('core-inspect-response.json', fixture('mutations', 'inspect', 'expected.json'), 'inspect');
  for (const directory of ['workbench-task-options', 'workbench-epic-blocked', 'workbench-terminal']) {
    accepts('core-inspect-workbench-response.json', fixture('mutations', directory, 'expected.json'), directory);
  }
  for (const directory of ['list-page', 'list-empty']) {
    accepts('core-list-response.json', fixture('mutations', directory, 'expected.json'), directory);
  }
  for (const directory of ['list-invalid-ledger', 'list-response-too-large', 'list-stale-cursor']) {
    accepts('core-list-error-response.json', fixture('mutations', directory, 'expected.json'), directory);
  }
  accepts('core-list-query.json', fixture('mutations', 'list-page', 'query.json'), 'list query');
  for (const directory of ['transition-success', 'epic-complete', 'restore', 'task-terminal']) {
    accepts('core-transition-response.json', fixture('mutations', directory, 'expected.json'), directory);
    accepts('core-transition-request.json', fixture('mutations', directory, 'request.json'), `${directory} request`);
  }
  for (const directory of [
    'candidate-invalid-transition',
    'child-disposition',
    'combined-blockers',
    'date-rollback',
    'dependent-disposition',
    'lock-held',
    'multi-item-required',
    'operation-failed',
    'stale-revision-conflict',
  ]) {
    accepts('core-transition-error-response.json', fixture('mutations', directory, 'expected.json'), directory);
  }
  accepts('bare-validation-result.json', fixture('validation-errors', 'expected-errors.json'), 'validate');
  accepts('bare-ready-result.json', fixture('ready-selection', 'expected-ready.json'), 'ready');

  const refusals = ledgerMutationRefusals();
  assert.ok(refusals.length >= 3, 'the fence refusals must be pinned by fixtures');
  for (const refusal of refusals) {
    accepts('ledger-mutation-refusal.json', refusal, `${refusal.command} ${refusal.error.code}`);
  }
});

test('the capabilities schema pins the limits the runtime advertises', () => {
  const limits = schemas.get('core-capabilities-response.json')
    .properties.result.properties.limits.properties;
  assert.equal(limits.max_item_source_bytes.const, MAX_ITEM_SOURCE_BYTES);
  assert.equal(limits.default_list_page_size.const, DEFAULT_LIST_PAGE_SIZE);
  assert.equal(limits.max_list_page_size.const, MAX_LIST_PAGE_SIZE);
  assert.equal(limits.max_list_title_characters.const, MAX_LIST_TITLE_CHARACTERS);
  assert.equal(limits.max_list_response_bytes.const, MAX_LIST_RESPONSE_BYTES);
  assert.equal(limits.max_workbench_title_characters.const, MAX_WORKBENCH_TITLE_CHARACTERS);
  assert.equal(limits.max_workbench_collection_entries.const, MAX_WORKBENCH_COLLECTION_ENTRIES);
  assert.equal(limits.max_workbench_response_bytes.const, MAX_WORKBENCH_RESPONSE_BYTES);
});

// A published schema that names a status or decision action the validator does
// not accept is worse than no schema: it tells a consumer to send bytes the
// core will refuse. The vocabularies are read from the runtime, never retyped.
test('the shared schema pins the vocabularies the validator enforces', () => {
  const definitions = schemas.get('common.json').$defs;
  assert.deepEqual([...definitions.status.enum].sort(), [...LIFECYCLE_STATUSES].sort());
  assert.deepEqual(
    [...definitions.decision.properties.action.enum].sort(),
    [...DECISION_ACTIONS].sort(),
  );
});

test('a schema rejects an extra root member on an instance it otherwise accepts', () => {
  const cases = [
    ['core-envelope.json', fixture('mutations', 'capabilities', 'expected.json')],
    ['core-capabilities-response.json', fixture('mutations', 'capabilities', 'expected.json')],
    ['core-inspect-response.json', fixture('mutations', 'inspect', 'expected.json')],
    ['core-inspect-workbench-response.json', fixture('mutations', 'workbench-task-options', 'expected.json')],
    ['core-list-response.json', fixture('mutations', 'list-page', 'expected.json')],
    ['core-list-error-response.json', fixture('mutations', 'list-stale-cursor', 'expected.json')],
    ['core-list-query.json', fixture('mutations', 'list-page', 'query.json')],
    ['core-transition-request.json', fixture('mutations', 'transition-success', 'request.json')],
    ['core-transition-response.json', fixture('mutations', 'transition-success', 'expected.json')],
    ['core-transition-error-response.json', fixture('mutations', 'lock-held', 'expected.json')],
    ['bare-validation-result.json', fixture('validation-errors', 'expected-errors.json')],
    ['bare-ready-result.json', fixture('ready-selection', 'expected-ready.json')],
    ['ledger-mutation-refusal.json', ledgerMutationRefusals()[0]],
  ];
  for (const [file, instance] of cases) {
    accepts(file, instance, 'its own fixture');
    rejects(file, { ...instance, operation_id: 'op-1' }, 'an extra root member');
  }
});

test('a core schema rejects a response from another domain', () => {
  const capabilities = fixture('mutations', 'capabilities', 'expected.json');
  const readyResult = fixture('ready-selection', 'expected-ready.json');
  const validateResult = fixture('validation-errors', 'expected-errors.json');
  const fence = ledgerMutationRefusals()[0];
  const adapterResult = fixture('adapters', '03-ready-forwarding', 'expected-adapter-result.json');

  rejects('core-envelope.json', fence, 'a namespaced ledger-mutation refusal');
  rejects('core-envelope.json', readyResult, 'a bare ready result');
  rejects('core-envelope.json', validateResult, 'a bare validation result');
  rejects('core-envelope.json', adapterResult, 'an adapter envelope');
  rejects('ledger-mutation-refusal.json', capabilities, 'a core envelope');
  rejects('ledger-mutation-refusal.json', {
    ...fence,
    namespace: 'work-claim',
  }, 'a work-claim namespace');
  rejects('bare-ready-result.json', validateResult, 'a validation result');
  rejects('bare-validation-result.json', readyResult, 'a ready result');
  rejects('core-list-response.json', fixture('mutations', 'list-stale-cursor', 'expected.json'), 'a list refusal');
  rejects('core-list-error-response.json', fixture('mutations', 'list-page', 'expected.json'), 'a list success');
  rejects(
    'core-inspect-response.json',
    fixture('mutations', 'workbench-task-options', 'expected.json'),
    'a workbench projection',
  );
  rejects(
    'core-inspect-workbench-response.json',
    fixture('mutations', 'inspect', 'expected.json'),
    'a lossless inspect read',
  );
  rejects('core-capabilities-response.json', fixture('mutations', 'list-page', 'expected.json'), 'a list response');
  rejects('core-transition-request.json', fixture('mutations', 'list-page', 'query.json'), 'a list query');
  rejects('core-list-query.json', fixture('mutations', 'transition-success', 'request.json'), 'a transition request');
});

test('a core schema rejects a neighbouring contract version', () => {
  for (const [file, relative] of [
    ['core-envelope.json', ['mutations', 'capabilities', 'expected.json']],
    ['core-capabilities-response.json', ['mutations', 'capabilities', 'expected.json']],
    ['core-list-response.json', ['mutations', 'list-page', 'expected.json']],
    ['core-inspect-workbench-response.json', ['mutations', 'workbench-task-options', 'expected.json']],
    ['core-transition-response.json', ['mutations', 'transition-success', 'expected.json']],
  ]) {
    rejects(file, { ...fixture(...relative), contract_version: 4 }, 'contract version 4');
  }
  rejects('core-list-query.json', {
    ...fixture('mutations', 'list-page', 'query.json'),
    query_version: 2,
  }, 'query version 2');
  rejects('ledger-mutation-refusal.json', {
    ...ledgerMutationRefusals()[0],
    contract_version: 5,
  }, 'the core contract version');
});

// The core view always emits both relation lists — `depends_on` is required of
// every valid ledger item and `related` is defaulted to an empty array — so a
// schema that treats them as optional invites a consumer to code a branch the
// runtime never produces.
test('the item core schema requires the relation lists the core view always emits', () => {
  const inspect = fixture('mutations', 'inspect', 'expected.json');
  accepts('core-inspect-response.json', inspect, 'the lossless inspect fixture');
  for (const field of ['depends_on', 'related']) {
    const stripped = structuredClone(inspect);
    delete stripped.result.item.core[field];
    rejects('core-inspect-response.json', stripped, `an item core with no ${field}`);
  }
});

// `operation-failed` is raised before a commit is established, so its state is
// always `unchanged`. Admitting `unknown` there would let the schema bless a
// response that claims an indeterminate write under the one error code that
// proves no write was attempted.
test('the transition error schema pins operation-failed to the unchanged state', () => {
  const failure = fixture('mutations', 'operation-failed', 'expected.json');
  assert.equal(failure.error.code, 'operation-failed');
  assert.equal(failure.state, 'unchanged');
  accepts('core-transition-error-response.json', failure, 'the operation-failed fixture');
  rejects(
    'core-transition-error-response.json',
    { ...failure, state: 'unknown' },
    'operation-failed with an unknown mutation state',
  );
});

test('the report configuration schemas separate version 1 from version 2', () => {
  const version1 = readJson('ledger', '.wowbagger', 'report.json');
  accepts('report-config-v1.json', version1, 'the shipped repository configuration');
  rejects('report-config-v2.json', version1, 'a version 1 configuration');

  const version2 = {
    report_version: 2,
    repository: { name: 'Example repository' },
    title: 'Ledger report',
    output: '../../report.html',
    fields: { class: '/class' },
    views: {
      'security-blockers': {
        title: 'Security bugs',
        output: '../../reports/security-blockers.html',
        filters: { kind: ['task'], fields: { class: ['bug'] } },
      },
    },
  };
  accepts('report-config-v2.json', version2, 'a named-view configuration');
  rejects('report-config-v1.json', version2, 'a version 2 configuration');
  rejects('report-config-v2.json', { ...version2, views: {} }, 'an empty view set');
  rejects('report-config-v2.json', {
    ...version2,
    views: { 'Security': version2.views['security-blockers'] },
  }, 'a view name outside the published pattern');
});

const workbenchItemId = 'wb_01Q45X474NAAAAAAAAAAAAAAAA';
const secondItemId = 'wb_01Q45X474NBBBBBBBBBBBBBBBB';

function itemSource(id, title, extraLines = []) {
  return [
    '---',
    'schema_version: 1',
    `id: ${id}`,
    `title: "${title}"`,
    'kind: task',
    'status: backlog',
    'created: 2030-01-10',
    'updated: 2030-01-10',
    'provenance:',
    '  source: "fixture/schemas"',
    '  recorded_at: "2030-01-10T12:34:56.789Z"',
    'depends_on: []',
    'related: []',
    ...extraLines,
    '---',
    '',
    '# Body',
  ].join('\n');
}

const liveLedger = {
  [`${workbenchItemId}.md`]: itemSource(workbenchItemId, 'Schema live item', ['class: bug']),
  [`${secondItemId}.md`]: itemSource(secondItemId, 'Schema second item', ['class: chore']),
};

test('live core responses validate against their published schemas', async () => {
  const capabilities = runCli('capabilities', '--json');
  assert.equal(capabilities.status, 0, capabilities.stderr);
  accepts('core-capabilities-response.json', JSON.parse(capabilities.stdout), 'a live capabilities response');
  accepts('core-envelope.json', JSON.parse(capabilities.stdout), 'a live capabilities response');

  await withLedger(liveLedger, async (ledger) => {
    const validate = runCli('validate', '--ledger', ledger, '--json');
    assert.equal(validate.status, 0, validate.stderr);
    accepts('bare-validation-result.json', JSON.parse(validate.stdout), 'a live validation result');

    const ready = runCli('ready', '--ledger', ledger, '--as-of', '2030-01-15', '--json');
    assert.equal(ready.status, 0, ready.stderr);
    accepts('bare-ready-result.json', JSON.parse(ready.stdout), 'a live ready result');

    // An invalid ledger does not produce the ready shape at all: `ready` falls
    // back to the validation result, which is why the two bare schemas are
    // separate files rather than one union.
    const broken = runCli('ready', '--ledger', path.join(ledger, 'missing'), '--as-of', '2030-01-15', '--json');
    assert.equal(broken.status, 1);
    const brokenResult = JSON.parse(broken.stdout);
    accepts('bare-validation-result.json', brokenResult, 'a live ready refusal');
    rejects('bare-ready-result.json', brokenResult, 'a live ready refusal');

    const query = path.join(ledger, '..', 'query.json');
    const queryBody = {
      query_version: 1,
      as_of: '2030-01-15',
      sort: { field: 'id', direction: 'ascending' },
      page_size: 1,
    };
    writeFileSync(query, `${JSON.stringify(queryBody)}\n`);
    accepts('core-list-query.json', queryBody, 'the query it sends');

    const list = runCli('list', '--ledger', ledger, '--input', query, '--json');
    assert.equal(list.status, 0, list.stderr);
    const listResponse = JSON.parse(list.stdout);
    accepts('core-list-response.json', listResponse, 'a live list page');
    accepts('core-envelope.json', listResponse, 'a live list page');
    assert.equal(listResponse.result.page.has_more, true);

    const inspect = runCli('inspect', '--ledger', ledger, '--id', workbenchItemId, '--json');
    assert.equal(inspect.status, 0, inspect.stderr);
    accepts('core-inspect-response.json', JSON.parse(inspect.stdout), 'a live lossless read');

    const workbench = runCli(
      'inspect', '--ledger', ledger, '--id', workbenchItemId, '--workbench', '--as-of', '2030-01-15', '--json',
    );
    assert.equal(workbench.status, 0, workbench.stderr);
    accepts('core-inspect-workbench-response.json', JSON.parse(workbench.stdout), 'a live workbench projection');

    const missing = runCli('inspect', '--ledger', ledger, '--id', 'wb_01Q45X474NZZZZZZZZZZZZZZZZ', '--json');
    assert.equal(missing.status, 2);
    accepts('core-envelope.json', JSON.parse(missing.stdout), 'a live item-not-found refusal');
  });
});

test('live report responses validate against their published schemas', async () => {
  await withLedger({
    ...liveLedger,
    '.wowbagger/report.json': `${JSON.stringify({
      report_version: 2,
      repository: { name: 'Example repository' },
      title: 'Ledger report',
      output: '../../report.html',
      fields: { class: '/class' },
      views: {
        'security-blockers': {
          title: 'Security bugs',
          output: '../../reports/security-blockers.html',
          filters: { kind: ['task'], fields: { class: ['bug'] } },
        },
      },
    })}\n`,
  }, async (ledger) => {
    accepts(
      'report-config-v2.json',
      readJson(path.relative(projectRoot, path.join(ledger, '.wowbagger', 'report.json'))),
      'the configuration it runs',
    );

    const base = runCli('report', '--ledger', ledger, '--as-of', '2030-01-15', '--json');
    assert.equal(base.status, 0, base.stderr);
    const baseResponse = JSON.parse(base.stdout);
    accepts('core-report-response.json', baseResponse, 'a base report response');
    assert.equal(baseResponse.result.view, undefined, 'a base report names no view');

    const named = runCli(
      'report', '--ledger', ledger, '--view', 'security-blockers', '--as-of', '2030-01-15', '--json',
    );
    assert.equal(named.status, 0, named.stderr);
    const namedResponse = JSON.parse(named.stdout);
    accepts('core-report-response.json', namedResponse, 'a named-view report response');
    assert.equal(namedResponse.result.view, 'security-blockers');

    const unknown = runCli(
      'report', '--ledger', ledger, '--view', 'performance', '--as-of', '2030-01-15', '--json',
    );
    assert.equal(unknown.status, 2);
    const unknownResponse = JSON.parse(unknown.stdout);
    accepts('core-report-response.json', unknownResponse, 'a view-not-found refusal');
    accepts('core-envelope.json', unknownResponse, 'a view-not-found refusal');
  });
});
