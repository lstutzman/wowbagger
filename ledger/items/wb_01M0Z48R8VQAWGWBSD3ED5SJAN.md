---
schema_version: 2
id: wb_01M0Z48R8VQAWGWBSD3ED5SJAN
number: 162
title: "DX: list/read request contracts are rejection-only discoverable; snapshot cursors die under concurrent writers"
kind: task
priority: 3
status: triage
created: 2026-08-26
updated: 2026-08-26
provenance:
  source: "stress-run/2026-08-26/stress-run/waveA"
  recorded_at: "2026-08-26T13:31:03.837Z"
depends_on: []
related: []
tags:
  - "stress-run-2026-08-26"
---

## Problem
- list requires --input with query_version/as_of/page_size(≤200)/sort{field,direction:ascending|descending}; rejects page numbers (cursor-based) — none documented in --help; four guess-and-refuse round trips were typical across three independent agents.
- as_of demands YYYY-MM-DD while other surfaces accept ISO instants.
- Under concurrent writers every pagination attempt dies with list-snapshot-changed; no snapshot pin, no resume.
- inspect rejects --input; claim-verify absent from top-level --help; snooze undocumented anywhere.

## Source
F-AWaveA4-10, F-AWaveA5-4/-5, F-AAuth-V5, F-P-008.
