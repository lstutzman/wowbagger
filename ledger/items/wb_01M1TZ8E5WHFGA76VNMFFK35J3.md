---
schema_version: 2
id: wb_01M1TZ8E5WHFGA76VNMFFK35J3
number: 211
title: "Deliver a shared SQLite ledger with direct and service access"
kind: epic
status: triage
created: 2026-09-06
updated: 2026-09-06
provenance:
  source: "Lee: architecture discussion and explicit epic request, 2026-09-06"
  recorded_at: "2026-09-06T09:06:06.368Z"
depends_on: []
related: []
---

## Goal

Give concurrent agents one shared live ledger independent of their code branches, with direct local SQLite access and local or remote service access through the same core.

## Design discussion

[Shared SQLite ledger with direct and service access](../../docs/superpowers/specs/2026-09-06-shared-sqlite-ledger-design.md) captures the complete discussion, evidence, alternatives, acceptance criteria, and unresolved decisions. It distinguishes Lee's requirements from proposed mechanisms. Filing this epic authorizes tracking, not implementation or a live migration.

## Scope

- Authoritative SQLite state shared across worktrees and separate clones; remote clients use a service rather than network-mounted database files.
- Common domain rules for both modes: unique handles, ULID identity, revisions, claims, idempotent operations, and compatible schema upgrades.
- Explicit ledger binding, persistent storage, installation, diagnostics, and optional supervised local or remote service.
- GitHub publication on a designated ledger branch with readable items, owned attachments, recovery metadata, durable history, and visible publication lag.
- Migration rehearsal, conflict resolution, controlled cutover, database backup, and recovery from a specific published Git commit.
- Live and historical reporting without live dependence on item Markdown files.
- Lossless rich Markdown bodies and portable ledger-owned research and implementation-plan attachments; external references remain distinguishable.
- Branch integration evidence and explicit dependency-completion policy, without assuming new lifecycle statuses.

## Acceptance criteria

- Direct and service clients exercise equivalent domain behavior; concurrent creates produce unique handles without code-branch integration.
- Stale revisions and superseded claims refuse; replay after response loss produces one mutation. No supported writer bypasses the fence.
- Wrong identity, missing authority, and incompatible clients refuse rather than creating a writable fallback.
- Consistent exports survive publication failures and acknowledgment loss; competing publishers cannot regress GitHub history; saved and published state remain distinguishable.
- Migration preserves selected items, identities, relations, complete bodies, and owned attachments and explicitly resolves branch-only items, duplicate handles, conflicting revisions, and nonportable links.
- Recovery reconstructs the promised published state, invalidates old authority and claims, and reports unpublished loss. Backup and Git recovery are verified separately.
- Live reports work with exported Markdown absent; historical reports work without the live database and identify their snapshot.
- Embedded research and owned attachments round-trip without truncation, reformatting, broken internal links, or unguarded concurrent replacement.
- Installation, compatibility diagnostics, supported upgrade tooling, and revised documentation and skills ship with the storage cutover.

## Decisions required before implementation

Set publication acknowledgment and recovery-point guarantees; export/history retention; authority fencing after restore; dependency satisfaction across code branches; exact-byte revision compatibility; attachment limits and concurrency; service authentication, installation platforms, and upgrade coordination. See the design document for the full criteria.

## Non-goals

Offline task writes or reconciliation, independently writable SQLite replicas, automatic code-branch merging, an obligatory hosted database, automatic import of GitHub edits, and high availability claims based only on backups. No child implementation items are created by this filing.
