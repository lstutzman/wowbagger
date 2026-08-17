---
schema_version: 2
id: wb_01KZYS3100VWKSWTF8NTXQD8P7
number: 76
title: "Project historic PropertyCompass dates without invalid ordering"
kind: task
priority: 20
status: killed
created: 2026-08-14
updated: 2026-08-17
killed: 2026-08-17
provenance:
  source: "propertycompass-migration-preflight"
  recorded_at: "2026-08-14T13:24:17.000Z"
depends_on: []
related: [ wb_01KZYS31008RT7QHS6CGKDVNTS, wb_01KZ77NSW8363H1V6QG1HZRG11 ]
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
decisions:
  - action: accept
    date: 2026-08-16
    summary: "Accept into the backlog at triage review."
    rationale: "Reviewed earliest-evidenced-date rule resolving 168 date inversions; without it the target ledger cannot validate."
  - action: kill
    date: 2026-08-17
    summary: "Transferred to the PropertyCompass2 ledger."
    rationale: "Lee's ownership ruling of 2026-08-17: this item executes in PropertyCompass2's repository against PropertyCompass2's data, by their agents. Their session was notified with the full list and files the equivalent in their own wowbagger ledger. The wowbagger-side prerequisites shipped this week."
---

# Problem

Read-only preflight found 168 historic done PropertyCompass2 cards whose first Git addition under `docs/backlog/` occurred after their evidenced terminal date. Examples include #1 and #2. Using Git-add as projected core `created` would make terminal `updated` earlier than `created`, which Wowbagger correctly rejects.

The source snapshot itself is stable: 1,498 cards, 5,803,545 UTF-8 bytes, all per-file SHA-256 values unchanged, 963 structured relationships, and 9,492 artifact/reference occurrences. Git evidence resolves every previously missing required date.

# Decision

For a card with no legacy `created`, project core `created` from the earliest valid evidenced date anywhere in that card's legacy record: terminal date, legacy updated date, decision date, snoozed date, or Git-add date. Use Git-add only when no earlier card evidence exists.

A terminal card may use its terminal date for both projected `created` and terminal `updated`. This is an evidence-bounded schema projection, not a claim that creation and completion happened together. Preserve every original source date and the missing original `created` value.

Record `migration_synthetic_fields.created` with the selected date, all candidate evidence, source path, source commit when applicable, and derivation rule `earliest-evidenced-card-date`. Mint the target Wowbagger ID for that projected date.

# Acceptance criteria

1. The migration report lists all 168 date inversions and their selected evidence.
2. The projection rule applies only when legacy `created` is absent.
3. Every original date and missing value remains visible in legacy metadata and the source body.
4. Every derived `created` field records all candidate evidence and the selected source.
5. Every target ID encodes its projected core `created` date.
6. Verification proves `created <= updated` for all 1,498 target items.
7. No card remains unresolved or inverted.
8. The final target ledger validates.
