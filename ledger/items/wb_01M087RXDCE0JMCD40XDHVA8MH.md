---
schema_version: 2
id: wb_01M087RXDCE0JMCD40XDHVA8MH
number: 127
title: "Add a CAS-fenced parent relation migration"
kind: task
status: backlog
created: 2026-08-17
updated: 2026-08-22
provenance:
  source: "consumer-dogfood/propertycompass2"
  recorded_at: "2026-08-17T16:09:56Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-22
    summary: "Accept item into backlog for maintainer triage."
    rationale: "The reported scope is recorded; backlog acceptance makes it eligible for scheduling and implementation."
---
Field feedback from PropertyCompass2 worktree 260816-191701 against core contract 3. Lee ruled epic #1414 terminal. Live child #1415 must stand alone, but both the legacy card and ledger item still retain #1414 as parent. `transition #1414 -> killed` returned exit 5 `atomic-scope-required` with blocker `child-disposition`. Contract 3 `patch` cannot change `parent` because `parent` is create-once. The consumer correctly kept both stores unchanged: no hand-edit and no delete/recreate workaround.

This is not another `depends_on`/`related` patch request. Item #90 shipped those list edits, but it cannot detach or reparent a live child. Item #114 documented the ownership boundary; it does not provide a parent migration.

Required behavior, without prescribing a command or request shape: provide a CAS-fenced atomic relation migration that can detach a live child from its current epic or reparent it to another epic. The migration must validate the resulting complete ledger, preserve correct direct-child accounting for both old and new parents, and leave the old parent eligible for its terminal transition when it has no remaining live child blocker. A stale revision or relation witness must refuse without changing state. A provisioned-ledger success must not become visible as an uncommitted publication.

Acceptance:
- A live child can move from parent #1414 to no parent, and the resulting ledger no longer reports that child in #1414's direct-child accounting.
- The same behavior supports moving a live child to a different valid epic without transiently publishing an invalid or double-parented state.
- A stale witness refuses deterministically and changes no item byte.
- Any validation, claim, or publication fence refusal changes no item byte.
- On a provisioned ledger, success is durable under the existing Git publication fence and does not leave an uncommitted relation mutation visible.
- The PropertyCompass2 #1414/#1415 reproduction can detach #1415 through the sanctioned path and then terminalize #1414; no hand-edit or recreate is required.
