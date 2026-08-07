---
schema_version: 1
id: wb_01KZ77NSW81FXZVAWQ8WT4KDCJ
number: 1
title: "Deliver the Codex adapter"
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
    summary: "A Codex adapter is accepted as standalone integration work."
    rationale: "Codex is an initial compatibility target and must use the same core contract as other adapters."
  - action: reparent
    date: 2026-08-06
    summary: "Moved from the standalone v0 epic to the productization epic."
    rationale: "This is consumability work, not core work. Separating them lets the v0 epic close when the core is done instead of dragging distribution along with it."
---

Build a thin Codex integration that invokes the common core contract and passes
the shared black-box compatibility evidence.
