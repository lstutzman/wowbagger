---
schema_version: 2
id: wb_01M0Z48QDRTVA099BJX6SVZRBT
number: 161
title: "Stress finding: ready and validate emit bare envelopes, breaking dispatch-by-envelope"
kind: task
priority: 3
status: backlog
created: 2026-08-26
updated: 2026-08-26
provenance:
  source: "stress-run/2026-08-26/stress-run/waveA"
  recorded_at: "2026-08-26T13:31:02.970Z"
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
Every command emits `{ok,command,contract_version,result|error,…}` except validate (`{"valid":true,"errors":[]}`) and ready (`{"as_of":"…","valid":true,"ready":[]}`). Mutation-contract §2's dispatch rule (namespace-first, then domain version field) cannot be applied. Adjacent to item #92's envelope-unification scope; filing adds the ready shape as another instance with concrete consumer breakage from the stress run drivers.

## Source
F-AWaveA3-5, F-P-001.
