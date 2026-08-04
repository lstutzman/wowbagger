export function selectReady(items, asOf) {
  const byId = new Map(items.map((item) => [item.data.id, item]));

  return items
    .filter((item) => isReady(item, byId, asOf))
    .sort((left, right) => {
      const created = compareText(left.data.created, right.data.created);
      return created === 0 ? compareText(left.data.id, right.data.id) : created;
    })
    .map((item) => item.data.id);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isReady(item, byId, asOf) {
  const { data } = item;

  return data.kind === 'task'
    && data.status === 'backlog'
    && (!data.snoozed_until || data.snoozed_until <= asOf)
    && Array.isArray(data.depends_on)
    && data.depends_on.length === 0
    && ancestorsAreBacklog(data, byId);
}

function ancestorsAreBacklog(data, byId) {
  let parentId = data.parent;

  while (parentId) {
    const parent = byId.get(parentId);
    if (!parent || parent.data.status !== 'backlog') {
      return false;
    }
    parentId = parent.data.parent;
  }

  return true;
}
