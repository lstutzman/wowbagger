---
schema_version: 2
id: wb_01M0Z48GR62MCZEM2ZBG933BTN
number: 153
title: "Stress finding: cloning forks the claim coordinator while keeping one namespace identity"
kind: task
priority: 1
status: killed
created: 2026-08-26
updated: 2026-08-26
killed: 2026-08-26
provenance:
  source: "stress-run/2026-08-26/stress-run/waveC"
  recorded_at: "2026-08-26T13:30:56.136Z"
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
    summary: "Close: clone coordination is explicitly unsupported"
    rationale: "The capability and contract explicitly set cross_clone_coordination to false; independent clones have separate journals by design. Improve documentation only if desired, not a defect fix."
---

## Problem
A clone advertises the SAME provisioned namespace (`wbns_…`, from committed `.wowbagger/namespace`) but has its OWN empty common-dir journal. claim read in clone-f returned last_epoch "0"/active null for items WaveCE held active claims on in clone-e. Two disjoint coordinators share one identity; epoch/owner guarantees silently end at the clone boundary, and nothing detects the fork.

## Source
F-CWaveCF structural finding 2, cross-clone claim visibility probes.
