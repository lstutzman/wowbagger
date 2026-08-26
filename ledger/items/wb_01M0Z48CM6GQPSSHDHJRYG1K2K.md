---
schema_version: 2
id: wb_01M0Z48CM6GQPSSHDHJRYG1K2K
number: 148
title: "Stress finding: refused mutation writes a tracked file while claiming state \"unchanged\"; retry then blames that self-written file"
kind: task
priority: 1
status: triage
created: 2026-08-26
updated: 2026-08-26
provenance:
  source: "stress-run/2026-08-26/stress-run/waveB"
  recorded_at: "2026-08-26T13:30:51.912Z"
depends_on: []
related: []
tags:
  - "stress-run-2026-08-26"
---

## Problem
The first preflight refusal (`claim-state-unreconciled`) rewrites tracked `.wowbagger/reconcile-<ns>.md` BEFORE returning `state:"unchanged"` — the working tree changed though the envelope says unchanged. Every later attempt fails with a DIFFERENT reason, `ledger-not-clean`, naming the tool's own artifact; the real cause disappears from the envelope. No client can clear it without git.

## Source
`src/git-autocommit.js`: verifyClaimJournal writes at :147-156 and returns preflightFailed at :148-153; success path tolerates its own log at :161 (`journalOwned && entry === logPath`) but the attempt-1 dirty check at :129-130 has no such tolerance.

## Evidence
WaveB1 preserved artifact: /tmp copy journalled; wt-b saw 77 ledger-not-clean refusals after one real refusal; WaveB2 measured its journal copy grow 2902→11101 bytes during its own failed run.

## Source
F-P-004, F-BWaveB1-9, F-BWaveB2-4, F-AAuth analysis.
