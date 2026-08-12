---
schema_version: 2
id: wb_01KZVSW85FS738V9VM942M7NS6
number: 55
title: "Expose Git finalization in claim-verify output"
kind: task
priority: 1
status: backlog
created: 2026-08-12
updated: 2026-08-12
provenance:
  source: "propertycompass-consumer-dogfood"
  recorded_at: "2026-08-12T20:16:45Z"
depends_on: []
related: [ wb_01KZBT447HVZ9798DXV1NTT515, wb_01KZBMBEZKPE7D15HKW9Q3GSZV ]
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
decisions:
  - action: accept
    date: 2026-08-12
    summary: "Accept the Git-finalization observability defect at priority 10."
    rationale: "The same successful JSON describes both an uncommitted working-tree publication and a Git-finalized publication, which makes an automation durability gate impossible."
---

The pilot ran `claim-verify` immediately after `publish-claimed` while the item was untracked, then again after committing it. Both calls returned `ok: true`, top-level `state: "committed"`, and `findings: []`; only `observed_at` differed. The journal records `publish-finalization` only after Git `HEAD` contains the revision, but the command response does not expose that distinction. Automation can therefore mistake a clean check for Git durability.

Done means `claim-verify` reports a machine-readable per-publication Git-finalization state, including the commit when present. The response and documentation must distinguish a clean uncommitted working-tree publication from a revision finalized in Git.
