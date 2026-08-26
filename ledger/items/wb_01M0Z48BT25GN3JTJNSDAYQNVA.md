---
schema_version: 2
id: wb_01M0Z48BT25GN3JTJNSDAYQNVA
number: 147
title: "Stress finding: fresh clone is permanently dirty — committed reconcile-log export vs empty journal kills --auto-commit forever"
kind: task
priority: 1
status: backlog
created: 2026-08-26
updated: 2026-08-26
provenance:
  source: "stress-run/2026-08-26/stress-run/waveB"
  recorded_at: "2026-08-26T13:30:51.076Z"
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
`<ledger>/.wowbagger/reconcile-<ns>.md` is a DERIVED export ("Derived from the authoritative common-directory journal") yet lives COMMITTED in the tracked ledger tree. A fresh clone has an empty journal, so the regenerated export (181-byte header) never equals the committed export carrying the origin history. Every `--auto-commit` mutation refuses `auto-commit-preflight-failed / ledger-not-clean` naming that file, forever.

## Evidence
- clone-d: 226/226 auto-commit attempts refused; identical 264 ops succeeded 264/264 without the flag.
- Deleting the file does not help (refusal names the absent path); running claim-verify re-creates it (the command every remediation string names re-arms the blocker); claim-sync no-ops (imported_count 0).
- validate stays `{valid:true}`: a cloned provisioned ledger is read-only through the supported path while looking healthy.

## Fix shape
Stop committing the derived export and/or exclude it from the clean check.

## Source
F-P-013, F-BWaveB3-23, F-BWaveB2-14/15.
