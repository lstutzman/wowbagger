---
schema_version: 2
id: wb_01M1V5158BCTWHK60NG1P9XMET
number: 212
title: "P00: Resolve service ledger implementation-critical decisions"
kind: task
status: in-progress
created: 2026-09-06
updated: 2026-09-06
provenance:
  source: "Lee-authorized epic #211 execution; implementation plan P00, orchestrator Main at Herdr w77:p1"
  recorded_at: "2026-09-06T10:42:30.892Z"
depends_on: []
related: []
parent: wb_01M1TZ8E5WHFGA76VNMFFK35J3
decisions:
  - action: accept
    date: 2026-09-06
    summary: "Accept P00 as the first implementation-plan package."
    rationale: "The reviewed plan requires runtime probes, concrete technical contracts, Lee's durability decision, and independent architecture/security acceptance before P01/P02. Lee authorized starting this implementation plan; no production code or deployment belongs in P00."
---

## Scope

Execute P00 of docs/superpowers/plans/2026-09-06-service-owned-sqlite-ledger.md. Main owns decisions and independent acceptance; a verified native GPT-5.6-Sol child owns the bounded executable probe. No production code belongs in this package.

## Acceptance

- Compare in-process SQLite and a dedicated database worker using bounded concurrency, HTTP responsiveness, same-revision contention, rollback/reopen/WAL, and orderly-shutdown probes.
- Select SQLite binding and HTTP implementation with exact Node 24.20.0 warning, version, packaging, and platform evidence; distinguish local execution from unverified platforms.
- Decide authentication/bootstrap, browser sessions/CSRF, remote TLS, permissions, and server-owned credential references.
- Decide registry activation, attachment bounds/revisions, byte fidelity, import conflicts, operation retention, and backup retention.
- Record Lee's saved-locally/publication-tracked choice without implying unpublished acknowledgments survive total storage loss.
- Define old-writer isolation and publication fencing required before authority replacement.
- Preserve existing dependency completion semantics.
- Compare Beads reuse against mandatory API-only storage and preservation requirements using primary sources.
- Define supported OS versions and foreground-first installation.
- Update the research document, add the next numbered ADR, and obtain independent architecture/security acceptance before P01/P02.

## Authority

This item authorizes neither destructive operations nor credential changes, release, deployment, publication, live migration, or work in another repository. Current released Markdown tooling remains authoritative until the complete replacement and explicit cutover approval.
