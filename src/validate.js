export function validateLedger(ledger) {
  const errors = [...ledger.errors].sort(compareErrors);

  return {
    valid: errors.length === 0,
    errors,
  };
}

function compareErrors(left, right) {
  return compareText(left.path, right.path)
    || compareText(left.field, right.field)
    || compareText(left.code, right.code);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
