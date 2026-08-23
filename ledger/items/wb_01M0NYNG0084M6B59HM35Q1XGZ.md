---
schema_version: 2
id: wb_01M0NYNG0084M6B59HM35Q1XGZ
number: 145
title: "Refresh marketing prose across npm and GitHub"
kind: task
priority: 2
status: triage
created: 2026-08-23
updated: 2026-08-23
provenance:
  source: "marketing-prose-audit"
  recorded_at: "2026-08-23T12:00:00Z"
depends_on: [wb_01M0NYNG00XA7WJ9D36C74RJZW]
related: []
---

Audit and improve Wowbagger's product-facing prose across npm, GitHub, and Claude plugin surfaces. Make the public explanation reflect the current shipped feature set instead of the older minimal-ledger story.

Scope:
- Inventory shipped behavior from the current capabilities response, command summaries, changelog, README, contracts, and plugin metadata before rewriting prose.
- Explain report enhancements explicitly: named/custom report views, facets and graph filtering, accessible HTML output, workbench projections, bounded machine-readable report responses, and the dependency graph.
- Cover the current core value: deterministic ready queue, schema-2 identity and numbers, atomic Git-native mutations, exact-byte CAS, claims/fencing/reconciliation, response-loss handling, extension declarations, parent migration, snooze, and multi-harness adapters.
- Align npm package description, keywords, README, Claude plugin manifest/marketplace descriptions, and relevant user-facing skill copy where they make product claims.
- Keep technical contracts and historical changelog records factual; do not rewrite history or claim capabilities not present in contract_version 5.

Acceptance criteria:
- Produce a feature inventory tied to current runtime evidence before editing prose.
- Update npm and GitHub-facing prose so a new reader understands the complete product and the report enhancements.
- Remove stale, underspecified, or contradictory marketing claims and stale version/install references.
- Preserve the separate Wowbagger core, plugin, and skills installer installation model.
- Validate all changed manifests, links, version references, package contents, and README rendering surfaces.
- Record changed files and verification results in the item outcome.
