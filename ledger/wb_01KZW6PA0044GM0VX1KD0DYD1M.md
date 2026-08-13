---
schema_version: 2
id: wb_01KZW6PA0044GM0VX1KD0DYD1M
number: 67
title: "Ship the adapter contract with npm adapters"
kind: task
priority: 30
status: backlog
created: 2026-08-13
updated: 2026-08-13
provenance:
  source: "propertycompass-consumer-dogfood-run-5"
  recorded_at: "2026-08-13T09:30:22Z"
depends_on: []
related: [ wb_01KZSM9K00YKVC09P3KGGR6A0K ]
decisions:
  - action: accept
    date: 2026-08-13
    summary: "Accept the missing adapter contract defect."
    rationale: "The npm artifact ships adapter executables without the contract needed by npm-only consumers."
---
## Problem

The npm package ships the three adapter executables but omits `docs/adapter-contract.md`. npm-only consumers can execute the adapters but cannot read their contract. Plugin consumers see the file only because the plugin payload carries the repository.

## Acceptance criteria

- `npm pack --dry-run --json` includes `docs/adapter-contract.md`.
- A packaging test fails if any shipped adapter contract is absent.
- The package continues to exclude unpublished and internal directories.
- The packed npm artifact contains all three documented contracts and the adapter executables.
