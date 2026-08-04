---
schema_version: 1
id: wb_01KZ77NSW876B92APQN8Q8NK6X
title: "Implement the standalone mutation runtime"
kind: task
status: done
created: 2026-08-04
updated: 2026-08-04
completed: 2026-08-04
provenance:
  source: "repository-backlog"
  recorded_at: "2026-08-04T20:33:09Z"
depends_on: []
related:
  - wb_01KZ77NSW8P89118K6D6FSBFX2
parent: wb_01KZ77NSW8PNA4S48NYT26AGMH
decisions:
  - action: accept
    date: 2026-08-04
    summary: "Standalone mutation-runtime implementation is accepted."
    rationale: "The v0 plan schedules runtime work after its reviewed mutation contract."
  - action: complete
    date: 2026-08-04
    summary: "Complete the standalone mutation runtime."
    rationale: "The local capabilities, inspect, create, and guarded single-item transition commands are implemented; all 33 exact mutation manifests and the 83-test standalone suite pass."
---

Implement only the approved standalone creation and lifecycle-mutation
behaviour. Do not add a consumer integration as part of this work.
