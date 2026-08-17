---
schema_version: 2
id: wb_01KZYS3100YCRMVR2M83T648TH
number: 77
title: "Refresh the PropertyCompass migration snapshot after pre-freeze commits"
kind: task
priority: 20
status: killed
created: 2026-08-14
updated: 2026-08-17
killed: 2026-08-17
provenance:
  source: "propertycompass-migration-quiescence"
  recorded_at: "2026-08-14T13:24:17.000Z"
depends_on: []
related: [ wb_01KZYS3100NYPQ6AXGTBM9BFGT, wb_01KZ77NSW8363H1V6QG1HZRG11 ]
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
decisions:
  - action: accept
    date: 2026-08-16
    summary: "Accept into the backlog at triage review."
    rationale: "Snapshot-refresh requirement stands; the enumerated pre-freeze commits are a floor and the live dual-run session keeps adding to the source, so the refresh-to-pinned-tip rule is more necessary now, not less."
  - action: kill
    date: 2026-08-17
    summary: "Transferred to the PropertyCompass2 ledger."
    rationale: "Lee's ownership ruling of 2026-08-17: this item executes in PropertyCompass2's repository against PropertyCompass2's data, by their agents. Their session was notified with the full list and files the equivalent in their own wowbagger ledger. The wowbagger-side prerequisites shipped this week."
---

# Problem

Quiescence coordination found backlog changes pushed before the freeze notice that may be newer than the migration agent's first read-only snapshot:

- `5fe892518` and `af085bae4` update `docs/backlog/1514-trace-semantics-client-server-join.md`; the latter adds Staging verification results.
- `3041d3053` creates item #1516 and updates prioritization output.
- `264a7c3fc` creates item #1517 and updates prioritization output.
- `3af5afda4` moves #1472 to done and adds child/state evidence to epic #1075.

A further #1514 D4 and end-to-end evidence edit existed before cutover but remained deliberately uncommitted under the freeze. Its author will provide the exact content and intended insertion point without modifying the legacy backlog.

Migrating an earlier snapshot would omit finished evidence, new items, lifecycle changes, or the final held delta.

# Required result

Pin the migration source to one explicit current `origin/staging` commit after all listed pushed commits. Re-run the complete inventory from that commit. Reconcile the held #1514 delta as an explicit, checksummed pre-cutover input without writing it back to `docs/backlog/`.

# Acceptance criteria

1. The migration report names one exact source baseline commit and proves it contains all five listed commits.
2. The refreshed inventory reports item count, lifecycle totals, source bytes, per-file hashes, relationship totals, and artifact/reference totals.
3. Items #1516 and #1517 exist exactly once and retain their full source bytes.
4. #1472's done state, #1075's updated epic evidence, and #1514's Staging verification results match the pinned source commit.
5. The held #1514 delta has an exact content hash, author/source provenance, and intended insertion point.
6. The migrated #1514 preserves both the pinned source bytes and the held delta without pretending the delta existed in the baseline commit.
7. No target ID mapping or target item publication occurs before the refreshed snapshot passes.
8. `docs/backlog/` remains unchanged during migration.
9. The final reconciliation report accounts for every pre-freeze commit and held delta.
