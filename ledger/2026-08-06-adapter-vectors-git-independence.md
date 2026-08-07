---
schema_version: 1
id: wb_01KZBNMT39DE0F95RV0C5K0EJQ
number: 20
title: "Document the git-checkout requirement for adapter conformance vectors"
kind: task
status: done
created: 2026-08-06
updated: 2026-08-06
completed: 2026-08-06
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
  - action: record
    date: 2026-08-06
    summary: "Ruling: document the requirement rather than change the harness. Item retitled to match what was decided."
    rationale: "The original title promised harness independence, which is not what was chosen. Closing it under that title would assert the vectors run without a git checkout when they do not. The requirement is now stated in spec/fixtures/adapters/README.md, including which three members vary and that a resulting mismatch is an environment fault rather than an adapter defect."
  - action: complete
    date: 2026-08-06
    summary: "Documented the git-checkout requirement in the adapter vectors README."
    rationale: "The chosen resolution shipped: the requirement, the three varying members, and the environment-versus-adapter distinction are now stated where a runner will read them."
---
`spec/fixtures/adapters/10-capabilities-forwarding` now byte-pins a git-present environment (`shared-git-directory-cooperative-writers`, `supported: true`, `cross_worktree_coordination: true`). Two independent call sites hardcode `cwd = projectRoot` -- `evaluateCoreBaseline` in `spec/run-adapter-vectors.js` and a standalone test in `test/adapter-vectors.test.js` -- and the manifest schema has no precondition field. A third party running the vectors from a tarball, `npm pack` extraction, or a Docker context without `.git` sees a failure caused by our harness, not by their adapter.

Two options were considered:
1. Document the requirement — the vectors must run from a git checkout.
2. Synthesize a temporary `.git` directory at both call sites so the vectors are reproducible without one.

**Option 1 was chosen.** `spec/fixtures/adapters/README.md` now carries an
"Environment requirement" section naming the three members that vary with git
presence, stating that the committed expectation pins the git-present values, and
stating plainly that a resulting byte mismatch is caused by the environment rather
than by the adapter under test.

The harness is unchanged, so the precondition is stated rather than enforced. If
that proves insufficient — a third party trips over it despite the documentation —
option 2 remains available and its two call sites are named above.

Source: final whole-branch review of feature/advisory-work-claims, Important #5 (`.superpowers/sdd/2026-08-06-advisory-work-claims/final-review.md`); also recorded as an open decision for Lee in this branch's `progress.md` (Task 8).