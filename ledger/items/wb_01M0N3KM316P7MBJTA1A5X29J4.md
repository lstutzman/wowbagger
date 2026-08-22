---
schema_version: 2
id: wb_01M0N3KM316P7MBJTA1A5X29J4
number: 139
title: "Synchronize committed adoption rulings into fresh claim clones"
kind: task
priority: 1
status: backlog
created: 2026-08-22
updated: 2026-08-22
provenance:
  source: "propertycompass2-staging-5-field-report-2-pr-2250"
  recorded_at: "2026-08-22T16:07:11.478Z"
depends_on: []
related: [ wb_01M07J8W5TS6PVKFZ1T4RTN184, wb_01M057PY03G5AM0MMAKA5R9AT9, wb_01M0MR2Y8GKNCTTVS9V5ZX8Q0N, wb_01M0MY9NE61SATX6EHFZS99WH0 ]
decisions:
  - action: accept
    date: 2026-08-22
    summary: "Accept item into backlog for maintainer triage."
    rationale: "The reported scope is recorded; backlog acceptance makes it eligible for scheduling and implementation."
---

## Problem

PropertyCompass2 staging-5 field report #2, committed in `docs/wowbagger-feedback.md` entry `2026-08-22 (pm)` and PR #2250, found that recovery rulings recorded in a committed reconciliation log are not consumed by a fresh sibling clone's local claim journal.

On `origin/staging`, adoption rulings for #648 (`sha256:fe0487ab…` -> `sha256:547b8944…`) and #1484 (`sha256:c8c1a4ab…` -> `sha256:835c79ac…`) were present in `ledger/.wowbagger/reconcile-wbns_32119a74e42d76532139a4baf4f87a65.md` at sequences 4247 and 4253. A fresh worktree of a sibling clone at the same HEAD still ran `claim-verify` with the pre-adoption expected revisions, returned `ok: false` with `unauthorized-revision`, and refused `create` with `claim-store-unavailable` / `publication-reconciliation-required`. Repeating the identical `claim-adopt` in that clone made verification clean and allowed create of #1677. Its journal commit was later dropped as already upstream: two clones independently wrote the same adoption entries, and the second append-only-log commit conflicted during rebase.

The authoritative journal is per Git common directory under work-claim contract section 3.1, but committed reconciliation evidence is not projected into a clone's local journal. Claim verification therefore treats already-committed adoption rulings as absent.

## Scope

1. Reproduce with two clones or isolated Git-common-directory claim stores: publish adoption entries in one clone, commit the reconciliation log, then verify the same HEAD from a sibling clone whose local journal lacks those entries. Pin the current unauthorized-revision and publication-reconciliation-required findings before any repeated adoption.
2. Add an explicit synchronization seam. Prefer a machine-readable `claim-sync` or `claim-import` operation if importing committed evidence would make `claim-verify` non-read-only; otherwise define the exact safe ingestion semantics for `claim-verify`.
3. Import only valid `revision-adoption` records from the committed reconciliation log at the checked-out HEAD when they are newer than local journal state. Validate namespace, item ID, from/to revisions, operation identity, ordering, and complete item bytes before accepting them.
4. Make import idempotent and deterministic across clones. Identical adoption records must not be appended twice, produce competing Git commits, or require every clone to re-adopt the same revision. Conflicting or ambiguous records fail closed with bounded JSON diagnostics.
5. Preserve the existing claim fence: no item bytes change, no adoption is synthesized, no stale witness is widened, and no unrelated journal record is accepted. Distinguish committed-log import from a new operator ruling in result schemas and audit evidence.
6. Document the fallback if automatic import is rejected: every clone must explicitly re-adopt, and the reconciliation-log merge/commit procedure must make duplicate adoption entries deterministic without rebase loss.

## Acceptance criteria

- A normative two-clone fixture reproduces the staging-5 sequence: committed adoption evidence exists at the shared HEAD, the sibling local journal starts stale, and pre-fix verification/create refuse.
- The chosen sync/import contract consumes the committed adoption evidence without a second `claim-adopt`, then `claim-verify` is clean and `create` succeeds.
- Repeating sync is a no-op; concurrent or repeated imports produce no duplicate journal lines or conflicting commits.
- Item bytes, revisions, Git refs, and unrelated claim records remain unchanged; only the explicitly documented local synchronization state may change.
- Invalid, conflicting, out-of-order, wrong-namespace, and wrong-item adoption records fail closed with strict bounded JSON.
- Current Node and Node 20 gates pass, including mutation coverage for import authority, ordering, and idempotency.

## Evidence

PropertyCompass2 staging-5 field report #2, `docs/wowbagger-feedback.md`, entry `2026-08-22 (pm)`, PR #2250.
