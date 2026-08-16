// Report-layer sequencing. The core never invents, recalculates, or persists a
// priority: `ready` stays the deterministic queue (priority, created, id). Every
// derivation here is display-only, recomputed from ledger bytes at render time,
// and never written back.

// The documented class-of-service vocabulary. It rides the existing report
// `fields` mapping, so no core field carries it and the core stays policy-free.
export const CLASSES_OF_SERVICE = ['expedite', 'fixed-date', 'standard', 'intangible'];

// The WSJF-style size denominator. `complexity` already flows through report
// field mappings; these weights turn its documented values into a job size.
// A complexity value outside the scale keeps a null weight: it is shown, never
// guessed at, and never silently dropped.
const SIZE_WEIGHTS = new Map([
  ['xs', 1], ['x-small', 1], ['s', 1], ['small', 1],
  ['m', 2], ['medium', 2],
  ['l', 3], ['large', 3],
  ['xl', 5], ['x-large', 5], ['extra-large', 5],
]);

const MILLISECONDS_PER_DAY = 86400000;

// Whole days between two ISO calendar dates. Both are parsed as UTC midnight,
// so the result never shifts with the host time zone.
export function daysBetween(fromDate, toDate) {
  const from = Date.parse(`${fromDate}T00:00:00Z`);
  const to = Date.parse(`${toDate}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) {
    return null;
  }
  return Math.round((to - from) / MILLISECONDS_PER_DAY);
}

export function classifyItem(item, asOf) {
  const rawClass = typeof item.fields.class === 'string' ? item.fields.class : null;
  const known = rawClass === null || CLASSES_OF_SERVICE.includes(rawClass);
  const rawDue = typeof item.fields.due === 'string' ? item.fields.due : null;
  const daysUntil = rawDue === null ? null : daysBetween(asOf, rawDue);
  const rawSize = item.fields.complexity === undefined ? null : String(item.fields.complexity);

  return {
    class: {
      value: known && rawClass !== null ? rawClass : 'standard',
      raw: rawClass,
      known,
    },
    due: daysUntil === null ? null : { date: rawDue, daysUntil },
    ageDays: daysBetween(item.created, asOf) ?? 0,
    size: rawSize === null
      ? null
      : { value: rawSize, weight: SIZE_WEIGHTS.get(rawSize.toLocaleLowerCase('en-US')) ?? null },
  };
}

// Epic enablement. For every item that names a parent, how far that parent's
// direct children have already reached a terminal status. Finishing the last
// child of an almost-done epic releases the whole epic.
export function computeEpicEnablement(allItems) {
  const byId = new Map(allItems.map((item) => [item.id, item]));
  const childCounts = new Map();
  for (const item of allItems) {
    if (item.parent === null) {
      continue;
    }
    const counts = childCounts.get(item.parent) ?? { terminal: 0, total: 0 };
    counts.total += 1;
    if (item.terminalDate !== null) {
      counts.terminal += 1;
    }
    childCounts.set(item.parent, counts);
  }

  const epicById = new Map();
  for (const item of allItems) {
    const parent = item.parent === null ? undefined : byId.get(item.parent);
    if (parent === undefined) {
      epicById.set(item.id, null);
      continue;
    }
    const counts = childCounts.get(parent.id);
    epicById.set(item.id, {
      id: parent.id,
      number: parent.number,
      title: parent.title,
      kind: parent.kind,
      terminalChildren: counts.terminal,
      totalChildren: counts.total,
      ratio: counts.terminal / counts.total,
    });
  }
  return epicById;
}

// Transitive unblocking leverage over the depends_on DAG. For each open item,
// the set of other open items whose dependency chain passes through it. The
// ledger is cycle-checked before a report renders, so the reverse graph is a
// DAG; the on-stack guard only keeps a hand-built model from looping.
export function computeLeverage(openItems) {
  const dependents = new Map(openItems.map((item) => [item.id, []]));
  for (const item of openItems) {
    for (const dependencyId of item.dependsOn) {
      dependents.get(dependencyId)?.push(item.id);
    }
  }

  const reachable = new Map();
  const onStack = new Set();

  function resolve(id) {
    const cached = reachable.get(id);
    if (cached !== undefined) {
      return cached;
    }
    if (onStack.has(id)) {
      return new Set();
    }
    onStack.add(id);
    const collected = new Set();
    for (const dependentId of dependents.get(id) ?? []) {
      collected.add(dependentId);
      for (const transitiveId of resolve(dependentId)) {
        collected.add(transitiveId);
      }
    }
    onStack.delete(id);
    reachable.set(id, collected);
    return collected;
  }

  const numbersById = new Map(openItems.map((item) => [item.id, item.number]));
  const leverageById = new Map();
  for (const item of openItems) {
    const unblockedIds = [...resolve(item.id)];
    const numbers = unblockedIds
      .map((id) => numbersById.get(id))
      .filter((number) => typeof number === 'number')
      .sort((left, right) => left - right);
    leverageById.set(item.id, { count: unblockedIds.length, numbers });
  }
  return leverageById;
}
