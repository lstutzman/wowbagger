---
schema_version: 1
id: wb_01KZBNMT2G2RTSEAGCH6PYFGWC
title: "Return contract exits when the claim store cannot be written or read"
kind: task
status: backlog
created: 2026-08-06
updated: 2026-08-06
provenance:
  source: "final-review-fix-wave"
  recorded_at: "2026-08-06T00:00:00Z"
depends_on: []
related: [ wb_01KZAZW75CWEG3R4BH4MZJAA7G ]
parent: wb_01KZ77NSW8PNA4S48NYT26AGMH
decisions:
  - action: accept
    date: 2026-08-06
    summary: "Groom into backlog from the final-review fix wave."
    rationale: "Deferred Important finding from the whole-branch review of feature/advisory-work-claims; filed as a durable ledger item rather than left in progress.md."
---
The contract names `clock-floor-persistence-failed` (exit 6) but the string appears nowhere in `src/`. A `writeClaimState` failure (ENOSPC, EROFS, EACCES) or a corrupted store file (`JSON.parse` throws a `SyntaxError` with no `.code`, so the ENOENT guard misses it) escapes as exit 1 with a bare stderr line and no envelope. Exit 1 is not in the contract's documented set {0, 2, 4, 6}.

The safety property still holds: `writeClaimState` is awaited before any lease decision is reported, and the lock is released in the `finally`. No lease decision is ever reported whose time was not persisted. This is an envelope/exit-code gap, not a correctness one.

Fix: wrap the locked section so a non-`CLAIM_LOCK_HELD` throw becomes exit 6 -- `clock-floor-persistence-failed` for a `writeClaimState` failure, `claim-store-unavailable` with `details.reason: "claim-store-unreadable"` for a parse/read failure.

Source: final whole-branch review of feature/advisory-work-claims, Important #1 (`.superpowers/sdd/2026-08-06-advisory-work-claims/final-review.md`).