// The one native lifecycle definition. `transition` executes it under lock and
// compare-and-swap; the `inspect --workbench` projection reports it read-only.
// Both read this module, so an affordance can never advertise an edge, action,
// precondition, or blocker the mutation does not implement.
import { isDependencySatisfied } from './dependencies.js';

// The item status vocabulary, in one place. Enumerating targets against the
// edge function below keeps the allowed set derived rather than copied.
export const LIFECYCLE_STATUSES = Object.freeze([
  'archived', 'backlog', 'deferred', 'done', 'in-progress', 'killed', 'triage',
]);

// The decision action each edge generates, keyed `kind:from:to`. It is one
// module constant rather than a literal rebuilt per question, because
// `allowedTargets` and the workbench projection ask this table once per
// lifecycle target of one item. An allowed edge absent from it generates no
// action and so requires no decision.
const TRANSITION_ACTIONS = new Map([
  ['task:triage:backlog', 'accept'],
  ['epic:triage:backlog', 'accept'],
  ['task:triage:killed', 'kill'],
  ['epic:triage:killed', 'kill'],
  ['task:backlog:deferred', 'defer'],
  ['epic:backlog:deferred', 'defer'],
  ['task:deferred:backlog', 'undefer'],
  ['epic:deferred:backlog', 'undefer'],
  ['task:backlog:archived', 'archive'],
  ['task:backlog:killed', 'kill'],
  ['task:in-progress:done', 'complete'],
  ['task:in-progress:killed', 'kill'],
  ['epic:backlog:done', 'complete'],
  ['epic:backlog:archived', 'archive'],
  ['epic:backlog:killed', 'kill'],
  ['task:archived:backlog', 'restore'],
  ['epic:archived:backlog', 'restore'],
]);

export function transitionEdge(kind, from, to) {
  const action = TRANSITION_ACTIONS.get(`${kind}:${from}:${to}`) ?? null;
  const allowed = (from === 'triage' && (to === 'backlog' || to === 'killed'))
    || (from === 'backlog' && (
      (kind === 'task' && to === 'in-progress')
      || ['archived', 'killed', 'deferred'].includes(to)
    ))
    || (from === 'deferred' && to === 'backlog')
    || (kind === 'task' && from === 'in-progress' && ['backlog', 'done', 'killed'].includes(to))
    || (kind === 'epic' && from === 'backlog' && ['done', 'archived', 'killed'].includes(to))
    || (from === 'archived' && to === 'backlog');
  return { allowed, action, requiresDecision: action !== null };
}

// Every lifecycle target the edge table allows out of one kind and status, in
// status order. It asks `transitionEdge` rather than restating the table, so a
// changed edge changes both the mutation and the projection at once.
export function allowedTargets(kind, from) {
  return LIFECYCLE_STATUSES.filter((to) => transitionEdge(kind, from, to).allowed);
}

// The earliest date a transition of this item can carry. Both date
// preconditions below refuse anything earlier, so this is exactly the bound
// they enforce, derived from the item's own dates and nothing else.
export function minimumTransitionDate(data) {
  return data.updated > data.created ? data.updated : data.created;
}

export function transitionPreconditions(target, ledger, request, edge) {
  const issues = [];
  if (request.date < target.data.created) {
    issues.push(dateIssue('date-before-created', 'Transition date must not be earlier than the current created date.', target.data));
  }
  if (request.date < target.data.updated) {
    issues.push(dateIssue('date-before-updated', 'Transition date must not be earlier than the current updated date.', target.data));
  }
  if (!edge.allowed) {
    issues.push(transitionIssue('invalid-edge', 'to_status', 'The requested lifecycle edge is not allowed for this item.', []));
  }
  const dependencies = target.data.depends_on ?? [];
  const liveDependencies = target.data.schema_version === 2
    ? dependencies.filter((id) => !isDependencySatisfied(findItem(ledger, id)?.data.status))
    : dependencies;
  if (request.to_status === 'done' && liveDependencies.length > 0) {
    const message = target.data.schema_version === 2
      ? 'Completion requires every depends_on target to be done.'
      : 'Completion requires an empty depends_on list.';
    issues.push(transitionIssue('live-dependencies', 'depends_on', message, [...liveDependencies].sort(compareText)));
  }
  if (target.data.kind === 'epic' && request.to_status === 'done') {
    const children = ledger.items.filter((item) => item.data.parent === target.data.id);
    const nonterminal = children.filter((item) => !['done', 'killed'].includes(item.data.status))
      .map((item) => item.data.id).sort(compareText);
    if (nonterminal.length > 0) {
      issues.push(transitionIssue('nonterminal-children', 'parent', 'Epic completion requires every direct child to be done or killed.', nonterminal));
    }
  }
  return issues.sort(compareTransitionIssues);
}

export function transitionBlockers(target, ledger, toStatus) {
  const blockers = [];
  const requiresDependentMutation = ['killed', 'archived'].includes(toStatus)
    || (toStatus === 'done' && target.data.schema_version === 1);
  if (requiresDependentMutation) {
    for (const item of ledger.items) {
      if (item.data.id === target.data.id || !(item.data.depends_on ?? []).includes(target.data.id)) {
        continue;
      }
      blockers.push({
        code: toStatus === 'done' ? 'dependent-cleanup' : 'dependent-disposition',
        item_id: item.data.id,
        field: 'depends_on',
      });
    }
  }
  if (target.data.kind === 'epic' && ['killed', 'archived'].includes(toStatus)) {
    for (const item of ledger.items) {
      if (item.data.parent === target.data.id && ['triage', 'backlog', 'in-progress'].includes(item.data.status)) {
        blockers.push({ code: 'child-disposition', item_id: item.data.id, field: 'parent' });
      }
    }
  }
  return blockers.sort((left, right) => compareText(left.code, right.code)
    || compareText(left.item_id, right.item_id)
    || compareText(left.field, right.field));
}

export function findItem(ledger, id) {
  return ledger.items.find((item) => item.data.id === id);
}

export function transitionIssue(code, field, message, relatedIds) {
  return { code, field, message, related_ids: relatedIds };
}

// A date refusal names the item's own dates so the caller can correct the
// request without an inspect round-trip. Both dates ride both codes: the
// operator needs the whole window, not the one bound that happened to fire.
export function dateIssue(code, message, data) {
  return {
    ...transitionIssue(code, 'date', message, []),
    item_created: data.created,
    item_updated: data.updated,
  };
}

export function compareTransitionIssues(left, right) {
  return compareText(left.code, right.code)
    || compareText(left.field, right.field)
    || compareText(left.related_ids.join('\u0000'), right.related_ids.join('\u0000'));
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
