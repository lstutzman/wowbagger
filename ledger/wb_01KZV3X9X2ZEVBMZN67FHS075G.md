---
schema_version: 2
id: wb_01KZV3X9X2ZEVBMZN67FHS075G
number: 51
title: "Give core and claim contracts distinct version fields"
kind: task
priority: 1
status: backlog
created: 2026-08-12
updated: 2026-08-12
provenance:
  source: "propertycompass-dogfood-pilot"
  recorded_at: "2026-08-12T13:52:27Z"
depends_on: []
related: [ wb_01KZBT447HVZ9798DXV1NTT515 ]
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
decisions:
  - action: accept
    date: 2026-08-12
    summary: "Accept the version-domain ambiguity at priority 1."
    rationale: "A valid core response and a valid claim response use the same unqualified envelope member for different contract domains. Fail-closed consumers can reject one as incompatible. The fix must preserve explicit negotiation and migration safety."
---

The top-level core and mutation envelopes report `contract_version: 2`. `provision`, `claim capabilities`, every claim lifecycle command, `publish-claimed`, and `claim-verify` report `contract_version: 1` for the work-claim API. Both values are intentional in their own contracts, but the same unqualified envelope member carries two different version domains.

The installed workflow tells operators to require core contract version 2. A generic gate or a reader that does not already know the command namespace can treat a valid claim response as an incompatible core response. The first consumer pilot hit this ambiguity.

Done means the wire or its documented negotiation surface names the version domain unambiguously, preserves fail-closed compatibility checks, and includes migration guidance if changing the existing member would break version-1 claim consumers.
