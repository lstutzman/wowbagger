// Report-layer sequencing. The core never invents, recalculates, or persists a
// priority: `ready` stays the deterministic queue (priority, created, id). Every
// derivation here is display-only, recomputed from ledger bytes at render time,
// and never written back.

// Unrecognised class values are surfaced as a report-level notice. A typo in a
// consumer's extension field must never disappear into the standard band
// unannounced.
export function collectUnknownClasses(openItems) {
  const byValue = new Map();
  for (const item of openItems) {
    const { raw, known } = item.sequencing.class;
    if (raw === null || known) {
      continue;
    }
    const numbers = byValue.get(raw) ?? [];
    if (typeof item.number === 'number') {
      numbers.push(item.number);
    }
    byValue.set(raw, numbers);
  }
  return [...byValue.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([value, numbers]) => ({ value, numbers: numbers.sort((left, right) => left - right) }));
}

// The recommended order. Every factor is a separate, visible comparison step,
// never a single opaque score: an entry's position is always explained by the
// first step on which it beat the entry below it. Dominance runs expedite
// class, fixed-date proximity, unblocking leverage, epic enablement, priority,
// age, then size, with the immutable ID as the determinism backstop.
export function rankWorkNext(readyItems) {
  return [...readyItems]
    .sort(compareRanked)
    .map((item) => ({
      id: item.id,
      number: item.number,
      title: item.title,
      reasons: describeReasons(item),
    }));
}

function compareRanked(left, right) {
  return expediteBand(left) - expediteBand(right)
    || compareNumbers(dueProximity(left), dueProximity(right))
    || right.sequencing.leverage.count - left.sequencing.leverage.count
    || compareNumbers(epicEnablement(left), epicEnablement(right))
    || compareNumbers(left.priority, right.priority)
    || right.sequencing.ageDays - left.sequencing.ageDays
    || compareNumbers(sizeWeight(left), sizeWeight(right))
    || compareText(left.id, right.id);
}

// Nearest due date first, overdue first of all. An item with no due date has no
// date-driven cost of delay, so it sorts behind every dated one at this step.
function dueProximity(item) {
  return item.sequencing.due === null ? null : item.sequencing.due.daysUntil;
}

// The closer a parent is to fully terminal, the more a child releases by
// finishing. An item with no parent releases no parent and sorts last here.
function epicEnablement(item) {
  return item.sequencing.epic === null ? null : -item.sequencing.epic.ratio;
}

// The WSJF denominator, applied where the dominance order above has already
// tied. A complexity value outside the documented scale carries no weight and
// sorts last here rather than being guessed at.
function sizeWeight(item) {
  return item.sequencing.size?.weight ?? null;
}

// Ascending, with null last. Subtraction would turn two absent values into NaN.
function compareNumbers(left, right) {
  if (left === null || right === null) {
    return left === right ? 0 : left === null ? 1 : -1;
  }
  return left - right;
}

function expediteBand(item) {
  return item.sequencing.class.value === 'expedite' ? 0 : 1;
}

// The reasons are the report: one line per factor that placed this entry,
// in the same order the comparison steps run.
function describeReasons(item) {
  const { sequencing } = item;
  const reasons = [];
  if (sequencing.class.raw !== null) {
    reasons.push(sequencing.class.known
      ? { code: 'class', label: sequencing.class.raw }
      : { code: 'class-unknown', label: `unrecognised class "${sequencing.class.raw}"` });
  }
  if (sequencing.due !== null) {
    reasons.push({ code: 'due', label: `due ${sequencing.due.date} (${duePhrase(sequencing.due.daysUntil)})` });
  }
  if (sequencing.leverage.count > 0) {
    reasons.push({ code: 'leverage', label: `unblocks ${plural(sequencing.leverage.count, 'item')}${namedNumbers(sequencing.leverage.numbers)}` });
  }
  if (sequencing.epic !== null) {
    reasons.push({ code: 'epic', label: `advances ${epicPhrase(sequencing.epic)}` });
  }
  if (item.priority !== null) {
    reasons.push({ code: 'priority', label: `priority ${item.priority}` });
  }
  reasons.push({ code: 'age', label: `age ${sequencing.ageDays}d` });
  if (sequencing.size !== null) {
    reasons.push({ code: 'size', label: `size ${sequencing.size.value}` });
  }
  return reasons;
}

function epicPhrase(epic) {
  const noun = epic.kind === 'epic' ? 'epic' : 'parent';
  const handle = epic.number === null ? epic.id : `#${epic.number}`;
  return `${noun} ${handle} (${Math.round(epic.ratio * 100)}% done)`;
}

function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

// Name at most four unblocked items so the reason stays one readable line.
function namedNumbers(numbers) {
  if (numbers.length === 0) {
    return '';
  }
  const shown = numbers.slice(0, 4).map((number) => `#${number}`).join(', ');
  return numbers.length > 4 ? ` (${shown}, +${numbers.length - 4} more)` : ` (${shown})`;
}

function duePhrase(daysUntil) {
  if (daysUntil < 0) {
    return `${-daysUntil}d overdue`;
  }
  return daysUntil === 0 ? 'today' : `in ${daysUntil}d`;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

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
