const KINDS = new Set(['task', 'epic']);
const STATUSES = new Set([
  'triage',
  'backlog',
  'in-progress',
  'done',
  'killed',
  'archived',
]);
const TERMINAL_STATES = new Map([
  ['done', { field: 'completed', action: 'complete' }],
  ['killed', { field: 'killed', action: 'kill' }],
  ['archived', { field: 'archived', action: 'archive' }],
]);
const TERMINAL_DATE_FIELDS = ['completed', 'killed', 'archived'];
const DECISION_ACTIONS = new Set([
  'accept',
  'complete',
  'kill',
  'archive',
  'restore',
  'replace-dependency',
  'waive-dependency',
  'reparent',
  'record',
]);
const ULID_PATTERN = /^wb_([0-7][0-9A-HJKMNP-TV-Z]{25})$/;
const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const NON_TERMINAL_STATUSES = new Set(['triage', 'backlog', 'in-progress']);

export function validateLedger(ledger) {
  const context = {
    errors: [...ledger.errors],
    errorKeys: new Set(),
  };
  const facts = ledger.items.map((item) => inspectItem(item, context));
  const index = buildIdentityIndex(facts);

  validateUniformSchemaVersion(facts, context);
  validateDuplicateIds(index, context);
  validateDuplicateNumbers(facts, context);

  for (const fact of facts) {
    validateRelationLists(fact, context);
    validateTerminalDates(fact, context);
    validateDoneDependencies(fact, context);
    validateDecisionRecords(fact, context);
  }

  for (const fact of facts) {
    validateRelations(fact, index, context);
  }

  validateCycles(facts, index, 'dependency', context);
  validateCycles(facts, index, 'containment', context);

  const childrenByParent = indexChildren(facts);
  for (const fact of facts) {
    validateTerminalDecisions(fact, context);
    validateRollupPlacement(fact, context);
    validateEpicRules(fact, childrenByParent, context);
    validateTerminalParent(fact, index, context);
  }

  context.errors.sort(compareErrors);
  return {
    valid: context.errors.length === 0,
    errors: context.errors,
  };
}

function inspectItem(item, context) {
  const { data } = item;
  const fact = {
    item,
    data,
    schemaVersion: null,
    id: null,
    kind: null,
    status: null,
    created: null,
    updated: null,
    dependsOn: [],
    related: [],
    parent: null,
    decisions: [],
    terminalDate: null,
    matchingTerminalDecision: null,
  };

  fact.schemaVersion = validateSchemaVersion(fact, context);
  fact.id = inspectId(fact, context);
  validateTitle(fact, context);
  fact.kind = inspectKind(fact, context);
  fact.status = inspectStatus(fact, context);
  fact.created = inspectRequiredDate(fact, 'created', context);
  fact.updated = inspectRequiredDate(fact, 'updated', context);
  validateProvenance(fact, context);
  fact.dependsOn = inspectReferenceList(fact, 'depends_on', true, context);
  fact.related = inspectReferenceList(fact, 'related', false, context);
  fact.parent = inspectParent(fact, context);
  inspectOptionalDate(fact, 'snoozed_until', context);
  inspectOptionalPriority(fact, context);
  fact.number = inspectOptionalNumber(fact, context);

  for (const field of TERMINAL_DATE_FIELDS) {
    inspectOptionalDate(fact, field, context);
  }

  inspectDecisions(fact, context);
  validateDateOrdering(fact, context);
  validateIdCreatedAgreement(fact, context);
  return fact;
}

function validateSchemaVersion(fact, context) {
  const { data } = fact;
  if (!hasOwn(data, 'schema_version')) {
    addError(fact, 'schema_version', 'missing-required-field', 'Field schema_version is required.', context);
    return null;
  }

  if (!Number.isInteger(data.schema_version)) {
    addError(fact, 'schema_version', 'invalid-schema-version', 'schema_version must be the integer 1 or 2.', context);
    return null;
  }

  if (data.schema_version !== 1 && data.schema_version !== 2) {
    addError(fact, 'schema_version', 'unsupported-schema-version', 'schema_version must be 1 or 2.', context);
    return null;
  }

  return data.schema_version;
}

function validateUniformSchemaVersion(facts, context) {
  if (new Set(facts.map((fact) => fact.schemaVersion).filter(Boolean)).size < 2) {
    return;
  }

  for (const fact of facts) {
    if (fact.schemaVersion !== null) {
      addError(
        fact,
        'schema_version',
        'mixed-schema-versions',
        'Schema versions 1 and 2 must not be mixed in one ledger.',
        context,
      );
    }
  }
}

function inspectId(fact, context) {
  const { data } = fact;
  if (!hasOwn(data, 'id')) {
    addError(fact, 'id', 'missing-required-field', 'Field id is required.', context);
    return null;
  }

  if (typeof data.id !== 'string' || !ULID_PATTERN.test(data.id)) {
    addError(
      fact,
      'id',
      'invalid-id',
      'ID must use the canonical wb_ ULID form.',
      context,
    );
    return null;
  }

  return data.id;
}

function validateTitle(fact, context) {
  const { data } = fact;
  if (!hasOwn(data, 'title')) {
    addError(fact, 'title', 'missing-required-field', 'Field title is required.', context);
  } else if (!isNonEmptyString(data.title)) {
    addError(fact, 'title', 'invalid-field-type', 'Field title must be a non-empty string.', context);
  }
}

function inspectKind(fact, context) {
  const { data } = fact;
  if (!hasOwn(data, 'kind')) {
    addError(fact, 'kind', 'missing-required-field', 'Field kind is required.', context);
    return null;
  }

  if (typeof data.kind !== 'string') {
    addError(fact, 'kind', 'invalid-field-type', 'Field kind must be a string.', context);
    return null;
  }

  if (!KINDS.has(data.kind)) {
    addError(fact, 'kind', 'unknown-kind', `Kind ${data.kind} is not one of the schema version 1 kinds.`, context);
    return null;
  }

  return data.kind;
}

function inspectStatus(fact, context) {
  const { data } = fact;
  if (!hasOwn(data, 'status')) {
    addError(fact, 'status', 'missing-required-field', 'Field status is required.', context);
    return null;
  }

  if (typeof data.status !== 'string') {
    addError(fact, 'status', 'invalid-field-type', 'Field status must be a string.', context);
    return null;
  }

  if (!STATUSES.has(data.status)) {
    addError(
      fact,
      'status',
      'unknown-status',
      `Status ${data.status} is not one of the schema version 1 statuses.`,
      context,
    );
    return null;
  }

  return data.status;
}

function inspectRequiredDate(fact, field, context) {
  if (!hasOwn(fact.data, field)) {
    addError(fact, field, 'missing-required-field', `Field ${field} is required.`, context);
    return null;
  }

  return inspectDate(fact, field, context);
}

// number is a short human handle. The immutable ULID remains the identity used
// for publication, references, and the filename; number exists so a person can
// say "item 12" instead of reading out twenty-six characters.
function inspectOptionalNumber(fact, context) {
  if (!hasOwn(fact.data, 'number')) {
    return null;
  }

  const value = fact.data.number;
  if (!Number.isSafeInteger(value) || value < 1) {
    addError(
      fact,
      'number',
      'invalid-number',
      'Field number must be a positive integer.',
      context,
    );
    return null;
  }
  return value;
}

// priority is supplied by a consumer policy. The core validates its form and
// reports it; it never invents, recalculates, or persists one.
function inspectOptionalPriority(fact, context) {
  if (!hasOwn(fact.data, 'priority')) {
    return;
  }

  const value = fact.data.priority;
  if (!Number.isSafeInteger(value) || value < 0) {
    addError(
      fact,
      'priority',
      'invalid-priority',
      'Field priority must be a non-negative integer.',
      context,
    );
  }
}

function inspectOptionalDate(fact, field, context) {
  if (!hasOwn(fact.data, field)) {
    return null;
  }

  return inspectDate(fact, field, context);
}

function inspectDate(fact, field, context) {
  const value = fact.data[field];
  if (!isCalendarDate(value)) {
    addError(fact, field, 'invalid-date', `Field ${field} must be an ISO calendar date.`, context);
    return null;
  }

  return value;
}

function validateProvenance(fact, context) {
  const { data } = fact;
  if (!hasOwn(data, 'provenance')) {
    addError(fact, 'provenance', 'missing-required-field', 'Field provenance is required.', context);
    return;
  }

  if (!isMapping(data.provenance)) {
    addError(fact, 'provenance', 'invalid-field-type', 'Field provenance must be a mapping.', context);
    return;
  }

  if (!hasOwn(data.provenance, 'source')) {
    addError(fact, 'provenance.source', 'missing-required-field', 'Field provenance.source is required.', context);
  } else if (!isNonEmptyString(data.provenance.source)) {
    addError(fact, 'provenance.source', 'invalid-field-type', 'Field provenance.source must be a non-empty string.', context);
  }

  if (!hasOwn(data.provenance, 'recorded_at')) {
    addError(fact, 'provenance.recorded_at', 'missing-required-field', 'Field provenance.recorded_at is required.', context);
  } else if (!isRfc3339Utc(data.provenance.recorded_at)) {
    addError(
      fact,
      'provenance.recorded_at',
      'invalid-rfc3339-utc',
      'Field provenance.recorded_at must be an RFC 3339 UTC instant.',
      context,
    );
  }
}

function inspectReferenceList(fact, field, required, context) {
  if (!hasOwn(fact.data, field)) {
    if (required) {
      addError(fact, field, 'missing-required-field', `Field ${field} is required.`, context);
    }
    return [];
  }

  const value = fact.data[field];
  if (!Array.isArray(value)) {
    addError(fact, field, 'invalid-field-type', `Field ${field} must be a YAML sequence.`, context);
    return [];
  }

  const references = [];
  for (let index = 0; index < value.length; index += 1) {
    const reference = value[index];
    if (typeof reference !== 'string' || !ULID_PATTERN.test(reference)) {
      addError(
        fact,
        `${field}[${index}]`,
        'invalid-relation-reference',
        `Field ${field} entries must be canonical item IDs.`,
        context,
      );
      continue;
    }
    references.push(reference);
  }

  return references;
}

function inspectParent(fact, context) {
  if (!hasOwn(fact.data, 'parent')) {
    return null;
  }

  const parent = fact.data.parent;
  if (typeof parent !== 'string' || !ULID_PATTERN.test(parent)) {
    addError(fact, 'parent', 'invalid-parent-reference', 'Field parent must be a canonical item ID.', context);
    return null;
  }

  return parent;
}

function inspectDecisions(fact, context) {
  if (!hasOwn(fact.data, 'decisions')) {
    return;
  }

  const value = fact.data.decisions;
  if (!Array.isArray(value)) {
    addError(fact, 'decisions', 'invalid-field-type', 'Field decisions must be a YAML sequence.', context);
    return;
  }

  for (let index = 0; index < value.length; index += 1) {
    const decision = value[index];
    const field = `decisions[${index}]`;
    if (!isMapping(decision)) {
      addError(fact, field, 'invalid-decision', 'Each decision must be a mapping.', context);
      continue;
    }

    const inspected = {
      index,
      valid: true,
      action: null,
      date: null,
      hasRollup: hasOwn(decision, 'rollup'),
      rollup: decision.rollup,
    };

    if (!hasOwn(decision, 'action')) {
      inspected.valid = false;
      addError(fact, `${field}.action`, 'missing-decision-field', 'Each decision requires action.', context);
    } else if (typeof decision.action !== 'string' || !DECISION_ACTIONS.has(decision.action)) {
      inspected.valid = false;
      addError(fact, `${field}.action`, 'invalid-decision-action', 'Decision action is not recognized by schema version 1.', context);
    } else {
      inspected.action = decision.action;
    }

    if (!hasOwn(decision, 'date')) {
      inspected.valid = false;
      addError(fact, `${field}.date`, 'missing-decision-field', 'Each decision requires date.', context);
    } else if (!isCalendarDate(decision.date)) {
      inspected.valid = false;
      addError(fact, `${field}.date`, 'invalid-date', 'Decision date must be an ISO calendar date.', context);
    } else {
      inspected.date = decision.date;
    }

    for (const requiredField of ['summary', 'rationale']) {
      if (!hasOwn(decision, requiredField)) {
        inspected.valid = false;
        addError(
          fact,
          `${field}.${requiredField}`,
          'missing-decision-field',
          `Each decision requires ${requiredField}.`,
          context,
        );
      } else if (!isNonEmptyString(decision[requiredField])) {
        inspected.valid = false;
        addError(
          fact,
          `${field}.${requiredField}`,
          'invalid-field-type',
          `Decision ${requiredField} must be a non-empty string.`,
          context,
        );
      }
    }

    fact.decisions.push(inspected);
  }
}

function validateDateOrdering(fact, context) {
  if (fact.created && fact.updated && fact.updated < fact.created) {
    addError(
      fact,
      'updated',
      'updated-before-created',
      'Field updated must not be earlier than created.',
      context,
    );
  }
}

function validateIdCreatedAgreement(fact, context) {
  if (!fact.id || !fact.created) {
    return;
  }

  const idDate = dateFromId(fact.id);
  if (idDate !== fact.created) {
    addError(
      fact,
      'created',
      'id-created-date-mismatch',
      `Field created must equal the UTC calendar date encoded by ID ${fact.id}.`,
      context,
    );
  }
}

function buildIdentityIndex(facts) {
  const byId = new Map();
  for (const fact of facts) {
    if (!fact.id) {
      continue;
    }
    const members = byId.get(fact.id) ?? [];
    members.push(fact);
    byId.set(fact.id, members);
  }

  const uniqueById = new Map();
  for (const [id, members] of byId) {
    if (members.length === 1) {
      uniqueById.set(id, members[0]);
    }
  }

  return { byId, uniqueById };
}

function validateDuplicateIds(index, context) {
  for (const [id, members] of index.byId) {
    if (members.length < 2) {
      continue;
    }

    for (const fact of members) {
      addError(
        fact,
        'id',
        'duplicate-id',
        `ID ${id} is used by more than one ledger item.`,
        context,
      );
    }
  }
}

// A duplicate number is recoverable — the ULID still distinguishes the items —
// but it must be surfaced so a merge resolves it rather than a reader guessing.
function validateDuplicateNumbers(facts, context) {
  const byNumber = new Map();
  for (const fact of facts) {
    if (fact.number === null || fact.number === undefined) {
      continue;
    }
    const members = byNumber.get(fact.number) ?? [];
    members.push(fact);
    byNumber.set(fact.number, members);
  }

  for (const [number, members] of byNumber) {
    if (members.length < 2) {
      continue;
    }
    for (const fact of members) {
      addError(
        fact,
        'number',
        'duplicate-number',
        `Number ${number} is used by more than one ledger item.`,
        context,
      );
    }
  }
}

function validateRelationLists(fact, context) {
  validateDuplicateReferences(fact, 'depends_on', fact.dependsOn, context);
  validateDuplicateReferences(fact, 'related', fact.related, context);

  const related = new Set(fact.related);
  for (const dependency of new Set(fact.dependsOn)) {
    if (related.has(dependency)) {
      addError(
        fact,
        'depends_on',
        'relation-overlap',
        `Reference ${dependency} must not appear in both depends_on and related.`,
        context,
      );
    }
  }
}

function validateDuplicateReferences(fact, field, references, context) {
  const seen = new Set();
  for (const reference of references) {
    if (seen.has(reference)) {
      addError(
        fact,
        field,
        'duplicate-reference',
        `Field ${field} must not repeat reference ${reference}.`,
        context,
      );
    }
    seen.add(reference);
  }
}

function validateRelations(fact, index, context) {
  validateDependencies(fact, index, context);
  validateRelated(fact, index, context);
  validateParent(fact, index, context);
}

function validateDependencies(fact, index, context) {
  for (const dependency of new Set(fact.dependsOn)) {
    if (fact.id && dependency === fact.id) {
      addError(
        fact,
        'depends_on',
        'self-dependency',
        `Dependency ${dependency} must not reference the item itself.`,
        context,
      );
      continue;
    }

    const target = resolveReference(dependency, index);
    if (target === null) {
      addError(
        fact,
        'depends_on',
        'unresolved-dependency',
        `Dependency ${dependency} does not resolve to an item in the configured ledger.`,
        context,
      );
      continue;
    }

    if (target === 'ambiguous') {
      addError(
        fact,
        'depends_on',
        'ambiguous-dependency',
        `Dependency ${dependency} resolves to more than one ledger item.`,
        context,
      );
      continue;
    }

    if (target.status === 'archived') {
      addError(
        fact,
        'depends_on',
        'archived-dependency-must-be-dispositioned',
        `Dependency ${dependency} is archived and cannot remain a live blocker; restore it or explicitly disposition the dependent.`,
        context,
      );
    } else if (target.status === 'killed'
      || (target.status === 'done' && fact.schemaVersion === 1)) {
      addError(
        fact,
        'depends_on',
        'terminal-dependency-invalid',
        `Dependency ${dependency} is terminal (${target.status}) and cannot remain live; replace it with a valid live blocker, waive it with a durable decision, or terminalize the dependent.`,
        context,
      );
    }
  }
}

function validateRelated(fact, index, context) {
  for (const related of new Set(fact.related)) {
    if (fact.id && related === fact.id) {
      addError(
        fact,
        'related',
        'self-related',
        `Related item ${related} must not reference the item itself.`,
        context,
      );
      continue;
    }

    const target = resolveReference(related, index);
    if (target === null) {
      addError(
        fact,
        'related',
        'unresolved-related',
        `Related item ${related} does not resolve to an item in the configured ledger.`,
        context,
      );
    } else if (target === 'ambiguous') {
      addError(
        fact,
        'related',
        'ambiguous-related',
        `Related item ${related} resolves to more than one ledger item.`,
        context,
      );
    }
  }
}

function validateParent(fact, index, context) {
  if (!fact.parent) {
    return;
  }

  if (fact.id && fact.parent === fact.id) {
    addError(
      fact,
      'parent',
      'self-parent',
      `Parent ${fact.parent} must not reference the item itself.`,
      context,
    );
    return;
  }

  const target = resolveReference(fact.parent, index);
  if (target === null) {
    addError(
      fact,
      'parent',
      'unresolved-parent',
      `Parent ${fact.parent} does not resolve to an item in the configured ledger.`,
      context,
    );
    return;
  }

  if (target === 'ambiguous') {
    addError(
      fact,
      'parent',
      'ambiguous-parent',
      `Parent ${fact.parent} resolves to more than one ledger item.`,
      context,
    );
    return;
  }

  if (target.kind !== 'epic') {
    addError(
      fact,
      'parent',
      'parent-must-be-epic',
      `Parent ${fact.parent} must resolve to an epic item.`,
      context,
    );
  }
}

function resolveReference(id, index) {
  const members = index.byId.get(id);
  if (!members) {
    return null;
  }
  return members.length === 1 ? members[0] : 'ambiguous';
}

function validateCycles(facts, index, relation, context) {
  const graph = new Map();
  for (const fact of facts) {
    if (!fact.id || !index.uniqueById.has(fact.id)) {
      continue;
    }

    const references = relation === 'dependency' ? fact.dependsOn : [fact.parent].filter(Boolean);
    const edges = [...new Set(references)]
      .filter((reference) => reference !== fact.id && index.uniqueById.has(reference))
      .sort(compareText);
    graph.set(fact.id, edges);
  }

  for (const component of stronglyConnectedComponents(graph)) {
    if (component.length < 2) {
      continue;
    }

    for (const id of [...component].sort(compareText)) {
      const fact = index.uniqueById.get(id);
      const field = relation === 'dependency' ? 'depends_on' : 'parent';
      const code = relation === 'dependency' ? 'dependency-cycle' : 'containment-cycle';
      const label = relation === 'dependency' ? 'Dependency' : 'Containment';
      addError(
        fact,
        field,
        code,
        `${label} cycle detected in a component of ${component.length} items; member ${id}.`,
        context,
      );
    }
  }
}

function stronglyConnectedComponents(graph) {
  const nodes = [...graph.keys()].sort(compareText);
  const reverseGraph = new Map(nodes.map((id) => [id, []]));
  for (const [id, neighbors] of graph) {
    for (const neighbor of neighbors) {
      reverseGraph.get(neighbor).push(id);
    }
  }
  for (const neighbors of reverseGraph.values()) {
    neighbors.sort(compareText);
  }

  const visited = new Set();
  const finished = [];
  for (const start of nodes) {
    if (visited.has(start)) {
      continue;
    }

    visited.add(start);
    const stack = [{ id: start, nextNeighbor: 0 }];
    while (stack.length > 0) {
      const frame = stack.at(-1);
      const neighbors = graph.get(frame.id) ?? [];
      if (frame.nextNeighbor < neighbors.length) {
        const neighbor = neighbors[frame.nextNeighbor];
        frame.nextNeighbor += 1;
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          stack.push({ id: neighbor, nextNeighbor: 0 });
        }
        continue;
      }

      finished.push(frame.id);
      stack.pop();
    }
  }

  const components = [];
  visited.clear();
  for (let index = finished.length - 1; index >= 0; index -= 1) {
    const start = finished[index];
    if (visited.has(start)) {
      continue;
    }

    const component = [];
    const stack = [start];
    visited.add(start);
    while (stack.length > 0) {
      const member = stack.pop();
      component.push(member);
      for (const neighbor of reverseGraph.get(member) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          stack.push(neighbor);
        }
      }
    }
    components.push(component);
  }

  return components;
}

function indexChildren(facts) {
  const children = new Map();
  for (const fact of facts) {
    if (!fact.parent) {
      continue;
    }
    const members = children.get(fact.parent) ?? [];
    members.push(fact);
    children.set(fact.parent, members);
  }
  return children;
}

function validateTerminalDates(fact, context) {
  if (!fact.status) {
    return;
  }

  const terminal = TERMINAL_STATES.get(fact.status);
  if (!terminal) {
    for (const field of TERMINAL_DATE_FIELDS) {
      if (hasOwn(fact.data, field)) {
        addError(
          fact,
          field,
          'terminal-date-not-allowed',
          `Status ${fact.status} forbids completed, killed, and archived.`,
          context,
        );
      }
    }
    return;
  }

  const terminalDate = inspectOptionalDate(fact, terminal.field, context);
  if (!terminalDate) {
    if (!hasOwn(fact.data, terminal.field)) {
      addError(
        fact,
        terminal.field,
        'missing-terminal-date',
        `Status ${fact.status} requires ${terminal.field} and forbids ${forbiddenTerminalFields(terminal.field).join(' and ')}.`,
        context,
      );
    }
    validateForbiddenTerminalDates(fact, terminal.field, context);
    return;
  }

  fact.terminalDate = terminalDate;
  if (fact.updated && terminalDate !== fact.updated) {
    addError(
      fact,
      terminal.field,
      'terminal-date-must-match-updated',
      `Field ${terminal.field} must equal updated for status ${fact.status}.`,
      context,
    );
  }

  validateForbiddenTerminalDates(fact, terminal.field, context);
}

function validateForbiddenTerminalDates(fact, activeField, context) {
  for (const field of forbiddenTerminalFields(activeField)) {
    if (hasOwn(fact.data, field)) {
      addError(
        fact,
        field,
        'terminal-date-conflict',
        `Status ${fact.status} forbids ${field}.`,
        context,
      );
    }
  }
}

function validateDoneDependencies(fact, context) {
  if (fact.schemaVersion === 2 || fact.status !== 'done' || !Array.isArray(fact.data.depends_on)
    || fact.data.depends_on.length === 0) {
    return;
  }

  addError(
    fact,
    'depends_on',
    'done-item-has-dependencies',
    `Done item ${fact.id ?? 'without a valid ID'} must have an empty depends_on list; resolve or explicitly disposition every dependency before completion.`,
    context,
  );
}

function forbiddenTerminalFields(activeField) {
  return TERMINAL_DATE_FIELDS.filter((field) => field !== activeField);
}

function validateDecisionRecords(fact, context) {
  if (fact.kind === 'epic' && fact.status === 'in-progress') {
    addError(
      fact,
      'status',
      'epic-in-progress-not-allowed',
      'An epic must not use the in-progress status.',
      context,
    );
  }
}

function validateTerminalDecisions(fact, context) {
  const terminal = fact.status ? TERMINAL_STATES.get(fact.status) : null;
  if (!terminal || !fact.terminalDate) {
    return;
  }

  const matching = fact.decisions.find(
    (decision) => decision.valid
      && decision.action === terminal.action
      && decision.date === fact.terminalDate,
  );

  if (!matching) {
    addError(
      fact,
      'decisions',
      'missing-matching-terminal-decision',
      `Status ${fact.status} requires an action ${terminal.action} decision dated ${fact.terminalDate}.`,
      context,
    );
    return;
  }

  fact.matchingTerminalDecision = matching;
}

function validateRollupPlacement(fact, context) {
  for (const decision of fact.decisions) {
    if (!decision.hasRollup) {
      continue;
    }

    const completionDateIsUnavailable = fact.kind === 'epic'
      && fact.status === 'done'
      && !fact.terminalDate
      && decision.action === 'complete';
    if (completionDateIsUnavailable) {
      continue;
    }

    const isMatchingEpicCompletion = fact.kind === 'epic'
      && fact.status === 'done'
      && decision === fact.matchingTerminalDecision;
    if (!isMatchingEpicCompletion) {
      addError(
        fact,
        `decisions[${decision.index}].rollup`,
        'rollup-not-allowed',
        'rollup is allowed only on the matching complete decision of a done epic.',
        context,
      );
    }
  }
}

function validateEpicRules(fact, childrenByParent, context) {
  if (fact.kind !== 'epic') {
    return;
  }

  const children = [...(fact.id ? childrenByParent.get(fact.id) ?? [] : [])]
    .sort((left, right) => compareText(left.id ?? '', right.id ?? ''));

  if (fact.status === 'done') {
    if (children.some((child) => child.status !== 'done' && child.status !== 'killed')) {
      addError(
        fact,
        'status',
        'epic-has-nonterminal-child',
        `Done epic ${fact.id ?? 'without a valid ID'} has a direct child that is not done or killed.`,
        context,
      );
    }

    validateEpicRollup(fact, children, context);
  }
}

function validateEpicRollup(fact, children, context) {
  const decision = fact.matchingTerminalDecision;
  if (!decision) {
    return;
  }

  if (!decision.hasRollup) {
    addError(
      fact,
      'decisions',
      'missing-epic-rollup',
      `Done epic ${fact.id ?? 'without a valid ID'} requires rollup evidence on its matching complete decision.`,
      context,
    );
    return;
  }

  if (!Array.isArray(decision.rollup)) {
    addError(
      fact,
      `decisions[${decision.index}].rollup`,
      'invalid-epic-rollup',
      'Epic rollup must be a YAML sequence.',
      context,
    );
    return;
  }

  const matches = decision.rollup.length === children.length
    && decision.rollup.every((entry, index) => isMatchingRollupEntry(entry, children[index]));
  if (!matches) {
    addError(
      fact,
      `decisions[${decision.index}].rollup`,
      'invalid-epic-rollup',
      `Epic ${fact.id ?? 'without a valid ID'} rollup must list each direct child once in immutable ID order with its actual terminal status.`,
      context,
    );
  }
}

function isMatchingRollupEntry(entry, child) {
  return isMapping(entry)
    && typeof entry.id === 'string'
    && typeof entry.status === 'string'
    && entry.id === child?.id
    && entry.status === child?.status
    && (entry.status === 'done' || entry.status === 'killed');
}

function validateTerminalParent(fact, index, context) {
  if (!fact.parent || !fact.status || !NON_TERMINAL_STATUSES.has(fact.status)) {
    return;
  }

  const parent = resolveReference(fact.parent, index);
  if (parent === null || parent === 'ambiguous' || parent.kind !== 'epic') {
    return;
  }

  if (parent.status === 'killed' || parent.status === 'archived') {
    addError(
      fact,
      'parent',
      'nonterminal-child-of-terminal-epic',
      `${capitalize(fact.status)} child ${fact.id ?? 'without a valid ID'} cannot remain under ${parent.status} epic ${parent.id}; terminalize or reparent the child before the epic transition.`,
      context,
    );
  }
}

export function isCalendarDate(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }

  const monthLengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= monthLengths[month - 1];
}

export function isRfc3339Utc(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(value);
  if (!match || !isCalendarDate(match[1])) {
    return false;
  }

  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4]);
  return hour <= 23 && minute <= 59 && second <= 59;
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function dateFromId(id) {
  const ulid = ULID_PATTERN.exec(id)?.[1];
  let milliseconds = 0;
  for (const character of ulid.slice(0, 10)) {
    milliseconds = (milliseconds * 32) + ULID_ALPHABET.indexOf(character);
  }
  return new Date(milliseconds).toISOString().slice(0, 10);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isMapping(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, property) {
  return Object.prototype.hasOwnProperty.call(value, property);
}

function addError(fact, field, code, message, context) {
  const error = {
    path: fact.item.path,
    field,
    code,
    message,
  };
  const key = JSON.stringify(error);
  if (!context.errorKeys.has(key)) {
    context.errorKeys.add(key);
    context.errors.push(error);
  }
}

function compareErrors(left, right) {
  return compareText(left.path, right.path)
    || compareText(left.field, right.field)
    || compareText(left.code, right.code)
    || compareText(left.message, right.message);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function capitalize(value) {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}
