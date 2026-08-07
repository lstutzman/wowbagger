---
schema_version: 1
id: wb_01KZCRA000P3YCVCV5AS0M8YZF
title: "Adopt per-kind item templates and the durability doctrine"
kind: task
status: backlog
created: 2026-08-07
updated: 2026-08-07
provenance:
  source: "consumer-research/propertycompass2"
  recorded_at: "2026-08-07T15:30:00.000Z"
depends_on: []
related: []
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
priority: 20
number: 36
decisions:
  - action: accept
    date: 2026-08-07
    summary: "Accept: adopt per-kind item templates and the durability doctrine."
    rationale: "Wowbagger prescribes nothing about an item body and PropertyCompass has 1473 items of evidence that typed templates raise item quality and that code-coordinate items rot. The durability doctrine is one paragraph and is the most transferable idea in the comparison. Accepted at low priority because nothing is blocked on it."
---

Wowbagger prescribes nothing about an item body. `docs/mutation-contract.md`
treats it as opaque bytes. `CONTRIBUTING.md` says only to keep explanatory
documentation outside `ledger/`. Real items converge by author habit alone.

PropertyCompass has 1473 items of evidence that this is worth fixing, and two
conventions worth taking wholesale.

**The durability doctrine.** From its `backlog-format.md`:

    A backlog item may sit for weeks before an agent picks it up, and the tree
    moves underneath it. Describe the work as behaviour and interface contracts
    -- "the sync service fails to apply the patch", not "ApplyPatch() throws at
    FooService.cs:42" -- so the item still reads true after refactors.

This costs one paragraph and is the most transferable idea in the comparison.
It has two deliberate exceptions worth carrying across: a point-in-time
verification stamp pinned to a commit, because it is proof rather than
description; and a snippet that encodes a decision more precisely than prose.

**Per-kind templates.** PropertyCompass forbids hand-rolling an item and
supplies four templates. Each forces the questions that kind of work needs:
a defect states repro and impact, tech debt states the desired end state, an
epic lists its children. Wowbagger has one kind axis already (`task` and
`epic`) and no templates for either.

A third convention is smaller but real: PropertyCompass uses `***` for a body
horizontal rule, never `---`, to avoid any chance of a body line reading as a
frontmatter boundary. Whether wowbagger's parser is actually vulnerable to this
is untested and should be tested before the rule is adopted or dismissed.

What wowbagger already does better, and should keep: `decisions[]` is a
structured, mandatory, machine-checked record where PropertyCompass has
unstructured grooming prose. A migration should promote those prose sections
into decision records rather than flatten them into the body.

Acceptance:

- the durability doctrine is stated in `CONTRIBUTING.md`, with its exceptions;
- an item body has a stated shape per kind, so an author is not guessing; and
- the `---` in a body question is answered by a test rather than by assumption.

Surfaced 2026-08-07 by a read-only comparison of the two systems.
