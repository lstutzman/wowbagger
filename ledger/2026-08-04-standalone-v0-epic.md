---
schema_version: 1
id: wb_01KZ77NSW8PNA4S48NYT26AGMH
number: 9
title: "Deliver standalone Wowbagger v0"
kind: epic
status: backlog
created: 2026-08-04
updated: 2026-08-06
provenance:
  source: "repository-backlog"
  recorded_at: "2026-08-04T20:33:09Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-04
    summary: "The remaining standalone v0 work is accepted for this repository."
    rationale: "The repository now uses its own ledger to coordinate the work described in the standalone v0 plan."
  - action: record
    date: 2026-08-05
    summary: "PropertyCompass2 backlog item 1419 describes this same epic and is superseded here."
    rationale: "The portable-tool extraction epic is tracked once, in this ledger, so wowbagger work has a single source."
  - action: record
    date: 2026-08-06
    summary: "This epic gates dogfooding: wowbagger cannot drive work from this repository until its children are complete."
    rationale: "Tracking this repository's own backlog here is the shallow sense of dogfooding and already works. Driving work from wowbagger needs claims implemented, concurrency proven, the consumer configuration and policy seams defined, packaging shipped, and at least one harness adapter delivered."
---

This epic contains only standalone Wowbagger work. It intentionally excludes
PropertyCompass adoption and any other consumer migration.
