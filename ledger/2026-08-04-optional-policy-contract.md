---
schema_version: 1
id: wb_01KZ77NSW8A25Q593G7RTX7TAH
title: "Define the optional policy-input contract"
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
    summary: "Optional policy-input work is accepted."
    rationale: "The standalone v0 plan keeps consumer ranking and enrichment separate from core readiness."
---

Specify how optional consumer policy may rank or decorate valid core readiness
without changing ledger validity or core selection. This is not a place to add
consumer-specific policy.
