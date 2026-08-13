---
schema_version: 2
id: wb_01KZW6PA00XX20A5D3NT2FRF4H
number: 69
title: "Align unsupported epic edge refusal with the contract"
kind: task
priority: 30
status: done
created: 2026-08-13
updated: 2026-08-13
completed: 2026-08-13
provenance:
  source: "propertycompass-consumer-dogfood-run-5"
  recorded_at: "2026-08-13T09:30:22Z"
depends_on: []
related: [ wb_01KZSM9K00YKVC09P3KGGR6A0K ]
decisions:
  - action: accept
    date: 2026-08-13
    summary: "Accept the unsupported epic edge contract defect."
    rationale: "The implementation reaches candidate validation before applying the documented invalid-edge transition precondition."
  - action: complete
    date: 2026-08-13
    summary: "Reject unsupported epic edges before candidate validation."
    rationale: "The kind-aware backlog predicate now excludes epic to in-progress, so the transition returns the documented transition-precondition-failed invalid-edge refusal without writing the item. The regression test verifies the exact envelope, unchanged source bytes, and clean artifacts."
---
## Problem

`epic` backlog to in-progress returns `candidate-invalid`. Other unsupported lifecycle edges return `transition-precondition-failed`. The mutation contract says no other edge is supported and lists `invalid-edge` as a deterministic precondition issue, so the epic result bypasses the documented transition refusal precedence.

## Acceptance criteria

- A behavior test reproduces backlog epic to in-progress and fails before the fix.
- The refusal uses `transition-precondition-failed` with one `invalid-edge` issue, unless a contract decision explicitly defines a different stable rule.
- Unsupported task and epic edges have one documented code-selection rule.
- Candidate validation remains the final authority only after ordinary transition preconditions pass.
- The mutation suites pass on the current Node runtime and Node 20.
