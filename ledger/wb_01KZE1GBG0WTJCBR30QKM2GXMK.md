---
schema_version: 1
id: wb_01KZE1GBG0WTJCBR30QKM2GXMK
number: 33
title: "Let the CLI change an item's frontmatter, not just its status"
kind: task
status: done
created: 2026-08-07
updated: 2026-08-07
completed: 2026-08-07
provenance:
  source: "maintainer-dogfood/wowbagger"
  recorded_at: "2026-08-07T12:00:00.000Z"
depends_on: []
related: []
parent: wb_01KZ77NSW8PNA4S48NYT26AGMH
priority: 10
decisions:
  - action: accept
    date: 2026-08-07
    summary: "Accepted: priority cannot be changed through the CLI, only by hand-editing YAML."
    rationale: "Hit three times in one session — setting priority, backfilling numbers, correcting bodies. Each hand-edit bypassed validation, the per-ID lock, and the compare-and-swap transition provides. It also makes the plugin's own instruction, drive the core rather than hand-edit, impossible to follow for frontmatter."
  - action: complete
    date: 2026-08-07
    summary: "Completed: patch changes a narrow frontmatter set under the transition guarantees."
    rationale: "The patchable set is exactly priority, number, parent, depends_on and title. status stays with transition so no second path can bypass the decision record transition appends, and id, schema_version and created stay immutable. Every patch requires a decision, because a silent priority change is the failure ADR 0006 records. The operation reuses transition per-ID lock, revision compare-and-swap, candidate validation and atomic publication rather than reimplementing them. Advertising it widened the adapter command list, which the maintainer authorised and ADR 0008 records; a test proves the list stayed exact by removing patch from an otherwise valid list and confirming the independent oracle still refuses it. First use was allocating the missing number on item 34, with the stale-revision, absent-parent, status and missing-decision refusals all exercised against the live ledger."
---

There is no way to change an item's priority, number, parent, or dependencies
through the CLI. `create` sets frontmatter once; `transition` changes status and
appends a decision, and the mutation contract states it cannot supply
frontmatter patches. Everything else requires hand-editing Markdown.

This was hit three times in one session: setting priority on five items,
backfilling `number` across thirty, and correcting two item bodies. Each was a
hand-edit, which `CONTRIBUTING.md` does sanction as a reviewable Git change —
so the ledger stayed correct — but every one of those edits bypassed
validation, the per-ID lock, and the compare-and-swap that `transition` exists
to provide. A concurrent writer could have lost them.

The gap is sharper now that priority is restored. Priority is the field most
likely to change during normal use — that is what a priority is for — and it is
the one field a consumer cannot change without editing YAML by hand.

It also blocks the plugin. The skill tells a consumer to drive the core rather
than hand-edit ledger files, because hand-edits bypass validation and atomic
publication. That instruction is currently impossible to follow for any
frontmatter change.

The design question is scope, not desirability. `transition` refuses changes
that would require touching another item, and that refusal is correct. A patch
operation needs the same boundary: which fields may change, whether a decision
record is required, and what happens when a patch would invalidate a relation.

Acceptance:

- a consumer can change priority through the CLI, under the same revision
  compare-and-swap and per-ID lock that transition uses;
- the set of patchable fields is stated in the mutation contract rather than
  discovered; and
- a patch that would require changing another item refuses, consistent with
  transition.

Surfaced 2026-08-07 after three separate hand-edits in one session.
