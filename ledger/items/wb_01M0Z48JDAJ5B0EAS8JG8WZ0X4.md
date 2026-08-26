---
schema_version: 2
id: wb_01M0Z48JDAJ5B0EAS8JG8WZ0X4
number: 155
title: "Stress finding: transition can report failure after committing (post-commit-reconciliation-failed false negative)"
kind: task
priority: 2
status: killed
created: 2026-08-26
updated: 2026-08-26
killed: 2026-08-26
provenance:
  source: "stress-run/2026-08-26/stress-run/waveB"
  recorded_at: "2026-08-26T13:30:57.836Z"
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
    summary: "Close: current response already preserves committed state"
    rationale: "Current coreShape.reconciliationFailed returns state committed, and auto-commit-failures.test.js pins the post-commit reconciliation envelope. Stress report misread the existing contract."
---

## Problem
Accept on item #9 returned ok:false, exit 6, `post-commit-reconciliation-failed / claim-verify-refused` — but the mutation definitively landed (status backlog, decision recorded, later claim-verify clean). The envelope does not carry the truthful state:'committed' on this path. Under any response-loss discipline this is a double-apply trap: the caller cannot distinguish "failed" from "committed-but-cleanup-pending".

## Source
F-P-010, F-BWaveB1 (#9 case).
