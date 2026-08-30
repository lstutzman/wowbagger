---
schema_version: 2
id: wb_01M127VNWZZ0Q58YW387RXHDWD
number: 174
title: "Recognize parent-migrate and snooze lock owners in lock diagnostics"
kind: task
priority: 3
status: in-progress
created: 2026-08-27
updated: 2026-08-30
provenance:
  source: "alpha.11-release-documentation-audit"
  recorded_at: "2026-08-27T18:45:00Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-30
    summary: "Accept lock-owner diagnostic fidelity at priority three."
    rationale: "The lock still excludes concurrent writers safely. The defect only degrades diagnosis, so it ranks below stranded recovery, runtime support, and active data-maintenance gaps."
---
## Problem

`parent-migrate` and `snooze` acquire per-item locks whose metadata names those public operations, but `validLockOwner` recognizes only `create`, `transition`, and `patch`. A concurrent writer still fails safely with exit 4 `lock-held`; only the owner details are downgraded to `owner: null` and `owner_diagnostic: invalid-shape`.

This follows the diagnostics-fidelity precedent of #170 and #171: a genuine underlying reason must not be swallowed and replaced by a useless surface diagnosis. This item is not a lock-correctness failure; mutual exclusion remains restrictive.

## Acceptance criteria

- A behavioral test holds a parent-migrate or snooze lock and proves a concurrent mutation remains refused.
- The refusal reports the real owner operation instead of `invalid-shape`.
- The accepted lock-operation vocabulary and mutation contract agree.
- Malformed and unknown operation metadata remain restrictive.

## Triage decision — 2026-08-30

Accepted into backlog at priority 3. Mutual exclusion is already correct and restrictive; only owner diagnostics lose the public `parent-migrate` or `snooze` operation and report `invalid-shape`. This is fidelity work, not a safety or availability defect.

First implementation slice: drive real parent-migrate and snooze lock contention through public commands, pin restrictive refusal plus exact owner operation, then extend the closed lock-owner vocabulary. Unknown and malformed metadata must remain restrictive.
