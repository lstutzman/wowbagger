---
schema_version: 2
id: wb_01M05N0TD6C6W7HZAGED1487HX
number: 106
title: "Stop the adapter transport tests flaking under full-suite load"
kind: task
priority: 2
status: backlog
created: 2026-08-16
updated: 2026-08-16
provenance:
  source: "maintainer-dogfood"
  recorded_at: "2026-08-16T16:03:34Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-16
    summary: "Accept into the backlog."
    rationale: "Hits every future gate run; observed by four independent workers on 2026-08-16."
---

Reproducible-hazard flake, observed independently by four workers on 2026-08-16 (items #98, #102, #104, #105, #97 reports): under default parallel `node --test test/*.test.js`, roughly one full-suite run in three fails ONE adapter child-process test — a different one each time. Observed failures: adapter-opencode-wire "refuses a malformed wire request and still exits zero" (exit 1), adapter-bootstrap-wire "refuses a request with trailing bytes / invalid UTF-8 and still exits zero", several adapter-implementation-runner cases ("adapter transport failed (1)"), mutation-process "the number-index lock keeps concurrent creates from sharing a number". Every one passes in isolation (8-10 consecutive runs); the full suite is green at --test-concurrency=1 and =2; both Node runtimes affected equally.

Hypothesis (stated by #97's worker as inferred, not verified): spawn contention — these tests spawn real entrypoint child processes and only fail under full-suite parallel load. No failing run has ever implicated envelope classification or ledger logic.

Scope:
1. Reproduce under load (loop the full suite at default concurrency until a failure lands; capture the failing test's full output, not just the counts).
2. Identify the contention (fd exhaustion, spawn EAGAIN swallowed into an exit-1, PATH/tmpdir races) — the exit-1-instead-of-0 shape suggests the child itself fails to start cleanly.
3. Fix honestly: bound concurrent entrypoint spawns (a shared semaphore in the test helpers), or make the transport distinguish "child failed to spawn" from "child refused the request" so the test can retry the former. Do NOT serialize the whole suite or mark tests flaky.

Acceptance:
- 10 consecutive full-suite runs at default concurrency green on both runtimes.
- The mechanism is named in the closing decision with evidence.
- No test weakened or skipped; gate green.
