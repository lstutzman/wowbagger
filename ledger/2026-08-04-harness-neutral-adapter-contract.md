---
schema_version: 1
id: wb_01KZ77NSW8CG8NMNZ726CFKWQE
title: "Define the harness-neutral adapter contract"
kind: task
status: in-progress
created: 2026-08-04
updated: 2026-08-05
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
---

Define the small public tool and capability contract shared by all adapters.
Distinguish model API transport from the filesystem and command capabilities
that a host actually supplies. This is contract work, not an implementation of
any harness adapter.
