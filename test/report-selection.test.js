import assert from 'node:assert/strict';
import test from 'node:test';
import * as selection from '../src/report-selection.js';

function item(id, overrides = {}) {
  return {
    id, number: 1, title: id, status: 'backlog', kind: 'task', priority: null,
    created: '2026-08-01', terminalDate: null, readiness: { state: 'ready' }, fields: {},
    ...overrides,
  };
}

function state(overrides = {}) {
  return {
    scope: { search: '', facets: {} }, quickView: 'all-open', showHistory: false,
    sortBy: 'recommended', drilldown: null, ...overrides,
  };
}

test('matches any selected tag while requiring the selected lifecycle status', () => {
  const items = [
    item('a', { fields: { tags: ['regression', 'ui'] } }),
    item('b', { status: 'in-progress', fields: { tags: ['regression'] } }),
  ];
  const scope = { search: '', facets: {
    'field:tags': [{ kind: 'value', value: 'regression' }],
    status: [{ kind: 'value', value: 'backlog' }],
  } };
  assert.deepEqual(selection.selectReportItems(items, scope), [items[0]]);
  assert.equal(selection.selectReportItems(items, scope)[0], items[0]);
});

test('distinguishes missing metadata from a literal Unclassified value', () => {
  const items = [
    item('missing'), item('literal', { fields: { tags: ['Unclassified'] } }),
    item('empty', { fields: { tags: [] } }),
  ];
  const scoped = (selected) => selection.selectReportItems(items, {
    search: '', facets: { 'field:tags': selected },
  }).map((entry) => entry.id);
  assert.deepEqual(scoped([{ kind: 'missing' }]), ['missing', 'empty']);
  assert.deepEqual(scoped([{ kind: 'value', value: 'Unclassified' }]), ['literal']);
  assert.deepEqual(scoped([{ kind: 'missing' }, { kind: 'value', value: 'Unclassified' }]),
    ['missing', 'literal', 'empty']);
});

test('searches projected tags without conflating readiness and lifecycle status', () => {
  const items = [
    item('match', { status: 'in-progress', fields: { tags: ['Customer-Visible'] } }),
    item('blocked', { readiness: { state: 'blocked' }, fields: { tags: ['Customer-Visible'] } }),
    item('body-only', { body: 'Customer-Visible' }),
  ];
  const scope = { search: ' CUSTOMER-visible ', facets: {
    readiness: [{ kind: 'value', value: 'ready' }],
  } };
  assert.deepEqual(selection.selectReportItems(items, scope), [items[0]]);
  assert.deepEqual(selection.selectReportItems(items, { ...scope, search: '' }), [items[0], items[2]]);
});

test('matches unordered search tokens while preserving false, zero, and scalar type identity', () => {
  const items = [
    item('numeric', { title: 'Payment failure', priority: 0, fields: { severity: false, area: 0 } }),
    item('string', { title: 'Payment failure', priority: 0, fields: { severity: false, area: '0' } }),
  ];
  const scoped = selection.selectReportItems(items, {
    search: 'FALSE payment 0', facets: {
      priority: [{ kind: 'value', value: 0 }],
      'field:severity': [{ kind: 'value', value: false }],
      'field:area': [{ kind: 'value', value: 0 }],
    },
  });
  assert.deepEqual(scoped, [items[0]]);
});

test('counts each tag once and excludes only the facet being counted', () => {
  const items = [
    item('a', { fields: { tags: ['x', 'x', 'y'] } }),
    item('b', { fields: { tags: ['y'] } }),
    item('c', { status: 'in-progress', fields: { tags: ['x'] } }),
    item('d'),
  ];
  const scope = { search: '', facets: {
    status: [{ kind: 'value', value: 'backlog' }],
    'field:tags': [{ kind: 'value', value: 'x' }],
  } };
  assert.deepEqual(selection.countReportFacets(items, scope, ['field:tags', 'status']), [
    { dimension: 'field:tags', options: [
      { selection: { kind: 'missing' }, count: 1 },
      { selection: { kind: 'value', value: 'x' }, count: 1 },
      { selection: { kind: 'value', value: 'y' }, count: 2 },
    ] },
    { dimension: 'status', options: [
      { selection: { kind: 'value', value: 'backlog' }, count: 1 },
      { selection: { kind: 'value', value: 'in-progress' }, count: 1 },
    ] },
  ]);
});

test('keeps canonical Work next ordering within the shared scope without narrowing analytics', () => {
  const items = [
    item('a'), item('b'), item('not-recommended'),
    item('history', { status: 'done', terminalDate: '2026-08-13' }),
  ];
  const current = state({ quickView: 'work-next' });
  assert.deepEqual(selection.selectListItems(items, current, ['b', 'a']).map((entry) => entry.id),
    ['b', 'a']);
  assert.deepEqual(selection.selectReportItems(items, current.scope), items);
  current.scope.search = 'a';
  assert.deepEqual(selection.selectListItems(items, current, ['b', 'a']).map((entry) => entry.id), ['a']);
});

test('selects quick views by lifecycle or readiness while keeping history separate', () => {
  const items = [
    item('ready'), item('active', { status: 'in-progress' }),
    item('blocked', { readiness: { state: 'blocked' } }),
    item('triage', { status: 'triage', readiness: { state: 'ineligible' } }),
    item('history', { status: 'killed', terminalDate: '2026-08-13' }),
  ];
  const ids = (quickView, showHistory = false) => selection.selectListItems(
    items, state({ quickView, showHistory }), ['ready'],
  ).map((entry) => entry.id);
  assert.deepEqual(ids('in-progress'), ['active']);
  assert.deepEqual(ids('blocked'), ['blocked']);
  assert.deepEqual(ids('triage'), ['triage']);
  assert.deepEqual(ids('all-open'), ['ready', 'active', 'blocked', 'triage']);
  assert.deepEqual(ids('work-next', true), ['ready', 'history']);
});

test('drilldown overrides quick view and hidden history but never the shared scope', () => {
  const items = [
    item('ready', { fields: { area: 'Core' } }),
    item('done', { status: 'done', terminalDate: '2026-08-13', fields: { area: 'Core' } }),
    item('excluded', { status: 'done', terminalDate: '2026-08-13', fields: { area: 'Other' } }),
  ];
  const current = state({ quickView: 'work-next', scope: { search: '', facets: {
    'field:area': [{ kind: 'value', value: 'Core' }],
  } }, drilldown: { label: 'Closures', itemIds: ['done', 'excluded', 'absent'] } });
  assert.deepEqual(selection.selectListItems(items, current, ['ready']), [items[1]]);
  current.drilldown = null;
  assert.deepEqual(selection.selectListItems(items, current, ['ready']), [items[0]]);
});

test('emitted browser selection preserves typed filters, counts, and drilldown behavior', async () => {
  const vm = await import('node:vm');
  const items = [
    item('ready', { priority: 0, fields: { tags: ['x', 'y'], severity: false } }),
    item('history', { status: 'done', terminalDate: '2026-08-13', fields: { tags: ['x'] } }),
    item('missing'),
  ];
  const current = state({ scope: { search: 'x', facets: {
    'field:tags': [{ kind: 'value', value: 'x' }],
  } }, drilldown: { label: 'Completed', itemIds: ['history'] } });
  const context = vm.createContext({ items, current });
  vm.runInContext(selection.reportSelectionBrowserSource(), context);
  const browser = vm.runInContext(`JSON.stringify({
    scoped: selectReportItems(items, current.scope),
    listed: selectListItems(items, current, ['ready']),
    facets: countReportFacets(items, current.scope, ['priority', 'field:severity', 'field:tags'])
  })`, context);
  assert.deepEqual(JSON.parse(browser), {
    scoped: selection.selectReportItems(items, current.scope),
    listed: selection.selectListItems(items, current, ['ready']),
    facets: selection.countReportFacets(items, current.scope, ['priority', 'field:severity', 'field:tags']),
  });
});
