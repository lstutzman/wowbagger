---
schema_version: 2
id: wb_01M03F6VBR77G64N0JQNPQ9K32
number: 84
title: "Make the integer number the human-facing item identity"
kind: task
status: triage
created: 2026-08-15
updated: 2026-08-15
provenance:
  source: "maintainer-dogfood"
  recorded_at: "2026-08-15T00:00:00.000Z"
depends_on: []
related: []
---
The `wb_` ULID leaks into every human- and agent-facing surface even though CONTEXT.md defines the short integer `number` as the human handle. Make `number` a real identity on schema-2 ledgers: required, unique, immutable, core-assigned at create (`max+1` under the number-index lock); `create` rejects a caller-supplied number, `patch` no longer edits it. Add `inspect --number` and carry `number` in `ready --json`; the schema 1->2 migration assigns numbers. Rewrite SKILL.md so agents speak `#N`. Gated on schema_version 2 so no CORE_CONTRACT_VERSION bump. Design: docs/design/2026-08-15-number-identity.md.

Acceptance:
- Schema-2 item without a number fails validation (`missing-number`); schema-1 unchanged.
- `create` into a schema-2 ledger assigns `max+1` and refuses a caller-supplied `number`.
- `patch` refuses `number`.
- `inspect --number N` resolves to the item; `ready --json` includes `number`.
- Migration 1->2 assigns numbers to number-less items.
- SKILL.md refers to items by `#N`.
- Four-command gate green (both Node runtimes, conformance, ledger validate); oracle kept independent.