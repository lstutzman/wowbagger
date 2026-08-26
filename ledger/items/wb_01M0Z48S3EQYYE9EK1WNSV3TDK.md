---
schema_version: 2
id: wb_01M0Z48S3EQYYE9EK1WNSV3TDK
number: 163
title: "Stress finding: claim-merge-verify sees nothing when two forks of one namespace mutate the same items"
kind: task
priority: 3
status: killed
created: 2026-08-26
updated: 2026-08-26
killed: 2026-08-26
provenance:
  source: "stress-run/2026-08-26/stress-run/waveC"
  recorded_at: "2026-08-26T13:31:04.689Z"
depends_on: []
related: []
tags:
  - "stress-run-2026-08-26"
decisions:
  - action: accept
    date: 2026-08-26
    summary: "Accept exploratory stress defect"
    rationale: "Reproduced against the repository source during the 257-item concurrent lifecycle run; actionable fix belongs in wowbagger."
  - action: kill
    date: 2026-08-26
    summary: "Close: prospective merge command was used pairwise"
    rationale: "claim-merge-verify verifies one base/head prospective merge. Comparing two sibling heads requires invoking it with those two refs; no three-way sibling comparison contract exists."
---

## Problem
Deliberate divergence: claimed-loop publications (clone-e) and unclaimed completions (clone-f) raced the same 12 items across clones sharing one namespace identity. claim-merge-verify --base main --head <either> reported ok with zero findings — it checks head-vs-base only and cannot see sibling-fork divergence. Git merged the item files cleanly because edits touched disjoint regions (body append vs frontmatter status), producing a silent semantic union; body-vs-body edits would have been a plain textual conflict where resolution silently discards one side. Neither outcome is detected or named by any wowbagger verb.

## Source
Coordinator integration observation, waveC integration; feeds #89 scope.
