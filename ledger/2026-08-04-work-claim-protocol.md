---
schema_version: 1
id: wb_01KZ77NSW8825RKWA4AHJKN2YX
title: "Define and implement the work-claim protocol"
kind: task
status: backlog
created: 2026-08-04
updated: 2026-08-04
provenance:
  source: "repository-backlog"
  recorded_at: "2026-08-04T20:33:09Z"
depends_on:
  - wb_01KZ77NSW876B92APQN8Q8NK6X
related: []
parent: wb_01KZ77NSW8PNA4S48NYT26AGMH
decisions:
  - action: accept
    date: 2026-08-04
    summary: "A separate work-claim protocol is accepted for follow-on design and implementation."
    rationale: "The standalone v0 plan explicitly defers claims until mutation support and a dedicated claim contract exist."
---

Define the portable claim envelope and fail-closed resolution behaviour before
implementing claim storage. The protocol's acceptance criteria are:

- each claim identifies its owner and carries a monotonically advancing epoch
  that acts as its fencing token;
- acquire, renew, and release are compare-and-set operations;
- expiry and takeover semantics are explicit, and takeover advances the epoch;
- a worker holding a stale epoch self-fences before attempting a protected
  ledger write; and
- claim writes are followed by read-back evidence that confirms the observed
  owner, epoch, and operation outcome.

These are requirements for future implementation, not claims about the current
read-only runtime. A work claim does not substitute for ledger mutation safety.
