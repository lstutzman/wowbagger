---
schema_version: 2
id: wb_01M0MY9NE61SATX6EHFZS99WH0
number: 138
title: "Validate prospective claim-journal semantics before merge"
kind: task
priority: 1
status: in-progress
created: 2026-08-22
updated: 2026-08-22
provenance:
  source: "propertycompass2-feedback-20-corroboration"
  recorded_at: "2026-08-22T14:34:21.584Z"
depends_on: []
related: [ wb_01KZBMBEZKPE7D15HKW9Q3GSZV, wb_01M057PY03G5AM0MMAKA5R9AT9, wb_01M07J8W5TS6PVKFZ1T4RTN184, wb_01M0MR2Y8GKNCTTVS9V5ZX8Q0N ]
decisions:
  - action: accept
    date: 2026-08-22
    summary: "Accept item into backlog for maintainer triage."
    rationale: "The reported scope is recorded; backlog acceptance makes it eligible for scheduling and implementation."
---

## Problem

PropertyCompass2 feedback #20 reported that the append-only reconciliation journal merges cleanly as text while its semantic authorization order can reverse. Branch-local `claim-verify` success does not prove the merge result is authorized: Git combines journal lines and item bytes independently, then the merged journal can resolve an item to a different authorized revision than the item bytes present in the same merge tree.

The #648 rescue reproduced this live on published alpha.6. Before merging latest `origin/staging`, `claim-verify` was clean and journal seq 4253 authorized reviewed #648 revision `sha256:fe0487ab…` (tag parity fix). The Git merge was conflict-free and changed no #648 item content, but staging carried a later adoption of predecessor `sha256:9608b4c…`. Immediately after merge, `claim-verify` expected `9608b4c…` and rejected committed `fe0487ab…` bytes as `unauthorized-revision`. Recovery required a second explicit post-merge `claim-adopt` back to `fe0487ab…` and another committed journal entry.

Textual merge success is therefore not semantic claim-store success. Evaluating each parent branch before merge misses the failure by construction.

## Scope

1. Add a normative two-branch fixture where each parent is individually clean, one parent carries a reviewed mutation from predecessor R0 to R1, the other carries a later adoption of R0, and Git produces a conflict-free merge containing item R1 plus journal authorization R0.
2. Define one read-only machine contract that evaluates the exact prospective merge tree: complete ledger item bytes plus the reconciliation journal as they will exist after merge. It must not append, adopt, repair, or otherwise mutate either parent, the working tree, or the candidate tree.
3. Wire the repository merge/push gate to this prospective check. Parent-branch `claim-verify` runs remain useful but are insufficient; the gate must fail before publication when semantic replay of the merged journal disagrees with merged item bytes.
4. Return a structured failure naming item ID, actual merged revision, expected authorized revision, decisive journal records/sequences, and both parent/candidate identities so an operator can distinguish merge-order reversal from an out-of-protocol edit.
5. Keep recovery explicit. The gate must never auto-adopt, reorder committed evidence, discard a reviewed item revision, or synthesize a journal entry. It should state the valid choices and require the operator to publish the chosen authorization through the existing fenced operation.
6. Specify ordering and duplicate/conflict rules for reconciliation records independently of textual line placement. Reject an ambiguous prospective journal rather than choosing by Git hunk order.
7. Update work-claim contract, merge workflow, installed skill, and consumer guidance. Remove the design claim that textual reconciliation-log merge alone supplies semantic order unless the new invariant makes that statement true.

## Acceptance criteria

- Normative fixture proves both parent branches pass independently, the textual merge is conflict-free, and the prospective merged-state check fails before push with `unauthorized-revision`.
- The fixture models the #648 recurrence: R0 `9608b4c…`, reviewed R1 `fe0487ab…`, later R0 adoption, and unchanged item bytes during merge.
- A compatible two-branch merge passes the same prospective check.
- Failure output is strict JSON, bounded, stable, and identifies the exact records that determine the conflicting authorization.
- The check is side-effect-free; byte-for-byte assertions prove no item, journal, lock, claim, snapshot, or Git ref changes.
- Gate tests prove checking only source and target parents would pass while checking their exact merge result refuses.
- Recovery tests prove only an explicit fenced adoption or restoration clears the finding and leaves `claim-verify` clean.
- Current Node and Node 20 gates pass.

## Evidence

PropertyCompass2 #648 rescue, 2026-08-22. Live sequence: clean at seq 4253 with reviewed `fe0487ab…`; conflict-free merge with staging's later `9608b4c…` adoption; immediate `unauthorized-revision` against unchanged `fe0487ab…` item bytes; explicit post-merge adoption back to `fe0487ab…`; clean verification. This independently corroborates PropertyCompass2 feedback #20.
