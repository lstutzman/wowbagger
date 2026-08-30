---
schema_version: 2
id: wb_01M17MW3XEJFNK36S1TA652JSF
number: 186
title: "Design safe batch create allocation and publication"
kind: task
priority: 3
status: in-progress
created: 2026-08-29
updated: 2026-08-30
provenance:
  source: "item #181 batch workflow decision"
  recorded_at: "2026-08-29T18:30:00Z"
depends_on: []
related: [ wb_01M14Y1NTXQPMQ270VT1WH6H17 ]
decisions:
  - action: accept
    date: 2026-08-30
    summary: "Accept batch-create design as priority-three backlog work."
    rationale: "Bulk creation is awkward but supported safely through create-then-commit. A batch surface is optional and must not outrank current stranded-user or platform-support work."
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

## Design boundaries

- A valid design outcome is `no batch operation`: document create-then-commit in a loop as the supported bulk-import pattern if that is safer than a new atomic surface.
- Any batch operation must preserve the #181 guarantee exactly. Holding one namespace lock for N allocations must be at least as safe as N sequential fenced creates; batching may not weaken candidate validation, publication fencing, or recovery semantics.

## Triage decision — 2026-08-30

Accepted into backlog at priority 3. Five fixture families proved that batching creates before one commit is intuitive, but alpha.14 already provides the safe create-then-commit loop and `--auto-commit`. This is ergonomics with a supported path, not a missing safety capability.

First design slice: make the no-batch outcome compete honestly against one-fence multi-item publication. No implementation begins until allocation ordering, complete-ledger validation, partial failure, lost response, idempotency, and one Git commit set are specified without weakening #181.
