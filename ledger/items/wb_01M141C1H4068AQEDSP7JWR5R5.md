---
schema_version: 2
id: wb_01M141C1H4068AQEDSP7JWR5R5
number: 180
title: "Normalize Windows file-ancestor report path failures to ENOTDIR"
kind: task
priority: 1
status: done
created: 2026-08-28
updated: 2026-08-28
completed: 2026-08-28
provenance:
  source: "no-mistakes/01M13V2KDWVXHHBNWZEWSZ7CQK/ci"
  recorded_at: "2026-08-28T11:16:45Z"
depends_on: []
related: [ wb_01M13SBJHZABPX0QTNCFEGYMWM ]
decisions:
  - action: accept
    date: 2026-08-28
    summary: "Accept the hosted Windows report-path defect."
    rationale: "Required Windows Node 20 CI reproduced a wrong public error class in an existing behavioral test. The defect predates #179, but excluding its surgical fix leaves the alpha.12 release blocked. It remains separately attributed and documented."
  - action: complete
    date: 2026-08-28
    summary: "Normalized Windows file-ancestor report path failures."
    rationale: "Hosted Windows Node 20 CI failed the existing public CLI test with report-write-failed/EEXIST before the fix. That test explicitly requires report-read-failed, resolve-output-path, ENOTDIR, unchanged blocker bytes, and no output publication. Commit 260be63 adds only a stat guard after ancestor realpath in src/report.js. The pipeline's Windows-semantic simulation failed before the guard and passed after it; the macOS report suite passed 12/12; hosted CI passed after the separate commit."
---
## Problem

Hosted Windows Node 20 CI failed the existing public report-path contract while validating the alpha.12 barrier hotfix. When an output path descends through a regular file, POSIX `realpath` reports `ENOTDIR`, but Windows maps the condition to `ENOENT`. `resolvePhysicalPath` treated that as a missing segment, climbed to the file, and let resolution succeed. The failure then surfaced during publication as `report-write-failed` with `EEXIST` instead of the contracted pre-publication `report-read-failed` with operation `resolve-output-path` and cause `ENOTDIR`.

This defect predates #179. It is included as a separately committed CI companion because reverting it leaves required hosted Windows CI red and blocks the alpha.12 release.

## Acceptance criteria

- Keep `test/report-publication.test.js` at the public CLI seam; it must assert `report-read-failed`, `resolve-output-path`, `ENOTDIR`, unchanged blocker bytes, and no published report.
- Reproduce Windows `realpath` semantics against pre-fix `resolvePhysicalPath`; the public behavior must fail as `report-write-failed`/`EEXIST`.
- After a successful ancestor `realpath` with unresolved path segments, reject a non-directory ancestor as `ENOTDIR`.
- Do not change broader report publication semantics or the public test expectation.
- Confirm the scratch Windows simulation passes after the guard, the macOS report suite passes, and hosted Windows Node 20 CI passes.
- Attribute production commit `260be63` and add a distinct Unreleased changelog entry.
