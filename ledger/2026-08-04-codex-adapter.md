---
schema_version: 1
id: wb_01KZ77NSW81FXZVAWQ8WT4KDCJ
title: "Deliver the Codex adapter"
kind: task
status: backlog
created: 2026-08-04
updated: 2026-08-04
provenance:
  source: "repository-backlog"
  recorded_at: "2026-08-04T20:33:09Z"
depends_on:
  - wb_01KZ77NSW8CG8NMNZ726CFKWQE
related:
  - wb_01KZ77NSW876B92APQN8Q8NK6X
parent: wb_01KZ77NSW8PNA4S48NYT26AGMH
decisions:
  - action: accept
    date: 2026-08-04
    summary: "A Codex adapter is accepted as standalone integration work."
    rationale: "Codex is an initial compatibility target and must use the same core contract as other adapters."
---

Build a thin Codex integration that invokes the common core contract and passes
the shared black-box compatibility evidence.
