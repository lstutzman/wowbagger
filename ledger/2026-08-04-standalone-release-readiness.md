---
schema_version: 1
id: wb_01KZ77NSW8R8C26CEJPJKHVPBT
title: "Prepare a versioned standalone Wowbagger release"
kind: task
status: backlog
created: 2026-08-04
updated: 2026-08-06
provenance:
  source: "repository-backlog"
  recorded_at: "2026-08-04T20:33:09Z"
depends_on:
  - wb_01KZ77NSW8CXZRZ8JH2ADYZWH3
  - wb_01KZ77NSW8TWW2KWJANZ2TC837
related: []
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
decisions:
  - action: accept
    date: 2026-08-04
    summary: "Standalone release readiness is accepted as the final v0 delivery step."
    rationale: "Consumer adoption must wait for a versioned standalone release with compatibility evidence."
  - action: reparent
    date: 2026-08-06
    summary: "Moved from the standalone v0 epic to the productization epic."
    rationale: "This is consumability work, not core work. Separating them lets the v0 epic close when the core is done instead of dragging distribution along with it."
---

Produce and verify the first versioned standalone release only after the
required mutation, recovery, adapter, packaging, and compatibility evidence is
complete.
