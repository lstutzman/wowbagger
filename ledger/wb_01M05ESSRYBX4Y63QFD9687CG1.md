---
schema_version: 2
id: wb_01M05ESSRYBX4Y63QFD9687CG1
number: 100
title: "Collapse the redundant complete-ledger loads per mutation"
kind: task
status: triage
created: 2026-08-16
updated: 2026-08-16
provenance:
  source: "maintainer-dogfood"
  recorded_at: "2026-08-16T14:14:52Z"
depends_on: []
related: []
---

Follow-up from item #91's profile: after the git cat-file batch fix (12.8x), the remaining ~1.2s per provisioned-ledger mutation at 1,500 items is three complete ledger loads at ~0.3s each — two in `mutateExistingItem` (before and after lock closure) and one in `reconcileClaimJournal`. Ceiling is roughly another 2x.

Constraint from #91's analysis: the second mutateExistingItem load is the read-under-lock that makes the revision compare-and-swap meaningful — it cannot simply be dropped. The reconcile load and the first mutateExistingItem load are both unlocked reads of the same directory within one command and look genuinely redundant.

Scope:
1. Collapse the redundant unlocked loads (share one snapshot between reconciliation and the pre-lock load, or thread the reconcile load's result into the mutation path). The locked re-read stays.
2. The complete-ledger safety property survives: whatever is shared must be provably the same bytes the dropped load would have read, or re-checked under lock. No validation rule weakened.
3. Extend bench/mutation-latency.bench.js attribution with before/after on the same 1,500-item fixture.

Also flagged in #91 (contract question, decide here or split): `readGitHeadLedger` reads the whole HEAD ledger to answer per-item questions keyed by item ID because the filename-to-ID mapping is convention, not guarantee. Making that mapping authoritative would let the HEAD read narrow to the items under reconciliation and drop to near zero.

Acceptance:
- Benchmark shows the load-count reduction on the same fixture with before/after numbers.
- The large-ledger mutation guard (test/large-ledger-mutation-guard.test.js) stays green; no validation rule weakened.
- Gate green on both runtimes.
