---
schema_version: 1
id: wb_01KZHX3E00RRK3X1WYTFCW70D4
number: 43
title: "Make the no-launch guard and output-limit coverage real"
kind: task
priority: 1
status: triage
created: 2026-08-09
updated: 2026-08-09
provenance:
  source: "code-review"
  recorded_at: "2026-08-09T18:05:00.000Z"
depends_on: []
related: [wb_01KZ77NSW8ZP1289HFMN2ECNXD, wb_01KZHX3E00MX94XA5EG7J4TXWQ]
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
---

Item 42 made the conformance runner dispatch on each vector's declared mode, and
the run reports 183 of 183 with all 15 cases passing. An adversarial verification
found two mutations that survive that green run, so the number overstates what is
actually covered.

**The no-launch guard cannot see a real launch.** For `negative-capability` cases
the runner injects `forbid_core_launch`, which replaces the injected launcher with
one that throws. It therefore proves only that the injection point was not used. A
real child spawned independently, with its result discarded, is invisible to it.
Proof: inserting an awaited real `capabilities --json` launch into the entrypoint
and then returning the declared synthetic observation left the run green at 15 of
15 and 183 of 183. The obligation these four cases exist to enforce — that the
adapter refuses before core launch — is not enforced.

The test that appears to cover this does not. It rewrites an equivalence manifest
to `negative-capability`, and the evaluator then returns failure immediately
without any launch occurring, so it stays green under the prohibited-launch
mutation.

Enforcement has to observe the process, not the injection point. Whether a child
was spawned during the case is the fact under test.

**Bounded output no longer exercises real limit enforcement.** Because that vector
injects a completed observation, the conformance run never drives a real child past
its stdout limit. Clamping the byte counter so overflow is never detected left the
run green at 183 of 183, while the focused production test went red with
`stdout_complete: true !== false`. Section 10 nonetheless records bounded output as
implementation-pass.

This is the cost of item 42's correction rather than a mistake in it. Injecting the
declared observation is right for classification, and it also removes the only
place real stream-limit enforcement was exercised. Either the vector needs a
real-child companion, or section 10 must say plainly that real limit enforcement is
evidenced by the unit suite and not by the vector.

**Section 10 claims an enforcement that does not exist.** Around line 1100 it now
states that a negative-capability case fails when evaluation reaches a live
launcher. The surviving mutation above contradicts that directly. A contract
documenting an intention the implementation does not honour is its own defect, and
this is the second time this file has carried a claim its runner did not support.

Until these are closed, item 13 cannot close on the strength of the current run.
Everything else the verification attacked held: equivalence byte preservation,
protocol input ordering, the bootstrap LF, core probe validation, workspace
resolution, and path anchoring all went red when broken, the normative fixtures are
unchanged, and the oracle blob is identical on main and HEAD.
