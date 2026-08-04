---
schema_version: 1
id: wb_01KZ77NSW8825RKWA4AHJKN2YX
title: "Define and implement the work-claim protocol"
kind: task
status: backlog
created: 2026-08-04
updated: 2026-08-04
provenance:
  source: "repository-backlog"
  recorded_at: "2026-08-04T20:33:09Z"
depends_on:
  - wb_01KZ77NSW876B92APQN8Q8NK6X
related: []
parent: wb_01KZ77NSW8PNA4S48NYT26AGMH
decisions:
  - action: accept
    date: 2026-08-04
    summary: "A separate work-claim protocol is accepted for follow-on design and implementation."
    rationale: "The standalone v0 plan explicitly defers claims until mutation support and a dedicated claim contract exist."
---

Define the portable claim envelope, expiration or resolution rules, and
fail-closed behaviour before implementing claim storage. Do not treat a claim
as a substitute for ledger mutation safety.
