---
schema_version: 2
id: wb_01KZVSW8AHGEJFVSX56ASRB2S5
number: 57
title: "Support or reject a repository-root ledger at provision time"
kind: task
priority: 20
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
    summary: "Accept the repository-root layout defect at priority 20."
    rationale: "Provision accepts a layout that claim verification cannot use, then reports the path failure as an unreadable claim store."
  - action: complete
    date: 2026-08-12
    summary: "Complete repository-root ledger support."
    rationale: "Provision and claim-verify now support a ledger at the repository root while keeping reconciliation data inside the repository metadata boundary."
---

In a fresh Git repository, `wowbagger provision --ledger . --json` succeeds and writes `.wowbagger/namespace`. The next `claim-verify --ledger . --json` exits 6 with `claim-store-unavailable` and reason `claim-store-unreadable`. The claim store is readable; reconciliation-log derivation targets a parent outside the repository and fails.

Done means a repository-root ledger works without writing outside the repository, or `provision` refuses the layout before mutation with an error that names the actual layout constraint. `claim-verify` must not blame the claim store for a reconciliation-log path failure.
