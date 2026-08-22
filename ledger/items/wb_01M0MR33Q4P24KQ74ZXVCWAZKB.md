---
schema_version: 2
id: wb_01M0MR33Q4P24KQ74ZXVCWAZKB
number: 134
title: "Guard unchanged mutation refusals against reconcile-log residue regression"
kind: task
priority: 10
status: done
created: 2026-08-22
updated: 2026-08-22
completed: 2026-08-22
provenance:
  source: "propertycompass2-field-report-23"
  recorded_at: "2026-08-22T12:45:57.539Z"
depends_on: []
related: [ wb_01M058P3KQDSD269YXN5B4KSAK, wb_01M057PTYZ18N6EE76AEW46E0R ]
decisions:
  - action: accept
    date: 2026-08-22
    summary: "Accept item into backlog for maintainer triage."
    rationale: "The reported scope is recorded; backlog acceptance makes it eligible for scheduling and implementation."
  - action: complete
    date: 2026-08-22
    summary: "Complete unchanged refusal residue regression coverage."
    rationale: "Current preflight refusal leaves reconciliation bytes unchanged; focused regression test distinguishes it from durable publish refusal and peer findings."
---

## Problem

PropertyCompass2 reported that failed `transition` attempts with `state: unchanged` still dirtied `ledger/.wowbagger/reconcile-*.md` on published alpha.6. Item #96 previously completed the same defect in this repository and states that refused mutations leave the ledger working tree byte-identical, except for a documented durable publish-claimed refusal terminal. The new field report is therefore either an alpha.6 observation already fixed in the current core, a regression, or an uncovered refusal path.

The report occurred while unrelated global reconciliation findings blocked item #1637. The target item was unchanged, but the caller retained tracked reconciliation-log residue after the refusal. The residue must be separated from the independent branch-local global-deadlock defect filed beside this item.

## Scope

1. Reproduce the PropertyCompass sequence on the current core, not alpha.6: provisioned Git ledger, global `publication-reconciliation-required` finding on another item, attempted transition that returns `state: unchanged`, then exact before/after bytes and Git status for every path under the ledger.
2. Exercise each unchanged legacy transition refusal path, including reconciliation preflight refusal, active claim, invalid edge, revision conflict, and operation pre-publication failure. Exercise the documented publish-claimed durable-refusal exception separately.
3. If current source is clean, add a regression vector that would fail if the alpha.6 behavior returns and document the release boundary; do not change production code merely to manufacture a fix.
4. If any current path dirties the tracked reconcile log, fix the source of that write so `state: unchanged` leaves item and reconciliation surfaces byte-identical unless the contract explicitly proves a durable terminal was appended.
5. Ensure `--auto-commit` never commits residue from a refused unchanged mutation.

## Acceptance criteria

- A deterministic fixture reproduces the field-report preconditions and records exact before/after ledger paths.
- Every ordinary `state: unchanged` refusal leaves the tracked ledger working tree byte-identical.
- The publish-claimed durable-refusal exception is named, bounded, and independently tested rather than generalized to legacy mutation refusals.
- The next unrelated mutation is not blocked by residue created by the refused command itself.
- Tests distinguish this issue from a pre-existing stale journal entry or private peer commit; cleaning residue must not hide the global finding.
- Current Node and Node 20 gates pass, with mutation testing of the write guard.

## Evidence

PropertyCompass2 `docs/wowbagger-feedback.md` entry 23 on feature `1637-page-help-disclosure`, 2026-08-22, against published alpha.6. Related completed item #96 and commit-per-mutation documentation item #88.

## Additional staging-5 evidence

PropertyCompass2 PR #2237 reports a refused patch of #1533 appending 11 lines to the tracked reconciliation log even though the command returned `ok: false`, `state: unchanged`, and never touched #1533. The worktree was fresh from `origin/staging`; the refusal came from unrelated global claim findings. The tracked residue then changed a docs-only branch into the full CI profile.

This evidence narrows the current-core reproduction: exercise the pre-mutation global reconciliation refusal path, not only lifecycle/request/revision refusals reached after the legacy mutation fence has authorized an intent. The before/after assertion must include exact reconciliation-log line count and byte digest.

PropertyCompass evidence: `docs/wowbagger-feedback.md`, 2026-08-22 entry in PR #2237.
