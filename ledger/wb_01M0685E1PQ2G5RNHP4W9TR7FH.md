---
schema_version: 2
id: wb_01M0685E1PQ2G5RNHP4W9TR7FH
number: 109
title: "Name an undelivered core input instead of timing out"
kind: task
priority: 10
status: backlog
created: 2026-08-16
updated: 2026-08-16
provenance:
  source: "maintainer-dogfood"
  recorded_at: "2026-08-16T21:38:08Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-16
    summary: "Accept into the backlog."
    rationale: "From the #106 EPIPE fix: a diagnosable condition currently reports as timed_out."
---

Follow-up from item #106's EPIPE fix: `launchCoreProcess` now swallows a failed write to the core child's stdin. When the core exits fast that is correct (its real exit code is the story). But when the core is ALIVE and the write genuinely fails, the run reports `timed_out` after 30 seconds instead of "the input never reached the core" - a diagnosable condition reported as an unobservable one.

Making the distinction visible means a new member on the launch observation, which is adapter-contract surface: decide the shape (e.g. `input_delivery: "delivered" | "failed" | "unread"`), version-note it in docs/adapter-contract.md (investigate whether it is additive within adapter contract 2 the way #97's change was, or needs a bump), mirror in the oracle, pin with a conformance vector, mutation-guard both directions.

Acceptance:
- A fixture distinguishes "core exited before reading" (real exit forwarded, as today) from "core alive, input undelivered" (named, not timed_out).
- Version decision recorded with evidence; oracle and engine agree both directions.
- Gate green on both runtimes.
