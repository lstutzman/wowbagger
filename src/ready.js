import { isDependencySatisfied } from './dependencies.js';

export function projectReadiness(items, asOf) {
  const byId = new Map(items.map((item) => [item.data.id, item]));
  const ancestorReasonsById = new Map();
  const projection = new Map();

  for (const item of items) {
    const reasons = [];
    if (item.data.kind !== 'task') {
      reasons.push({ code: 'kind-not-task' });
    }
    if (item.data.status !== 'backlog') {
      reasons.push({ code: 'status-not-backlog' });
    }
    if (item.data.snoozed_until && item.data.snoozed_until > asOf) {
      reasons.push({ code: 'snoozed' });
    }
    const ineligible = reasons.length > 0;
    if (Array.isArray(item.data.depends_on)) {
      for (const dependencyId of item.data.depends_on) {
        const dependencyIsSatisfied = item.data.schema_version !== 1
          && isDependencySatisfied(byId.get(dependencyId)?.data.status);
        if (!dependencyIsSatisfied) {
          reasons.push({ code: 'dependency-unsatisfied', item_id: dependencyId });
        }
      }
    }
    reasons.push(...ancestorReasons(item.data.parent, byId, ancestorReasonsById));
    projection.set(item.data.id, {
      state: ineligible ? 'ineligible' : reasons.length > 0 ? 'blocked' : 'ready',
      reasons,
    });
  }

  return projection;
}

export function selectReady(items, asOf) {
  const projection = projectReadiness(items, asOf);

  return items
    .filter((item) => projection.get(item.data.id).state === 'ready')
    .sort((left, right) => comparePriority(left.data, right.data)
      || compareText(left.data.created, right.data.created)
      || compareText(left.data.id, right.data.id))
    .map((item) => item.data.id);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

// Items carrying a priority sort before items without one, then by ascending
// priority. The core reports the supplied priority; it never invents or
// recalculates one.
function comparePriority(left, right) {
  const hasLeft = typeof left.priority === 'number';
  const hasRight = typeof right.priority === 'number';

  if (hasLeft !== hasRight) {
    return hasLeft ? -1 : 1;
  }
  if (!hasLeft) {
    return 0;
  }
  return left.priority - right.priority;
}

function ancestorReasons(startId, byId, cache) {
  if (!startId) {
    return [];
  }
  if (cache.has(startId)) {
    return cache.get(startId);
  }

  const path = [];
  const visited = new Set();
  let ancestorId = startId;
  let suffix = [];

  while (ancestorId) {
    if (cache.has(ancestorId)) {
      suffix = cache.get(ancestorId);
      break;
    }
    if (visited.has(ancestorId)) {
      suffix = [{ code: 'ancestor-not-backlog', item_id: ancestorId }];
      break;
    }
    visited.add(ancestorId);

    const ancestor = byId.get(ancestorId);
    path.push({ id: ancestorId, item: ancestor });
    if (!ancestor) {
      break;
    }
    ancestorId = ancestor.data.parent;
  }

  for (let index = path.length - 1; index >= 0; index -= 1) {
    const entry = path[index];
    if (!entry.item || entry.item.data.status !== 'backlog') {
      suffix = [{ code: 'ancestor-not-backlog', item_id: entry.id }, ...suffix];
    }
    cache.set(entry.id, suffix);
  }

  return cache.get(startId) ?? suffix;
}
