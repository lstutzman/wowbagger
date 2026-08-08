---
schema_version: 1
id: wb_01KZE1GBG07PE2FEZQA32ZVQ36
number: 28
title: "Give every item a short human-readable handle"
kind: task
priority: 20
status: done
created: 2026-08-07
updated: 2026-08-08
completed: 2026-08-08
provenance:
  source: "maintainer-dogfood/wowbagger"
  recorded_at: "2026-08-07T12:00:00.000Z"
depends_on: []
related: [ wb_01KZE1GBG04T52TG5VJX4KV7N0 ]
parent: wb_01KZ77NSW8PNA4S48NYT26AGMH
decisions:
  - action: accept
    date: 2026-08-07
    summary: "Accepted: a 26-character ULID is unusable as a conversational handle."
    rationale: "Raised while reading a ready queue printed as sixteen bare ULIDs, which is the tool's primary human-facing surface. The canonical ULID stays; what is missing is a short handle beside it. Integers were requested but cannot be allocated without the coordination the ULID exists to avoid, so the item recommends a Git-style resolved short prefix and says plainly that this is not what was asked for."
  - action: complete
    date: 2026-08-08
    summary: "Completed: ready without --json is the human surface, showing handle, priority, and title."
    rationale: "The number field shipped earlier at eac8954; the open acceptance was the display. ready --ledger --as-of now prints one line per ready item — #number pri=priority title — in ready order, with dashes for absent fields. ready --json is byte-identical to before, so the adapter conformance vectors are untouched. A CLI test pins the format and ordering."
---

Nobody will say "let's do item wb_01KZ77NSW81FXZVAWQ8WT4KDCJ". **The `number`
field shipped at `eac8954`**: a positive integer, unique within one ledger,
validated, backfilled across all thirty existing items.

The first version of this item argued that integers could not be had cheaply,
because allocating a sequence reintroduces the coordination the ULID exists to
avoid. That reasoning was wrong and is recorded here so it is not repeated.

It conflated two different collisions. A ULID collision breaks identity and
atomic publication, so it must be impossible. A duplicate `number` is
recoverable — the ULID still distinguishes the items — so it is a validation
error that a merge resolves, like any other conflicting edit. Both duplicates
are flagged as `duplicate-number`, so a reader never silently gets the wrong
item.

`number` is explicitly not identity. Publication, references, and the filename
still use the immutable ID.

What is still open: **the human display surface.**

`ready --json` deliberately did not change. Its result is byte-compared by the
adapter conformance vectors, and a display concern does not belong in a
machine contract. So the field exists and the queue still prints bare ULIDs —
a reader has to render the numbers themselves, which is what happened when
this item was filed.

The remaining work is a human-readable `ready` that shows number, priority and
title. That means either making `--json` optional or adding an explicit format
flag, which is a CLI contract change and should be decided rather than
assumed.

Acceptance:

- every item carries a short handle — **done at `eac8954`**;
- a duplicate handle is refused with both participants flagged — **done**;
- the canonical ULID is unchanged — **done**; and
- `ready` has a human surface that shows the handle, so reading the queue does
  not require rendering it by hand.

Raised 2026-08-07 by the maintainer while reading a sixteen-ULID ready queue,
and again after the first answer declined to give integers.
