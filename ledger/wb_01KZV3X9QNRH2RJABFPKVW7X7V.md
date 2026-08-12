---
schema_version: 2
id: wb_01KZV3X9QNRH2RJABFPKVW7X7V
number: 48
title: "Align plugin release identity with the core release"
kind: task
status: triage
created: 2026-08-12
updated: 2026-08-12
provenance:
  source: "propertycompass-dogfood-pilot"
  recorded_at: "2026-08-12T13:52:27Z"
depends_on: []
related: [wb_01KZBT43RZSKMG8Z19RQQ43DDR, wb_01KZBT447HVZ9798DXV1NTT515]
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
---

The first installed-skill dogfood used `npm install -g wowbagger@next`, which installed core `0.1.0-alpha.1`. `claude plugin details wowbagger@wowbagger` reported plugin `0.1.0-prealpha` from Git commit `28a3740d08b288d49402c7851011638cb51f2a9b`.

The behavioural compatibility gate is core `contract_version: 2`, and the installed skill requires that version, so package-version equality is not itself the compatibility rule. The friction is release identity: the operator's instruction artifact appears one release behind the core, and no install-time surface explains whether that exact pairing is intended.

Done means the plugin release metadata follows the released repository version or explicitly identifies its supported core contract and release lineage, and the release process verifies the marketplace/plugin metadata together with the npm and Git release.
