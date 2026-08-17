---
schema_version: 2
id: wb_01KZA1V3HN29SK5BS0P7RHS96R
number: 14
title: "Define the consumer configuration layer"
kind: task
status: done
created: 2026-08-05
updated: 2026-08-08
completed: 2026-08-08
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
  - action: complete
    date: 2026-08-08
    summary: "Completed: docs/consumer-configuration.md defines the binding seam — explicit, minimal, semantics never configurable."
    rationale: "Version 1 has exactly one consumer binding: the ledger directory, stated explicitly on every invocation. The contract explains why the core reads no consumer configuration file — an obeyed discovery file is the same hazard class as an arbitrary create path — and routes every other configuration concern to its owning surface: naming to Git renames, branch policy out of core permanently, branding to consumer views, ranking to the policy-input contract, per-repository instructions to the skill. Absence fails closed with no defaulting or upward walk; validity and selection semantics are declared permanently non-configurable. A reopen trigger names the constrained config-file shape if invocation friction ever demands one, ADR-first per ADR-0006."
---

A consuming repository must supply its own paths, branch names, and
branding to the core without forking it. Specify that configuration seam:
what a consumer declares, where the core reads it from, what happens when it
is absent, and which values the core refuses to accept because they would
change ledger validity or core selection.

This is the portability precondition for any repository other than the one
the core was developed in.
