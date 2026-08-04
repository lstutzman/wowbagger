# Synthetic black-box fixtures

These fixtures are intentionally fictional. They exercise ledger behaviour
without importing a consumer's source paths, policies, people, products, or
backlog data.

Each fixture declares its expected result instead of an implementation detail.
A future core implementation must satisfy the result through its public
validate and ready interfaces.

- ready-selection is a valid ledger evaluated at a fixed date.
- validation-errors is an invalid ledger whose errors demonstrate fail-closed
  validation, stable error reporting, and one repair target per affected item.

All fixture items include portable structured provenance and canonical IDs whose
embedded UTC timestamp date matches created. The ready fixture proves core
creation-order selection, including snooze equality. The invalid fixture covers
duplicate identities, stale killed and archived prerequisites, cycles, invalid
parents, and terminal-date invariants.
