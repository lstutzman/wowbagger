---
schema_version: 2
id: wb_01KZSM9K00AEWED9YWTB5G867A
number: 63
title: "Detect skill and core behavior mismatches"
kind: task
priority: 20
status: killed
created: 2026-08-12
updated: 2026-08-12
killed: 2026-08-12
provenance:
  source: "propertycompass-consumer-dogfood-final"
  recorded_at: "2026-08-12T22:45:00Z"
depends_on: []
related: [ wb_01KZVSW80HMW6RM39MX90P1TSH ]
decisions:
  - action: accept
    date: 2026-08-12
    summary: "Accept consumer-dogfood finding G5."
    rationale: "The published alpha.2 artifact reproduces the finding on a clean consumer installation."
  - action: kill
    date: 2026-08-12
    summary: "Reject capability-envelope extension and replace with item 64."
    rationale: "Core contract version 2 has an exact capability schema enforced by the independent adapter oracle. Adding members without a contract bump breaks existing adapters. Item 64 detects the same mismatch through the existing distribution-version seam."
---
## Problem

The alpha.2 skill accepts any core with `contract_version: 2`. Alpha.1 also reports contract version 2 but lacks alpha.2 behavior that the skill requires: empty ledgers start on schema version 1 and `claim-verify` omits per-publication Git finalization. The documented version-mismatch gate is therefore silent.

## Acceptance criteria

- Core capability output advertises the empty-ledger schema default used by `create`.
- Work-claim capability output advertises per-publication Git-finalization evidence from `claim-verify`.
- The installed skill requires both behavior capabilities and refuses when either is absent or has the wrong value.
- Contract-version compatibility remains separate from behavior-capability compatibility.
- Tests cover the capability envelopes and installed skill gate.
