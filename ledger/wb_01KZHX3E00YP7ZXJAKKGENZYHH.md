---
schema_version: 2
id: wb_01KZHX3E00YP7ZXJAKKGENZYHH
number: 37
title: "Validate the adapter under concurrent invokes"
kind: task
status: triage
created: 2026-08-09
updated: 2026-08-09
provenance:
  source: "repository-backlog"
  recorded_at: "2026-08-09T13:30:00.000Z"
depends_on: [wb_01KZ77NSW8ZP1289HFMN2ECNXD]
related: []
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
---

The adapter has only ever been exercised one invoke at a time. Nothing in the
conformance vectors or the test suite runs two invokes against one ledger at
once, so concurrent safety is an assumption, not a finding.

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
