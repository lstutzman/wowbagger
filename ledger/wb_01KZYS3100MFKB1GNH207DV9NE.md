---
schema_version: 2
id: wb_01KZYS3100MFKB1GNH207DV9NE
number: 78
title: "Project malformed PropertyCompass source identities without collision"
kind: task
status: backlog
created: 2026-08-14
updated: 2026-08-16
provenance:
  source: "propertycompass-migration-refreshed-inventory"
  recorded_at: "2026-08-14T13:24:17.000Z"
depends_on: []
related: [ wb_01KZYS3100YCRMVR2M83T648TH, wb_01KZ77NSW8363H1V6QG1HZRG11 ]
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
decisions:
  - action: accept
    date: 2026-08-16
    summary: "Accept into the backlog at triage review."
    rationale: "Reviewed collision-checked filename-identity projection for the three malformed cards; loses nothing, invents nothing."
---

# Problem

The refreshed PropertyCompass2 baseline at `8a69e5c61e14416d5e0c60fbebac3f7816e4b84b` contains 1,501 backlog files. Three added files do not have a valid frontmatter identity:

- `docs/backlog/1288-listing-cleanup-inert-succeeds-removes-nothing.md` has `id: __ID__`.
- `docs/backlog/1289-sweep-chunk-residual-hardening-1244.md` has `id: __ID__`.
- `docs/backlog/1429-sensitivity-flip-metrics-and-scenario-label.md` has no frontmatter `id`.

Their filename prefixes are plausible legacy identities, but silently treating malformed frontmatter as valid would rewrite source history. Omitting the cards would lose work.

# Decision

Use the numeric filename prefix as the legacy source identity only after proving it is unique across all 1,501 source paths and is not claimed by another valid frontmatter identity. Map core `number` to that filename number. Preserve the exact malformed or missing frontmatter state and the complete source bytes.

Record `legacy_identity_projection` with source path, filename number, raw frontmatter value or explicit missing marker, reason `malformed-or-missing-frontmatter-id`, and the pinned baseline commit. Do not modify the source card or imply its frontmatter was valid.

# Acceptance criteria

1. A complete uniqueness check proves 1288, 1289, and 1429 have no filename or valid-frontmatter collision.
2. Each source file maps to exactly one target item with matching core `number`.
3. Exact source bytes and the raw `__ID__` or missing state remain preserved.
4. Every projection records source path, filename number, raw value, reason, and baseline commit.
5. No source file is rewritten to repair frontmatter.
6. The reconciliation report lists all three projections and explains why filename identity was used.
7. Verification fails on collision, raw-value drift, missing provenance, duplicate target number, or omitted item.
8. The final target ledger validates with all 1,501 source files represented.
