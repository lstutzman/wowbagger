---
schema_version: 2
id: wb_01M05N0V016SAVW2RCS1652YXN
number: 107
title: "Collapse publish-claimed's redundant complete-ledger loads"
kind: task
priority: 20
status: in-progress
created: 2026-08-16
updated: 2026-08-16
provenance:
  source: "maintainer-dogfood"
  recorded_at: "2026-08-16T16:03:35Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-16
    summary: "Accept into the backlog."
    rationale: "Same collapse as #100 with the same safety argument; measure first."
---

Follow-up from item #100 (which collapsed the legacy mutation path from 3 complete-ledger loads to 2): `publish-claimed` still reads the complete ledger three times — once in validateCandidateLedger, then the mutation engine's two — and four when a pending intent forces reconciliation first. NOTE: this count was read from call sites by #100's worker, not measured; measure first with the ledgerLoadCount() observability export #100 added.

Scope:
1. Extend bench/mutation-latency.bench.js with a publish-claimed measurement on the 1,500-item fixture; confirm the load count.
2. Apply the same collapse with the same safety argument: candidate validation is re-done under lock in validateSerializedCandidate, so the unlocked pre-reads can share a snapshot; the locked read stays; a lock-closure retry loads fresh (the #100 invariant tests in test/mutation-shared-snapshot.test.js are the pattern — extend them to the claimed path).
3. No validation rule weakened; the large-ledger mutation guard extended to the publish-claimed path if not already covered (it is — duplicate-number via publish-claimed — keep it biting).

Acceptance:
- Benchmark shows measured before/after load counts and wall time for publish-claimed on the same fixture.
- Snapshot-sharing invariants pinned on the claimed path (locked re-read guarded, retry-loads-fresh guarded), mutation-tested red.
- Gate green on both runtimes.
