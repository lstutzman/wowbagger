---
schema_version: 2
id: wb_01M0Z48M2HEEM5BFJBWZCDMRFS
number: 157
title: "Stress finding: preflight refusal drops the findings it already computed"
kind: task
priority: 2
status: killed
created: 2026-08-26
updated: 2026-08-26
killed: 2026-08-26
provenance:
  source: "stress-run/2026-08-26/stress-run/waveB"
  recorded_at: "2026-08-26T13:30:59.539Z"
depends_on: []
related: []
tags:
  - "stress-run-2026-08-26"
decisions:
  - action: accept
    date: 2026-08-26
    summary: "Accept exploratory stress defect"
    rationale: "Reproduced against the repository source during the 257-item concurrent lifecycle run; actionable fix belongs in wowbagger."
  - action: kill
    date: 2026-08-26
    summary: "Close as not reproducible against the corrected preflight path."
    rationale: "The preflight matrix carries computed findings through its refusal envelope, and the current regression suite passes; the stress observation is superseded by the target-scoped reconciliation fix."
---

## Problem
First refusal after a certified-clean state returned `reason: claim-state-unreconciled` with `findings: []` — no item, no remediation — while a simultaneous claim-verify returned 87 concrete stale-write-detected findings naming items and revisions. The information existed and was omitted from the mutating path's envelope, forcing an extra round-trip to learn what to fix.

## Source
F-P-011, F-BWaveB3 (findings-empty refusal row).
