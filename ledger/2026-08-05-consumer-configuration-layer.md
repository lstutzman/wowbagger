---
schema_version: 1
id: wb_01KZA1V3HN29SK5BS0P7RHS96R
priority: 30
number: 14
title: "Define the consumer configuration layer"
kind: task
status: backlog
created: 2026-08-05
updated: 2026-08-08
provenance:
  source: "repository-backlog"
  recorded_at: "2026-08-05T22:48:54Z"
depends_on: []
related: []
parent: wb_01KZ77NSW8PNA4S48NYT26AGMH
decisions:
  - action: accept
    date: 2026-08-05
    summary: "Accept the consumer configuration layer."
    rationale: "The configuration seam is the portability precondition for any consuming repository."
  - action: record
    date: 2026-08-08
    summary: "Rank the consumer configuration layer at 30."
    rationale: "Every consumer so far has invoked the binary by path. A configuration layer is worth designing once two consumers disagree about what it should hold."
---

A consuming repository must supply its own paths, branch names, and
branding to the core without forking it. Specify that configuration seam:
what a consumer declares, where the core reads it from, what happens when it
is absent, and which values the core refuses to accept because they would
change ledger validity or core selection.

This is the portability precondition for any repository other than the one
the core was developed in.
