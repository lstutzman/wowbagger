---
schema_version: 2
id: wb_01M0Z48F3EBMZE1MPKB8QF3JY5
number: 151
title: "Stress finding: commit-per-mutation invariant unenforced in a fresh clone — legacy transitions and publish-claimed stack dozens of unreconciled writes"
kind: task
priority: 1
status: killed
created: 2026-08-26
updated: 2026-08-26
killed: 2026-08-26
provenance:
  source: "stress-run/2026-08-26/stress-run/waveC"
  recorded_at: "2026-08-26T13:30:54.448Z"
depends_on: []
related: []
tags:
  - "stress-run-2026-08-26"
decisions:
  - action: accept
    date: 2026-08-26
    summary: "Accept exploratory stress defect"
    rationale: "Reproduced against the repository source during the 257-item concurrent lifecycle run; actionable fix belongs in wowbagger."
  - action: kill
    date: 2026-08-26
    summary: "Close: contract already distinguishes publication and Git finalization"
    rationale: "The work-claim contract and existing claim-verify tests intentionally report durable publication state separately from result.publications.git_finalized; an uncommitted publication is not itself a claim-verify error."
---

## Problem
work-claim-contract section 1 binds publish-claimed to commit-per-mutation. In a fresh clone (empty local journal): 24 consecutive uncommitted mutating transitions, zero exit-6 publication-reconciliation-required; stacked publish → claim-verify exit 0 findings [] → second publish same item → exit 0 → legacy patch → first refusal came from the LEGACY patch, not either publication. 24 of 27 publications finished git_finalized:false with claim-verify clean. The invariant exists only where the journal has records; a clone hollows it out.

## Source
F-CWaveCE-2/-3, F-CWaveCF structural finding 1, F-CWaveCG nonconforming 1.
