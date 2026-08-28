---
schema_version: 2
id: wb_01M141C1H4068AQEDSP7JWR5R5
number: 180
title: "Normalize Windows file-ancestor report path failures to ENOTDIR"
kind: task
priority: 1
status: triage
created: 2026-08-28
updated: 2026-08-28
provenance:
  source: "no-mistakes/01M13V2KDWVXHHBNWZEWSZ7CQK/ci"
  recorded_at: "2026-08-28T11:16:45Z"
depends_on: []
related: [wb_01M13SBJHZABPX0QTNCFEGYMWM]
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
