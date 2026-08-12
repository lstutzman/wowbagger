---
schema_version: 2
id: wb_01KZVSW82ZF94R3DZQQJ0NAYHZ
number: 54
title: "Let new consumer ledgers start on schema version 2"
kind: task
priority: 10
status: backlog
created: 2026-08-12
updated: 2026-08-12
provenance:
  source: "propertycompass-consumer-dogfood"
  recorded_at: "2026-08-12T20:16:45Z"
depends_on: []
related: [ wb_01KZBT447HVZ9798DXV1NTT515 ]
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
decisions:
  - action: accept
    date: 2026-08-12
    summary: "Accept the schema bootstrap defect at priority 10."
    rationale: "A package-only consumer cannot start on the current ledger schema or run the unshipped migration path."
---

`create` stamps `schema_version: 1` when a ledger is empty. The request has no schema selector. The only schema-2 migration tool is `scripts/migrate-schema-2.js`, but `scripts/` is absent from the npm package and the tool refuses an empty ledger. A package-only consumer therefore cannot start on or migrate to schema 2 before its first item, even though the installed skill documents schema-2 dependency semantics.

Reproduce by provisioning an empty ledger with the published package, minting an ID, creating its first item, and reading the generated frontmatter.

Done means a package-only consumer can start a schema-2 ledger through a supported path, and the selected ledger schema is explicit in the create result or installed skill. Existing schema-1 behavior remains available only when deliberately selected or preserved for compatibility.
