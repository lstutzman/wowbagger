---
schema_version: 2
id: wb_01M13SBJHZABPX0QTNCFEGYMWM
number: 179
title: "Keep committed unknown revisions blocking when a sibling owns the expected revision"
kind: task
priority: 1
status: triage
created: 2026-08-28
updated: 2026-08-28
provenance:
  source: "item-178-topology-research"
  recorded_at: "2026-08-28T08:56:42Z"
depends_on: []
related: [wb_01M0XNVN00ABNA2SZ7WHM0FRX7, wb_01M12GT91WYNWHTYRBV7Y5R9E3]
---
## Problem

Alpha.11 can downgrade an out-of-protocol committed revision from a global safety barrier to advisory sibling synchronization. The reproduced topology has expected revision E on a named sibling ref while the blocked checkout holds unknown revision U in both its working tree and HEAD. U is not in the journal's authorized revision set.

`reconciliationDiagnosis` checks `actualRevision === headRevision` and returns the named expected owner before proving that the observed revision is an authorized predecessor. Public `claim-verify --json` exits 6 but reports `worktree-synchronization-required` with the sibling `owner_ref`; an unrelated patch then exits 0. This violates the contract rule that out-of-protocol revisions are global safety barriers.

This is #172 target-scoped success meeting a state #172 never authorized. Target scoping remains correct for genuine synchronization findings and wrong for unknown revisions. The fix must distinguish barrier class from finding scope rather than globally re-widening synchronization blocks. Found by the #178 topology audit.

## Acceptance criteria

- Add one RED public-CLI scenario with E on a named sibling ref and unknown U at both working tree and HEAD.
- `claim-verify --json` reports `unauthorized-revision`, preserves exit 6, and does not expose sibling-owner evidence as the diagnosis.
- An unrelated mutation refuses with the reconciliation finding instead of exiting 0.
- An authorized predecessor at working tree and HEAD still reports named sibling synchronization and remains advisory for unrelated mutations.
- Named-current-owner and detached-current-owner restored predecessors remain globally blocking.
- An expected revision that is not yet reachable remains unavailable-owner synchronization with the existing remediation.
- The fix changes barrier classification, not #172 target scoping.
- Update the changelog to state that alpha.11 shipped the unsafe downgrade and alpha.12 restores the global barrier.
- Full current-Node, Node 20, adapter-conformance, ledger-validation, and release-review gates pass.
