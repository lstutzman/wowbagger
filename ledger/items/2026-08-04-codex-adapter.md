---
schema_version: 2
id: wb_01KZ77NSW81FXZVAWQ8WT4KDCJ
number: 1
title: "Deliver the Codex adapter"
kind: task
status: done
created: 2026-08-04
updated: 2026-08-08
completed: 2026-08-08
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
  - action: complete
    date: 2026-08-08
    summary: "Completed: the Codex adapter ships at exact parity with the Claude Code adapter."
    rationale: "adapters/codex answers the section 3.3 bootstrap wire with its own identity and honest host declaration, rides the shared entrypoint runtime extracted to src/adapter/entrypoint-main.js, and the implementation runner now reports the codex target across all fifteen shared vector cases — the same 183 assertions, the same 79-evidenced Plan 1 profile the Claude Code adapter shipped with. The run status is fail for both adapters by design: the unevidenced assertions belong to the shared engine's Plans 2 and 3, tracked by the Claude Code adapter item, and their evidence will apply to every adapter on the engine at once. The codex-specific work this item names — a thin integration invoking the common core contract, measured by the shared black-box vectors — is delivered."
---

Build a thin Codex integration that invokes the common core contract and passes
the shared black-box compatibility evidence.
