---
schema_version: 2
id: wb_01M0Z48PJCFSR3SJCBSBYVFGK2
number: 160
title: "Design question: a zero-child epic completes to done with an empty rollup"
kind: task
priority: 3
status: killed
created: 2026-08-26
updated: 2026-08-26
killed: 2026-08-26
provenance:
  source: "stress-run/2026-08-26/stress-run/probe"
  recorded_at: "2026-08-26T13:31:02.094Z"
depends_on: []
related: []
tags:
  - "stress-run-2026-08-26"
decisions:
  - action: kill
    date: 2026-08-26
    summary: "Close as non-defect design question"
    rationale: "Zero-child epic completion is contract-literal behavior; changing it requires an explicit product decision, not a defect fix."
---

## Observation
Created epic #257 with zero children, accepted triage→backlog, then backlog→done succeeded immediately: "every direct child done or killed" is vacuously true. A never-populated epic reaches terminal done instantly with rollup []. Contract-literal but semantically questionable — completion should arguably require at least one direct child, or the emptiness should be visible in the decision.

## Source
F-P-002 (coordinator probe).
