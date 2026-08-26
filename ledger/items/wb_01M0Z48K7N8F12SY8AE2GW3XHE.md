---
schema_version: 2
id: wb_01M0Z48K7N8F12SY8AE2GW3XHE
number: 156
title: "Stress finding: read-only claim-verify overloads the response-loss state tokens (unknown/committed)"
kind: task
priority: 2
status: backlog
created: 2026-08-26
updated: 2026-08-26
provenance:
  source: "stress-run/2026-08-26/stress-run/waveB+C"
  recorded_at: "2026-08-26T13:30:58.679Z"
depends_on: []
related: []
tags:
  - "stress-run-2026-08-26"
decisions:
  - action: accept
    date: 2026-08-26
    summary: "Accept exploratory stress defect"
    rationale: "Reproduced against the repository source during the 257-item concurrent lifecycle run; actionable fix belongs in wowbagger."
---

## Problem
claim-verify is a diagnostic with no publication ambiguity, yet returns exit 6 state:"unknown" on stale-write findings and state:"committed" with 251 uncommitted writes in a clone. Operator guidance treats state:"unknown" as stop-everything; automation treating state:"committed" as durability proof gets lied to. It is neither a halt token nor a durability gate, but its envelopes impersonate both.

## Source
F-P-007, F-BWaveB2-22, F-BWaveB3 distinct_refusals, F-CWaveCE-3.
