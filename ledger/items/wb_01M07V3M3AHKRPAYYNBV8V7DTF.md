---
schema_version: 2
id: wb_01M07V3M3AHKRPAYYNBV8V7DTF
number: 118
title: "Give consumer-owned extension members a sanctioned patch path"
kind: task
priority: 10
status: backlog
created: 2026-08-17
updated: 2026-08-17
provenance:
  source: "maintainer-dogfood"
  recorded_at: "2026-08-17T12:28:26Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-17
    summary: "Accept into the backlog."
    rationale: "Two field occurrences in two days; the obstacles and requirements are already written into the contract by #114."
---

Split from item #114 per its "say what is trivial and split it" upgrade (two field occurrences in two days: consumer-owned identifier fields wrong or missing with no repair verb). #114 verified the optimistic premise false — src/validate.js constrains no extension member, so there is no permitted-extension rule for candidate validation to enforce — and recorded the four real obstacles in the contract's Frontmatter ownership section: (1) an arbitrary set key destroys the fail-closed allowlist boundary, so the path needs a set.extensions container, not one more name; (2) no value schema exists — unvalidated caller JSON would land in frontmatter; (3) extension values may be nested and anchored, and extensionNodeIdentity is the successor guard proving they were untouched — patching one means carving it out of the guard that protects the rest; (4) extension members are absent from the lossless core view, so the oracle has nothing to correlate without parsing item source.

Scope: design and ship the sanctioned path the contract now names. A set.extensions container (whole-value replace of one named permitted extension member per request member), a declared per-ledger extension schema (where it lives - layout.json sibling? - and what it constrains), the anchored/nested-value rule, and an oracle-visible correlation surface. Update the ownership table row from "not patchable" to the shipped mechanism; version-note per the request-schema-widening precedent.

Acceptance:
- A fixture proves a consumer identifier field (wrong AND missing cases) is corrected in-band on a provisioned ledger with no unauthorized-revision aftermath.
- Extension nodes NOT named in the request keep their extensionNodeIdentity guarantee, pinned.
- Ownership table updated; oracle mirrored both directions, mutation-guarded; gate green on both runtimes.
