---
schema_version: 2
id: wb_01KZBT435CG4HMTP0H6F3CTTNA
number: 21
title: "Deliver wowbagger as a consumable product"
kind: epic
status: backlog
created: 2026-08-06
updated: 2026-08-17
provenance:
  source: "repository-backlog"
  recorded_at: "2026-08-06T15:12:29Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-06
    summary: "Accept into the productization epic."
    rationale: "Filed so the work is tracked in wowbagger's own ledger rather than in a session transcript."
  - action: defer
    date: 2026-08-13
    summary: "Defer the remaining productization epic."
    rationale: "The released product and consumer dogfood satisfy the first distribution milestone, but native Linux and Windows support evidence remains open and full PropertyCompass migration remains unauthorized."
  - action: undefer
    date: 2026-08-17
    summary: "Undefer."
    rationale: "Overtaken by events: PropertyCompass2 runs wowbagger in parallel with its legacy backlog on published alpha.5 - the dual-run that item 80 planned is live in the field, a fourteen-hundred-item provisioned ledger reconciles cleanly, and three days of field reports have driven eleven shipped fixes. The consumable-product epic is no longer hypothetical; its remaining children are the formal cutover plan."
---

Make wowbagger consumable by repositories and harnesses other than this one.

The standalone v0 epic covers the core: contracts, the mutation runtime, claims,
and the conformance vectors. This epic covers everything required for someone
else to install wowbagger and drive real work with it — harness adapters, a
distribution channel, a release path, and first-party adoption in a live
consumer.

The two epics have a clean boundary. If it changes what the core does, it
belongs to standalone v0. If it changes how the core reaches a consumer, it
belongs here.

Definition of done for this epic: a named external consumer runs a released
wowbagger, installed through a real distribution channel, to coordinate its own
work — without copying files out of this repository.
