import { projectReadiness } from './ready.js';

// Report-only dependency impact. The core readiness projection stays the
// authority: ready-if-done is the baseline-to-counterfactual diff of
// `projectReadiness` on a copied ledger where only the candidate is done.
// Downstream reach mirrors the recommendation leverage traversal over the
// retained open graph. Pure: no Node or DOM access, input never mutated.
export function buildReportImpact(allItems, retainedOpenIds, asOf) {
  const retained = new Set(retainedOpenIds);
  const byId = new Map(allItems.map((item) => [item.data.id, item]));
  const baseline = projectReadiness(allItems, asOf);

  const dependents = new Map();
  const children = new Map();
  for (const id of retained) {
    dependents.set(id, []);
    children.set(id, []);
  }
  for (const item of allItems) {
    const id = item.data.id;
    if (Array.isArray(item.data.depends_on)) {
      for (const dependencyId of item.data.depends_on) {
        if (dependents.has(dependencyId) && retained.has(id)) {
          dependents.get(dependencyId).push(id);
        }
      }
    }
    const parentId = item.data.parent;
    if (parentId && children.has(parentId) && retained.has(id)) {
      children.get(parentId).push(id);
    }
  }

  const downstreamCache = new Map();
  function downstream(id, onStack) {
    const cached = downstreamCache.get(id);
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
      for (const transitiveId of downstream(dependentId, onStack)) {
        collected.add(transitiveId);
      }
    }
    onStack.delete(id);
    downstreamCache.set(id, collected);
    return collected;
  }

  // Reverse dependency/ancestor reach from a candidate bounds the diff scan.
  function affectedIds(candidateId) {
    const seen = new Set([candidateId]);
    const queue = [candidateId];
    while (queue.length > 0) {
      const current = queue.pop();
      for (const next of dependents.get(current) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
      for (const next of children.get(current) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    seen.delete(candidateId);
    return seen;
  }

  function readinessIfDone(candidateId) {
    const candidate = byId.get(candidateId);
    if (!candidate) {
      return baseline;
    }
    const copied = allItems.map((item) => (item === candidate
      ? { ...item, data: { ...item.data, status: 'done' } }
      : item));
    return projectReadiness(copied, asOf);
  }

  const impact = {};
  for (const id of [...retained].sort(compareText)) {
    const downstreamIds = [...downstream(id, new Set())].filter((other) => other !== id).sort(compareText);
    const after = readinessIfDone(id);
    const readyIfDoneIds = [...affectedIds(id)]
      .filter((other) => retained.has(other)
        && baseline.get(other)?.state !== 'ready'
        && after.get(other)?.state === 'ready')
      .sort(compareText);
    impact[id] = { downstreamIds, readyIfDoneIds };
  }
  return impact;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
