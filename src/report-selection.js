import { reportFieldValues } from './report-view.js';

const SEARCH_INDEX = new WeakMap();
const FACET_INDEX = new WeakMap();

function searchableText(item) {
  if (!SEARCH_INDEX.has(item)) {
    SEARCH_INDEX.set(item, [
      item.number, item.id, item.title,
      ...Object.values(item.fields).flatMap(reportFieldValues),
    ].filter((value) => value !== null && value !== undefined).join(' ').toLowerCase());
  }
  return SEARCH_INDEX.get(item);
}

function dimensionValues(item, dimension) {
  if (!FACET_INDEX.has(item)) FACET_INDEX.set(item, new Map());
  const index = FACET_INDEX.get(item);
  if (!index.has(dimension)) {
    const value = dimension === 'readiness' ? item.readiness.state
      : dimension.startsWith('field:') ? item.fields[dimension.slice(6)] : item[dimension];
    index.set(dimension, reportFieldValues(value));
  }
  return index.get(dimension);
}

export function selectReportItems(items, scope) {
  const tokens = scope.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const facets = Object.entries(scope.facets);
  return items.filter((item) => tokens.every((token) => searchableText(item).includes(token))
    && facets.every(([dimension, selected]) => {
      const values = dimensionValues(item, dimension);
      return selected.length === 0 || selected.some((entry) => entry.kind === 'missing'
        ? values.length === 0 : values.includes(entry.value));
    }));
}

export function countReportFacets(items, scope, dimensions) {
  return dimensions.map((dimension) => {
    const facets = { ...scope.facets };
    delete facets[dimension];
    const options = new Map();
    for (const item of selectReportItems(items, { search: scope.search, facets })) {
      const values = dimensionValues(item, dimension);
      const selections = values.length === 0 ? [{ kind: 'missing' }]
        : [...new Set(values)].map((value) => ({ kind: 'value', value }));
      for (const selection of selections) {
        const key = JSON.stringify(selection);
        const option = options.get(key);
        if (option) option.count += 1;
        else options.set(key, { selection, count: 1 });
      }
    }
    return { dimension, options: [...options.entries()]
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([, option]) => option) };
  });
}

const TERMINAL_STATUSES = new Set(['done', 'killed', 'archived', 'deferred']);

export function selectListItems(items, state, workNextIds) {
  const scoped = selectReportItems(items, state.scope);
  if (state.drilldown !== null) {
    const ids = new Set(state.drilldown.itemIds);
    return scoped.filter((item) => ids.has(item.id));
  }
  const open = scoped.filter((item) => !TERMINAL_STATUSES.has(item.status));
  let selected;
  if (state.quickView === 'work-next') {
    const byId = new Map(open.map((item) => [item.id, item]));
    selected = workNextIds.filter((id) => byId.has(id)).map((id) => byId.get(id));
  } else {
    selected = open.filter((item) => {
      switch (state.quickView) {
        case 'in-progress': return item.status === 'in-progress';
        case 'blocked': return item.readiness.state === 'blocked';
        case 'triage': return item.status === 'triage';
        case 'all-open': return true;
        default: throw new Error(`Unknown report quick view: ${state.quickView}`);
      }
    });
  }
  return state.showHistory
    ? [...selected, ...scoped.filter((item) => TERMINAL_STATUSES.has(item.status))]
    : selected;
}

export function reportSelectionBrowserSource() {
  return [
    'const SEARCH_INDEX = new WeakMap();',
    'const FACET_INDEX = new WeakMap();',
    `const TERMINAL_STATUSES = new Set(${JSON.stringify([...TERMINAL_STATUSES])});`,
    ...[reportFieldValues, searchableText, dimensionValues, selectReportItems,
      countReportFacets, selectListItems].map((fn) => fn.toString().replace(/^export\s+/, '')),
  ].join('\n');
}
