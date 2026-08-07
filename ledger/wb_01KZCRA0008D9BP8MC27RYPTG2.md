---
schema_version: 1
id: wb_01KZCRA0008D9BP8MC27RYPTG2
title: "Settle the PropertyCompass migration rulings before the first import"
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
priority: 10
number: 35
decisions:
  - action: accept
    date: 2026-08-07
    summary: "Accept: settle the four PropertyCompass migration rulings before any import."
    rationale: "Each of created-must-match-the-ULID-date, numeric-id demotion, inferred epic-ness, and fail-closed validation over 1473 items has a defensible answer and no recorded one. Answering them during an import rather than before it is how the priority deletion happened: a contract question settled implicitly and never written down."
---

Importing 1473 PropertyCompass items raises four questions that must be answered
before an import, not during one. Each has a defensible answer; none is recorded.

**1. `created` must equal the date encoded in the ULID.** Wowbagger enforces
this (`id-created-date-mismatch`). Historical items have real creation dates
spread over months. Either every minted ID encodes its item's historical date,
or every import fails. Minting to the historical date is defensible, because
the ULID timestamp is defined as the intended creation instant. It needs saying
out loud, because it looks like forgery until it is explained.

**2. PropertyCompass numeric IDs are identity; wowbagger `number` is not.**
PropertyCompass cites `#1291` in commit messages, `depends_on`, `parent`,
grooming records, and immutable filenames, and runs a claim script precisely to
make collisions impossible. Wowbagger states that two worktrees may allocate the
same `number`, and that a duplicate is a validation error resolved at merge.
Mapping one to the other preserves the digits and demotes them from identity to
nickname, while a hundred documents keep citing them.

**3. Epic-ness is inferred in PropertyCompass and declared in wowbagger.**
PropertyCompass treats an item as an epic if it carries the `epic` tag OR if any
open item names it as `parent`. Wowbagger requires `kind: epic` and refuses a
`parent` that does not resolve to one. The import must materialise `kind` for
every target of the 58 parented items; a tag-only epic with no children would
silently import as a task.

**4. Fail-closed validation meets a long tail of drift.** One structural error
invalidates the whole ledger and `ready` refuses to emit a partial list. That is
correct and is not in question. It does mean the first import is all-or-nothing
per ledger, and 121 killed items with stale numeric references are exactly the
kind of drift that will block the first `ready`. Expect a repair pass, and plan
for it rather than discovering it.

Acceptance:

- each of the four questions has a recorded answer before any bulk import runs;
- the `created` and ULID-date ruling in particular is written where an importer
  will read it, since the honest answer looks wrong without its reasoning; and
- if any answer is that the import cannot proceed as designed, that is a
  legitimate outcome and is recorded as one.

Surfaced 2026-08-07 by a read-only comparison of the two systems.
