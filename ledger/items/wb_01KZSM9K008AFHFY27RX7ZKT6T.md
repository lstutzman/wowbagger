---
schema_version: 2
id: wb_01KZSM9K008AFHFY27RX7ZKT6T
number: 64
title: "Require matching plugin and core distributions"
kind: task
priority: 20
status: done
created: 2026-08-12
updated: 2026-08-12
completed: 2026-08-12
provenance:
  source: "propertycompass-consumer-dogfood-final"
  recorded_at: "2026-08-12T22:45:00Z"
depends_on: []
related: [ wb_01KZSM9K00AEWED9YWTB5G867A, wb_01KZVSW80HMW6RM39MX90P1TSH ]
decisions:
  - action: accept
    date: 2026-08-12
    summary: "Accept distribution-version mismatch detection."
    rationale: "The clean alpha.2 pilot proved that contract version 2 alone cannot distinguish alpha.1 behavior from alpha.2 behavior."
  - action: complete
    date: 2026-08-12
    summary: "Require the matching core distribution."
    rationale: "The installed skill checks its exact distribution version and contract version 2; packaging tests pin release metadata."
---
## Problem

A new installed plugin skill can accept an older core that reports the same contract version while lacking release-specific behavior described by the skill. Extending the exact contract-version-2 capability envelope would break the independent adapter oracle and older adapters.

## Acceptance criteria

- The installed skill runs `wowbagger --version` before ledger work.
- It requires the exact core distribution version that shipped with the plugin, in addition to core contract version 2.
- It stops and reports installed and required versions when the distribution version is absent or different, even when the contract version matches.
- Packaging tests enforce that the skill's required distribution equals `package.json` and plugin metadata.
