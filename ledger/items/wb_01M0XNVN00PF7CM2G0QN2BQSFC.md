---
schema_version: 2
id: wb_01M0XNVN00PF7CM2G0QN2BQSFC
number: 171
title: "Define retryability for cross-worktree auto-commit contention"
kind: task
priority: 2
status: done
created: 2026-08-26
updated: 2026-08-26
completed: 2026-08-26
provenance:
  source: "exploratory-stress/2026-08-26/phase2-retryability"
  recorded_at: "2026-08-26T22:57:00.000Z"
depends_on: []
related: [ wb_01M0XNVN00NMH176S1BHVM0HHR ]
tags:
  - "stress-run-2026-08-26-alpha10"
  - "design"
decisions:
  - action: accept
    date: 2026-08-26
    summary: "Accept the cross-worktree retryability design gap."
    rationale: "The stress campaign proved the per-worktree mutex cannot represent shared claim-store contention and approved an underlying-reason retry signal."
  - action: complete
    date: 2026-08-26
    summary: "Defined retryability for cross-worktree auto-commit contention."
    rationale: "The claim-store reason mapping landed in ad7ed33 and its public contract in 0cdfa42. The complete suite passed 1726/1726 on current Node and Node 20, covering retryable lock contention and nonretryable reconciliation."
---
## Design gap — current code matches the contract

The auto-commit mutex is per working tree, while `retryable: true` is reserved exclusively for `mutex-held`. Sibling worktrees have different mutexes, so cross-worktree callers can never observe the only retryable preflight reason. The campaign expected `mutex-held` to dominate its overlapping-worktree phase; that expected-behavior register entry was structurally wrong, not unlucky.

## Version and evidence provenance

- Distribution: `0.1.0-alpha.10`.
- Binary: `/Users/leestutzman/.nvm/versions/node/v20.20.2/bin/wowbagger`, resolving to `/Users/leestutzman/Documents/GitHub/wowbagger/bin/wowbagger.js`.
- Source HEAD: `b06db85c42d3795a82ad0b57b400e1c7b9a7025b`, clean, local `main` ahead of `origin/main` by two metadata-only commits.
- Recovery ref: local annotated tag `v0.1.0-alpha.10`, unpushed.
- Ahead commits: `b06db85` Cut 0.1.0-alpha.10; `e6c012f` Prepare alpha10 release notes. Neither changes behavior.
- Reproducibility: exact pinned tree is local-only; tested behavior is present on published `origin/main`, which reports alpha.9.
- Evidence came post-reinitialization from on-disk drivers and direct CLI. Every attempt fresh-inspected and constructed a new desired toggle, so the counts are independent desired mutations rather than retries of landed writes.

## Structural source result

Pinned mutation contract line 2679 states that auto-commit takes a per-working-tree mutex. Lines 2697-2700 state `retryable` is true only for `mutex-held`, and every other preflight reason is false. Pinned `src/git-autocommit.js:87-104` creates the mutex beneath `placement.gitDir`, which is distinct per worktree. `src/git-autocommit.js:683-686` implements the retry rule exactly.

This structural result does not depend on the campaign histogram: cross-worktree callers cannot contend on that mutex and therefore cannot receive `retryable: true` from it.

## Supporting observation

Forty valid, proven-overlapping attempts on #171 and #180 produced zero `mutex-held` or `retryable: true` responses. Twenty-four preflights returned `claim-state-unreconciled`, `retryable: false`; ten writes committed with post-commit reconciliation errors; six other writes committed. Temporal overlap was proven by c2 observing the shared journal advance from holder activity between its own attempts nine times.

`claim_verify_code: "claim-store-unavailable"` appeared on refusal envelopes, but transient lock versus persistent reconciliation is unmeasured because the capture does not preserve the underlying verification `details.reason`. Do not conclude which occurred. `claim_verify_code` is itself an uncontracted extra detail and was the only visible distinction.

## Impact

A well-behaved cross-worktree caller sees retryability always false under contention and must abandon work even where a condition may clear. The documented retry contract describes only intra-worktree serialization, while claims coordinate worktrees sharing one Git common directory.

## Acceptance criteria

- Choose and document a cross-worktree policy: serialize auto-commit at Git-common-directory scope, or preserve per-worktree parallelism and contract a bounded underlying claim-verification reason.
- If an underlying reason proves `claim-store-locked`, classify transient contention safely; persistent `publication-reconciliation-required` remains non-retryable.
- Contract `claim_verify_code` and the necessary bounded reason if clients must use them.
- Add a real overlapping-worktree test that proves the selected policy and distinguishes transient locking from persistent findings.
- Keep fail-closed behavior and prohibit blind retries.
- Correct operator documentation: `mutex-held` is intra-worktree only.
- Current Node, Node 20, adapter conformance, and ledger validation gates pass.

## Relation

The unmeasured transient-versus-persistent split is a direct consequence of the discarded refusal diagnostics tracked by #170. Fixing #170 is the prerequisite for closing this item's open measurement question.

No fix is included. No production code was edited during this campaign. Implementation requires separate user-approved work.
