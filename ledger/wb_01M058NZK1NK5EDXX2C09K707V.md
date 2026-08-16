---
schema_version: 2
id: wb_01M058NZK1NK5EDXX2C09K707V
number: 95
title: "Name actual dates and UTC derivation in transition date refusals"
kind: task
priority: 10
status: backlog
created: 2026-08-16
updated: 2026-08-16
provenance:
  source: "consumer-field-feedback"
  recorded_at: "2026-08-16T00:00:00.000Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-16
    summary: "Accept the corrected/new PropertyCompass2 field finding."
    rationale: "Field paper-cut 9: correct invariant, insufficient diagnostics; UTC/ULID date derivation is undocumented."
---
Field paper-cut 9 (report: .PropertyCompass2/worktrees/260815-212735/docs/wowbagger-feedback.md): a create just after midnight UTC mints created=next-day (the created date derives from the ULID timestamp, which is UTC), so a transition dated with the operator’s local calendar date refuses `transition-precondition-failed` with `date-before-created`/`date-before-updated`. The invariant is correct; the diagnostics are not: the refusal names neither the item’s actual created/updated values nor that they are UTC/ULID-derived (verified: transitionPreconditions in src/mutation.js emits code/field/message with empty related_ids and no dates). Every occurrence costs an inspect round-trip.

Scope:
1. Include the item’s current `created` and `updated` values in the precondition issue details for both date refusal codes (same for the patch preconditions, which share the shape).
2. Document in the mutation contract and skill that create derives the created date from the ULID timestamp in UTC, with the across-midnight example.
3. Mirror the enriched issue shape in the oracle and conformance fixtures - this widens a refusal envelope, so pin it deliberately.

Acceptance:
- A fixture test asserts the date-before-created refusal carries the item’s actual created and updated values.
- Contract and skill state the UTC/ULID derivation; the across-midnight footgun is documented where transition dates are explained.
- Oracle and fixtures agree with the new shape (mutation-guarded both directions); gate green on both runtimes.