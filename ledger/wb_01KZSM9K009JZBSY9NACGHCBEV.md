---
schema_version: 2
id: wb_01KZSM9K009JZBSY9NACGHCBEV
number: 60
title: "Ship the schema version 2 migration tool"
kind: task
priority: 20
status: done
created: 2026-08-12
updated: 2026-08-12
completed: 2026-08-12
provenance:
  source: "propertycompass-consumer-dogfood-rerun"
  recorded_at: "2026-08-12T22:00:00Z"
depends_on: []
related: [ wb_01KZVSW82ZF94R3DZQQJ0NAYHZ ]
decisions:
  - action: accept
    date: 2026-08-12
    summary: "Accept pilot rerun finding G1."
    rationale: "The package-only rerun supplied a direct reproduction and the defect affects the installed consumer contract."
  - action: complete
    date: 2026-08-12
    summary: "Complete package-only schema migration access."
    rationale: "The npm allowlist now ships scripts/migrate-schema-2.js with executable mode; the packaging test and npm dry-run artifact verify its path and mode."
---
Package-only consumers can create schema-version-2 ledgers, but they cannot migrate an existing schema-version-1 ledger because `scripts/migrate-schema-2.js` is absent from the npm package.

Done means the npm package ships the documented migration entrypoint at `scripts/migrate-schema-2.js`, preserves its executable mode, and a package-only consumer can run its help or dry-run surface without a source checkout.
