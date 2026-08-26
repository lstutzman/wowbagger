---
schema_version: 2
id: wb_01M0Z48M2HEEM5BFJBWZCDMRFS
number: 157
title: "Stress finding: preflight refusal drops the findings it already computed"
kind: task
priority: 2
status: triage
created: 2026-08-26
updated: 2026-08-26
provenance:
  source: "stress-run/2026-08-26/stress-run/waveB"
  recorded_at: "2026-08-26T13:30:59.539Z"
depends_on: []
related: []
tags:
  - "stress-run-2026-08-26"
---

## Problem
First refusal after a certified-clean state returned `reason: claim-state-unreconciled` with `findings: []` — no item, no remediation — while a simultaneous claim-verify returned 87 concrete stale-write-detected findings naming items and revisions. The information existed and was omitted from the mutating path's envelope, forcing an extra round-trip to learn what to fix.

## Source
F-P-011, F-BWaveB3 (findings-empty refusal row).
