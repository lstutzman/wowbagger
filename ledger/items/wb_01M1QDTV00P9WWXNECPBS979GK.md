---
schema_version: 2
id: wb_01M1QDTV00P9WWXNECPBS979GK
number: 209
title: "Reject prospective adoption revision cycles"
kind: task
priority: 10
status: backlog
created: 2026-09-05
updated: 2026-09-05
provenance:
  source: "PropertyCompass2 defect digest #200 heading 25 item 1476 cycle guard"
  recorded_at: "2026-09-05T16:59:00Z"
depends_on: []
related: [ wb_01M0N3KM316P7MBJTA1A5X29J4, wb_01M0MY9NE61SATX6EHFZS99WH0 ]
tags:
  - "consumer-feedback"
  - "propertycompass2"
  - "defect-digest-200"
decisions:
  - action: accept
    date: 2026-09-05
    summary: "Accept prospective adoption cycle prevention."
    rationale: "Directional adoption history must reject new cycles without rewriting the accepted #1476 history."
---

## Problem

Adoption validation rejects two targets for the same source revision, but it does not reject a prospective cycle such as revision A to B followed later by B to A. Cyclic history destroys the directional meaning of adoption even when current item bytes remain valid.

## Accepted evidence boundary

Property Compass item #1476 already contains seq 3309 (`71e8ced9` to `3f0f6415`) and seq 3477 (`3f0f6415` to `71e8ced9`). Lee accepted those historical bytes and rows as-is. This item applies prospectively only and must not rewrite, delete, or repair that cycle.

## Acceptance criteria

- New adoption and claim-sync candidates are rejected when adding their directed revision edge would create a cycle for one item.
- The refusal identifies the proposed edge and the existing path that closes the cycle.
- Existing committed cycles remain readable and diagnosable; no migration rewrites accepted history.
- Prospective validation runs before journal or reconcile-log mutation and leaves all bytes unchanged on refusal.
- Tests cover direct two-edge cycles, longer cycles, unrelated item revisions, and an acyclic chain.
