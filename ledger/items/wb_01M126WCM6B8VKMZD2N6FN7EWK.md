---
schema_version: 2
id: wb_01M126WCM6B8VKMZD2N6FN7EWK
number: 173
title: "Block same-branch working-tree regressions when HEAD owns the expected revision"
kind: task
priority: 1
status: done
created: 2026-08-27
updated: 2026-08-27
completed: 2026-08-27
provenance:
  source: "no-mistakes/01M1249TW28C6FVTWBGJQYXVZ9/review"
  recorded_at: "2026-08-27T18:20:00Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-27
    summary: "Accept the release-blocking reconciliation safety defect."
    rationale: "The no-mistakes release review produced a concrete same-branch working-tree regression that can be downgraded from blocking unauthorized revision to advisory synchronization. Alpha.11 must not publish until a regression test proves the classifier remains blocking without breaking legitimate sibling windows."
  - action: complete
    date: 2026-08-27
    summary: "Kept same-branch restored authorized bytes blocking."
    rationale: "Commit ff904a9 fixes the current-ref classifier and its public-seam regression; 3cacf23 corrects commit-fence guidance with a real CLI characterization; 2816c7e aligns the envelope contract assertion. RED observed worktree-synchronization-required instead of unauthorized-revision. Focused reconciliation suites passed 53/53, and the complete suite passed 1729/1729 on current Node and Node 20 with adapter conformance and ledger validation green."
---
## Problem

When the current branch contains the latest authorized revision at HEAD but the working tree is restored to earlier authorized bytes, reconciliation can misclassify the regression as `worktree-synchronization-required`. That downgrades a same-branch blocking condition to an advisory sibling window.

## Acceptance criteria

- A RED regression reproduces latest authorized bytes at current HEAD plus an uncommitted restore to earlier authorized bytes.
- `claim-verify` and an unrelated mutation classify the regression as `unauthorized-revision` and block; neither reports `worktree-synchronization-required`.
- The legitimate uncommitted sibling predecessor window and unknown-edit blocking remain unchanged.
- Reproduce the release-audit README loop separately. If its overstatement derives from this classifier gap, correct it here; otherwise land a separate docs-only correction without changing runtime behavior.
- Current Node, Node 20, adapter conformance, and actual ledger validation pass.
