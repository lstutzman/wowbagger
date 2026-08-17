---
schema_version: 2
id: wb_01KZHX3E00Z81H2BT71FGP1CZY
number: 44
title: "No item with dependents can be closed"
kind: task
priority: 1
status: done
created: 2026-08-09
updated: 2026-08-10
completed: 2026-08-10
provenance:
  source: "maintainer-dogfood"
  recorded_at: "2026-08-09T19:20:00.000Z"
depends_on: []
related: []
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
decisions:
  - action: accept
    date: 2026-08-09
    summary: "Accepted, taking the first option: give the backend multi-item atomic write scope."
    rationale: "Lee chose to build multi-item atomicity rather than redefine what depends_on means or push cleanup onto the dependent. That keeps the meaning of a dependency intact and closes the general defect rather than routing around it. The cost is larger than the three-option summary implied, and it is recorded here so nobody discovers it mid-implementation. This is not a bug fix. Section 2 states the backend's write scope is one Markdown item with no multi-item atomicity, and limits.multi_item_atomicity is advertised as false in the capabilities envelope, so consumers negotiate against it today. Delivering this flips a published capability, adds a write scope and a compare-and-set scope spanning N items, and needs crash recovery for a partially applied set. The hard part is publication: the contract's atomicity rests on same-path atomic replacement of one file, and no filesystem primitive replaces N files atomically, so the all-or-nothing guarantee has to be built from a journal or an equivalent recoverable protocol. Design comes before code."
  - action: complete
    date: 2026-08-10
    summary: "Delivered as schema version 2 rather than multi-item atomicity."
    rationale: "The item was filed because no item with dependents could reach a terminal status. Building multi-item atomic write scope was tried, reviewed, and rejected. Schema 2 instead defines depends_on as declared prerequisites, so a satisfied dependency stays recorded and the done transition remains a single-item compare-and-set. Item 13 closed immediately afterwards, which is the proof."
---

Item 13 met every acceptance criterion, its work merged to main, and the close was
refused:

    transition --to-status done -> atomic-scope-required, exit 5, unchanged
    blockers: dependent-cleanup on items 11, 37, 38, 39 (field depends_on)

When a target becomes done, the backend wants to clean the now-satisfied entry out
of every item whose depends_on names it. That is a mutation of other items, so
section 8 returns atomic-scope-required. Exit 5 means the backend lacks the
capability, and there is no scope flag to grant it. The single-item transition is
the only transition the CLI has.

The consequence is general, not specific to item 13: an item with any dependent can
never reach a terminal status. This repository only hit it now because item 13 is
the first done-transition here that had dependents at all. Every future epic, and
every item another item was built on, meets the same wall.

Which of three answers is right should be settled before any implementation:

- dependent cleanup is genuinely required, so the backend needs multi-item atomic
  write scope and the CLI needs a way to ask for it;
- a satisfied dependency should stay recorded, because depends_on is history rather
  than a live edge, and no cleanup is owed;
- cleanup is owed but belongs to the dependent, which drops the edge when it next
  transitions, leaving the target free to close now.

The second reading is cheapest and matches how the ready queue already treats a done
dependency, but it changes what depends_on means, and that is a contract change
rather than an implementation detail.

A smaller problem surfaced with it. Items 37, 38 and 39 were filed with
depends_on naming item 13 when they are follow-on work rather than blocked work;
related was correct, and items 41, 42 and 43 use it. Only item 11's dependency is
genuine. There is no supported way to fix the other three: patch accepts exactly
number and priority, and relations cannot change through any command. A ledger whose
relations can be written once and never corrected is its own defect.
