---
schema_version: 1
id: wb_01KZ77NSW8CXZRZ8JH2ADYZWH3
title: "Test mutation concurrency and crash recovery"
kind: task
status: backlog
created: 2026-08-04
updated: 2026-08-04
provenance:
  source: "repository-backlog"
  recorded_at: "2026-08-04T20:33:09Z"
depends_on:
  - wb_01KZ77NSW876B92APQN8Q8NK6X
  - wb_01KZ77NSW8825RKWA4AHJKN2YX
related: []
parent: wb_01KZ77NSW8PNA4S48NYT26AGMH
decisions:
  - action: accept
    date: 2026-08-04
    summary: "Concurrency and recovery testing is accepted."
    rationale: "Mutable coordination needs black-box evidence for conflict and recovery behaviour before release."
---

Add standalone black-box tests for concurrent writers, failures around durable
publication, and recovery reporting. Claim coverage must include contention,
expiry and takeover, renewal and release, and rejection of a stale-fenced
writer after another owner advances the epoch. The tests must describe only
guarantees the implemented backend can honestly provide.
