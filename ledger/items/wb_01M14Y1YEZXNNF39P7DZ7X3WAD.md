---
schema_version: 2
id: wb_01M14Y1YEZXNNF39P7DZ7X3WAD
number: 182
title: "Add fenced recovery for duplicate immutable numbers"
kind: task
priority: 1
status: triage
created: 2026-08-28
updated: 2026-08-28
provenance:
  source: "PropertyCompass2 field failures"
  recorded_at: "2026-08-28T19:38:40Z"
depends_on: []
related: []
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
