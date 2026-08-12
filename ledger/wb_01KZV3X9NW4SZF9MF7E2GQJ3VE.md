---
schema_version: 2
id: wb_01KZV3X9NW4SZF9MF7E2GQJ3VE
number: 47
title: "Disambiguate core and provisioned claim capabilities"
kind: task
priority: 1
status: done
completed: 2026-08-12
created: 2026-08-12
updated: 2026-08-12
provenance:
  source: "propertycompass-dogfood-pilot"
  recorded_at: "2026-08-12T13:52:27Z"
depends_on: []
related: [ wb_01KZBT447HVZ9798DXV1NTT515 ]
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
decisions:
  - action: complete
    date: 2026-08-12
    summary: "Clarify capability context on machine and human surfaces."
    rationale: "Core help now names the unbound default claim profile and directs operators to the ledger-specific probe. Claim and publication help name the provisioned gate. The normative contracts identify namespace and backend as the existing machine discriminator without changing the version-2 wire."
  - action: accept
    date: 2026-08-12
    summary: "Accept the capability-context defect at priority 1."
    rationale: "The first consumer saw two valid capability profiles as contradictory and nearly aborted a supported claimed-work flow. Machine output and help must identify which context they describe and which probe gates ledger-specific publication."
---

PropertyCompass dogfood found that two successful capability probes use the same field names for different contexts. `wowbagger capabilities --json` reports the unprovisioned local-filesystem work-claim profile as `mode: advisory`, `claim_protected_publication: false`, and `cross_worktree_coordination: false`. After `provision`, `wowbagger claim capabilities --ledger ledger --json` reports the provisioned Git-journal profile as `mode: merge-coordinated`, `claim_protected_publication: true`, and a shared Git common-directory scope. `wowbagger publish-claimed --help` also says publication is unavailable on an advisory backend.

Expected: capability output and help text make the context boundary explicit and tell an operator which probe gates a claimed-work loop. Actual: an operator sees apparently contradictory values and can conclude that `publish-claimed` is unavailable. This matched a written pilot stop condition and nearly aborted the run.

Done means the machine and human surfaces distinguish core/unprovisioned mutation capabilities from ledger-specific provisioned claim capabilities without requiring prior contract knowledge, and the claimed-work command help is conditional rather than categorical.
