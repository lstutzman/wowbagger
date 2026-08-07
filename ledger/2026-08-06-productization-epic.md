---
schema_version: 1
id: wb_01KZBT435CG4HMTP0H6F3CTTNA
number: 21
title: "Deliver wowbagger as a consumable product"
kind: epic
status: backlog
created: 2026-08-06
updated: 2026-08-06
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
