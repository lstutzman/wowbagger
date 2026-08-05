---
schema_version: 1
id: wb_01KZ77NSW8ZP1289HFMN2ECNXD
title: "Deliver the Claude Code adapter"
kind: task
status: backlog
created: 2026-08-04
updated: 2026-08-05
provenance:
  source: "repository-backlog"
  recorded_at: "2026-08-04T20:33:09Z"
depends_on: []
related:
  - wb_01KZ77NSW876B92APQN8Q8NK6X
  - wb_01KZ77NSW8CG8NMNZ726CFKWQE
parent: wb_01KZ77NSW8PNA4S48NYT26AGMH
decisions:
  - action: accept
    date: 2026-08-04
    summary: "A Claude Code adapter is accepted as standalone integration work."
    rationale: "Claude Code is an initial compatibility target, but it must remain an adapter rather than the core architecture."
---

Build a thin Claude Code integration that invokes the common core contract and
passes the shared black-box compatibility evidence.
