---
schema_version: 2
id: wb_01M05ESTZXMPRYTZSQDY7D9HGP
number: 102
title: "Refuse a missing configured items directory by name"
kind: task
status: triage
created: 2026-08-16
updated: 2026-08-16
provenance:
  source: "maintainer-dogfood"
  recorded_at: "2026-08-16T14:14:54Z"
depends_on: []
related: []
---

Paper-cut found during item #94's verification: with `.wowbagger/layout.json` configuring `items_directory` and the configured directory absent, `create` fails as `operation-failed` / `operation: "prepare-temporary"` / `reason: "io-error"`, exit 6 — a generic envelope that names neither the missing directory nor the fix. The repo's own fixtures dodge it by seeding `items/.keep`. The docs from #94 state "the configured directory must already exist", but the refusal itself should say so.

Scope: detect the missing configured items directory before the temporary-file step and return a deterministic refusal naming the resolved directory and the remedy (create and commit it). Decide the honest code: an invalid-request-style precondition issue at the layout surface, or a dedicated candidate/capability refusal — align with the response-domain rule from #92 and the deterministic-issue conventions in mutation contract section 3. Pin with a fixture; mirror in the oracle only if the adapter surface carries the new shape.

Acceptance:
- A fixture test proves create against a layout-configured ledger with a missing directory refuses deterministically, naming the directory; the ledger stays untouched.
- The contract documents the refusal where layout.json is specified.
- Gate green on both runtimes.
