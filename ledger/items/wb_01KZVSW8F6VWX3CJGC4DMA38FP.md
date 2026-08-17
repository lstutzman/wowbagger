---
schema_version: 2
id: wb_01KZVSW8F6VWX3CJGC4DMA38FP
number: 59
title: "Make contract documents available to package-only consumers"
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
related: [ wb_01KZBT447HVZ9798DXV1NTT515 ]
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
decisions:
  - action: accept
    date: 2026-08-12
    summary: "Accept the missing installed-contract defect at priority 30."
    rationale: "The skill requires exact contract documents that a package-only consumer does not receive."
  - action: complete
    date: 2026-08-12
    summary: "Complete installed contract packaging."
    rationale: "The npm package now ships both contract documents referenced by the installed skill; the package test and npm pack dry run confirm both files."
---

The installed skill directs consumers to `docs/mutation-contract.md` and `docs/work-claim-contract.md` for exact request and response envelopes. The npm package excludes `docs/`, so those paths do not exist under the installed core. The pilot could read them only because the Claude Code plugin cache happened to contain a full repository snapshot.

Done means the published npm package includes the referenced contract documents, or the installed skill points to stable published URLs or another guaranteed installed location. A package-only consumer must be able to construct every documented request without a source checkout.
