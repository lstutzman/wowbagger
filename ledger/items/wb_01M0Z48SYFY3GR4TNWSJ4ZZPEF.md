---
schema_version: 2
id: wb_01M0Z48SYFY3GR4TNWSJ4ZZPEF
number: 164
title: "Friction: provision leaves the reconcile log uncommitted and does not say so"
kind: task
priority: 3
status: backlog
created: 2026-08-26
updated: 2026-08-26
provenance:
  source: "stress-run/2026-08-26/stress-run/setup"
  recorded_at: "2026-08-26T13:31:05.553Z"
depends_on: []
related: []
tags:
  - "stress-run-2026-08-26"
decisions:
  - action: accept
    date: 2026-08-26
    summary: "Accept exploratory stress defect"
    rationale: "Reproduced against the repository source during the 257-item concurrent lifecycle run; actionable fix belongs in wowbagger."
---

## Problem
After provision on a fresh ledger, `.wowbagger/reconcile-<ns>.md` sits dirty; the first `--auto-commit` mutation refuses `ledger-not-clean` naming it. The provision response names no changed_paths and gives no commit instruction (the refusal eventually names the path — partial mitigation). First-contact experience of the happy path starts with a refusal.

## Source
F-003 (setup smoke).
