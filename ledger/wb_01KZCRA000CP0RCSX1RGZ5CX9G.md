---
schema_version: 1
id: wb_01KZCRA000CP0RCSX1RGZ5CX9G
title: "Pin the PropertyCompass extension profile, starting with the priority inversion"
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
priority: 5
decisions:
  - action: accept
    date: 2026-08-07
    summary: "Accept: pin the PropertyCompass extension profile and the priority inversion."
    rationale: "PropertyCompass priority_score is a float where higher is better; wowbagger priority is an integer where lower sorts first. A naive import fails loudly on the 993 float values and silently reverses the rest. This is the only gap found in the comparison that yields a ledger which validates clean and is wrong, so it is accepted above the rest of the batch."
  - action: record
    date: 2026-08-07
    summary: "Allocate the missing number through the CLI."
    rationale: "create does not allocate a number, so this item was filed without one. Patching it is the first use of the operation item 33 asked for, and it replaces the hand-edit that would otherwise bypass validation, the per-ID lock, and the compare-and-swap."
number: 34
---

PropertyCompass2 carries 1473 backlog items with their own frontmatter schema.
Wowbagger permits and preserves unknown frontmatter fields, so most of that
schema can ride as extension fields with no core change. One field cannot.

**The hazard.** PropertyCompass `priority_score` is a float where **higher is
better**. Wowbagger `priority` is a non-negative integer where **lower sorts
first**. Copying one into the other orders the queue exactly backwards. The
993 items carrying a float would also fail `invalid-priority`, so a naive
import fails loudly on some items and silently mis-ranks the rest.

The correct source is `priority_rank`, where 1 is best. That maps directly.
Nothing in either repository records this, and the two field names are similar
enough that the wrong one is the obvious choice.

This is the only gap found in the comparison that produces a ledger which
validates clean and is wrong. Every other gap fails loudly.

**The wider problem.** Extension fields work today by accident of policy, not
by agreement. `src/validate.js` rejects no unknown field, SPEC section 4.2
blesses them, create accepts them and transition preserves them. What is
missing is a written statement of what any of them mean. The next consumer
will invent `severity` differently, and two ledgers will disagree while both
validate.

The PropertyCompass fields worth naming, with the count of items carrying each:
`severity` 735, `complexity` 1296, `tags` 1260, `tier` 1080, `commit` 827,
`completion_summary` 894, `blocks` 186, `verified` 26, `started` 596,
`design_doc` 335, `duplicate_of` 48, `merged_from` 54, `due` rare.

Acceptance:

- the `priority_score` to `priority` conversion is documented as a conversion,
  with its inverted sense stated, wherever a consumer would look before an
  import;
- a named extension profile states the meaning and type of each field above,
  so a second consumer adopts the same names rather than inventing them; and
- the profile is explicitly consumer policy, not core contract. Wowbagger core
  still calculates nothing and validates none of it beyond the rules it
  already applies.

Surfaced 2026-08-07 by a read-only comparison of the two systems, before the
first PropertyCompass dogfood.
