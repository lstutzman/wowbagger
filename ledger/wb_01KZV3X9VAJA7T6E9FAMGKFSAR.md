---
schema_version: 2
id: wb_01KZV3X9VAJA7T6E9FAMGKFSAR
number: 50
title: "Expose the Git prerequisite before provisioning claims"
kind: task
priority: 20
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
    summary: "Expose the Git prerequisite before claim provisioning."
    rationale: "Provision command help now names the Git-checkout prerequisite and directs operators and automation to the ledger-specific claim capability preflight. The shipped skill runs that preflight before provision and stops when work claims are unsupported. README gives the same gate. A CLI test pins the help contract, and an end-to-end smoke check confirmed supported false outside Git, supported true in this checkout, and the unchanged exit-6 git-directory-not-found provision refusal."
  - action: accept
    date: 2026-08-12
    summary: "Accept the Git-prerequisite discovery defect at priority 20."
    rationale: "The existing structured failure and README are correct, but an operator cannot discover the prerequisite from the relevant capability or command-help surface before attempting provision. This is real friction with a stable fallback error already present."
---

In a non-Git directory, `wowbagger provision --ledger ledger --json` exited 6 with `claim-store-unavailable` and `details.reason: git-directory-not-found`. The error is clear after failure. The README also says that work-claim and namespace operations need Git, so this is not absent from all documentation. It is not discoverable from the generic capability output or the provision command help before the operator attempts the mutation.

The generic backend name `local-filesystem` reinforced the wrong preflight assumption during dogfood.

Done means an operator or automation can discover the Git-checkout prerequisite before calling `provision`, through the relevant capability/help surface, while the existing structured failure remains stable for race and environment changes.
