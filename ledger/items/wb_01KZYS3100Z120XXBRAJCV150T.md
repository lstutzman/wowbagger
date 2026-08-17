---
schema_version: 2
id: wb_01KZYS3100Z120XXBRAJCV150T
number: 74
title: "Project incompatible PropertyCompass lifecycle relationships losslessly"
kind: task
status: backlog
created: 2026-08-14
updated: 2026-08-16
provenance:
  source: "propertycompass-migration-inventory"
  recorded_at: "2026-08-14T13:24:17.000Z"
depends_on: []
related: [ wb_01KZ77NSW8363H1V6QG1HZRG11 ]
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
decisions:
  - action: accept
    date: 2026-08-16
    summary: "Accept into the backlog at triage review."
    rationale: "Reviewed projection rule for 15 terminal dependency conflicts and the in-progress source epic; validator-compatible and lossless, agreed decision recorded."
---

# Problem

The PropertyCompass2 inventory contains 15 done cards whose `depends_on` targets are not done. Examples include #313 depending on #312 (killed) and #521 (backlog), #372 depending on #371 (backlog), #433 depending on #430 (backlog), and #634 depending on #628 (killed). Wowbagger schema version 2 requires every dependency of a done item to be done.

Source epic #1075 is `in-progress`. Wowbagger epics do not support that lifecycle state. Direct field translation would make the target ledger invalid. Changing or dropping source evidence would make the migration lossy.

# Decision

Keep each terminal card's compatible core lifecycle state. Preserve incompatible historical dependencies in queryable `legacy_relationships` extension data and in the original body. Do not silently recast them as `related`. Populate core `depends_on` only for validator-valid nonterminal projections.

Map source epic #1075 to core kind `epic` and core status `backlog`. Preserve its exact legacy `in-progress` status, dates, and evidence in extension data and the original body.

# Acceptance criteria

1. The migration mapping enumerates all 15 terminal dependency conflicts and source epic #1075.
2. Each done source card remains core `done`.
3. No validator-incompatible dependency enters a terminal item's core `depends_on`.
4. Every original relationship remains exact and queryable in extension data and the migrated body.
5. No historical dependency is silently relabeled as `related`.
6. Epic #1075 becomes core `epic`/`backlog` and retains exact legacy status, dates, and evidence.
7. The reconciliation report explains every omitted or changed core projection.
8. Ready-queue verification accounts for the backlog projection of #1075 and every active dependency projection.
9. The final target ledger validates without dropping source lifecycle or relationship evidence.
