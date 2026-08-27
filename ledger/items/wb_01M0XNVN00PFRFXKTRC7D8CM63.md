---
schema_version: 2
id: wb_01M0XNVN00PFRFXKTRC7D8CM63
number: 169
title: "Define an in-protocol recovery from claim-refusal reconciliation-log dirt"
kind: task
priority: 2
status: done
created: 2026-08-26
updated: 2026-08-26
completed: 2026-08-26
provenance:
  source: "exploratory-stress/2026-08-26/phase2-claim-log"
  recorded_at: "2026-08-26T22:55:00.000Z"
depends_on: []
related: [ wb_01M0Z48CM6GQPSSHDHJRYG1K2K, wb_01M0XNVN002WFNRD85Q1SSF5FK, wb_01M0XNVN00NMH176S1BHVM0HHR ]
tags:
  - "stress-run-2026-08-26-alpha10"
  - "design"
  - "documentation"
decisions:
  - action: accept
    date: 2026-08-26
    summary: "Accept the claim-log recovery design gap."
    rationale: "The stress campaign reproduced three claim-decision paths that dirty the derived reconciliation log and approved a safe authoritative-journal rebuild design."
  - action: complete
    date: 2026-08-26
    summary: "Added in-protocol recovery from claim-generated reconciliation-log dirt."
    rationale: "Runtime recovery landed in 3695798, contract guidance in 0cdfa42, and combined foreign-dirt coverage in 555713c. The complete suite passed 1726/1726 on current Node and Node 20."
---
## Design and documentation gap — not a defect

Claim CAS and fence decisions must persist authoritative decision time and evidence, including refusals. The problem is not that the journal advances. The gap is that projected claim evidence rewrites the tracked reconciliation log, then the next auto-commit outer cleanliness preflight refuses non-retryable `ledger-not-clean` until an operator performs an out-of-band commit or restore. The contract does not state this obligation or offer an in-protocol recovery.

## Version and evidence provenance

- Distribution: `0.1.0-alpha.10`.
- Binary: `/Users/leestutzman/.nvm/versions/node/v20.20.2/bin/wowbagger`, resolving to `/Users/leestutzman/Documents/GitHub/wowbagger/bin/wowbagger.js`.
- Source HEAD: `b06db85c42d3795a82ad0b57b400e1c7b9a7025b`, clean, local `main` ahead of `origin/main` by two metadata-only commits.
- Recovery ref: local annotated tag `v0.1.0-alpha.10`, unpushed.
- Ahead commits: `b06db85` Cut 0.1.0-alpha.10; `e6c012f` Prepare alpha10 release notes. Neither changes behavior.
- Reproducibility: exact pinned tree is local-only; tested behavior is present on published `origin/main`, which reports alpha.9.
- Evidence came post-reinitialization from on-disk drivers and direct CLI. Each race attempt fresh-inspected and constructed a new desired state; counts are independent attempts, not retries of landed writes.

## Three inline reproductions

1. c2 submitted stale and correct claim-acquire requests against active #170. The commands correctly returned `claim-conflict` and `claim-held`, state unchanged. Their durable records changed the tracked reconciliation mirror. The next `patch --auto-commit` first returned `ledger-not-clean`, `retryable: false`, masking the active-claim refusal.
2. The holder submitted a wrong-fence claimed publication. It correctly returned `claim-fence-rejected`, reason `epoch-mismatch`, but its publish-final evidence dirtied the mirror. The immediately following valid `publish-claimed --auto-commit` refused `ledger-not-clean` until the holder committed the log.
3. The holder's exact claim release succeeded after a valid publication, then immediately re-dirtied the mirror that the publication had committed. The next auto-commit began pre-broken.

All ledgers remained valid. Authoritative journal data stayed intact. The harness explicitly recorded each derived-mirror restore or log-only commit; no item or journal was rolled back.

## Source and contract

Claim operations advance the clock floor and work-claim contract sections 5 and 7 require persistence before response. The CLI claim handler writes the reconciliation log after journal append. Those writes are correct.

Pinned `src/git-autocommit.js:128-133` rejects any initial dirty ledger path. Later lines 170-173 tolerate the reconcile log dirtied inside the same auto-commit only for a journal-owning command. Pre-existing derived-log dirt from a prior claim decision never receives that carve-out. Non-mutex preflight reasons are `retryable: false` by contract.

## Impact

Normal claimed workflow can become: correct claim refusal or release, tool-generated tracked dirt, unrelated auto-commit refusal without the original claim findings, then a human-only commit or restore the tool never suggests. Reproduction 1 also masks the operative `claim-conflict` or `claim-held` reason behind the outer cleanliness complaint.

This corroborates #148's earlier mutation-refusal log-side-effect issue, but the remaining path is claim operations. #165 shares campaign and reconciliation context but has a different classifier root cause.

## Acceptance criteria

- Document that claim decisions may dirty the derived reconciliation log and state the exact safe next step.
- Design an in-protocol recovery: either ownership-aware validation of the derived log at initial preflight or an explicit synchronization or finalization verb.
- Preserve authoritative journal writes, fail closed on foreign ledger dirt, never broad-add or absorb unrelated log changes, and keep commit-per-mutation.
- Do not fix this by skipping or suppressing the projected-log write on a refused claim operation. Sections 5 and 7 mandate durable evidence, and the projected log must mirror the journal. Any conditional projection must be explicitly justified against those guarantees.
- Add acquire-conflict, fence-rejection, and release followed by auto-commit tests, plus operator documentation.
- Current Node, Node 20, adapter conformance, and ledger validation gates pass.

No fix is included. No production code was edited during this campaign. Implementation requires separate user-approved work.
