---
schema_version: 2
id: wb_01KZW6PA002MMJWTKCKFD9SBXW
number: 68
title: "Make adapter describe refusals actionable"
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
    summary: "Accept the describe refusal usability defect."
    rationale: "The describe wire drops available request diagnostics and leaves a malformed caller without actionable guidance."
---
## Problem

A malformed adapter `describe` request returns only `{"ok":false,"error":{"code":"invalid-describe-request"}}`. The sibling `invoke` refusal includes a message and `details.member`. Without the adapter contract in an npm-only installation, the describe caller cannot discover the required request shape from either documentation or the refusal.

## Acceptance criteria

- Define the version-1 describe refusal envelope in the adapter contract before changing the wire.
- A malformed describe request returns a stable human message and the existing precise member detail.
- The independent adapter oracle and conformance fixtures agree with the documented envelope.
- All adapter entrypoints return the same describe refusal bytes for the same request.
- Adapter conformance passes on the current Node runtime and Node 20.
