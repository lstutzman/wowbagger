---
schema_version: 2
id: wb_01KZ77NSW8CG8NMNZ726CFKWQE
number: 6
title: "Define the harness-neutral adapter contract"
kind: task
status: done
created: 2026-08-04
updated: 2026-08-05
completed: 2026-08-05
provenance:
  source: "repository-backlog"
  recorded_at: "2026-08-04T20:33:09Z"
depends_on: []
related: []
parent: wb_01KZ77NSW8PNA4S48NYT26AGMH
decisions:
  - action: accept
    date: 2026-08-04
    summary: "The portable adapter contract is accepted for parallel design work."
    rationale: "Wowbagger must remain harness-neutral while supporting multiple tool-capable agent hosts."
  - action: complete
    date: 2026-08-05
    summary: "Complete the harness-neutral adapter contract."
    rationale: "ADR 0005, the normative adapter contract, fifteen synthetic conformance vectors with 183 independently executed assertions, and a strict raw-byte invoke reference runner preserve the core CLI boundary, exact version-1 negotiation and core capability probing, fail-closed instruction and handoff carriers, request and process bounds, complete outer envelopes, hash-bound artifact use, mandatory stable snapshot identities, safe mutation recovery, consumer-only approval, package-root entrypoints, cross-platform path and process containment, canonical item identity, and explicit authority limits; all 171 standalone tests pass."
---

Define the small public tool and capability contract shared by all adapters.
Distinguish model API transport from the filesystem and command capabilities
that a host actually supplies. This is contract work, not an implementation of
any harness adapter.
