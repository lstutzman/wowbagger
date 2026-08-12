---
schema_version: 2
id: wb_01KZSM9K00Y45VS0YCXDR5D35C
number: 61
title: "Define claim-verify committed state precisely"
kind: task
priority: 40
status: done
created: 2026-08-12
updated: 2026-08-12
completed: 2026-08-12
provenance:
  source: "propertycompass-consumer-dogfood-rerun"
  recorded_at: "2026-08-12T22:00:00Z"
depends_on: []
related: [ wb_01KZVSW85FS738V9VM942M7NS6 ]
decisions:
  - action: accept
    date: 2026-08-12
    summary: "Accept pilot rerun finding G2."
    rationale: "The package-only rerun supplied a direct reproduction and the defect affects the installed consumer contract."
  - action: complete
    date: 2026-08-12
    summary: "Complete claim-verify state clarification."
    rationale: "The installed work-claim contract now defines top-level committed as durable reconciliation state and requires Git completion checks on git_finalized and git_commit; the packaging contract test passes."
---
`claim-verify` returns top-level `state: "committed"` when reconciliation is clean even if a successful publication still has `git_finalized: false`. A consumer can misread the top-level state as a Git guarantee.

Done means the installed work-claim contract states that top-level `committed` describes durable reconciliation state, not Git finalization, and requires callers to gate Git completion on each publication's `git_finalized` and `git_commit` fields.
