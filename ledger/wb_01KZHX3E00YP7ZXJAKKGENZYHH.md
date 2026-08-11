---
schema_version: 2
id: wb_01KZHX3E00YP7ZXJAKKGENZYHH
number: 37
title: "Validate the adapter under concurrent invokes"
kind: task
status: done
created: 2026-08-09
updated: 2026-08-11
completed: 2026-08-11
provenance:
  source: "repository-backlog"
  recorded_at: "2026-08-09T13:30:00.000Z"
depends_on: [ wb_01KZ77NSW8ZP1289HFMN2ECNXD ]
related: []
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
decisions:
  - action: accept
    date: 2026-08-10
    summary: "Accept into backlog: prove or contract what concurrent adapter invocation may mean."
    rationale: "The adapter boundary was only ever exercised one invoke at a time; concurrent safety is an assumption, not a finding. Valid follow-on scope distinct from core item 7."
  - action: complete
    date: 2026-08-11
    summary: "Done: adapter is a one-shot CLI with no concurrent state. Concurrent invokes are independent; serialization happens at core level through lock file."
    rationale: "Five tests prove: (1) concurrent invokeAdapter calls don't interfere, (2) each invocation enforces its own stdout/stderr limits, (3) approval state is per-invocation, (4) shared runtime objects don't cause race conditions, (5) adapter is a one-shot CLI with no state persistence. Contract section 11.1 documents these findings. Commit 652d468."
---

The adapter has only ever been exercised one invoke at a time. Nothing in the
conformance vectors or the test suite runs two invokes against one ledger at
once, so concurrent safety is an assumption, not a finding.

**Resolution (2026-08-11):** The adapter is a one-shot CLI process. Each
invocation runs to completion and exits. There is no daemon, no shared state,
and no concurrency control at the adapter level.

Key findings:
1. **One adapter process cannot serve overlapping invokes.** It reads one
   request, processes it, writes one response, and exits. If a host needs
   concurrent execution, it must spawn multiple adapter processes.

2. **Concurrent adapter processes against the same ledger are independent.**
   The adapter has no concurrency control; serialization happens at the core
   level through the lock file. Two simultaneous mutations may both pass
   approval and launch, but the core's lock serializes writes.

3. **Each invocation enforces its own stdout/stderr limits independently.**
   Buffer state is per-process; one invocation hitting its limit does not affect
   another's limit enforcement.

These findings are documented in adapter-contract.md section 11.1 and verified
by test/adapter-concurrent.test.js.

Item 7 covered concurrency and crash recovery for the core mutation runtime.
That is a different boundary: it says nothing about an adapter that spawns core
subprocesses, buffers their output under a byte limit, and maps their process
outcomes. The gap is the adapter's own state, not the core's.

The work is to decide what concurrent invocation is even allowed to mean, then
prove it:

- whether one adapter process may serve overlapping invokes at all, or whether
  the contract requires the host to serialise them;
- whether two adapter processes against one ledger stay correct, given that
  claims are advisory and enforce nothing;
- what a partially-buffered subprocess does to the stdout and stderr limits when
  a second invoke is live.

An answer of "sequential only, and the contract says so" is a valid outcome, but
it has to be written down rather than left implied.
