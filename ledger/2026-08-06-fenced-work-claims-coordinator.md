---
schema_version: 1
id: wb_01KZBMBEZKPE7D15HKW9Q3GSZV
priority: 50
number: 17
title: "Implement fenced work claims with a transactional coordinator"
kind: task
status: backlog
created: 2026-08-06
updated: 2026-08-08
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
  - action: record
    date: 2026-08-08
    summary: "Rank fenced work claims at 50, behind the decision it waits on."
    rationale: "This is not unwritten code; it is an unresolved design question. Either the ledger bytes move inside a transactional coordinator, which challenges the plain-Markdown thesis, or the definition of fenced changes. Ranking it as ordinary work would misrepresent it, and the PropertyCompass migration is gated on it."
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
