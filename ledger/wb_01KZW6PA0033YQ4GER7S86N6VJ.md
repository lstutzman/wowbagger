---
schema_version: 2
id: wb_01KZW6PA0033YQ4GER7S86N6VJ
number: 66
title: "Return the contracted publish-claimed retry guidance"
kind: task
priority: 20
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
    summary: "Accept the publish retry guidance defect."
    rationale: "The alpha.3 CLI contradicts the stable recovery message in the installed work-claim contract."
---
## Problem

A `publish-claimed` request that contains only `operation_id` returns the correct `invalid-request` code but the wrong message. The installed alpha.3 contract promises `The publish-claimed retry must include its complete request.` The CLI returns the generic schema-version message instead. This failure occurs at the response-loss recovery seam where the caller needs exact retry guidance.

## Acceptance criteria

- A behavior test reproduces the operation-ID-only request and fails before the fix.
- The refusal keeps exit 2, code `invalid-request`, and state `unchanged`.
- The refusal message is exactly `The publish-claimed retry must include its complete request.`
- Other malformed version-1 requests keep their existing deterministic schema refusals.
- The mutation suites pass on the current Node runtime and Node 20.
