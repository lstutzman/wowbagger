---
schema_version: 2
id: wb_01M05ESS6K4SM3P8G42G3J2PVW
number: 99
title: "Decide whether create should record a claim-journal entry"
kind: task
priority: 20
status: in-progress
created: 2026-08-16
updated: 2026-08-16
provenance:
  source: "maintainer-dogfood"
  recorded_at: "2026-08-16T14:14:52Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-16
    summary: "Accept into the backlog."
    rationale: "Lee accepted on 2026-08-16. Design decision on create journal asymmetry needs recording either way."
---

Design question surfaced during item #89: `createItem` does not pass `authorize` to `withLegacyMutationFence`, so a create records no journal entry on a provisioned ledger. Consequences, now documented in work-claim-contract section 3.1: create never causes a cross-worktree block (only transition and patch do), and — the open risk — the journal cannot detect an unauthorized overwrite of a freshly created item until its first transition records it.

Scope:
1. Decide whether the asymmetry is intended. If yes, record the rationale in the work-claim contract next to the section 3.1 statement (why create's atomic no-clobber publication is protection enough until first transition). If no, record create in the journal like transition and patch, accepting that creates then serialize worktrees too — a real behavior change consumers must hear about loudly.
2. Either way, add a fixture proving the chosen property: an overwrite of a freshly created, committed item is either detected (journal records create) or explicitly out of coordination scope until first transition (documented).

Acceptance:
- The decision and its rationale live in the work-claim contract; a fixture pins the chosen behavior.
- If behavior changes, the CHANGELOG names it and the two-worktree fixture from #89 covers the create-blocks case.
- Gate green on both runtimes.
