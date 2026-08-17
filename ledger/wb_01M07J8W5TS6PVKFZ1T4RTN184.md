---
schema_version: 2
id: wb_01M07J8W5TS6PVKFZ1T4RTN184
number: 113
title: "Give unauthorized-revision a non-destructive adoption remedy"
kind: task
priority: 2
status: backlog
created: 2026-08-17
updated: 2026-08-17
provenance:
  source: "maintainer-dogfood"
  recorded_at: "2026-08-17T09:54:01Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-17
    summary: "Accept into the backlog."
    rationale: "Field-blocked consumer staging on published alpha.5; the only documented remedy discards reviewed, merged work."
---

Field issue from PropertyCompass2 on published alpha.5 (their staging, 1,574-item provisioned ledger, docs/wowbagger-feedback.md on their side): `unauthorized-revision` has no non-destructive remedy. Their staging checkout is blocked exit 6 with three findings (observed_surface: working-tree, reason: unauthorized-revision) on items whose bodies were hand-edited in a design session and MERGED (their PRs #2208/#2209). The refusal is correct - the edits bypassed the protocol. The only documented remedy (work-claim contract section 3.1: "restore the authorized revision, then claim-verify") destroys reviewed, merged work. Their runnable workaround is three steps and rewrites updated: restore authorized bytes, claim-verify, re-apply through patch set.body.

Consumer ask: a first-class re-baseline - claim-verify --adopt <item-id> or a reauthorize operation that records the current committed bytes as the authorized revision after explicit operator confirmation.

Scope:
1. Design the verb. Requirements that make adoption safe rather than a fence hole: per-item and per-revision explicit (the request names the item ID and the exact revision being adopted - no blanket adopt-all); the adopted revision must be committed at git HEAD and the complete ledger valid with it; the operation writes a journal entry recording the adoption (who, when, from-revision, to-revision) so the audit trail says "operator ruled these bytes legitimate" instead of losing the event; refused while an active claim holds the item.
2. Choose the surface: a claim-verify flag vs a standalone command vs a ledger-mutation verb. Decide with the response-domain rules; the operation mutates coordinator state, not the item file, which suggests the work-claim domain.
3. Update every unauthorized-revision remediation string to name BOTH paths: restore (discard the edit) or adopt (rule it legitimate); the two-sentence shape must make the destructive/non-destructive distinction unmissable.
4. Contract: work-claim contract section 3.1 documents the adoption operation, its preconditions, and its journal record; fixtures pin the success and the refusal cases (uncommitted bytes, invalid ledger, active claim, wrong revision witness).

Acceptance:
- A fixture reproduces the consumer's exact state (valid ledger, committed out-of-protocol edit, unauthorized-revision block) and clears it with one adoption operation, preserving the edited bytes and leaving updated untouched.
- The adoption is journaled and visible to claim-verify afterwards; a second adoption with a stale revision witness refuses.
- Remediation strings name both remedies; contract documents the operation; mutation-guarded both directions where mirrored.
- Gate green on both runtimes.
