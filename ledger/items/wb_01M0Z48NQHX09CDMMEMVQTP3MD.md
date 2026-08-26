---
schema_version: 2
id: wb_01M0Z48NQHX09CDMMEMVQTP3MD
number: 159
title: "Stress finding: create accepts a draft key named \"extensions\" and serializes a zombie nested map invisible to patch and extensions-provision"
kind: task
priority: 2
status: done
created: 2026-08-26
updated: 2026-08-26
completed: 2026-08-26
provenance:
  source: "stress-run/2026-08-26/stress-run/setup"
  recorded_at: "2026-08-26T13:31:01.235Z"
depends_on: []
related: []
tags:
  - "stress-run-2026-08-26"
decisions:
  - action: accept
    date: 2026-08-26
    summary: "Accept exploratory stress defect"
    rationale: "Reproduced against the repository source during the 257-item concurrent lifecycle run; actionable fix belongs in wowbagger."
  - action: complete
    date: 2026-08-26
    summary: "Fix defect and verify the corrected behavior."
    rationale: "The implementation now satisfies the reported contract and the current and Node 20 regression suites pass."
---

## Problem
Canonical extension members are FLAT frontmatter members (create serializes item.tags flat; patch set.extensions writes flat; extensions-provision scans flat). But create ALSO accepted `item.extensions:{...}` verbatim and serialized a NESTED `extensions:` map. Result: one item carried `extensions.tier: gold` AND flat `tier: lead` simultaneously — two values for one logical member — and validate passes. The nested members are invisible to every CLI verb.

## Consequence chain
On a ledger whose items only have nested maps, extensions-provision refuses every member with extension-member-absent → declaration impossible → set.extensions dead-ended behind extension-declaration-missing. Self-inconsistent with create's own accepted shape.

## Repro
create request with item:{extensions:{tier:'gold'}}; then patch set.extensions{tier:'lead'}; inspect shows both; validate clean. Then delete flat copies and try extensions-provision.

## Source
F-001/F-002 (setup), independently rediscovered by WaveB1 during verification.
