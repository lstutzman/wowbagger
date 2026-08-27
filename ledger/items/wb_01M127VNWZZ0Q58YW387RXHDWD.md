---
schema_version: 2
id: wb_01M127VNWZZ0Q58YW387RXHDWD
number: 174
title: "Recognize parent-migrate and snooze lock owners in lock diagnostics"
kind: task
priority: 2
status: triage
created: 2026-08-27
updated: 2026-08-27
provenance:
  source: "alpha.11-release-documentation-audit"
  recorded_at: "2026-08-27T18:45:00Z"
depends_on: []
related: []
---
## Problem

`parent-migrate` and `snooze` acquire per-item locks whose metadata names those public operations, but `validLockOwner` recognizes only `create`, `transition`, and `patch`. A concurrent writer still fails safely with exit 4 `lock-held`; only the owner details are downgraded to `owner: null` and `owner_diagnostic: invalid-shape`.

This follows the diagnostics-fidelity precedent of #170 and #171: a genuine underlying reason must not be swallowed and replaced by a useless surface diagnosis. This item is not a lock-correctness failure; mutual exclusion remains restrictive.

## Acceptance criteria

- A behavioral test holds a parent-migrate or snooze lock and proves a concurrent mutation remains refused.
- The refusal reports the real owner operation instead of `invalid-shape`.
- The accepted lock-operation vocabulary and mutation contract agree.
- Malformed and unknown operation metadata remain restrictive.
