---
schema_version: 2
id: wb_01KZYS3100NYPQ6AXGTBM9BFGT
number: 72
title: "Authorize and enforce a quiesced PropertyCompass migration window"
kind: task
status: backlog
created: 2026-08-14
updated: 2026-08-16
provenance:
  source: "propertycompass-migration-inventory"
  recorded_at: "2026-08-14T13:24:17.000Z"
depends_on: []
related: [ wb_01KZ77NSW8363H1V6QG1HZRG11 ]
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
decisions:
  - action: accept
    date: 2026-08-16
    summary: "Accept into the backlog at triage review."
    rationale: "The authorization gate the deferred migration needs before any write; accepting queues the gate, deferral of epic #21 keeps it non-ready until undeferred."
---

# Problem

PropertyCompass2 has about twenty concurrent worktrees that can write its legacy backlog. Wowbagger 0.1.0-alpha.3 can provide merge-coordinated claim-protected publication for a provisioned Git ledger, but it reports `safe_exclusive_dispatch: false`. Full migration writes cannot start while another process or person can change the source backlog or target ledger.

The 2026-08-14 migration session stopped before mutation. No target ledger, commit, merge, push, PR, or remote change exists.

# Required result

Authorize and enforce one quiesced single-writer maintenance window for the full PropertyCompass2 migration. The window must cover every source-backlog writer, target-ledger writer, automation path, agent session, worktree, and human mutation path. Merge-coordinated claims do not replace this operational gate.

# Acceptance criteria

1. Lee explicitly authorizes the migration window and names its start and release conditions.
2. The migration inventory enumerates every known source and target mutation entry point.
3. Every writer except the migration process is stopped or placed in a verified read-only state before the first target write.
4. Source paths and bytes are snapshotted with deterministic counts and SHA-256 evidence immediately before migration.
5. The selected target runs ledger-specific claim capability preflight before any claim operation. Its actual mode and `safe_exclusive_dispatch` value are recorded without being upgraded locally.
6. One migration process performs all writes. A second process cannot enter the window silently.
7. Any severe migration issue stops writes and restores the last verified local checkpoint before work resumes.
8. The window remains closed until source-to-target reconciliation, link preservation, relationship resolution, ledger validation, and ready-queue explanation all pass.
9. No branch, commit, tag, PR, or ref is merged or pushed before Lee gives a separate release instruction.

# Scope constraint

Do not claim that the operational window makes the Wowbagger backend strictly fenced. It is a temporary migration control around a merge-coordinated backend.
