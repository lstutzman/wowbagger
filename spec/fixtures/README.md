# Synthetic black-box fixtures

These fixtures are intentionally fictional. They exercise ledger behaviour
without importing a consumer's source paths, policies, people, products, or
backlog data.

Each fixture declares its expected result instead of an implementation detail.
A future core implementation must satisfy the result through its public
validate and ready interfaces.

- ready-selection is a valid ledger evaluated at a fixed date.
- validation-errors is an invalid ledger whose errors demonstrate fail-closed
  validation and stable error reporting.
