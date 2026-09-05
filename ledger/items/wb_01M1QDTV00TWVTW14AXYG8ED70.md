---
schema_version: 2
id: wb_01M1QDTV00TWVTW14AXYG8ED70
number: 204
title: "Name claim-lock contention and recovery details"
kind: task
priority: 20
status: triage
created: 2026-09-05
updated: 2026-09-05
provenance:
  source: "PropertyCompass2 defect digest #200 heading 19"
  recorded_at: "2026-09-05T16:59:00Z"
depends_on: []
related: [wb_01M127VNWZZ0Q58YW387RXHDWD]
tags:
  - "consumer-feedback"
  - "propertycompass2"
  - "defect-digest-200"
---

## Problem

`claim-store-locked` reports contention but does not name the logical lock artifact, whether its owner is live, or the safe recovery boundary. Operators cannot distinguish retryable live contention from a malformed or stale lock owner without inspecting Git internals manually. Orphan `.candidate-*` files are now ignored and dead valid lock owners are reclaimed, but the remaining refusal is still under-diagnosed.

## Reproduction

Hold a namespace claim lock from one process, then invoke a claim-protected command from another. Observe `claim-store-locked` without bounded owner age, owner operation, logical path role, or recovery guidance.

## Acceptance criteria

- Lock refusal details identify the logical lock role, the recognized owner operation, PID liveness when safely available, and bounded age information.
- Diagnostics never expose an unsafe caller-controlled absolute path.
- Live contention says when retry is safe; malformed ownership fails closed and gives explicit manual-escalation guidance.
- Dead valid owners continue to be reclaimed automatically, and orphan candidate files remain non-blocking.
- Crash and live-contention fixtures cover transition, patch, parent-migrate, and snooze owners.
