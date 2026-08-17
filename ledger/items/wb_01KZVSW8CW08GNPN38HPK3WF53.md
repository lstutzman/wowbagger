---
schema_version: 2
id: wb_01KZVSW8CW08GNPN38HPK3WF53
number: 58
title: "Define the lifecycle status of claimed work"
kind: task
priority: 30
status: done
created: 2026-08-12
updated: 2026-08-12
completed: 2026-08-12
provenance:
  source: "propertycompass-consumer-dogfood"
  recorded_at: "2026-08-12T20:16:45Z"
depends_on: []
related: [ wb_01KZBT447HVZ9798DXV1NTT515, wb_01KZBMBEZKPE7D15HKW9Q3GSZV ]
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
decisions:
  - action: accept
    date: 2026-08-12
    summary: "Accept the claimed-lifecycle ambiguity at priority 30."
    rationale: "The protected workflow intentionally skips in-progress, but neither the lifecycle surface nor the installed skill makes that observer-visible tradeoff explicit."
  - action: complete
    date: 2026-08-12
    summary: "Complete claimed-work lifecycle guidance."
    rationale: "The installed skill now states that claimed work remains in backlog and the active claim is the work-in-flight signal; the packaging guidance test passes."
---

An active claim correctly causes legacy `transition` from backlog to in-progress to refuse with `active-claim-write-refused`. The installed skill acquires the claim, performs work, and publishes backlog directly to done, so a ledger-only observer never sees `in-progress`. The only alternatives are transition before claim or hand-building the complete candidate bytes.

Done means either a claim-aware status transition can move an owned item to `in-progress`, or the installed skill explicitly states that claimed work stays in backlog and that the claim, not lifecycle status, is the work-in-flight signal.
