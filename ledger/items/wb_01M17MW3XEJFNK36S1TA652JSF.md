---
schema_version: 2
id: wb_01M17MW3XEJFNK36S1TA652JSF
number: 186
title: "Design safe batch create allocation and publication"
kind: task
priority: 2
status: triage
created: 2026-08-29
updated: 2026-08-29
provenance:
  source: "item #181 batch workflow decision"
  recorded_at: "2026-08-29T18:30:00Z"
depends_on: []
related: [wb_01M14Y1NTXQPMQ270VT1WH6H17]
---
## Problem

Alpha.14 intentionally requires each create to be committed before the next create or mutation so same-clone worktrees cannot allocate duplicate immutable numbers. During #181 integration, five independent fixture families in Wowbagger's own suite naturally used the former workflow: create several items, then commit once. That repeated pattern is direct evidence that batching is intuitive and that commit-per-create adds real friction to bulk import and setup workflows.

#181 must stay focused on the safety fence. This item decides whether Wowbagger should expose a safe batch operation rather than weakening single-create coordination.

## Acceptance criteria

- Decide explicitly whether a public batch-create operation is supported; document a permanent no-batch decision if rejected.
- If supported, allocate every number under one shared namespace-lock hold from one synchronized ledger snapshot.
- Validate the complete multi-item candidate ledger before publishing any item.
- Define all-or-nothing versus partial-publication semantics, including exact crash, lost-response, and retry recovery.
- Preserve core-assigned immutable numbering, request binding, and atomic no-clobber guarantees for every item.
- Define one auto-commit set and Git commit for the whole successful batch without absorbing foreign dirt.
- Prove same-clone cross-worktree contention and deterministic ordering on current Node and Node 20.
- Preserve the existing single-create request, response, and refusal contract.
