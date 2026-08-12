---
schema_version: 2
id: wb_01KZSM9K00YKVC09P3KGGR6A0K
number: 65
title: "Publish immutable 0.1.0-alpha.3 release"
kind: task
priority: 10
status: in-progress
created: 2026-08-12
updated: 2026-08-12
provenance:
  source: "propertycompass-consumer-dogfood-final"
  recorded_at: "2026-08-12T22:45:00Z"
depends_on: [ wb_01KZSM9K0056M70JN6BJFYBDQV, wb_01KZSM9K008AFHFY27RX7ZKT6T ]
related: [ wb_01KZVSW80HMW6RM39MX90P1TSH ]
decisions:
  - action: accept
    date: 2026-08-12
    summary: "Accept alpha.3 release after pilot corrections."
    rationale: "Items 62 and 64 correct published consumer guidance and detect plugin/core release mismatch; both require immutable artifact proof."
---
## Acceptance criteria

- Current Node and Node 20 suites pass.
- Adapter conformance, ledger validation, claim verification, npm audit, plugin validation, and package dry run pass.
- Package, lockfile, plugin, marketplace, README, skill, and changelog name `0.1.0-alpha.3`.
- Annotated tag `v0.1.0-alpha.3` resolves to the release commit.
- npm serves `wowbagger@0.1.0-alpha.3`, and `next` points to it.
- A clean consumer dogfood rerun passes with no source-checkout workaround.
