---
schema_version: 2
id: wb_01M0Z48DEH7MVSVF01GQT6KZVM
number: 149
title: "Stress finding: parent-migrate/snooze cannot carry their own journal entries — flagless verbs desync reconcile log from HEAD permanently"
kind: task
priority: 1
status: done
created: 2026-08-26
updated: 2026-08-26
completed: 2026-08-26
provenance:
  source: "stress-run/2026-08-26/stress-run/waveB"
  recorded_at: "2026-08-26T13:30:52.755Z"
depends_on: []
related: []
tags:
  - "stress-run-2026-08-26"
decisions:
  - action: accept
    date: 2026-08-26
    summary: "Accept exploratory stress defect"
    rationale: "Reproduced against the repository source during the 257-item concurrent lifecycle run; actionable fix belongs in wowbagger."
  - action: complete
    date: 2026-08-26
    summary: "Fix defect and verify the corrected behavior."
    rationale: "The implementation now satisfies the reported contract and the current and Node 20 regression suites pass."
---

## Problem
parent-migrate and snooze reject `--auto-commit` (their only mode) yet still append to the shared claim journal. No commit ever carries the regenerated log projection, so every later `--auto-commit` call regenerates, sees drift, refuses `ledger-not-clean`, and never commits the fix. Deadlock is permanent; reverting the log to HEAD makes it worse (the next preflight re-dirties it). The only escape is committing the log forward by hand — which agents chartered away from git cannot do.

## Evidence
30 flagless parent-migrates → 60 patch-v1 journal entries → 77 subsequent refusals on an otherwise clean tree; resolved only by coordinator committing the log forward.

## Source
F-BWaveB1 headline 2, F-P-005 interaction.
