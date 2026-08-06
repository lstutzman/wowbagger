---
schema_version: 1
id: wb_01KZBNMT39DE0F95RV0C5K0EJQ
title: "Make the adapter conformance vectors reproducible without a git checkout"
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
`spec/fixtures/adapters/10-capabilities-forwarding` now byte-pins a git-present environment (`shared-git-directory-cooperative-writers`, `supported: true`, `cross_worktree_coordination: true`). Two independent call sites hardcode `cwd = projectRoot` -- `evaluateCoreBaseline` in `spec/run-adapter-vectors.js` and a standalone test in `test/adapter-vectors.test.js` -- and the manifest schema has no precondition field. A third party running the vectors from a tarball, `npm pack` extraction, or a Docker context without `.git` sees a failure caused by our harness, not by their adapter.

Fix, name both options:
1. Document the requirement (the vectors must run from a git checkout).
2. Synthesize a temporary `.git` directory at both call sites so the vectors are reproducible without one.

Option 2 is recommended: a precondition a harness cannot enforce tends to get skipped.

Source: final whole-branch review of feature/advisory-work-claims, Important #5 (`.superpowers/sdd/2026-08-06-advisory-work-claims/final-review.md`); also recorded as an open decision for Lee in this branch's `progress.md` (Task 8).