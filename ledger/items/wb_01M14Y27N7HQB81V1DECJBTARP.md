---
schema_version: 2
id: wb_01M14Y27N7HQB81V1DECJBTARP
number: 183
title: "Make standard tags safely mutable on existing ledgers"
kind: task
priority: 2
status: in-progress
created: 2026-08-28
updated: 2026-08-30
provenance:
  source: "PropertyCompass2 field failures"
  recorded_at: "2026-08-28T19:38:40Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-30
    summary: "Accept safe tags mutability as priority-two backlog work."
    rationale: "Real mirrored items have stale tags, but the ledger remains valid and titles, bodies, and dependencies can still be corrected. A sanctioned migration is needed without bypassing extension safety."
---
## Problem

PropertyCompass2 creates mirrored items with `tags`, but its ledger has no `.wowbagger/extensions.json`. Current ownership rules therefore make `patch.set.extensions.tags` unavailable after create. Following a domain ruling, titles, bodies, and dependencies were corrected in band, but eight mirrors still carry obsolete `partners` tags.

Current Wowbagger deliberately requires an extension declaration, so this may be consumer configuration or discoverability rather than a core runtime defect. The field report shows the requirement makes a common field effectively write-once unless every consumer predicts and provisions it before the first correction.

## Acceptance criteria

- Decide whether `tags` is a standard patchable field by default or remains an extension requiring declaration; state the compatibility tradeoff.
- If tags become standard, preserve existing YAML types and refuse incompatible historical shapes before enabling writes.
- If declaration remains required, provide a safe bootstrap/provision/migration path for existing ledgers with tags already present.
- The path must validate all existing tag values, commit one explicit declaration, and avoid hand-editing item bytes.
- Teach the installed skill and consumer docs how to discover, provision, and patch tags before mirrors drift.
- Add a consumer trap test: create tagged item on a ledger without a declaration, make a later domain correction, and update tags through the sanctioned path with no unauthorized-revision aftermath.

## Triage decision — 2026-08-30

Accepted into backlog at priority 2. Eight PropertyCompass2 mirrors retain obsolete tags because their ledger predates an extension declaration. The current safety rule is correct but offers no sanctioned bootstrap for existing values, so this is a real data-maintenance gap rather than immediate ledger corruption.

First design slice: inventory historical tag YAML shapes and compare two explicit choices — standard patchable tags or a declaration-bootstrap command. Either path must validate every existing value before enabling mutation and must leave item bytes untouched until a complete proposal is accepted.
