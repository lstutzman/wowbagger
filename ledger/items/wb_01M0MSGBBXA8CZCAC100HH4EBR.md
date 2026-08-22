---
schema_version: 2
id: wb_01M0MSGBBXA8CZCAC100HH4EBR
number: 135
title: "Return every tracked path changed by a managed mutation"
kind: task
priority: 2
status: triage
created: 2026-08-22
updated: 2026-08-22
provenance:
  source: "propertycompass2-field-report-msg-fffb996b3be5"
  recorded_at: "2026-08-22T13:10:52.057Z"
depends_on: []
related: [wb_01M057PTYZ18N6EE76AEW46E0R, wb_01KZVSW885W9T05HSZK1GC0241, wb_01M0JNSCGBXZSJ447Z11PKTHZC]
---

## Problem

PropertyCompass2 alpha.6 ran seven CAS-fenced managed mutations during the #648 backlog surgery. Five successful `transition` and `patch` commands returned only `result.item.path`, but each invocation also appended an intent/commit pair to `ledger/.wowbagger/reconcile-<namespace>.md`. An exact-path commit built from the machine envelope staged only the item; ten reconciliation rows remained dirty and a later rebase refused with `cannot rebase: You have unstaged changes`.

Broad `git add ledger/` is not a safe remedy under concurrent worktrees. `--auto-commit` returns `commit_paths`, but the unflagged mutation response does not identify its complete changed-path set. A host-routed plugin or disciplined manual caller cannot construct the commit-per-mutation loop from the public response alone.

## Scope

1. Reproduce successful manual `transition`, `patch`, `create`, and `publish-claimed` commands on a provisioned ledger and record every tracked path whose bytes change. Include commands that are journal-silent by design rather than assuming one path set for all verbs.
2. Define one core/work-claim response member, such as `changed_paths`, containing the complete ordered ledger-relative set changed by that invocation. Reuse the same path derivation that auto-commit validates; do not infer from `git status` after the response.
3. Return only paths the invocation itself changed. Never broaden to a directory, include foreign dirty paths, expose absolute paths, or imply that the paths are already Git-committed.
4. Keep `result.item.path`, `commit_paths`, recovery-token commit sets, and response-domain dispatch internally consistent. State which member describes publication, working-tree changes, and established Git commits.
5. For `state: unchanged`, return no changed path unless the contract explicitly proves a durable refusal terminal changed the reconciliation surface; name that exception rather than hiding it.
6. Publish the path member in JSON Schemas, capabilities/host guidance, mutation contract, installed skill, and normative fixtures so Orca can commit exact paths without parsing human output.

## Acceptance criteria

- Normative fixtures pin exact changed-path arrays for create, transition, patch, publish-claimed, ordinary refusals, and the durable-refusal exception.
- Every actual tracked byte change made by an invocation appears exactly once, ledger-relative and in deterministic order.
- No unchanged or foreign path appears.
- Manual exact-path staging of the returned set leaves no invocation-owned ledger residue and does not stage an unrelated sibling mutation.
- Auto-commit's `commit_paths` equals the changed tracked set it commits, subject only to an explicitly documented untracked/transient artifact rule.
- Response loss/recovery and schema tests preserve response-domain exactness under core v5 and work-claim API v2.
- Current Node and Node 20 gates pass with mutation testing of omissions and extras.

## Evidence

Orca message `msg_fffb996b3be5`, PropertyCompass2 feedback log section `2026-08-22 — #648 targeted backlog split`. Five successful mutations changed item plus reconciliation log while their envelopes named only the item path; ten journal rows remained unstaged.
