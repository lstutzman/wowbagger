---
schema_version: 1
id: wb_01KZBT447HVZ9798DXV1NTT515
priority: 10
number: 23
title: "Run wowbagger inside PropertyCompass from the installed skill"
kind: task
status: backlog
created: 2026-08-06
updated: 2026-08-08
provenance:
  source: "repository-backlog"
  recorded_at: "2026-08-06T15:12:29Z"
depends_on: []
related: []
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
decisions:
  - action: accept
    date: 2026-08-06
    summary: "Accept into the productization epic."
    rationale: "Filed so the work is tracked in wowbagger's own ledger rather than in a session transcript."
  - action: record
    date: 2026-08-08
    summary: "Rank the PropertyCompass dogfood at 10."
    rationale: "The comparison behind items 34 to 36 was read-only. Running the tool there is what turns those predictions into evidence, and PropertyCompass carries 1473 items against this repo's 42."
---

Install the released wowbagger skill in PropertyCompass and use it to coordinate
real work there, with PropertyCompass's existing backlog left in place.

This is the first-party dogfood and the first proof the product works outside
this repository. It is deliberately NOT the full backlog migration: that is
tracked separately and is gated on fenced work claims, because PropertyCompass
writes its backlog from roughly twenty concurrent worktrees and advisory claims
enforce nothing.

Scope: install the skill from the real distribution channel rather than a local
path, provision a namespace in that repository, and drive a genuine unit of work
through the ledger — file it, select it from the ready queue, claim it, and
close it. Record what the loop actually felt like to use, including anything the
tool made harder than doing it by hand.

Done means: work was coordinated in PropertyCompass through an installed
wowbagger, and the friction found is filed here as items rather than left in a
session transcript.
