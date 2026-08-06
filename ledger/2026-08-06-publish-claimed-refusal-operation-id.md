---
schema_version: 1
id: wb_01KZBNMT2WWV2BWM2QEJX18RX2
title: "Reconcile the publish-claimed refusal with its normative transcript"
kind: task
status: backlog
created: 2026-08-06
updated: 2026-08-06
provenance:
  source: "final-review-fix-wave"
  recorded_at: "2026-08-06T00:00:00Z"
depends_on: []
related: [ wb_01KZAZW75CWEG3R4BH4MZJAA7G ]
parent: wb_01KZ77NSW8PNA4S48NYT26AGMH
decisions:
  - action: accept
    date: 2026-08-06
    summary: "Groom into backlog from the final-review fix wave."
    rationale: "Deferred Important finding from the whole-branch review of feature/advisory-work-claims; filed as a durable ledger item rather than left in progress.md."
---
The fixture `spec/fixtures/work-claims/advisory-publication-rejection` expects `operation_id` in the refusal envelope; the CLI omits it, necessarily, because it refuses BEFORE reading the input file where `operation_id` lives -- and that refuse-before-read ordering is now mutation-enforced by `test/claim-publish-refusal.test.js`. Two shipped requirements are in tension and the branch resolved it silently.

The spec and plan both promised a comparison against the advisory fixtures that was never written -- Task 8's conformance test covers only the four `work-claim.*` fixtures, while `test/claim-publish-refusal.test.js` asserts field-by-field against hand-written expectations instead. That missing comparison is what hid the divergence: had it existed, it would have failed on `operation_id` and surfaced this during Task 6.

Fix, name both options:
1. Amend the contract to allow the `operation_id` omission when the request was never read.
2. Have the refusal parse only `operation_id` from the input (without validating the rest of the request) and echo it.

Either way, also implement the fixture comparison the spec and plan promised (accepting a documented `operation_id` exclusion if option 1 is chosen), or amend the spec and plan to say what was actually delivered -- do not leave the plan asserting a test that does not exist.

Source: final whole-branch review of feature/advisory-work-claims, Important #3 and #4 (`.superpowers/sdd/2026-08-06-advisory-work-claims/final-review.md`).