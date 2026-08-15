---
schema_version: 2
id: wb_01KZYS31006X1JKC2KDPSZSVAK
number: 73
title: "Preserve dangling PropertyCompass relationship identifiers"
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

The complete 1,498-card PropertyCompass2 inventory found nine structured relationship references whose targets have no source card:

- #5 `merged_from` #273
- #90 `merged_from` #6
- #158 `merged_from` #159 and #170
- #162 `merged_from` #271 and #279
- #276 `merged_from` #6
- #1020 `related` #356.1 and #356.2

A direct canonical projection would create unresolved Wowbagger identities. Dropping the values would erase historical provenance.

# Decision

Do not invent cards or fake canonical targets. Preserve each exact source identifier, relationship type, and source card in queryable `legacy_relationships` extension data. Retain the original relationship text in the migrated body. Populate Wowbagger core relationship fields only when a source identity maps to a real migrated item.

# Acceptance criteria

1. The migration mapping records all nine references with exact source card, relationship type, and legacy identifier.
2. No placeholder item or fabricated canonical Wowbagger ID represents a missing source card.
3. Each source card retains the original relationship text in its migrated body.
4. Each relationship remains queryable in lossless extension data.
5. Core `parent`, `depends_on`, and `related` contain only real mapped target IDs.
6. The reconciliation report lists all nine omitted core projections and their reason.
7. Verification fails if any exact value disappears, changes type, or becomes a fabricated canonical link.
8. The final target ledger validates.
