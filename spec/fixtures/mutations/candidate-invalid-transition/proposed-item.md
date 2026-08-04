---
schema_version: 1
id: wb_01Q5PRNWG020FEXVQEXVQEXVQE
title: "Archive the fictional tidal charts"
kind: task
status: backlog
created: 2030-01-29
updated: 2030-01-31
provenance:
  source: "fixture/mutations"
  recorded_at: "2030-01-29T10:00:00Z"
depends_on: []
related: []
parent: wb_01Q5M695G020EXVQEXVQEXVQEW
decisions:
  - action: archive
    date: 2030-01-30
    summary: "Archive the fictional tidal charts."
    rationale: "The synthetic charts were closed with their survey."
  - action: restore
    date: 2030-01-31
    summary: "Restore the fictional tidal charts."
    rationale: "The isolated child restore intentionally leaves its parent archived."
---

Restoring only this child would violate terminal-parent safety.
