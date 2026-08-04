---
schema_version: 1
id: wb_01KJ91GV0068WKA36EZRT09RVR
title: "Killed task with an unrelated decision"
kind: task
status: killed
created: 2026-02-25
updated: 2026-02-26
killed: 2026-02-26
provenance:
  source: "fixture/validation-errors"
  recorded_at: "2026-02-25T12:00:00Z"
depends_on: []
related: []
decisions:
  - action: archive
    date: 2026-02-26
    summary: "Record an unrelated archive decision."
    rationale: "This action does not provide evidence for the killed state."
---

A same-date decision with the wrong action cannot justify a terminal state.
