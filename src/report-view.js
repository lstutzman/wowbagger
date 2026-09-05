// Named report view parsing. A view is a read-only projection of the complete
// ledger, so this module only reads configuration and reports whether it is
// usable: it returns `null` instead of throwing, and `src/report.js` owns the
// `ReportError` vocabulary. Keeping the failure signal structural is what keeps
// the parser out of an import cycle with the report it configures.
export const REPORT_VIEW_NAME = /^[a-z][a-z0-9-]{0,63}$/;
const MAXIMUM_REPORT_VIEWS = 64;
const VIEW_KEYS = new Set(['title', 'output', 'filters']);
const FILTER_KEYS = new Set(['readiness', 'status', 'kind', 'fields']);

// The closed vocabularies a view may select. Readiness and kind are the report
// and schema vocabularies; status is the ledger lifecycle. They are stated here
// so a view can never select a value no item could ever carry.
const BUILT_IN_FILTER_VALUES = new Map([
  ['readiness', new Set(['ready', 'blocked', 'ineligible'])],
  ['status', new Set([
    'triage',
    'backlog',
    'in-progress',
    'done',
    'killed',
    'archived',
    'deferred',
  ])],
  ['kind', new Set(['task', 'epic'])],
]);

export function normalizeReportViews(value, fieldMappings) {
  if (!isObject(value)) {
    return null;
  }
  const names = Object.keys(value);
  if (names.length === 0 || names.length > MAXIMUM_REPORT_VIEWS) {
    return null;
  }

  const views = {};
  for (const name of names) {
    if (!REPORT_VIEW_NAME.test(name)) {
      return null;
    }
    const view = value[name];
    if (!isObject(view)
      || !hasOnlyKeys(view, VIEW_KEYS)
      || !isNonEmptyString(view.title)
      || !isNonEmptyString(view.output)) {
      return null;
    }
    const filters = normalizeFilters(view.filters, fieldMappings);
    if (filters === null) {
      return null;
    }
    views[name] = {
      name,
      title: view.title,
      output: view.output,
      filters,
    };
  }
  return views;
}

// Matching is typed identity, never stringification: a mapped `1` and a
// configured `"1"` are different selections. An item missing the mapped field
// matches no selected value for that field. Values inside one group are
// alternatives; every present group must match.

// One accessor for every consumer of a projected field value: absent values
// carry no candidates, the tags array carries each member, and a scalar
// carries itself. Named matching below and later selection code share it so
// one item with two tags answers either tag filter.
export function reportFieldValues(value) {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

export function matchesReportView(item, filters) {
  if (filters.readiness !== undefined && !filters.readiness.includes(item.readiness.state)) {
    return false;
  }
  if (filters.status !== undefined && !filters.status.includes(item.status)) {
    return false;
  }
  if (filters.kind !== undefined && !filters.kind.includes(item.kind)) {
    return false;
  }
  if (filters.fields !== undefined) {
    for (const [name, values] of Object.entries(filters.fields)) {
      const carried = reportFieldValues(item.fields[name]);
      if (!Object.prototype.hasOwnProperty.call(item.fields, name)
        || !values.some((candidate) => carried.some((entry) => isSameScalar(candidate, entry)))) {
        return false;
      }
    }
  }
  return true;
}

// The criteria a named report states about itself, keyed with the report's own
// facet vocabulary so the renderer labels a fixed criterion exactly as it
// labels the interactive chip for the same dimension. Order is the group order,
// never the configuration's key order, so one view always reads the same way.
export function reportViewCriteria(filters) {
  const criteria = [];
  for (const group of BUILT_IN_FILTER_VALUES.keys()) {
    if (filters[group] !== undefined) {
      criteria.push({ key: group, values: [...filters[group]] });
    }
  }
  if (filters.fields !== undefined) {
    for (const [name, values] of Object.entries(filters.fields)) {
      criteria.push({ key: `field:${name}`, values: [...values] });
    }
  }
  return criteria;
}

function normalizeFilters(value, fieldMappings) {
  if (!isObject(value) || !hasOnlyKeys(value, FILTER_KEYS)) {
    return null;
  }

  const filters = {};
  for (const [group, allowed] of BUILT_IN_FILTER_VALUES) {
    if (value[group] === undefined) {
      continue;
    }
    const values = normalizeValues(value[group], (candidate) => allowed.has(candidate));
    if (values === null) {
      return null;
    }
    filters[group] = values;
  }

  if (value.fields !== undefined) {
    if (!isObject(value.fields) || Object.keys(value.fields).length === 0) {
      return null;
    }
    const fields = {};
    for (const [name, candidates] of Object.entries(value.fields)) {
      if (!Object.prototype.hasOwnProperty.call(fieldMappings, name)) {
        return null;
      }
      const values = normalizeValues(candidates, isFilterScalar);
      if (values === null) {
        return null;
      }
      fields[name] = values;
    }
    filters.fields = fields;
  }

  return Object.keys(filters).length === 0 ? null : filters;
}

// Uniqueness is typed: `"1"` and `1` are two selectable values, so the seen key
// carries the type the configuration wrote.
function scalarKey(value) {
  return `${typeof value}:${JSON.stringify(value)}`;
}

function isSameScalar(left, right) {
  return typeof left === typeof right && left === right;
}

function normalizeValues(value, isAllowed) {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const seen = new Set();
  for (const candidate of value) {
    if (!isAllowed(candidate)) {
      return null;
    }
    const key = scalarKey(candidate);
    if (seen.has(key)) {
      return null;
    }
    seen.add(key);
  }
  return [...value];
}

function isFilterScalar(value) {
  return typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value));
}

function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
