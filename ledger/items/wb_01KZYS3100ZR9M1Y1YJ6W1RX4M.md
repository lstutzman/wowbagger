---
schema_version: 2
id: wb_01KZYS3100ZR9M1Y1YJ6W1RX4M
number: 80
title: "Run a Wowbagger-active parallel proof period in PropertyCompass"
kind: task
priority: 10
status: backlog
created: 2026-08-14
updated: 2026-08-17
provenance:
  source: "user-decision"
  recorded_at: "2026-08-14T13:24:17.000Z"
depends_on: []
related: [ wb_01KZ77NSW8363H1V6QG1HZRG11, wb_01KZYS3100NYPQ6AXGTBM9BFGT ]
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
decisions:
  - action: accept
    date: 2026-08-16
    summary: "Accept into the backlog at triage review."
    rationale: "The proof-period plan Lee decided on 2026-08-14; the current dual-run (legacy authoritative) is the precursor phase, this item governs the later wowbagger-sole-writer phase."
---

# Decision

PropertyCompass2 will not remove its legacy backlog when the full Wowbagger migration lands. Both systems remain present during a proof period. Wowbagger is the sole active write system. The legacy `docs/backlog/` system remains read-only as the rollback and audit baseline.

Do not implement dual writes. Two writable systems would create drift and ambiguous partial-failure recovery. Rollback is an explicit authority change: stop Wowbagger writes, reconcile evidence, and re-authorize legacy writes through a Lee decision.

Legacy removal requires a later explicit Lee decision after Wowbagger has proved real use.

# Required operation

During the proof period, every new item, lifecycle transition, priority change, claim operation, and supported relationship change goes through Wowbagger. Existing legacy files and tools remain present but frozen. Reconciliation must detect any legacy mutation as a failure.

Collaborators need one documented write path, one authority signal, and exact recovery instructions. Existing numeric references remain usable through Wowbagger core `number` plus the frozen source-to-target mapping.

# Acceptance criteria

1. The migration leaves every legacy backlog file and tool present and byte-unchanged.
2. Documentation names Wowbagger as the only active write system and the legacy backlog as read-only.
3. Legacy create, claim, prioritization, and lifecycle instructions display an explicit freeze notice or route collaborators to Wowbagger without deleting the old implementation.
4. No automation writes both systems.
5. Reconciliation detects any change to the pinned legacy baseline and fails loudly.
6. Rollback instructions stop Wowbagger writes before legacy writes are re-authorized.
7. The proof period exercises real claimed lifecycles, deterministic ready selection, preserved artifact links, writer coordination, response-loss recovery, and collaborator use.
8. Proof metrics and exit criteria are recorded before the period starts.
9. The proof-period report records every defect and its resolution.
10. Legacy removal or permanent cutover requires a separate Lee decision.
11. No merge, push, PR, tag, or remote mutation occurs before Lee releases the current migration gate.
