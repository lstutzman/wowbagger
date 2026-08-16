---
schema_version: 2
id: wb_01M058P3KQDSD269YXN5B4KSAK
number: 96
title: "Stop failed mutations leaving reconcile-log residue that blocks the next write"
kind: task
status: triage
created: 2026-08-16
updated: 2026-08-16
provenance:
  source: "consumer-field-feedback"
  recorded_at: "2026-08-16T00:00:00.000Z"
depends_on: []
related: [wb_01M057PTYZ18N6EE76AEW46E0R]
---
Field paper-cut 10 (report: .PropertyCompass2/worktrees/260815-212735/docs/wowbagger-feedback.md): a FAILED transition (ok:false, state:unchanged) still rewrote `ledger/.wowbagger/reconcile-*.md`, and the consumer reports the next mutation then trips the commit-at-HEAD blocker on that file unless batch tooling git-adds after failures too. Write-on-failure is verified in source: the legacy fence appends intent and abort journal entries and the reconciliation surfaces rewrite the reconcile log regardless of mutation outcome (src/claim-coordinator.js, src/claim-publication.js writeReconcileLog call sites). This repo’s own sessions hit the residue twice on 2026-08-16 (trailing "Record ledger reconciliation" commits).

Scope:
1. Reproduce the consumer’s exact claim in a fixture: failed transition, dirty reconcile log, does the NEXT mutation refuse? Pin the mechanism (the log is excluded from item listing by the `.wowbagger/` filter in git-reconciliation.js, so the refusal path - if real - runs through something else; find it, do not guess).
2. Decide the honest fix: do not rewrite the reconcile log when state is `unchanged`, or exclude the log from whatever surface check trips, or document that the log is part of the per-mutation commit set. A mutation that changes nothing should leave the working tree byte-identical - that is the default position; deviating needs a recorded reason.
3. Whatever the outcome, the commit-per-mutation documentation from item #88 states exactly which files belong to the post-mutation commit.

Acceptance:
- A fixture test proves a refused mutation leaves the ledger working tree byte-identical (or the documented exception is pinned by test and stated in the contract).
- The consumer’s batch-tooling ceremony (git add after failures) becomes unnecessary or explicitly documented.
- Gate green on both runtimes.