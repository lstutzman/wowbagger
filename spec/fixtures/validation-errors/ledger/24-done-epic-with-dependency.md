---
schema_version: 1
id: wb_01KJE6A900SRTMTER3CN7Y50SX
title: "Completed epic with a live dependency"
kind: epic
status: done
created: 2026-02-27
updated: 2026-02-28
completed: 2026-02-28
provenance:
  source: "fixture/validation-errors"
  recorded_at: "2026-02-27T12:00:00Z"
depends_on: [wb_01KH8VHVG0EFWMK0R3T2XDN5JF]
related: []
decisions:
  - action: complete
    date: 2026-02-28
    summary: "Attempt to roll up a blocked epic."
    rationale: "There are no direct children, but the epic still has a live dependency."
    rollup: []
---

The rollup evidence is complete, but the live dependency forbids done state.
