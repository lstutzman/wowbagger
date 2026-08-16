---
schema_version: 2
id: wb_01M057PY03G5AM0MMAKA5R9AT9
number: 89
title: "Make cross-worktree claim coordination honest and diagnosable"
kind: task
priority: 1
status: done
created: 2026-08-16
updated: 2026-08-16
completed: 2026-08-16
provenance:
  source: "consumer-field-feedback"
  recorded_at: "2026-08-16T00:00:00.000Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-16
    summary: "Accept the PropertyCompass2 field finding into the backlog."
    rationale: "First real production session (21 creates, 27 transitions, alpha.4) recorded this in docs/wowbagger-feedback.md (PR #2196). Verified against this repo source before filing."
  - action: complete
    date: 2026-08-16
    summary: "Made cross-worktree serialization honest and diagnosable."
    rationale: "claim capabilities now advertises write_serialization (all-worktrees-of-one-repository); a two-worktree fixture distinguishes the foreign-writer and own-uncommitted refusals with the right remediation each; recovery and both traps documented. cross_worktree_coordination stays false with a precise definition."
---
Field blocker 2 from PropertyCompass2 dual-run (report: .PropertyCompass2/worktrees/260815-212735/docs/wowbagger-feedback.md, PR #2196). A sibling worktree's unpushed ledger commits block ALL creates in other worktrees: the claim journal lives in the shared git common dir, so it knows items whose files the local checkout cannot see; every create fails `stale-write-detected` naming a foreign item, and `expected_revision` keeps moving while the sibling works - chasing it is a trap (the consumer proved copying byte-identical files in still loses the race).

Three-way contradiction verified in source: core `capabilities` advertises `cross_worktree_coordination: false` (src/cli.js), the claim capability advertises `coordination_scope: shared-git-common-dir-serialized-journal` (src/claim-capabilities.js) which IS cross-worktree serialization, and the contract prose says worktrees are not coordinated. The consumer read an advertisement they took as `cross_worktree_coordination: true`. Behavior: the journal serializes writers across worktrees without coordinating their checkouts.

Scope:
1. Decide the honest model and make all three surfaces agree: either the journal is scoped per-worktree surface, or the capability/prose say plainly that provisioned ledgers serialize ALL worktrees of one repository and a write in one blocks writes in the rest until pushed/merged.
2. Distinguish the two stale-write cases in every refusal (source already has both remediation strings in claim-publication.js - own-uncommitted 'Commit X then claim-verify' vs foreign 'run claim-verify in the writing worktree or synchronize'): assert the create path emits the right one.
3. Document the recovery: stop writing, wait for the sibling push, pull, claim-verify, resume. Name the moving-expected_revision trap explicitly.

Acceptance:
- A two-worktree fixture test reproduces the block and asserts the foreign-writer finding names the wait-for-synchronize remedy, distinguishable from the own-uncommitted finding.
- Every advertised capability field about worktree/clone coordination matches observed behavior and the contract prose; the conformance oracle pins the agreed shape.
- Field report issue 2's failed workaround is documented as a warning.