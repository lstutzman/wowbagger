---
schema_version: 2
id: wb_01KZHX3E00VK34CWW9CVSN225F
number: 45
title: "Settle whether the backend coordinates worktrees"
kind: task
priority: 1
status: done
created: 2026-08-09
updated: 2026-08-10
completed: 2026-08-10
provenance:
  source: "code-review"
  recorded_at: "2026-08-09T20:30:00.000Z"
depends_on: []
related: [ wb_01KZHX3E00Z81H2BT71FGP1CZY ]
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
decisions:
  - action: accept
    date: 2026-08-09
    summary: "Accepted and resolved: cross-worktree mutation coordination is advertised wrongly and becomes false."
    rationale: "Section 1 of the mutation contract says the backend coordinates cooperative writers using the same ledger directory in one working copy and does not coordinate worktrees. ADR 0003 records the same accepted decision, and the adapter contract forbids an adapter elevating a local mutation capability into a cross-worktree one. Three normative sources agree, so the capabilities envelope is the outlier: limits.cross_worktree_coordination true is wrong for mutation. Contract version 2 advertises local mutation scope as same-working-copy-cooperative-writers and sets cross-worktree mutation coordination false. Advisory claims may still be visible through the Git common directory, but that visibility belongs under operations.work_claim and is not mutation coordination. The item stays open because the envelope has not been changed yet; the decision it was blocked on is settled."
  - action: complete
    date: 2026-08-10
    summary: "Cross-worktree mutation coordination is advertised false in contract version 2."
    rationale: "Section 1, ADR 0003, and the adapter contract's ban on elevating a local capability all agreed, so the capabilities envelope was the outlier. Version 2 advertises local mutation scope as same-working-copy-cooperative-writers. Advisory claim visibility stays under operations.work_claim, which is not mutation coordination."
---

The capabilities envelope advertises cross_worktree_coordination as true. Section 2
of the mutation contract says the backend "does not coordinate clones, worktrees,
machines, hostile or non-cooperating writers, or Git operations", and its write scope
is one Markdown item. The adapter contract separately forbids an adapter turning a
local mutation capability into a cross-worktree one. These cannot all be true.

Nothing forced the question until now because every mutation touched one file in one
working copy. The first multi-item design hit it immediately and could not proceed.

An adversarial review of that design showed the contradiction is not cosmetic. If a
transaction coordinator is keyed to a logical namespace that spans worktrees, a reader
in worktree B can read worktree A's committed marker, load B's unchanged files, read
the same marker again, and accept B's stale bytes as the committed snapshot. Recovery
is worse: it is undefined whether a manifest's paths resolve against A, against B, or
against stored absolute paths, so recovery can roll A's transaction into B's files.

A logical namespace is explicitly not a physical identity and survives moving and
cloning, so it cannot be what binds a transaction to the files it is about.

The resolution is a contract decision, not an implementation choice:

- if the backend genuinely does not coordinate worktrees, then
  cross_worktree_coordination is advertised wrongly and should be false, and a
  transaction coordinator binds to one physical ledger root;
- if cross-worktree coordination is genuinely intended, section 2 is wrong, and the
  contract must define a physical ledger identity that survives moves, deleted
  worktrees, and reused paths.

This repository runs several worktrees against one ledger, so the answer is not
academic. Item 44 cannot be implemented until it is settled.

The full design and the review that stopped it are in
docs/design/2026-08-09-multi-item-atomicity.md.
