---
schema_version: 1
id: wb_01KHSK4H00VQG2VTW797VCH555
title: "Completed task with a live dependency"
kind: task
status: done
created: 2026-02-19
updated: 2026-02-20
completed: 2026-02-20
provenance:
  source: "fixture/validation-errors"
  recorded_at: "2026-02-19T12:00:00Z"
depends_on: [wb_01KH8VHVG0EFWMK0R3T2XDN5JF]
related: []
decisions:
  - action: complete
    date: 2026-02-20
    summary: "Attempt to complete blocked work."
    rationale: "This fixture isolates the non-empty dependency invariant."
---

Completion cannot imply that a live dependency was waived or replaced.
