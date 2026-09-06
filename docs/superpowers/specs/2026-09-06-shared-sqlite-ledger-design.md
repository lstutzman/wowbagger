# Shared SQLite ledger with direct and service access

Date: 2026-09-06

Status: Discussion capture and proposed architecture. Lee requested an epic and this document, not implementation. Confirmed requirements below are distinct from proposed mechanisms and unresolved decisions. This proposal changes the current Markdown-authoritative storage contract; it does not describe shipped behavior.

Tracking epic: [Shared SQLite ledger with direct and service access](../../../ledger/items/wb_01M1TZ8E5WHFGA76VNMFFK35J3.md).

## Purpose and confirmed requirements

Wowbagger provides durable, scriptable task management, tracking, and reporting for concurrent coding agents. Agents must be able to work in their own code branches. Git worktrees are one checkout arrangement, not the product boundary. Multiple machines must be supported.

Lee established these requirements during the discussion:

- Support direct access to a local SQLite database and access through a service. The service may be local or remote.
- Treat agents as online while working. Offline task mutation and later synchronization are not requirements.
- Preserve task information in GitHub. Explain publication, freshness, and recovery rather than treating SQLite as the only durable copy.
- Provide tooling to migrate the current ledger, initialize or connect clients, and install the service where needed.
- Recover a lost database from the ledger published on a GitHub branch.
- Support reporting without requiring item Markdown files to be present beside the database.
- Preserve extensive research, implementation plans, code examples, and acceptance criteria embedded in item bodies or linked from them.

The recommendation is one authoritative SQLite store per shared ledger, with a recoverable Git publication. Exact publication policy, recovery guarantees, and attachment limits remain design decisions.

## Why the current architecture causes friction

The current implementation reads branch-local Markdown and allocates the next human number from the items visible in that checkout. ULIDs preserve item identity but do not prevent duplicate human handles across disconnected coordination domains.

Provisioned writers already share a namespace lock and publication journal. The coordinator refuses create when a journaled item is missing locally, rather than allocating a number from shared authoritative item state. This prevents collisions among cooperating writers but requires synchronization before another branch can create an item. Existing-item reconciliation is target-scoped; it is incorrect to describe every sibling mutation as globally blocked.

Evidence:

- [Local allocation](../../../src/mutation.js): `createItemUnfenced` passes local items to `nextItemNumber`.
- [Create reconciliation barrier](../../../src/claim-coordinator.js): `withLegacyMutationFence` checks `missingCoordinatedItems` under the namespace lock.
- [Capabilities](../../../src/claim-capabilities.js): the provisioned profile advertises `merge-coordinated` and `safe_exclusive_dispatch: false`; missing namespaces use advisory mode.
- [Cross-worktree regression coverage](../../../test/create-journal-asymmetry.test.js): a journaled create blocks stale sibling allocation without blocking an unrelated transition.
- [Current identity contract](../../adr/0001-identity-and-claim-contract.md) and [fenced claim contract](../../adr/0004-fenced-work-claim-protocol.md).

Lee reports actual number collisions. This review did not diagnose each incident. Separate clones, namespaces, old clients, or out-of-protocol edits are possible causes, not established incident explanations.

A shared number allocator alone is a narrower alternative. It preserves branch-local item authority but does not solve stale task views, report divergence, or database-to-file publication recovery. A canonical shared Markdown directory removes branch-local copies but retains custom transaction and recovery machinery. Neither is the recommended target.

## Authority and access modes

Code branches isolate code. They do not partition the live backlog. Branch checkout does not rewind task state, and abandoning a code branch does not erase its findings.

The shared core owns lifecycle validation, number allocation, claims, revision checks, idempotency, and report projections. Two entry paths call that same implementation:

- Direct mode: CLI, shared core, local SQLite database.
- Service mode: CLI transport, local or remote service, shared core, service-local SQLite database.

Domain results and refusal semantics must agree across modes. The service adds authentication and network errors, not a second implementation of task rules.

A direct database belongs in persistent host-local storage outside every checkout. An illustrative macOS location is `~/Library/Application Support/wowbagger/ledgers/<ledger-id>/ledger.sqlite`; platform paths remain to be selected. A service uses its own persistent data directory, separate from application releases.

Each checkout explicitly binds to a ledger identity and either a local database target or a service endpoint. Worktree discovery through Git's common directory may be convenient, but cannot define project identity across separate clones. Connections verify the expected ledger identity. Missing storage or an unreachable endpoint must never create a fresh writable fallback.

Compatible local direct clients may use the same database while a service runs. SQLite serializes transactions; the shared core enforces domain rules. Direct access is trusted local access. A deployment requiring service authorization for every write must restrict filesystem access to the database.

Remote clients use the service, never a SQLite file on a network filesystem. Multiple independently writable SQLite replicas and offline merge protocols are out of scope.

## Transactions, claims, and branch integration

Each short mutation transaction checks the request, expected revision, and any claim fence; validates current domain state; allocates a number when needed; and writes the mutation, audit event, and operation result atomically. No transaction remains open while an agent reasons, edits code, runs tests, or waits for review.

Preserve ULIDs and unique ledger-scoped handles. A stale update refuses rather than overwriting newer content. Persist operation identity and a request digest with the result so an identical retry returns the same outcome and conflicting reuse refuses.

Claims remain separate from lifecycle status. Publication checks owner, epoch, expiry, and revision in the same transaction. Durable lease clock handling must follow the fenced-claim contract. SQLite alone does not authorize a strict-fencing capability: every supported mutation path must enforce it. Claims cannot prevent stale agents from editing source files or performing external side effects.

An implementation complete on one feature branch is not automatically available in another checkout. Record repository, branch, commit, or PR evidence. Define when completion satisfies dependencies, such as integration into a designated branch, before changing readiness semantics. New statuses are not yet selected.

Network failures have explicit outcomes: bounded retries for transient failure, idempotent replay after response loss, and refusal of stale claim generations. Online operation does not guarantee service availability. No local fallback writes are permitted during an outage.

## Database content and schemas

The database contains all authoritative task data: item metadata, complete Markdown bodies, relations, provenance, decisions, extension values and declarations, ledger configuration, revisions, claims, audit events, operation results, and publication state. Reports must not reopen item files to complete an item.

Storage schema means tables, indexes, constraints, and database migration version. Domain schema means the core's validation and lifecycle contract, with relevant versions and ledger declarations persisted so content is interpretable. Use database constraints for structural invariants and the shared core for domain rules.

Preserve existing lifecycle, dependency, epic accounting, deterministic ready ordering, and reporting semantics unless an explicit decision changes them. Review the current exact-byte revision and lossless source contracts. Either preserve canonical source bytes or version those APIs deliberately; SQLite does not require discarding source fidelity.

Every connection verifies schema and protocol compatibility. An older branch binary must not reinterpret newer storage or run an automatic downgrade. Schema upgrades require a backup, coordinated writer exclusion, validation, and explicit activation.

## Rich bodies, attachments, and links

Preserve complete embedded Markdown, including research, plans, code blocks, local annotations, and acceptance criteria. Do not summarize, truncate, or split arbitrary headings into schema fields. Body edits require revision checks. Append operations remain useful for enrichment without replacing existing research.

Proposed ledger-owned attachments cover separate documents necessary to preserve an item's plan. Store logical path, media type, content hash, association, and content for each attachment. Modest text, patches, and supporting files can live in SQLite so mutation and backup remain transactional. Size limits and large-binary handling require a decision.

Agents can retrieve attachments through the CLI or service, materialize them for normal file tooling, and submit changes through revision-checked commands. Materialized files are editable copies, not an additional authority. Publish attachments with the item and import them during recovery. Define whether item-plus-attachment changes share an aggregate revision or carry separate revision guards before implementation.

Classify references explicitly:

- Ledger-owned content is preserved in backup and Git export.
- Source evidence identifies repository, commit, and path where possible.
- Living project documents remain external references whose contents can change.
- External URLs are not guaranteed recoverable. Capture necessary material only where permitted.
- Absolute local paths are nonportable and must be reported.

Migration inventories links, including missing files and local-only references. It proposes attachment imports rather than copying arbitrary linked paths or secrets automatically. Relative links in both item bodies and attached documents must resolve in the published layout.

## GitHub publication

Proposed model: SQLite owns current state; GitHub stores a readable recovery package on one designated ledger branch. Do not commit the active database binary into agent code branches. Keep the export outside code-branch mutation workflows.

The package includes Markdown items, owned attachments, ledger definitions, durable history promised by the recovery contract, and a versioned manifest. The manifest identifies the ledger, authority generation, export format, included change sequence, and content inventory. A full database backup and a Git recovery package serve different purposes.

A publisher reads a consistent snapshot through change N, generates the package in a dedicated checkout, commits it, pushes it, and records publication only after confirming the remote commit. Mutations after N remain pending. Store sufficient durable publication state to recover after a push succeeds but its acknowledgment or local bookkeeping fails.

Only one publisher advances a ledger's publication branch at a time. This must hold across direct processes and service workers, not merely one in-memory process lock. Use expected remote history to prevent overwriting another publisher or an out-of-band edit. Do not force-push divergent exports automatically.

Service mode can publish in the background. Direct mode needs an explicit sync operation and may offer the same operation after mutations. Command names and cadence are proposals, not shipped interfaces.

Expose database position, confirmed publication position and commit, pending state, and last failure. A failed push must not erase a saved mutation or invite duplicate creation.

Two distinct results are under consideration:

- Saved: committed locally; publication may be pending.
- Published: committed locally and confirmed on GitHub.

Lee has not selected whether every successful command must wait for GitHub publication. That decision determines the accepted unpublished-loss window and outage behavior.

Normal freshness flows from database to GitHub. Direct GitHub edits are out-of-band changes requiring detection and explicit reviewed import, not last-writer-wins synchronization. Database restoration compares identity, generation, publication position, and history before accepting writes. A counter alone cannot establish ancestry across divergent stores.

## Installation, migration, and cutover

Direct mode requires database support in the CLI, not a separate SQLite agent. Service installation is optional. Supported tooling should initialize or import, bind clients, serve an existing ledger, install supervised startup, diagnose configuration and publication, back up, restore, and upgrade schemas. Exact platform support and command interfaces remain open.

Initial migration has a read-only rehearsal and an explicit cutover:

1. Inventory the current ledger, schema, claims, and selected Git refs, including branch-only items.
2. Resolve duplicate handles and competing same-ULID revisions explicitly. Preserve IDs and relation targets.
3. Inventory linked research and propose attachment treatment.
4. Establish a quiesced window for old writers.
5. Import into a new database without overwriting the original ledger.
6. Validate all items and compare content, relations, and deterministic report results with the selected source state.
7. Publish the initial recovery package and activate client bindings.
8. Require fresh claims and prevent continued use of the old writable ledger path.

Preserve old history for rollback, but do not operate two writable authorities after cutover. Define rollback restrictions once the new authority has accepted mutations. This epic does not authorize deleting existing files, stopping agents, changing credentials, or migrating a live ledger without explicit approval.

## Loss, backup, and recovery

A missing expected database is an error, never an empty ledger. It must not cause an empty export that replaces GitHub history.

Recovery from GitHub selects an exact commit, validates the recovery package, imports into a new database, validates domain state, establishes a new authority generation, invalidates old active claims, and requires explicit activation. Fence all participating clients, including direct clients, so an old authority cannot continue accepting writes after replacement. Backups must include SQLite's committed state through a SQLite-aware procedure, not a blind copy of an active WAL database file.

GitHub can restore only published state. If the database reached 428 and GitHub reached 421, changes 422 through 428 require another backup or are lost. Do not claim zero data loss without a corresponding acknowledgment and replication policy.

Active leases, secrets, and old client authority are not restored blindly. Decide which audit and operation-result history is exported, retained only in backups, or reset during recovery. An operation ID whose result was lost during restoration must not be silently treated as a new request from the old authority generation.

## Reporting

Live reports use one consistent database snapshot, directly or through the service. They include current task state and, where relevant, claim and publication state. No Markdown export or Git checkout is required.

Published reports use a recovery package at a specific Git commit and the same domain/reporting engine. They state the source commit, included change position, and effective reporting date. They do not present historical leases as current ownership or imply unpublished work is included.

Both render full bodies and available attachments. External links remain visibly external. Named views and readiness must continue to use complete-ledger dependency context before filtering presentation. Report artifacts remain derived output, not authority for mutation or dispatch.

## Verification and acceptance criteria

The epic is complete only when the following observable contracts are demonstrated:

1. Concurrent direct clients in separate worktrees and clones create unique handles in one bound database without Git integration.
2. Remote clients use the same task semantics through a service; compatible local direct access can coexist against that store.
3. Stale revisions and expired or superseded claim generations cannot publish; alternate supported mutation paths cannot bypass fencing.
4. Lost-response replay yields one mutation and one recorded result, including conflicting operation-ID refusal.
5. Missing targets, wrong ledger identities, incompatible clients, and uncoordinated schema upgrades refuse safely.
6. Publication preserves consistent item, attachment, configuration, and history snapshots; concurrent publishers cannot regress remote history.
7. A crash or response loss between export, push, and acknowledgment has a deterministic recovery path. Publication lag and failures are visible.
8. Migration rehearsal identifies branch-only content, conflicting revisions, duplicate handles, and nonportable references. Cutover preserves selected content and domain behavior.
9. Restoring a published package reconstructs its promised state, invalidates old authority, and states unpublished loss honestly. Restore drills also cover database backups.
10. Live reports work without Markdown files; published reports work without the live database. Both identify their snapshot and preserve deterministic semantics.
11. Rich bodies and owned attachments survive migration, mutation, publication, and recovery without lost content or broken internal links.
12. Installation and diagnostics cover direct and service modes, persistent storage, compatibility, backup, and publication health.
13. Product documentation and skills describe the new authority model and remove obsolete commit-per-mutation and branch-reconciliation instructions only when the replacement ships.

A bounded investigation tested SQLite 3.53.4 mechanics: eight separate writer processes committed 200 items with 200 unique numbers; two same-revision updates produced one success and one rejection; rollback, reopen, and integrity checks passed. This was not a Wowbagger backend test, a throughput benchmark, or a crash-durability proof. The source review inspected existing regression tests but did not run them because this worktree lacked its local YAML dependency at that time.

## Proposed work packages and unresolved decisions

Decompose the epic after design review into contracts and schema; transactional core; direct binding and compatibility; service transport and installation; export and publication; migration and recovery; attachments; reporting; and cutover documentation. These are proposed work packages, not created child items or an implementation sequence.

Resolve before implementation:

- Whether command success requires GitHub publication and what recovery-point guarantee users receive.
- Publication branch ownership, batching cadence, authentication, and treatment of reviewed external edits.
- Exact recovery-package contents, operation-history retention, backup policy, and restored-authority fencing.
- Dependency completion policy across code branches and integration targets.
- Byte-level source/revision compatibility and API versioning.
- Attachment limits, aggregate revision semantics, portable link layout, and large-binary policy.
- Service authentication, installation platforms, exposure model, and schema-upgrade coordination across direct clients.

Non-goals are offline writes, writable replicated SQLite stores, automatic Git merges of agent code, hosted-database requirements, automatic out-of-band imports, and claiming high availability from backups alone.

## SQLite references

- [Transaction isolation](https://www.sqlite.org/isolation.html).
- [WAL operation and restrictions](https://www.sqlite.org/wal.html). Select a maintained runtime containing relevant WAL fixes and verify its actual embedded version.
- [Online backup API](https://www.sqlite.org/backup.html).
- [Appropriate uses](https://www.sqlite.org/whentouse.html).
