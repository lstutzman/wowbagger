---
schema_version: 2
id: wb_01M0Z48FXW33933XZ1SE2WVT5R
number: 152
title: "Stress finding: reconciliation block is clone-global, contradicting the contract's item-scoped wording"
kind: task
priority: 1
status: backlog
created: 2026-08-26
updated: 2026-08-26
provenance:
  source: "stress-run/2026-08-26/stress-run/waveC"
  recorded_at: "2026-08-26T13:30:55.295Z"
depends_on: []
related: []
tags:
  - "stress-run-2026-08-26"
decisions:
  - action: accept
    date: 2026-08-26
    summary: "Accept exploratory stress defect"
    rationale: "Reproduced against the repository source during the 257-item concurrent lifecycle run; actionable fix belongs in wowbagger."
---

## Problem
work-claim-contract §3.1: "a recorded private write blocks mutations targeting that item, not unrelated item mutations." Observed in a clone: ONE uncommitted legacy patch refused every mutating command clone-wide, including publish-claimed targeting unrelated items. Section 7's unconditional wording matches the implementation; §3.1 does not. Contract self-contradiction with global blast radius.

## Asymmetry
Uncommitted CLAIMED publications produce NO blocking finding at all (claim-verify exit 0), while one uncommitted legacy patch blocks everything.

## Source
F-CWaveCG nonconforming findings 1-2, work-claim-contract §3.1 vs §7.
