---
schema_version: 2
id: wb_01KZMFG500937XD19XGFA5EJ32
number: 46
title: "Allow an item to be marked deferred/held after creation"
kind: task
priority: 20
status: done
created: 2026-08-10
updated: 2026-08-11
completed: 2026-08-11
provenance:
  source: "consumer-dogfood/wowbagger-self"
  recorded_at: "2026-08-10T19:30:00.000Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-10
    summary: "Accepted from wowbagger self-dogfood: the ledger cannot mark an item deferred/held."
    rationale: "Raised by item 22's deferral, which could not be recorded in-band. No deferred status, no defer edge, snoozed_until is create-only. Files the deferral gap so it is tracked rather than left in a transcript."
  - action: complete
    date: 2026-08-11
    summary: "Implemented deferred status with defer/undefer transitions."
    rationale: "Added 'deferred' to STATUSES, TERMINAL_STATES, DECISION_ACTIONS, and TERMINAL_DATE_FIELDS. Added transition edges for backlog<->deferred with 'defer' and 'undefer' actions. Deferred items are excluded from ready (status !== 'backlog'). Deferral reason recorded via decision (requiresDecision: true). Item 22 can now be deferred in-band."
---
The ledger has no supported way to mark an existing item deferred or on hold.

Raised by item 22: the marketplace publication was intentionally deferred until
other issues finish and dogfooding proves the tool, but the ledger could not
record that in-band. There is no `deferred` status (only triage, backlog,
in-progress, done, killed, archived), no defer transition edge, and `snoozed_until`
is set only at create time and cannot be changed via patch or transition. The
deferral had to live in the handoff instead.

This is the same class of gap as the recorded 'change of direction' friction
(decisions attach only to evidence-appending edges) and the 'relationships cannot
be edited' friction. Coordination tooling should let a human park an item and
explain why, or the intent must leak into out-of-band notes.

Acceptance:

- a supported way to mark an in-backlog item deferred/held and to lift it back
  into ready, surviving validation;
- the deferral reason is recorded durably (a decision or first-class field) and
  visible in inspect;
- ready excludes deferred items until they are lifted;
- the mechanism follows the existing mutation discipline (single-item, revision
  compare-and-swap, atomic publication) rather than hand-editing.
