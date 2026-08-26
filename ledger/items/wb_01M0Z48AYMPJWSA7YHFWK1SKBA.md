---
schema_version: 2
id: wb_01M0Z48AYMPJWSA7YHFWK1SKBA
number: 146
title: "Stress finding: sibling git worktrees fence each other ledger-wide; reconciliation is repo-scoped while files are branch-scoped"
kind: task
priority: 1
status: triage
created: 2026-08-26
updated: 2026-08-26
provenance:
  source: "stress-run/2026-08-26/stress-run/waveB"
  recorded_at: "2026-08-26T13:30:50.199Z"
depends_on: []
related: []
tags:
  - "stress-run-2026-08-26"
---

## Problem
One checkout's committed mutation makes every OTHER worktree of the same repo refuse all mutations, for all items. capabilities reports `cross_worktree_coordination: false` and claim backend scope `target-item-reconciliation` ("an unrelated item mutation may proceed"), but observed behavior is whole-ledger fencing with no CLI resync path.

## Evidence (stress run 2026-08-26, 257-item scratch ledger)
- Three concurrent worktree writers: holder writes 85/86 unimpeded; non-holders 0/85 and 0/85 (228 consecutive preflight refusals in one tree).
- 90s after a certified-clean claim-verify, another worktree's commits produced 87 stale-write-detected findings — ALL for items the blocked agent never touched.
- Remediation strings assume restore/adopt of a known revision; the actual fix was a git fast-forward, which agent charters forbid.

## Repro
Two git worktrees, one repo. A commits any item via --auto-commit. B runs any mutation touching any item.

## Source findings
F-P-003, F-P-012, F-BWaveB1/B2/B3 headline rows. Feeds item #89.
