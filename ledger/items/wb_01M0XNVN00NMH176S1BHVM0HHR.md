---
schema_version: 2
id: wb_01M0XNVN00NMH176S1BHVM0HHR
number: 170
title: "Preserve claim-verify refusal diagnostics after auto-commit lands"
kind: task
priority: 2
status: backlog
created: 2026-08-26
updated: 2026-08-26
provenance:
  source: "exploratory-stress/2026-08-26/phase2-postcommit-diagnostics"
  recorded_at: "2026-08-26T22:56:00.000Z"
depends_on: []
related: [ wb_01M0XNVN00PFRFXKTRC7D8CM63 ]
tags:
  - "stress-run-2026-08-26-alpha10"
  - "defect"
decisions:
  - action: accept
    date: 2026-08-26
    summary: "Accept the post-commit diagnostics defect."
    rationale: "The stress campaign reproduced committed auto-commit failures that discarded the underlying claim-verification refusal cause."
---
## Defect

Committing and returning `state: committed` with `ok: false` is contract-correct. Pinned mutation contract lines 2720-2723 say committed state continues even when `ok` is false because published item bytes are already proven. This item does not question the commit or state machine. The defect is solely that the claim-verification refusal cause is discarded in transit.

During valid overlapping auto-commit loops, five #180 mutations committed item plus reconciliation log and returned exit 6 `post-commit-reconciliation-failed`, state committed, reason `claim-verify-refused`, but `findings: []` and no claim-verify error code or details reason. The operator knows the write landed but cannot know why verification refused or choose recovery.

## Version and evidence provenance

- Distribution: `0.1.0-alpha.10`.
- Binary: `/Users/leestutzman/.nvm/versions/node/v20.20.2/bin/wowbagger`, resolving to `/Users/leestutzman/Documents/GitHub/wowbagger/bin/wowbagger.js`.
- Source HEAD: `b06db85c42d3795a82ad0b57b400e1c7b9a7025b`, clean, local `main` ahead of `origin/main` by two metadata-only commits.
- Recovery ref: local annotated tag `v0.1.0-alpha.10`, unpushed.
- Ahead commits: `b06db85` Cut 0.1.0-alpha.10; `e6c012f` Prepare alpha10 release notes. Neither changes behavior.
- Reproducibility: exact pinned tree is local-only; tested behavior is present on published `origin/main`, which reports alpha.9.
- Evidence came post-reinitialization from an on-disk driver and direct CLI. Each attempt fresh-inspected and constructed a new desired toggle, so counts are independent mutations, not retries of landed writes.

## Inline evidence

One representative #180 attempt fresh-inspected revision `sha256:61075a439a56da14b47373fdf7d746ae49d765d2a0a91a7ee48805591c88cff4`, built priority 0 to 1 with valid date `2026-09-05`, and ran patch with `--auto-commit`. Exit was 6, stderr empty. Item bytes and HEAD moved; the ledger remained valid.

```json
{"ok":false,"command":"patch","contract_version":5,"state":"committed","error":{"code":"post-commit-reconciliation-failed","message":"The item was published and committed, but claim reconciliation did not verify.","details":{"id":"wb_01M0XNVN00QV961C3B4BFKANXP","published_revision":"sha256:78b9a8cbf2e2a5415916ef0f1709e1ed7e550dda70fa853b363b37d9d6863f99","git_commit":"acbac745bcf72532b5657e607cf7be417f2d32d8","commit_paths":[".wowbagger/reconcile-wbns_4e6c98e584a9ec264f6fa5dc76ce5296.md","items/wb_01M0XNVN00QV961C3B4BFKANXP.md"],"reason":"claim-verify-refused","findings":[]}}}
```

The same opaque shape occurred on five distinct commits: `acbac74`, `55027af`, `1d16688`, `7ddfb73`, and `da2efa1`. Adjacent preflight refusals during the same temporal overlap exposed `claim_verify_code: "claim-store-unavailable"`. The exact underlying refusal code for each post-commit attempt is unmeasured because the current mapper discards it.

## Root cause

Pinned `src/git-autocommit.js:404-406` handles a failed `verifyClaimJournal` by returning `claim-verify-refused` and reading `verified.stdout.result?.findings ?? []`. A refusal envelope carries `error`, not `result`. Findings on a `publication-reconciliation-required` envelope live under `error.details.findings` at pinned `src/cli.js:1682-1685`; other claim-store refusals may carry only `error.code` and `error.details.reason`. Both forms are discarded.

The preflight path at `src/git-autocommit.js:157-161` preserves `claim_verify_code`; the post-commit path preserves neither the code nor details reason. The same system already transports the error identity correctly one path earlier.

## Acceptance criteria

- Preserve the claim-verify error code and relevant bounded `error.details.reason` and `error.details.findings` inside the post-commit error details.
- Do not invent an empty findings array when the verification envelope has no result.
- Keep `state: committed`, `git_commit`, `published_revision`, and `commit_paths`; never invite mutation replay.
- Test both a verification refusal with findings and one without findings.
- Document recovery branching on the preserved cause.
- Current Node, Node 20, adapter conformance, and ledger validation gates pass.

## Relation

#169 and this defect both hide the operative claim cause behind an outer auto-commit error; #169 covers preflight cleanliness masking, while this item covers post-commit diagnostic loss.

No fix is included. No production code was edited during this campaign. Implementation requires separate user-approved work.
