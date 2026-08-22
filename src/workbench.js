import { loadLedger } from './ledger.js';
import {
  allowedTargets,
  minimumTransitionDate,
  transitionBlockers,
  transitionEdge,
  transitionPreconditions,
} from './lifecycle.js';
import {
  MAX_WORKBENCH_COLLECTION_ENTRIES,
  MAX_WORKBENCH_TITLE_CHARACTERS,
  WORKBENCH_PROJECTION_VERSION,
} from './limits.js';
import { revisionFor } from './mutation.js';
import { boundedCollection, projectText, snapshotWitness } from './projection.js';
import { projectReadiness } from './ready.js';
import { validateLedger } from './validate.js';

// What the projection is, stated in the response rather than left to a reader
// of the contract. It is one observation of one ledger snapshot: it grants no
// lease, and `transition` rechecks every one of these before it writes.
const OBSERVATION = Object.freeze({
  authority: 'observed-snapshot',
  rechecked_by: Object.freeze([
    'revision', 'lock', 'claim-fence', 'reconciliation', 'candidate-validation',
  ]),
});

// Answers one workbench projection from one complete validated ledger snapshot.
// An invalid ledger returns its validation and no projection: an affordance
// derived from a ledger this core has not judged would be a claim it cannot
// support.
export async function inspectWorkbench(ledgerDirectory, selector, asOf) {
  const ledger = await loadLedger(ledgerDirectory);
  const validation = validateLedger(ledger);
  if (!validation.valid) {
    return { validation };
  }
  const entry = ledger.items.find(selector.id === undefined
    ? (candidate) => candidate.data.number === selector.number
    : (candidate) => candidate.data.id === selector.id);
  if (!entry) {
    return { workbench: null };
  }
  const readiness = projectReadiness(ledger.items, asOf);
  return {
    workbench: {
      projection_version: WORKBENCH_PROJECTION_VERSION,
      as_of: asOf,
      snapshot: snapshotWitness(ledger.items),
      observation: OBSERVATION,
      item: workbenchItem(entry, readiness),
      transition_options: transitionOptions(entry, ledger),
    },
  };
}

// One option per lifecycle target the edge table allows, in status order. Each
// option is evaluated at the item's own minimum legal date, so a date
// precondition can never be what disables it: the caller reads `minimum_date`
// and sends that date or a later one.
function transitionOptions(entry, ledger) {
  const minimumDate = minimumTransitionDate(entry.data);
  return allowedTargets(entry.data.kind, entry.data.status).map((toStatus) => {
    const edge = transitionEdge(entry.data.kind, entry.data.status, toStatus);
    const request = { date: minimumDate, to_status: toStatus };
    const issues = transitionPreconditions(entry, ledger, request, edge);
    const blockers = transitionBlockers(entry, ledger, toStatus);
    return {
      to_status: toStatus,
      action: edge.action,
      decision_required: edge.requiresDecision,
      minimum_date: minimumDate,
      enabled: issues.length === 0 && blockers.length === 0,
      precondition_issues: boundedCollection(
        issues.map(boundedIssue),
        MAX_WORKBENCH_COLLECTION_ENTRIES,
      ),
      blockers: boundedCollection(blockers, MAX_WORKBENCH_COLLECTION_ENTRIES),
    };
  });
}

// An issue keeps the code, field, and message `transition` refuses with. Only
// its related-ID list is reshaped, because that list grows with the ledger and
// this projection is bounded.
function boundedIssue(issue) {
  return {
    ...issue,
    related_ids: boundedCollection(issue.related_ids, MAX_WORKBENCH_COLLECTION_ENTRIES),
  };
}

// The projection carries identity, lifecycle, dates, the exact revision, and
// readiness, with every variable-size field bounded. It carries no item source
// and no body: those are the lossless `inspect` read, and this projection has to
// stay inside an advertised response bound.
function workbenchItem(entry, readiness) {
  const data = entry.data;
  const title = projectText(data.title, MAX_WORKBENCH_TITLE_CHARACTERS);
  return {
    id: data.id,
    ...(Object.hasOwn(data, 'number') ? { number: data.number } : {}),
    title: title.text,
    title_truncated: title.truncated,
    kind: data.kind,
    status: data.status,
    ...(Object.hasOwn(data, 'priority') ? { priority: data.priority } : {}),
    ...(Object.hasOwn(data, 'parent') ? { parent: data.parent } : {}),
    created: data.created,
    updated: data.updated,
    revision: revisionFor(entry.bytes),
    ready: readiness.get(data.id).state === 'ready',
    depends_on: boundedCollection(data.depends_on ?? [], MAX_WORKBENCH_COLLECTION_ENTRIES),
    related: boundedCollection(data.related ?? [], MAX_WORKBENCH_COLLECTION_ENTRIES),
  };
}
