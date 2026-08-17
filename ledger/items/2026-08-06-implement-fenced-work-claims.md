---
schema_version: 2
id: wb_01KZAZW75CWEG3R4BH4MZJAA7G
number: 16
title: "Implement advisory work claims in the core CLI"
kind: task
status: done
created: 2026-08-06
updated: 2026-08-06
completed: 2026-08-06
provenance:
  source: "repository-backlog"
  recorded_at: "2026-08-06T07:33:48Z"
depends_on: []
related: [ wb_01KZ77NSW8825RKWA4AHJKN2YX, wb_01KZBMBEZKPE7D15HKW9Q3GSZV ]
parent: wb_01KZ77NSW8PNA4S48NYT26AGMH
decisions:
  - action: accept
    date: 2026-08-06
    summary: "Accept the fenced work-claim implementation."
    rationale: "The contract is complete but unimplemented; the gap was invisible while it sat inside an item marked done."
  - action: record
    date: 2026-08-06
    summary: "Narrowed to advisory claims. Fencing needs a transactional coordinator and is tracked separately."
    rationale: "The contract defines a local-filesystem backend as advisory regardless of its write paths, so the core CLI cannot be fenced. Closing this item as written would assert that fencing exists."
  - action: record
    date: 2026-08-06
    summary: "Rewrote the body to describe the delivered advisory scope; the prior body still briefed fencing under the new title."
    rationale: "A body describing an unbuilt fencing protocol on an item titled advisory and sitting in the ready queue would read as build instructions to the next agent that selects it."
  - action: complete
    date: 2026-08-06
    summary: "Advisory work claims shipped in the core CLI."
    rationale: "provision, claim read/acquire/renew/release, claim capabilities, and a publish-claimed that always refuses; claim state shared across worktrees via the git common directory. Enforcement was never in scope here — fencing is tracked as wb_01KZBMBEZKPE7D15HKW9Q3GSZV and remains the gate for any multi-worktree consumer."
---

The core CLI now implements advisory work claims: `provision`, `claim read`,
`claim acquire`, `claim renew`, `claim release`, and a `publish-claimed` that
always refuses. Claim state is shared across the worktrees of one repository
via the git common directory.

These claims enforce nothing. A writer that ignores a claim still wins; there
is no fencing at the publication commit boundary. `capabilities` reports this
honestly: `work_claim.mode` is `"advisory"` and
`work_claim.safe_exclusive_dispatch` is `false`.

The fenced work-claim protocol described in the original scope of this item —
a durable coordinator serializing claim decisions, the clock floor, every
write path, ledger publication, and its idempotency outcome — has moved to
wb_01KZBMBEZKPE7D15HKW9Q3GSZV, "Implement fenced work claims with a
transactional coordinator". A consumer whose agents write a backlog from
several worktrees at once is gated on that item, not this one.
