# Synthetic black-box fixtures

These fixtures are intentionally fictional. They exercise ledger behaviour
without importing a consumer's source paths, policies, people, products, or
backlog data.

Each fixture declares its expected result instead of an implementation detail.
The standalone core satisfies the result through its public command interfaces.

- ready-selection is a valid ledger evaluated at a fixed date.
- validation-errors is an invalid ledger whose errors demonstrate fail-closed
  validation, stable error reporting, and one repair target per affected item.
- mutations is an executable black-box mutation-contract vector suite for
  local capabilities, inspection revisions, creation, single-item transition,
  stale writes, locks, and multi-item refusal.

All fixture items include portable structured provenance and canonical IDs whose
embedded UTC timestamp date matches created. The ready fixture has 16 valid
items and proves the exact minimal ready result, creation-order selection,
snooze equality, backlog-versus-triage ancestor readiness, matching terminal
decisions, and a valid epic rollup. The invalid fixture has 24 items and 19
expected errors covering duplicate identities, stale killed and archived
prerequisites, dependency and containment cycles, self-parents, invalid parents,
done tasks and epics with dependencies, live children under terminal epics,
mismatched terminal decisions, and terminal-date invariants.
