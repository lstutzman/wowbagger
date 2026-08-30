---
schema_version: 2
id: wb_01M14Y1YEZXNNF39P7DZ7X3WAD
number: 182
title: "Add fenced recovery for duplicate immutable numbers"
kind: task
priority: 1
status: done
created: 2026-08-28
updated: 2026-08-30
completed: 2026-08-30
provenance:
  source: "PropertyCompass2 field failures"
  recorded_at: "2026-08-28T19:38:40Z"
depends_on: []
related: [ wb_01M14Y1NTXQPMQ270VT1WH6H17 ]
decisions:
  - action: accept
    date: 2026-08-30
    summary: "Accept duplicate-number recovery as the top backlog item."
    rationale: "Alpha.14 prevents new collisions but leaves existing invalid ledgers blocked. PropertyCompass2 required unsafe out-of-band recovery, so this is the sharpest current user gap."
  - action: complete
    date: 2026-08-30
    summary: "Ship fenced duplicate-number recovery."
    rationale: "The released package passes the complete dual-runtime, adapter, validation, audit, and whitespace gates."
---
## Problem

After duplicate schema-v2 numbers were committed, the ledger was invalid and every ordinary mutation refused. `number` is immutable and `patch` correctly rejects it, but Wowbagger provides no sanctioned recovery operation. The only available repair was manual source editing followed by Git commit and `claim-adopt`, a dangerous workflow that bypasses number collision and reference checks.

## Emergency repair already performed

Lee selected the newer advertising business work for reassignment. PropertyCompass2 manually changed those items to free #1693/#1694, committed the bytes, and CAS adopted both revisions. The ledger now validates. This is out-of-band intervention, not evidence that a supported recovery path exists.

## Acceptance criteria

- Design a dedicated fenced renumber/reassign command; do not widen ordinary `patch`.
- Operate narrowly on a ledger whose blocking validation fault is duplicate-number, while refusing unrelated invalid-ledger states.
- Require item identity, exact expected revision, expected old number, requested or core-selected replacement number, and request date.
- Refuse collisions against every committed item and revalidate the complete successor ledger before publication.
- Check references, extension bindings, and projections that may persist the human number; never assume number is identity.
- Integrate claim reconciliation, response-loss handling, changed paths, auto-commit, recovery tokens, and audit evidence.
- Provide a dry-run or inspectable proposal before mutation and public tests for stale witness, collision, ambiguous outcome, and successful repair.

## Triage decision — 2026-08-30

Accepted into backlog at priority 1. Alpha.14 prevents new same-clone duplicate numbers and repairs none; the PropertyCompass2 emergency repair was an unsafe manual renumber plus adoption. This is the only open item with a user already stranded behind an invalid ledger and no supported recovery.

First design slice: specify a read-only repair proposal that runs only when the ledger's blocking fault set is duplicate-number, names every affected item and reference, chooses or validates replacement numbers, and proves the complete successor ledger before any write. Do not widen ordinary patch and do not legitimize manual source edits.
