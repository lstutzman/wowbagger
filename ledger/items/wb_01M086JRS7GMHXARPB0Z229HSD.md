---
schema_version: 2
id: wb_01M086JRS7GMHXARPB0Z229HSD
number: 126
title: "Bound the item source at every candidate door"
kind: task
priority: 20
status: in-progress
created: 2026-08-17
updated: 2026-08-17
provenance:
  source: "maintainer-dogfood"
  recorded_at: "2026-08-17T15:48:57Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-17
    summary: "Accept into the backlog."
    rationale: "Ideation survivor: alpha.6 accepts a 50MiB item with a false message on the one bounded path; first contract narrowing, v4 bundled with #122."
---

Ideation survivor 5 of 5 (2026-08-17). Full design basis: docs/ideation/2026-08-17-open-ideation.md and the Sol enrichment at docs/ideation/enrichments/2026-08-17-bodybound.md - the enrichment is the authoritative scope; this body is its summary. RELATED to the provisioned-performance program: both require core contract v4 - bundle into one version bump and one release.

One item-source byte bound. Empirical state of alpha.6 (enrichment section 1, observed not inferred): a 50 MiB create returns exit 0, state committed, in 0.70s, producing 122,334,911 bytes of JSON output; create/patch/transition have NO bound anywhere (requestSource reads with maxBytes Infinity); publish-claimed alone bounds candidates at 8,388,608 bytes but reports an oversized candidate with the FALSE message "The candidate source is not canonical base64" (canonicalBase64Error at src/claim-publication.js:63-75 - there is no size-specific error anywhere, contra the ideation's original premise).

Design (enrichment section 2):
- MAX_ITEM_SOURCE_BYTES = 8,388,608, measured over the complete serialized item source (frontmatter + decisions + extensions + body all consume the budget - NOT a body limit), one shared constant, enforced at every candidate door: create (before candidate validation), patch AND transition (the serialized successor - transition can grow unboundedly through decisions), publish-claimed (replacing the misleading message for the size case while keeping canonical-base64 errors for malformed input).
- One named refusal: item-source-too-large, exit 2, state unchanged, details exactly {id|item_id, size_bytes, limit_bytes} per response domain.
- Stored oversized legacy items stay readable and validate-clean; a shrinking patch is allowed; any successor still above the bound refuses. Capabilities gains result.limits.max_item_source_bytes.
- Version position (the enrichment's careful call): this is the project's FIRST accepted-input narrowing against a published version - core contract v4 required so v3 consumers fail closed at negotiation; if publish-claimed's pinned v1 error text changes for the size case, work-claim api_version moves to 2. Alpha status does not exempt a documented narrowing.

Explicitly out of scope unless the maintainer widens it (enrichment section 6): raw JSON request exhaustion (a second transport limit - one semantic bound cannot cap arbitrary JSON spelling) and the core-output vs adapter 1 MiB stdout amplification mismatch.

Consumer risk measured: PropertyCompass2's largest item is 80,676 bytes (0.96% of the bound); largest body 33,357 bytes. No migration needed.

Acceptance: the enrichment's criteria verbatim (section 4) - exact boundary and boundary-plus-one fixtures per verb, multi-byte UTF-8 accounting, precedence pins against every earlier refusal class, legacy-oversized fixtures, fail-closed v3 negotiation, both oracles pinning value and shape independently.


## Orchestrator resolution (2026-08-17, Lee)

Core contract v4 approved, low ceremony. We are the only consumers, so the bump costs one coordinated upgrade rather than a migration campaign. Bundle with item #122's filename-contract stage: two narrowings, one bump, one release.