---
schema_version: 2
id: wb_01KZVSW885W9T05HSZK1GC0241
number: 56
title: "Keep reconciliation logs inside the configured ledger"
kind: task
priority: 2
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
    summary: "Accept the reconciliation-path defect at priority 20."
    rationale: "The configured ledger boundary does not contain all ledger-derived writes, and the extra path is not disclosed before it is created."
  - action: complete
    date: 2026-08-12
    summary: "Complete ledger-contained reconciliation logging."
    rationale: "The reconciliation log now lives inside the configured ledger boundary, including nested-ledger coverage, and the reconciliation suite passes."
---

With `--ledger docs/pilots/wowbagger-ledger`, `claim-verify` wrote `docs/pilots/wowbagger/reconcile-<namespace>.md`. The derived path is `<parent-of-ledger>/wowbagger/reconcile-<namespace>.md`, outside the configured ledger. Nothing in capabilities, the installed skill, or the response announces this extra write boundary. A routine parent-directory `git add` swept the file into the consumer commit.

Done means the derived reconciliation log lives inside the configured ledger, preferably under its `.wowbagger/` metadata directory. If an external path remains necessary, it must be configurable and returned by the command that writes it.
