---
schema_version: 2
id: wb_01M0XNVN00ABNA2SZ7WHM0FRX7
number: 172
title: "Align auto-commit preflight and post-commit finding scopes"
kind: task
priority: 2
status: backlog
created: 2026-08-26
updated: 2026-08-26
provenance:
  source: "exploratory-stress/2026-08-26/phase2-finding-scope"
  recorded_at: "2026-08-26T22:58:00.000Z"
depends_on: []
related: [ wb_01M0XNVN002WFNRD85Q1SSF5FK, wb_01M0XNVN00NMH176S1BHVM0HHR ]
tags:
  - "stress-run-2026-08-26-alpha10"
  - "design"
decisions:
  - action: accept
    date: 2026-08-26
    summary: "Accept the auto-commit finding-scope design gap."
    rationale: "The stress campaign proved target-scoped preflight and global post-commit finding checks create committed-but-reported-failed steady state."
---
## Design gap — current code matches the contract

Auto-commit preflight accepts target-scoped claim verification: an unrelated `worktree-synchronization-required` finding is nonblocking. After mutation and commit, the success contract requires internal claim-verify exit 0 with no findings and a valid ledger. The post-commit gate therefore fails on that same unrelated finding after the write lands. The contract never explains that its two gates use different scoping policies.

## Version and evidence provenance

- Distribution: `0.1.0-alpha.10`.
- Binary: `/Users/leestutzman/.nvm/versions/node/v20.20.2/bin/wowbagger`, resolving to `/Users/leestutzman/Documents/GitHub/wowbagger/bin/wowbagger.js`.
- Source HEAD: `b06db85c42d3795a82ad0b57b400e1c7b9a7025b`, clean, local `main` ahead of `origin/main` by two metadata-only commits.
- Recovery ref: local annotated tag `v0.1.0-alpha.10`, unpushed.
- Ahead commits: `b06db85` Cut 0.1.0-alpha.10; `e6c012f` Prepare alpha10 release notes. Neither changes behavior.
- Reproducibility: exact pinned tree is local-only; tested behavior is present on published `origin/main`, which reports alpha.9.
- Evidence came post-reinitialization from on-disk drivers and direct CLI. Every attempt fresh-inspected and constructed a new desired toggle, so counts are independent desired mutations rather than retries of landed writes.

## Inline observation

During 40 valid, proven-overlapping attempts, the holder mutated #171 while an unrelated #180 `worktree-synchronization-required` finding remained. The finding named #180 actual revision `sha256:61075a439a56da14b47373fdf7d746ae49d765d2a0a91a7ee48805591c88cff4`, expected revision `sha256:490fb83d7722710d893fa0639d897650f88a5df158e154f886e5c44757a64b68`, `owner_ref: refs/heads/stress/c2-autocommit`, and `owner_commit: da2efa189e8a906e828c6dfd01401d661d98faf2`.

Six holder writes and one contender write committed and then returned `post-commit-reconciliation-failed`, reason `claim-findings-present`. The target item and reconciliation log were committed, `state: committed` was honest, and each ledger remained valid.

## Source and contract

Pinned `src/claim-publication.js:749-752` makes an unrelated finding nonblocking only when its reason is `worktree-synchronization-required`. Pinned `src/git-autocommit.js:149-161` preflight rejects only verification exit or `ok` failure, so `ok: true` with a nonblocking finding passes. Pinned `src/git-autocommit.js:404-410` post-commit reconciliation rejects any `result.findings`.

Pinned mutation contract lines 2733-2737 explicitly require a successful invocation to wait for claim-verify exit 0 with no findings and a valid ledger. Runtime behavior is contract-correct.

## Impact

Under sustained legitimate worktree divergence, auto-commit can settle into a lands-then-reports-failure steady state on unrelated items. A caller must inspect `state` and never replay, but throughput and reporting remain failure-heavy. Target scoping applies before the write while global zero-findings applies after it.

Fixing #165 will increase this pattern. #165 correctly reclassifies uncommitted sibling state from blocking `unauthorized-revision` to nonblocking `worktree-synchronization-required`. That converts pre-write false refusals into states that pass preflight and then fail the post-commit zero-findings gate. Fixing #165 without deciding this policy trades a false block for more successful-but-reported-failed mutations.

## Acceptance criteria

- Choose and document one coherent policy: strict preflight on any finding, or target-scoped post-commit success that reports nonblocking findings separately.
- State the cost: strict preflight loses unrelated concurrency; target-scoped post-commit changes the success no-findings guarantee.
- Preserve honest `state: committed` semantics and the no-replay rule under either policy.
- Add a two-worktree test where an unrelated synchronization finding persists through commit.
- Coordinate #170 so underlying verification causes survive whichever policy is selected.
- Current Node, Node 20, adapter conformance, and ledger validation gates pass.

## Relations

#165 is causal-forward: its correct fix increases the incidence of this pattern. #170 is required so the underlying post-commit cause remains diagnosable under either policy.

No fix is included. No production code was edited during this campaign. Implementation requires separate user-approved work.
