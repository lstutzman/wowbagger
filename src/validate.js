export function validateLedger(ledger) {
  const errors = [...ledger.errors];

  for (const item of ledger.items) {
    validateStatus(item, errors);
  }

  errors.sort(compareErrors);

  return {
    valid: errors.length === 0,
    errors,
  };
}

function validateStatus(item, errors) {
  const { status } = item.data;
  if (typeof status === 'string' && STATUSES.has(status)) {
    return;
  }

  errors.push({
    path: item.path,
    field: 'status',
    code: 'unknown-status',
    message: `Status ${String(status)} is not one of the schema version 1 statuses.`,
  });
}

const STATUSES = new Set([
  'triage',
  'backlog',
  'in-progress',
  'done',
  'killed',
  'archived',
]);

function compareErrors(left, right) {
  return compareText(left.path, right.path)
    || compareText(left.field, right.field)
    || compareText(left.code, right.code);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
