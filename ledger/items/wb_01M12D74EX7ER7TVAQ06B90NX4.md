---
schema_version: 2
id: wb_01M12D74EX7ER7TVAQ06B90NX4
number: 176
title: "Preserve known sibling owner evidence for restored authorized bytes"
kind: task
priority: 1
status: in-progress
created: 2026-08-27
updated: 2026-08-27
provenance:
  source: "no-mistakes/01M12BEPPZGQVW09XQ56BHZMCR/review"
  recorded_at: "2026-08-27T20:15:00Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-27
    summary: "Accept the release-blocking known-owner evidence regression."
    rationale: "The final release review proved that Git can identify a sibling ref and commit for an expected revision while the authorized-predecessor branch replaces that evidence with owner_unavailable. Alpha.11 must restore the explicit #165 contract without weakening blocking or current-ref discrimination."
---
## Problem

When the working tree holds authorized revision N-2, current HEAD holds N-1, and a sibling ref contains expected revision N, reconciliation remains safely blocking but discards the concrete `owner_ref` and `owner_commit` proven by Git. It reports `owner_unavailable: true` with generic wait guidance, contradicting the #165 known-owner contract and release notes.

## Acceptance criteria

- A RED public `claim-verify --json` scenario proves exit 6 and synchronization reason remain blocking while concrete owner evidence is missing.
- GREEN returns the sibling `owner_ref` and `owner_commit`, names that owner in remediation, and omits `owner_unavailable`.
- An expected revision not yet committed remains `owner_unavailable: true` with wait guidance.
- A current-ref restored predecessor remains `unauthorized-revision`.
- Existing sibling-window and unknown-edit companions remain green.
- Recheck work-claim contract and installed skill remediation text against the final scenarios.
- Full current Node, Node 20, adapter, and ledger gates pass.
