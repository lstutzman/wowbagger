export function selectReady(items, asOf) {
  const byId = new Map(items.map((item) => [item.data.id, item]));
  const ancestorsBacklogById = new Map();

  return items
    .filter((item) => isReady(item, byId, ancestorsBacklogById, asOf))
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

function isReady(item, byId, ancestorsBacklogById, asOf) {
  const { data } = item;

  return data.kind === 'task'
    && data.status === 'backlog'
    && (!data.snoozed_until || data.snoozed_until <= asOf)
    && Array.isArray(data.depends_on)
    && data.depends_on.length === 0
    && ancestorsAreBacklog(data, byId, ancestorsBacklogById);
}

function ancestorsAreBacklog(data, byId, ancestorsBacklogById) {
  let parentId = data.parent;
  const visited = new Set();
  const path = [];
  let result = true;

  while (parentId) {
    if (ancestorsBacklogById.has(parentId)) {
      result = ancestorsBacklogById.get(parentId);
      break;
    }

    if (visited.has(parentId)) {
      result = false;
      break;
    }
    visited.add(parentId);
    path.push(parentId);

    const parent = byId.get(parentId);
    if (!parent || parent.data.status !== 'backlog') {
      result = false;
      break;
    }
    parentId = parent.data.parent;
  }

  for (const id of path) {
    ancestorsBacklogById.set(id, result);
  }

  return result;
}
