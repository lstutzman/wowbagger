---
schema_version: 2
id: wb_01M0Z48HJD3R9649ZFF0NKWKGZ
number: 154
title: "Stress finding: auto-commit-preflight-failed buckets four causes with opposite retry semantics behind one code"
kind: task
priority: 2
status: in-progress
created: 2026-08-26
updated: 2026-08-26
provenance:
  source: "stress-run/2026-08-26/stress-run/waveA"
  recorded_at: "2026-08-26T13:30:56.975Z"
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
`auto-commit-preflight-failed` covers: mutex-held (transient — retry succeeds), claim-state-unreconciled / ledger-not-clean / staged-paths-present (permanent without git). Retriability is discoverable ONLY by string-matching nested `error.details.reason`; there is no retryable/transient flag anywhere in contract_version 5. Clients classifying on error.code silently drop writes — observed ~30-50% first-attempt loss at 6 concurrent writers, and two independent stress drivers did exactly this on pass 1.

## Evidence
WaveA across 6 writers: 44+27+25+24+5 mutex-held refusals; 7-16% of items exhausted a 4-attempt backoff ladder per lane under sustained contention; the mutex never queues (fails fast ~85-190ms) and create exposes no wait/retry option.

## Source
F-AAuth-V2/V5, F-AWaveA2-200, F-AWaveA3-3/-4, F-AWaveA4-2, F-AWaveA6-1/-2, F-BWaveB1.
