---
schema_version: 2
id: wb_01KZYS3100MFHC5ZR6FGP8ZX6N
number: 81
title: "Preserve exact PropertyCompass source bytes outside parsed bodies"
kind: task
priority: 20
status: backlog
created: 2026-08-14
updated: 2026-08-17
provenance:
  source: "propertycompass-migration-final-reconciliation"
  recorded_at: "2026-08-14T13:24:17.000Z"
depends_on: []
related: [ wb_01KZYS3100YCRMVR2M83T648TH, wb_01KZYS3100KCTE3T0998YF55V8 ]
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
decisions:
  - action: accept
    date: 2026-08-16
    summary: "Accept into the backlog at triage review."
    rationale: "Byte-exact source preservation rule fixing the demonstrated parser newline defect; prerequisite for trustworthy reconciliation."
---

# Problem

The PropertyCompass migration generated target bodies from a legacy frontmatter parser. The parser drops one delimiter-adjacent newline. All 1,501 generated targets could therefore fail exact raw-source-byte reconstruction even when Wowbagger schema validation succeeds. `docs/backlog/352-migration-gate.md` demonstrated the defect.

The failed target publication was local only. The migration must revert all target items to the frozen mapping/provision checkpoint before regeneration.

# Required result

Read each pinned legacy card as raw bytes. Derive the target body by an exact byte-offset slice after the closing frontmatter delimiter. Do not use a parser-produced body as preservation evidence.

Each target also records the complete original legacy source as base64 and its SHA-256 in migration extension data. This copy is authoritative for exact reconstruction. The readable target body and queryable legacy metadata remain projections.

# Acceptance criteria

1. The failed 1,501 target files are removed without changing the frozen source-to-target mapping.
2. The generator reads each source as bytes and preserves the exact delimiter-adjacent newline and line endings.
3. Every target records complete original source bytes as base64 and the pinned source SHA-256.
4. Verification decodes all 1,501 values and compares them byte-for-byte with the pinned source files.
5. Verification fails on any missing byte, newline drift, encoding change, hash mismatch, or source-path mismatch.
6. Target bodies retain every readable legacy link and artifact reference.
7. The corrected held item #1514 delta is preserved separately from its exact pinned baseline and records checksum `6f7e788f7c860da7b8e0eb581fef7e55133f67e89fa8ea330c21fdb761689de2`.
8. The complete regenerated ledger passes Wowbagger validation and source-target reconciliation.
9. Legacy source files remain byte-unchanged.
10. No core parser or validator is weakened to accommodate the migration.
