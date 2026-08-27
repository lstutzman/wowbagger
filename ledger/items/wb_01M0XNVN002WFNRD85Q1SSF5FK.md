---
schema_version: 2
id: wb_01M0XNVN002WFNRD85Q1SSF5FK
number: 165
title: "Classify uncommitted sibling revisions as synchronization-required without weakening unauthorized edits"
kind: task
priority: 1
status: in-progress
created: 2026-08-26
updated: 2026-08-26
provenance:
  source: "exploratory-stress/2026-08-26/phase2-c2"
  recorded_at: "2026-08-26T22:50:00.000Z"
depends_on: []
related: [ wb_01M0MR2Y8GKNCTTVS9V5ZX8Q0N, wb_01M0Z48AYMPJWSA7YHFWK1SKBA, wb_01M0Z48FXW33933XZ1SE2WVT5R ]
tags:
  - "stress-run-2026-08-26-alpha10"
  - "defect"
decisions:
  - action: accept
    date: 2026-08-26
    summary: "Accept the confirmed uncommitted-sibling reconciliation defect."
    rationale: "The alpha10 stress campaign reproduced the classifier failure, traced its root cause, and approved a safety-preserving implementation design."
---
## Defect

On a provisioned multi-worktree ledger, worktree c1 performs an in-protocol mutation of item #11 and records authorized revision `sha256:e29b39c31f870a88c6d437c34e068238acf0166b704a5b1b3ebbe573afb9f43a` in the shared journal but has not committed it. Pristine sibling c2 still carries committed/baseline #11 revision `sha256:bbcae102216c62dcc634c89a9d0ea38eca45d32ac71c3919517ddbcd5cb30d5a`. An unrelated auto-commit targeting #170 falsely classifies c2's untouched #11 as `unauthorized-revision`, blocks the unrelated target, and offers restore or claim-adopt remedies c2 cannot execute.

## Version and source provenance

- Distribution: `0.1.0-alpha.10`.
- Binary: `/Users/leestutzman/.nvm/versions/node/v20.20.2/bin/wowbagger`, resolving to `/Users/leestutzman/Documents/GitHub/wowbagger/bin/wowbagger.js`.
- Source HEAD: `b06db85c42d3795a82ad0b57b400e1c7b9a7025b`, clean, local `main` ahead of `origin/main` by two metadata-only commits.
- Recovery ref: local annotated tag `v0.1.0-alpha.10`, unpushed.
- Ahead commits: `b06db85` Cut 0.1.0-alpha.10; `e6c012f` Prepare alpha10 release notes. Neither changes behavior.
- Reproducibility: exact pinned tree is recoverable only on this machine; tested behavior is present on published `origin/main`, which reports alpha.9. `contract_version: 5` is not used as version evidence.
- Evidence came post-reinitialization from an on-disk driver and direct CLI in `/private/tmp/wowbagger-explore-alpha10-20260826-c2`; no shared eval-kernel evidence supports this item.

## Exact reproduction

Scratch baseline: `ab329233262d9365bedcfc26917457c0d2ffc552`; namespace: `wbns_4e6c98e584a9ec264f6fa5dc76ce5296`. c1 and c2 begin at that HEAD. c1 changes #11 in protocol, without auto-commit or a Git commit, through patch, snooze, and parent-migrate. Its shared journal expects `e29b39c3...`; c2's item and c2 HEAD remain `bbcae102...`. c1 holds only #11 plus its reconciliation log dirty. c2 is clean.

The request payload path `/tmp/c2-capture-patch-170.json` is harness-side input by design, not ledger state. Payload:

```json
{"date":"2026-08-26","expected_revision":"sha256:71c6eeb54e6c0111b3a6a4685c08d78098846ff995a871b96696096c54f0b405","id":"wb_01M0XNVN000B8Y08JRGZPHAQTF","set":{"priority":7}}
```

Command:

```sh
wowbagger patch --ledger /private/tmp/wowbagger-explore-alpha10-20260826-c2/ledger --input /tmp/c2-capture-patch-170.json --json --auto-commit
```

Exit 4, empty stderr, target #170 unchanged at `sha256:71c6eeb54e6c0111b3a6a4685c08d78098846ff995a871b96696096c54f0b405`:

```json
{"ok":false,"command":"patch","contract_version":5,"state":"unchanged","error":{"code":"auto-commit-preflight-failed","message":"Auto-commit refused before the mutation ran.","details":{"reason":"claim-state-unreconciled","retryable":false,"claim_verify_code":null,"findings":[{"code":"stale-write-detected","item_id":"wb_01M0XNVN00NCVCDDFZKCV1WPC4","actual_revision":"sha256:bbcae102216c62dcc634c89a9d0ea38eca45d32ac71c3919517ddbcd5cb30d5a","expected_revision":"sha256:e29b39c31f870a88c6d437c34e068238acf0166b704a5b1b3ebbe573afb9f43a","observed_surface":"working-tree","reason":"unauthorized-revision","expected_path":"items/wb_01M0XNVN00NCVCDDFZKCV1WPC4.md","remediation":"Restore the authorized revision at items/wb_01M0XNVN00NCVCDDFZKCV1WPC4.md, then run claim-verify; that discards the edit. Or adopt the committed revision of items/wb_01M0XNVN00NCVCDDFZKCV1WPC4.md with claim-adopt, then run claim-verify; that keeps the edit."}]}}}
```

Independent `claim-verify` returned exit 6, empty stderr, `state:"unknown"`, and the same finding:

```json
{"ok":false,"namespace":"work-claim","command":"claim-verify","contract_version":1,"state":"unknown","result":{"ledger_namespace":"wbns_4e6c98e584a9ec264f6fa5dc76ce5296","findings":[{"code":"stale-write-detected","item_id":"wb_01M0XNVN00NCVCDDFZKCV1WPC4","actual_revision":"sha256:bbcae102216c62dcc634c89a9d0ea38eca45d32ac71c3919517ddbcd5cb30d5a","expected_revision":"sha256:e29b39c31f870a88c6d437c34e068238acf0166b704a5b1b3ebbe573afb9f43a","observed_surface":"working-tree","reason":"unauthorized-revision","expected_path":"items/wb_01M0XNVN00NCVCDDFZKCV1WPC4.md"}]}}
```

After c1 committed exactly #11 plus its log at `7801e5822e46cc57c83bdb2cb775ba07c363cc84`, the same c2 bytes were correctly reclassified:

```json
{"code":"stale-write-detected","item_id":"wb_01M0XNVN00NCVCDDFZKCV1WPC4","actual_revision":"sha256:bbcae102216c62dcc634c89a9d0ea38eca45d32ac71c3919517ddbcd5cb30d5a","expected_revision":"sha256:e29b39c31f870a88c6d437c34e068238acf0166b704a5b1b3ebbe573afb9f43a","observed_surface":"working-tree","reason":"worktree-synchronization-required","owner_ref":"refs/heads/stress/c1-holder","owner_commit":"7801e5822e46cc57c83bdb2cb775ba07c363cc84"}
```

Reachability alone flips the false unauthorized classification to correct synchronization classification.

## Root cause

`blocksTarget` correctly tolerates unrelated findings only when the reason is `worktree-synchronization-required`. `reconciliationDiagnosis` cannot reach that reason for a file-present, uncommitted sibling state: owner lookup finds no commit; `workingTreeChanged` compares c2 actual to the journal expectation and is true; the owner-unavailable synchronization branch requires `actualRevision === null`; fallthrough returns `unauthorized-revision`. See pinned source `src/claim-publication.js:565-577,611-618,749-752,765-812`, `src/git-reconciliation.js:69-96`, `src/git-autocommit.js:152-161`, and work-claim contract section 3.1 and lines 368-372.

The caller already computes `authorizedRevisions` one frame up and includes legacy intent predecessors. In this sibling-ahead case, c2's actual `bbcae102...` is in that set. A genuine out-of-protocol edit is not. The classifier does not receive the discriminator it needs.

## Safety constraint and acceptance

Do not merely relax the `actualRevision === null` guard. A genuine out-of-protocol hand edit is also file-present, changed, and owner-unattributable; reclassifying it as synchronization-required would create a false pass.

Acceptance criteria:

- An uncommitted in-protocol sibling revision reports `worktree-synchronization-required` and does not block an unrelated target.
- A companion regression proves a genuine file-present unauthorized edit remains `unauthorized-revision` and blocks.
- A committed sibling still reports its owner ref and commit.
- Current Node and Node 20 suites, adapter conformance, and ledger validation pass.

## Relations

- #133 introduced target-scoped claim reconciliation; this is its uncommitted-sibling edge case.
- #146 reproduced committed sibling worktree fencing under stress; this is the remaining pre-commit window.
- #152 tracked the contract's target-scoping contradiction; this finding identifies the classifier condition that still violates it.

No fix is included. No production code was edited during this campaign. The classifier shape and acceptance criteria are a proposal; implementation requires separate user-approved work.
