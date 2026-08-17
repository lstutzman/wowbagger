---
schema_version: 2
id: wb_01KZ77NSW8P89118K6D6FSBFX2
number: 8
title: "Complete the mutation and compare-and-set contract"
kind: task
status: done
created: 2026-08-04
updated: 2026-08-04
completed: 2026-08-04
provenance:
  source: "repository-backlog"
  recorded_at: "2026-08-04T20:33:09Z"
depends_on: []
related: []
parent: wb_01KZ77NSW8PNA4S48NYT26AGMH
decisions:
  - action: accept
    date: 2026-08-04
    summary: "Mutation and compare-and-set design work is accepted."
    rationale: "The standalone v0 plan requires an explicit contract before mutable coordination can be implemented."
  - action: record
    date: 2026-08-04
    summary: "The mutation and compare-and-set contract is under active review."
    rationale: "Its draft is being worked on separately and is not yet canonical in main."
  - action: complete
    date: 2026-08-04
    summary: "Complete the standalone mutation and compare-and-set contract."
    rationale: "The proposed contract, ADR, and synthetic compatibility suite now define lossless inspection, caller-known creation, guarded transitions, deterministic refusal and recovery outcomes, and honest local coordination limits; 33 exact manifests and all 35 read-only core tests pass."
---

Finish reviewing and merge the standalone mutation and compare-and-set contract
before beginning mutation-runtime implementation. This item does not make any
unmerged contract content normative.
