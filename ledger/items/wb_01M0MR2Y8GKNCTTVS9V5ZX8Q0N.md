---
schema_version: 2
id: wb_01M0MR2Y8GKNCTTVS9V5ZX8Q0N
number: 133
title: "Stop branch-local claim publications globally deadlocking sibling worktrees"
kind: task
priority: 1
status: triage
created: 2026-08-22
updated: 2026-08-22
provenance:
  source: "propertycompass2-field-report-22-23"
  recorded_at: "2026-08-22T12:45:57.539Z"
depends_on: []
related: [ wb_01M057PY03G5AM0MMAKA5R9AT9, wb_01M05ESRM258XEJJW7G15TXJ68 ]
---

## Problem

PropertyCompass2 alpha.6 reported two independent staging sessions blocked before touching their requested items by the repository-wide provisioned claim coordinator. The shared Git-common-directory journal recorded a valid legacy mutation on an item whose commit existed only on another live, unmerged worktree branch. The current checkout could not make that item revision visible from `origin/staging`, and merging the unrelated live branch would violate worktree authority. Every create, transition, and patch in the namespace remained refused with `claim-store-unavailable`, `publication-reconciliation-required`, and `stale-write-detected`.

The concrete blocked item was `wb_01M0KC8S00JYEAJD1JAKEESATG` (#1677), expected revision `sha256:ddb08a8ec4bbd7289fc0d58aeded5b287f50161ec776cf7005f5161adc103aa5`, actual revision null, observed on the working-tree surface with reason `worktree-synchronization-required`. The item existed only on live branch `docs/648-sdlt-backlog-surgery`; it was absent from `origin/staging`. A separate unauthorized revision on #648 was successfully repaired with `claim-adopt`, proving that adoption is not the missing remedy here.

Items #89 and #98 made global worktree serialization honest and removed one misleading remediation clause, but the remaining advice still says to synchronize by pull or merge. That has no safe action when the owning commit is intentionally unmerged, unavailable, abandoned, or deleted.

## Scope

1. Reproduce on the current core with two real Git worktrees: publish and commit an item mutation on branch A, keep that commit unreachable from branch B's selected ledger ref, then prove an unrelated item mutation on B is globally refused.
2. Record the exact journal, Git-HEAD, working-tree, branch, and reachability facts that make the refusal safe or unnecessary. Do not infer from filenames or copy bytes between worktrees.
3. Decide the coordination key deliberately: item-scoped reconciliation, reachable ledger ref, an explicit `--ref`, or another design that preserves durable publication detection without making one branch's private work a global write barrier.
4. Provide deterministic recovery when the journal expects a commit that is not reachable from the blocked checkout and may no longer exist. Recovery must not require merging unrelated live work or discarding reviewed bytes.
5. Enrich `stale-write-detected` findings with the owning branch/ref and commit when they can be established. When another live worktree owns the publication, remediation says WAIT for that owner to publish; it never directs a sibling to merge unauthorized work.
6. Preserve claim fencing, exact-byte CAS, commit-per-mutation durability, and `safe_exclusive_dispatch: false`. A local availability fix must not pretend to provide cross-clone or hostile-writer exclusion.
7. Update `claim capabilities` so the advertised serialization scope and unblock condition match the repaired behavior.

## Acceptance criteria

- Normative two-worktree fixtures cover: visible peer commit, private live peer commit, abandoned/deleted peer branch, unrelated target item, same target item, and later synchronization.
- An unrelated private branch publication cannot permanently deadlock every other item mutation on the machine.
- A same-item concurrent write still refuses under a deterministic CAS/fence rule.
- Every refusal names the owning ref/commit or states why ownership cannot be established, and gives only safe remediation.
- No recovery path copies a peer's working-tree bytes, merges an unrelated branch automatically, adopts a revision without explicit operator authority, or weakens Git-HEAD durability.
- Current Node and Node 20 gates pass, with mutation tests proving each guard can fail.

## Evidence

PropertyCompass2 `docs/wowbagger-feedback.md` entries 22 and 23, reported from `staging-7` and feature `1637-page-help-disclosure` on 2026-08-22. Namespace: `wbns_32119a74e42d76532139a4baf4f87a65`. The #1637 transition was unrelated to the blocking #1677 item and never reached its own mutation.

## Additional staging-5 evidence

PropertyCompass2 PR #2237 reproduced the same global barrier from a fresh worktree cut from `origin/staging`. A patch of unrelated item #1533 refused before touching it because claim reconciliation found: (1) an unauthorized committed revision on #1484, repaired successfully with explicit `claim-adopt`; and (2) `worktree-synchronization-required` for private sibling-worktree item #1675 with actual revision null. The private authoring commit was still unpushed in staging-4, so the second finding kept every mutation blocked after the first was repaired.

The report also observed commit `e1fa6653c` apparently going through a Wowbagger command — it wrote reconciliation entries — yet the resulting committed item revision was unauthorized in another session. Reproduction must therefore test where the authorized revision is recorded when the mutation command, Git commit, and later verifier run in different worktrees or machines.

PropertyCompass evidence: `docs/wowbagger-feedback.md`, 2026-08-22 entry in PR #2237; namespace `wbns_32119a74e42d76532139a4baf4f87a65`.
