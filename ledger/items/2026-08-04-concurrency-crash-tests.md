---
schema_version: 2
id: wb_01KZ77NSW8CXZRZ8JH2ADYZWH3
number: 7
title: "Test mutation concurrency and crash recovery"
kind: task
status: done
created: 2026-08-04
updated: 2026-08-08
completed: 2026-08-08
provenance:
  source: "repository-backlog"
  recorded_at: "2026-08-04T20:33:09Z"
depends_on: []
related:
  - wb_01KZ77NSW876B92APQN8Q8NK6X
  - wb_01KZ77NSW8825RKWA4AHJKN2YX
parent: wb_01KZ77NSW8PNA4S48NYT26AGMH
decisions:
  - action: accept
    date: 2026-08-04
    summary: "Concurrency and recovery testing is accepted."
    rationale: "Mutable coordination needs black-box evidence for conflict and recovery behaviour before release."
  - action: complete
    date: 2026-08-08
    summary: "Completed for the advisory backend; the two fencing scenarios are item 17's evidence by definition."
    rationale: "Every bullet the implemented backend can honestly evidence is covered in the tree: contention (claim-held, unequal-witness conflict, contended store lock), expiry and takeover with epoch advance, renewal including expired-tuple refusal, release with retained high-water mark, monotonic epochs across release and reacquisition, cross-worktree visibility, clock-floor monotonicity even on rejection, and the mutation crash and recovery suites (mutation-recovery, mutation-process, mutation-hardening). The remaining bullets — rejecting a claim-protected mutation on a missing owner or fencing epoch, and the paused-writer commit-boundary race — require backend-enforced fencing, which the advisory backend deliberately does not provide (claim_protected_publication false; publish-claimed refuses capability-unavailable, itself pinned by test). Per this item's own constraint to describe only guarantees the backend honestly provides, those two scenarios are the acceptance evidence of item 17's coordinator and must ship with it, not before it."
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
