---
schema_version: 2
id: wb_01KZBMBEZKPE7D15HKW9Q3GSZV
number: 17
title: "Implement fenced work claims with a transactional coordinator"
kind: task
status: done
created: 2026-08-06
updated: 2026-08-11
completed: 2026-08-11
provenance:
  source: "repository-backlog"
  recorded_at: "2026-08-06T13:31:39Z"
depends_on: []
related: [ wb_01KZAZW75CWEG3R4BH4MZJAA7G ]
parent: wb_01KZ77NSW8PNA4S48NYT26AGMH
decisions:
  - action: accept
    date: 2026-08-06
    summary: "Accept the fenced work-claim coordinator item."
    rationale: "Advisory claims are shipped; fencing is a distinct, unresolved design problem worth tracking on its own."
  - action: complete
    date: 2026-08-11
    summary: "Implemented the accepted merge-coordinated work-claim profile with durable claim operations, claim-protected publication, and Git reconciliation."
    rationale: "The implementation passes the normative fixtures, both supported Node runtimes, adapter conformance, a real provision-acquire-publish-commit-verify smoke flow, and keeps safe_exclusive_dispatch false for the documented cooperative-only trust model."
---

Advisory claims coordinate cooperating agents but enforce nothing. Fenced
claims require one transactional coordinator that serializes claim decisions,
the clock floor, every write path that can mutate a claimed item, the ledger
publication, and its idempotency outcome.

The open question this item carries: what the coordinator is, and whether
ledger bytes must live inside it for publication to commit atomically with the
fence check. A coordinator beside a plain file rename is advisory by the
contract's own definition, so a design that keeps Markdown files authoritative
needs to explain how it reaches atomicity.

This item gates any consumer whose agents write a backlog from several
worktrees at once.
