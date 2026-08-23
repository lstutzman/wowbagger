---
schema_version: 2
id: wb_01M0NYNG0084M6B59HM35Q1XGZ
number: 145
title: "Refresh marketing prose across npm and GitHub"
kind: task
priority: 2
status: in-progress
created: 2026-08-23
updated: 2026-08-23
provenance:
  source: "marketing-prose-audit"
  recorded_at: "2026-08-23T12:00:00Z"
depends_on: [ wb_01M0NYNG00XA7WJ9D36C74RJZW ]
related: []
decisions:
  - action: accept
    date: 2026-08-23
    summary: "Accept the refreshed agent-first marketing prose."
    rationale: "The public copy now reflects current contract 5 behavior, report enhancements, agent TL;DR, agentic safety boundaries, and the requested Douglas Adams inspiration."
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


Agent TL;DR requirement:
- Add a prominent, concise "TL;DR for agents" section to the public README/prose.
- State what Wowbagger is, when an agent should use it, and that the core is the authority for ledger validation, ready selection, inspection, and mutation.
- Include the first-session checks: `wowbagger --version`, `wowbagger capabilities --json`, and the required distribution/contract versions.
- Give the safe read path (`validate`, `ready`, `inspect`) and the guarded write rule: inspect immediately before mutation, send the expected revision, never hand-edit ledger files, and verify after writes.
- Explain the number-versus-ULID distinction and the response-loss rule in agent-operable language.
- Keep the section copy-pasteable, short enough to scan during a live agent session, and consistent with `skills/wowbagger/SKILL.md`.

Additional acceptance criterion:
- A fresh agent can follow the TL;DR to perform a safe read and understand the required guarded mutation sequence without reading the full marketing page first.


Agentic engine optimization requirement:
- Treat the marketing audit as an agentic-engineering audit, not only copy editing.
- Explain how Wowbagger reduces agent failure modes: deterministic ready selection, explicit inspect-before-write CAS, atomic Git publication, claims and fencing, reconciliation after response loss, bounded machine envelopes, and capability negotiation.
- Distinguish guarantees owned by the Wowbagger core from responsibilities left to the harness, plugin, host, and human operator.
- Remove prose that implies autonomous dispatch, exclusive locking, silent retries, or hosted state when the current engine does not provide those guarantees.
- Make the agent workflow and its safety boundaries easy to understand without overstating autonomy.


Hitchhiker's Guide theme requirement:
- Work the iconic phrase "Don't Panic!" into the public marketing prose as a restrained thematic hook for agent safety and recoverable workflow.
- Tie the phrase to concrete Wowbagger guarantees rather than using it as empty decoration: validate first, inspect before mutation, trust exact revisions, never replay a lost write, and verify the result.
- Keep the reference clearly an homage, avoid implying endorsement or affiliation, and preserve Wowbagger's own product identity.


Douglas Adams reference requirement:
- Include a respectful reference to https://douglasadams.com/creations/hhgg.html in the public marketing prose.
- Work in the personal framing: "The books that helped shape my childhood."
- Keep the statement clearly as Lee's personal inspiration, not an official Douglas Adams or Hitchhiker's Guide endorsement, partnership, or affiliation.
- Connect the reference to the product's themes of curiosity, absurdity, resilience, and staying calm while coordinating difficult work.


Implementation outcome (2026-08-23):
- Refreshed README marketing copy with current contract 5 capabilities, report sequencing dashboard enhancements, named views, facets, graph filtering, claims/fencing/reconciliation, and core-versus-host boundaries.
- Added the prominent "TL;DR for agents" workflow with version checks, safe reads, inspect-before-write CAS, response-loss handling, and identity guidance.
- Added the restrained "Don't Panic!" theme and the personal childhood-inspiration reference to https://douglasadams.com/creations/hhgg.html, with an explicit no-affiliation statement.
- Updated npm description/keywords, Claude plugin metadata, marketplace description, and skill trigger prose.
- Published the resulting public prose and image adoption in `0.1.0-alpha.9` / `v0.1.0-alpha.9`.
- Full alpha9 release gate passed on current Node, Node 20, all adapter vectors, ledger validation, audit, and whitespace checks.
