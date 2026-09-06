---
schema_version: 2
id: wb_01M1TZ8E5WHFGA76VNMFFK35J3
number: 211
title: "Deliver a shared SQLite ledger behind a required service"
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

Give concurrent agents one shared live ledger independent of their code branches, through a required local or remote service. CLI and dashboard clients use its API; SQLite is service-owned storage.

## Design discussion

[Shared SQLite ledger behind a required service](../../docs/superpowers/specs/2026-09-06-shared-sqlite-ledger-design.md) captures the complete discussion, evidence, alternatives, acceptance criteria, and unresolved decisions. It distinguishes Lee's requirements from proposed mechanisms. Filing this epic authorizes tracking, not implementation or a live migration.

## Scope

- Authoritative SQLite state shared across worktrees and separate clones; remote clients use a service rather than network-mounted database files.
- Service-owned domain rules for all clients: unique handles, ULID identity, revisions, claims, idempotent operations, and compatible schema upgrades.
- Explicit ledger binding, persistent storage, installation, diagnostics, and a required local or remote service on macOS, Windows, and Linux. Managed background startup is optional; the service is not.
- GitHub publication on a designated ledger branch with readable items, owned attachments, recovery metadata, durable history, and visible publication lag.
- Migration rehearsal, conflict resolution, controlled cutover, database backup, and recovery from a specific published Git commit.
- An HTML dashboard as the primary human reporting surface, with selectable ledger views; retain programmatic projections and historical reporting without live dependence on item Markdown files.
- Lossless rich Markdown bodies and portable ledger-owned research and implementation-plan attachments; external references remain distinguishable.
- Branch integration evidence and explicit dependency-completion policy, without assuming new lifecycle statuses.

## Acceptance criteria

- Local and remote service deployments expose the same domain behavior; concurrent API clients produce unique handles without code-branch integration. No client opens SQLite directly.
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

Direct SQLite client access, offline task writes or reconciliation, independently writable SQLite replicas, automatic code-branch merging, an obligatory hosted database, automatic import of GitHub edits, and high availability claims based only on backups. No child implementation items are created by this filing.

## Architecture decision: required service, 2026-09-06

Lee removed direct SQLite client access from scope, superseding the earlier two-path requirement. A service is mandatory even on a single local machine. Clients resolve an expected ledger identity and local or remote API endpoint, not a database path. The service owns storage, authorization, domain rules, migrations, and publication. Service unavailability must not trigger direct-database fallback.

Multiple projects remain ledger-scoped. The dashboard selects authorized ledgers and named views; all clients use the same API authority. Connection profiles reference credentials without embedding secrets. Database-per-ledger storage and exact connection schemas remain proposals in the linked design.

## Approved API requirements and implementation plan, 2026-09-06

Lee approved the REST resource families and common API rules in the research document and requested a documentation-inclusive implementation plan. All ledger clients, including administrative clients, use the API. Only private service storage code opens databases or issues SQL; installation and initial identity bootstrap are not database access paths.

A fresh service with zero ledgers is healthy and supports explicit creation and staged legacy import. A missing registered database remains a visible recovery error. Import acceptance binds to the inspected source revision. Portable export and GitHub publication are separate operations. OpenAPI, authorization, guarded revisions, scoped idempotency, durable operation status, structured errors, and complete noninteractive CLI coverage apply to every supported operation.

[Service-owned SQLite ledger implementation plan](../../docs/superpowers/plans/2026-09-06-service-owned-sqlite-ledger.md) defines 18 dependency-ordered delivery packages and maps all 19 research acceptance criteria. Each behavioral change includes documentation, verification, and independent review. A healthy Fable- or GPT-6-class orchestrator owns contracts, assignments, integration, and acceptance; cheaper implementers own bounded changes, with stronger specialists for high-risk work. Parallel work uses accepted contracts and separate ownership and resources.

Implementation has not started. The first package resolves remaining technical and business decisions, including publication acknowledgment guarantees, authentication bootstrap, storage binding, and recovery fencing. This planning update does not authorize production implementation, package publication, credential changes, destructive actions, deployment, or live migration. The epic remains in triage; no implementation children are created by this update.


## Implementation authorization and durability decision — 2026-09-06

Lee authorized execution of the implementation plan. Main is the orchestrator at Herdr w77:p1 and writes no code; native subagents own all source, test, probe, and integration code. Lower-capability coding models such as GPT-5.6-Sol and GPT-5.6-Terra are required. A native Sol implementer reported its actual runtime model before receiving coding authorization.

P00 has started with a bounded SQLite ownership probe and read-only security, recovery, reuse, and platform research. No production service is implemented yet.

Lee selected saved locally with publication tracked: a committed SQLite transaction may report success before GitHub publication. The API distinguishes saved from published and supports waiting for publication. After total service-storage loss, recovery guarantees only the latest confirmed publication or retained backup; acknowledged but unpublished work may be lost.

Implementation authorization is not approval for release, deployment, live migration, destructive operations, credential changes, or work in other repositories.
