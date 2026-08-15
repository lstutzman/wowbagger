---
schema_version: 2
id: wb_01KZYS31008RT7QHS6CGKDVNTS
number: 75
title: "Derive missing PropertyCompass migration metadata from Git evidence"
kind: task
status: triage
created: 2026-08-14
updated: 2026-08-14
provenance:
  source: "propertycompass-migration-inventory"
  recorded_at: "2026-08-14T13:24:17.000Z"
depends_on: []
related: [wb_01KZ77NSW8363H1V6QG1HZRG11]
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
---

# Problem

The complete PropertyCompass2 inventory found 172 cards with no legacy `created` date, 1,295 with no legacy `updated` date, and 17 done cards with no `completed` date. Wowbagger schema version 2 requires `created` and `updated`; terminal items also require a terminal date equal to `updated` and a matching terminal decision.

Using the migration date would erase historical timing. Inventing completion rationale would fabricate evidence. Target Wowbagger IDs must also encode each target item's projected `created` date.

# Decision

Derive missing dates from source-path Git history. Use the earliest commit that added the source card for missing `created`, the latest commit that changed it for missing nonterminal `updated`, and the first commit whose source bytes show the terminal state for a missing terminal date. Use that terminal date for core `updated` and the terminal date field. If Git history cannot establish a required date, stop and report a severe migration issue.

Record every derived field in `migration_synthetic_fields` with its value, source path, source commit, and derivation rule. Preserve each original missing value in legacy metadata and the source body. Synthetic terminal decisions may state only that migration imported an evidenced legacy terminal state; they must cite the source card and commit and must not invent a completion rationale.

Generate the complete source-to-target ID table once after Lee authorizes the quiesced window. Mint each target ID for its projected core `created` date. Freeze the table before target item publication and reuse it unchanged on retry.

# Acceptance criteria

1. Read-only analysis reports how many missing fields Git history resolves and lists every unresolved field.
2. Every derived date cites an exact source path, commit, and deterministic rule.
3. Core date ordering and terminal date equality satisfy schema version 2.
4. Every target ID encodes its projected core `created` date.
5. The source-to-target ID table is generated once, persisted before item publication, and never regenerated on retry.
6. Every original blank or absent value remains visible in legacy metadata and the source body.
7. Every synthetic terminal decision is factual, cites evidence, and invents no rationale.
8. Verification compares all derived fields with their cited Git evidence and fails on drift.
9. The final target ledger validates.
