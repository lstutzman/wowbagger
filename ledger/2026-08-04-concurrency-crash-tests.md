---
schema_version: 1
id: wb_01KZ77NSW8CXZRZ8JH2ADYZWH3
title: "Test mutation concurrency and crash recovery"
kind: task
status: backlog
created: 2026-08-04
updated: 2026-08-05
provenance:
  source: "repository-backlog"
  recorded_at: "2026-08-04T20:33:09Z"
depends_on:
  - wb_01KZ77NSW8825RKWA4AHJKN2YX
related:
  - wb_01KZ77NSW876B92APQN8Q8NK6X
parent: wb_01KZ77NSW8PNA4S48NYT26AGMH
decisions:
  - action: accept
    date: 2026-08-04
    summary: "Concurrency and recovery testing is accepted."
    rationale: "Mutable coordination needs black-box evidence for conflict and recovery behaviour before release."
---

Add standalone black-box tests for concurrent writers, failures around durable
publication, and recovery reporting. Claim coverage must include:

- contention, expiry and takeover, renewal, and release;
- monotonically advancing epochs across release and reacquisition;
- rejection of a claim-protected mutation with a missing owner or fencing-token
  epoch, leaving the ledger unchanged; and
- a paused-writer race at the mutation commit boundary: owner A with epoch N
  pauses after ordinary item and revision validation, owner B obtains epoch
  N+1, then A resumes and the backend's commit-boundary owner-and-epoch check
  rejects A's mutation unchanged.

The tests must exercise backend-enforced fencing rather than rely on worker
self-fencing, and must describe only guarantees the implemented backend can
honestly provide.
