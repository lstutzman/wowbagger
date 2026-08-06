---
schema_version: 1
id: wb_01KZ77NSW8ZP1289HFMN2ECNXD
title: "Deliver the Claude Code adapter"
kind: task
status: backlog
created: 2026-08-04
updated: 2026-08-06
provenance:
  source: "repository-backlog"
  recorded_at: "2026-08-04T20:33:09Z"
depends_on: []
related:
  - wb_01KZ77NSW876B92APQN8Q8NK6X
  - wb_01KZ77NSW8CG8NMNZ726CFKWQE
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
decisions:
  - action: accept
    date: 2026-08-04
    summary: "A Claude Code adapter is accepted as standalone integration work."
    rationale: "Claude Code is an initial compatibility target, but it must remain an adapter rather than the core architecture."
  - action: reparent
    date: 2026-08-06
    summary: "Moved from the standalone v0 epic to the productization epic."
    rationale: "This is consumability work, not core work. Separating them lets the v0 epic close when the core is done instead of dragging distribution along with it."
---

Build a thin Claude Code integration that invokes the common core contract and
passes the shared black-box compatibility evidence.
