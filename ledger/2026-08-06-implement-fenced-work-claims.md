---
schema_version: 1
id: wb_01KZAZW75CWEG3R4BH4MZJAA7G
title: "Implement advisory work claims in the core CLI"
kind: task
status: backlog
created: 2026-08-06
updated: 2026-08-06
provenance:
  source: "repository-backlog"
  recorded_at: "2026-08-06T07:33:48Z"
depends_on: []
related: [ wb_01KZ77NSW8825RKWA4AHJKN2YX ]
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
---

The fenced work-claim contract and its no-I/O reference model are complete, but
the core CLI implements none of it. There is no acquire, renew, release, or
claim-protected publication command, and the README states that fenced claims
are unavailable from the core CLI.

Build the protocol into the tool against a durable coordinator: claim identity
and epoch allocation, idempotent retries, expiry and takeover, ledger-revision
conflict detection, fencing at the publication commit boundary, and the refusal
envelopes the contract specifies. The committed reference vectors are the
conformance target: a backend is conformant only when it reproduces their exact
envelopes, durable read-back, and ledger bytes.

Until this ships, the mutation runtime covers cooperative writers in one working
copy only. That is the stated gate on any consumer whose agents write a backlog
from several worktrees at once.
