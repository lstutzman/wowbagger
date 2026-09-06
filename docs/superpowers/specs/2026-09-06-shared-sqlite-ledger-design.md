# Shared SQLite ledger behind a required service

Date: 2026-09-06

Status: Approved architecture direction and research record, with implementation details identified below. On 2026-09-06 Lee approved the REST resource families and API rules and requested an implementation plan with documentation, parallel implementers, strong orchestration, and independent review. This document changes the current Markdown-authoritative storage contract; it does not describe shipped behavior or authorize implementation, deployment, or live migration.

Tracking epic: [Epic #211](../../../ledger/items/wb_01M1TZ8E5WHFGA76VNMFFK35J3.md).

Implementation plan: [Service-owned SQLite ledger implementation plan](../plans/2026-09-06-service-owned-sqlite-ledger.md).

## Purpose and confirmed requirements

Wowbagger provides durable, scriptable task management, tracking, and reporting for concurrent coding agents. Agents must be able to work in their own code branches. Git worktrees are one checkout arrangement, not the product boundary. Multiple machines must be supported.

Lee established these requirements during the discussion:

- Require a service for all normal ledger access, including local-only use. CLI and dashboard clients use its API; clients never open the SQLite database directly.
- Treat agents as online while working. Offline task mutation and later synchronization are not requirements.
- Preserve task information in GitHub. Explain publication, freshness, and recovery rather than treating SQLite as the only durable copy.
- Provide tooling to migrate the current ledger, initialize or connect clients, and install the service where needed.
- Recover a lost database from the ledger published on a GitHub branch.
- Support reporting without requiring item Markdown files to be present beside the database.
- Preserve extensive research, implementation plans, code examples, and acceptance criteria embedded in item bodies or linked from them.
- Support multiple projects with explicit ledger selection and connection configuration.
- Run the service on macOS, Windows, and Linux.
- Expose an API as the service's programmatic input, with Wowbagger domain logic in front of the database.
- Make an HTML dashboard the primary human reporting surface. Users select a view in the dashboard instead of generating a report as their normal workflow.
- Allow a healthy service to start with no ledger databases and accept explicit ledger creation or import.
- Provide a RESTful API, including legacy ledger import and portable export suitable for GitHub publication.
- Make all supported API operations automatable through the CLI, including administrative operations subject to authorization.
- Route every ledger operation through the API, including validation, import, export, backup, recovery, and historical reporting. Only the service's private storage implementation issues SQL.
- Include all approved REST resource families, staged import, separate export and publication, OpenAPI, guarded revisions, idempotency, durable operations, structured errors, and per-ledger authorization.
- Deliver independently reviewable changes with their documentation and verification. Use a Fable- or GPT-6-class orchestrator, cheaper bounded implementers, and independent reviewers under the configured provider health policy.

The recommendation is one authoritative SQLite store per shared ledger, with a recoverable Git publication. Exact publication policy, recovery guarantees, and attachment limits remain design decisions.

Decision update, 2026-09-06: Lee removed direct SQLite client access from the target architecture. This supersedes the earlier two-access-path requirement. SQLite remains service-owned storage, not a client interface. The service may run locally or remotely; these are deployment choices for one API, not separate access modes.

Decision update, 2026-09-06: Lee approved the endpoint recommendations and explicitly rejected all direct SQL access. The earlier reference to controlled maintenance tooling is superseded: maintenance clients also use the API, and SQL stays inside the service. Service installation and initial identity bootstrap remain host operations, not alternate ledger access. Approved resource families are requirements; the example URL spellings and complete schemas still require contract review.

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

## Authority and service boundary

Code branches isolate code. They do not partition the live backlog. Branch checkout does not rewind task state, and abandoning a code branch does not erase its findings.

The service's core owns lifecycle validation, number allocation, claims, revision checks, idempotency, and report projections. CLI clients, programmatic clients, dashboard clients, and maintenance clients all use its API. Only the service's private storage implementation opens ledger databases or issues SQL.

Local and remote deployments expose the same domain operations. The CLI does not embed an alternate database write path or fall back to direct access when the service is unavailable.

The database belongs in persistent service-host storage outside every code checkout and application release directory. Platform-specific locations remain to be selected. The service owns database compatibility and migrations; clients negotiate API compatibility.

Each checkout binds to an expected ledger identity and a service connection. Worktree discovery through Git's common directory may be convenient, but cannot define identity across separate clones. Connections verify the expected ledger identity. Missing storage or an unreachable service must never create a fresh writable fallback.

Database filesystem permissions must restrict access to the service. The product provides no direct SQL client, maintenance bypass, or arbitrary SQL endpoint. A host administrator can physically access files, but that does not make filesystem edits a supported ledger operation.

Remote clients never open a SQLite file on a network filesystem. Multiple independently writable SQLite replicas and offline merge protocols are out of scope.

## Multiple projects and connection configuration

Proposed isolation model: each project binds to a stable ledger ID, and one service can host multiple ledgers. All branches and clones of a project resolve the same authority. Directory names, branch names, and connection aliases are not ledger identity.

Recommend one SQLite database per ledger. Items, human numbering, claims, configuration, publication state, and backups remain ledger-scoped. Separate databases also avoid a shared SQLite writer lock across unrelated projects. Filesystem separation does not replace per-ledger authorization.

A human handle such as #211 is meaningful within its ledger. Cross-project references need the ledger identity and item identity. Cross-ledger dependency evaluation is not proposed for the initial scope; it requires separate consistency and readiness decisions.

The proposed connection configuration has three parts:

- A committed project binding names the expected ledger ID and a logical connection alias. It contains neither secrets nor machine-specific database paths.
- A machine-level connection profile resolves the alias to a local loopback or remote service endpoint and a credential reference. Database paths remain server configuration, not client settings.
- Credentials live in an OS credential store or deployment secret facility, with a supported noninteractive source for headless agents. Configuration refers to credentials rather than embedding them.

Different machines may resolve an alias through different routes, but connections must verify the expected ledger identity. A repository binding must not silently authorize use of arbitrary machine credentials. Define connection trust, explicit overrides, and configuration precedence before implementation.

The server maintains its own registry of ledger IDs, storage locations, authorization, and publication settings. Clients select authorized ledger identities, never arbitrary server filesystem paths. Diagnostics identify the selected project, ledger, target, and compatibility without revealing secrets. Exact configuration filenames, schemas, and credential providers remain proposals.

## Service API and shared domain logic

The service exposes domain operations, not SQL execution or unrestricted table updates. Agents can use its API through the CLI or a programmatic client; the dashboard uses the same API.

Operation families include list, inspect, report projections, create, patch, transition, claim acquisition and renewal, claimed publication, attachment access, and publication status or synchronization. Each mutation uses the shared core's lifecycle, relation, revision, claim, and operation-identity checks.

REST, OpenAPI, guarded revisions, scoped idempotency, durable operation resources, structured errors, and CLI parity are approved requirements. Use a versioned HTTP API with JSON metadata and documented upload and download representations. Exact routes and wire schemas remain subject to contract review. The service enforces authentication, per-ledger authorization, request limits, protocol negotiation, and encrypted remote transport. Local loopback access also needs protection against unauthorized callers.

The CLI is an API client in both local and remote deployments. Domain logic runs in the service. Backup, import, validation, recovery, and historical reporting use API resources backed by private service storage logic. There is no supported direct database maintenance mode.

Serve dashboard assets and the API from the same service deployment. The browser owns presentation, not a duplicate implementation of readiness or lifecycle rules.

### Empty service and ledger onboarding

A fresh service can be healthy with zero ledger databases. Its API and dashboard remain available for authorized creation and import. This does not mean that the service has no persistent configuration: identities, access policy, and the ledger registry may exist before any ledger.

Distinguish an empty registry from a registered ledger whose database is missing or corrupt. The first is valid initial state. The second is a recovery problem: report the ledger as unavailable, preserve its registration, and refuse its mutations or publication. Do not silently replace or forget the missing ledger.

New-ledger creation and staged import are separate operations. Creation explicitly initializes an empty ledger. Import accepts uploaded legacy ledger content, validates an immutable staged source, reports conflicts and nonportable links, and requires explicit acceptance before making a new ledger available. Default import never overwrites a registered ledger.

The CLI packages a local legacy ledger and uploads it; a remote service cannot read the client's filesystem path. Reject unsafe archive paths, escaping symlinks, excessive expanded sizes, and arbitrary server-path requests. Reading from a Git remote requires a separate constrained source contract; upload is the initial recommendation.

Import inspection does not itself mutate the live ledger. Acceptance binds to the inspected source and conflict-resolution revision so the committed result cannot differ silently from the preview. Existing-ledger reconciliation and recovery are distinct workflows, not an overwrite flag on ordinary import.

### Approved REST resource families

Lee approved every resource family below. Routes are design examples under `/api/v1`, not implemented or frozen wire contracts. `{ledger}` denotes a stable authorized ledger ID; item routes use immutable item IDs, with human number lookup supported by collection filters.

| Resource | Proposed methods and paths | Purpose |
|---|---|---|
| Service discovery | `GET /health`, `GET /readiness`, `GET /capabilities` | Distinguish process health, onboarding availability, and supported API versions, formats, and limits. An empty registry is not a readiness failure. |
| Caller identity | `GET /me` | Show the authenticated principal and effective permissions without exposing credentials. Bootstrap must work before any ledger exists. |
| Ledgers | `GET /ledgers`, `POST /ledgers`, `GET /ledgers/{ledger}` | List authorized ledgers, explicitly create an empty ledger, and inspect identity, availability, and publication state. |
| Import sessions | `POST /imports`, `GET /imports/{import}`, `POST /imports/{import}/commits` | Upload and validate legacy content, inspect findings and proposed resolutions, then explicitly accept the inspected revision into a new ledger. |
| Items | `GET /ledgers/{ledger}/items`, `POST /ledgers/{ledger}/items`, `GET /ledgers/{ledger}/items/{item}`, `PATCH /ledgers/{ledger}/items/{item}` | Filter, search, paginate, create, inspect, and revise permitted non-lifecycle content. Return whole bodies on detail requests. |
| Lifecycle and relations | `POST /ledgers/{ledger}/items/{item}/transitions`, `GET /ledgers/{ledger}/items/{item}/history` | Apply validated lifecycle transitions with reasons and inspect history. Relation edits use revision-checked item mutations; parent and snooze operations need explicit documented contracts. |
| Readiness | `GET /ledgers/{ledger}/ready` | Return deterministic actionable work and reasons for blockers, with the effective date and snapshot witness. |
| Claims | `POST /ledgers/{ledger}/items/{item}/claims`, `GET /ledgers/{ledger}/claims/{claim}`, `PATCH /ledgers/{ledger}/claims/{claim}`, `POST /ledgers/{ledger}/claims/{claim}/releases` | Acquire, inspect, renew, and release ownership through guarded operations. Do not expose arbitrary owner or epoch updates. |
| Claimed publication | `POST /ledgers/{ledger}/items/{item}/claimed-publications` | Apply a mutation under the claim fence and expected item revision. This is distinct from GitHub export publication. |
| Attachments | `GET` and `POST /ledgers/{ledger}/items/{item}/attachments`, `GET` and `PUT /ledgers/{ledger}/items/{item}/attachments/{attachment}` | List, upload, retrieve, and revision-check replacement of owned content and metadata. Stream file content rather than force all bytes into JSON. |
| View definitions and projections | `GET` and `POST /ledgers/{ledger}/views`, `GET` and `PATCH /ledgers/{ledger}/views/{view}`, `GET /ledgers/{ledger}/views/{view}/results` | Manage authorized shared view definitions and fetch dashboard or agent projections without generating an HTML file. |
| Change history | `GET /ledgers/{ledger}/events` | Read authorized, cursor-paginated audit and change history. Initial dashboard refresh can poll; live streaming remains optional. |
| Configuration | `GET` and `PATCH /ledgers/{ledger}/configuration` | Inspect and revise permitted ledger definitions and publication settings. Redact secrets and validate changes; never expose unrestricted database or filesystem configuration. |
| Exports | `POST /ledgers/{ledger}/exports`, `GET /ledgers/{ledger}/exports/{export}`, `GET /ledgers/{ledger}/exports/{export}/content` | Create a consistent portable package, inspect its snapshot and manifest, and download it without a GitHub side effect. |
| GitHub publication | `POST /ledgers/{ledger}/publications`, `GET /ledgers/{ledger}/publications/{publication}` | Request export publication to the configured remote and inspect the confirmed commit or pending failure. |
| Long-running operations | `GET /operations/{operation}` | Inspect durable queued, running, successful, or failed work and retrieve its result after disconnect or service restart. Every operation is authorization-scoped. |
| Maintenance | `POST /ledgers/{ledger}/validations`, `POST /ledgers/{ledger}/backups`, `POST /recoveries`, `GET /recoveries/{recovery}`, `POST /recoveries/{recovery}/activations` | Validate, create a database-aware backup, stage a recovery, inspect it, and activate a new authority under explicit administrative controls. |

Exact recovery upload routes, parent migration, snooze, attachment metadata operations, and allowed configuration fields must be specified before implementation. This inventory names required resource families rather than claiming complete request schemas. Include every supported operation in OpenAPI and CLI coverage; do not infer missing schemas by probing refusals.

### Export, publication, and recovery boundaries

Export creates a versioned portable artifact containing items, definitions, owned attachments, and the manifest and history promised by the recovery contract. GitHub publication pushes that artifact's representation to a configured branch. Separate resources let a caller inspect or download an export without granting permission to push.

A legacy import and a recovery-package import have different contracts. Legacy import reports compatibility and conflict choices. Recovery verifies package identity, hashes, version, and history and establishes a new authority generation before activation. Neither exposes arbitrary SQL or permits silent replacement of a live ledger.

### Common API behavior and CLI parity

- Require per-ledger authorization for every item, view, artifact, operation, and history request. Ledger creation and imports also require explicit service-level permissions.
- Use entity tags and `If-Match` or an equivalent documented revision field for guarded updates. Stale revisions refuse; reads return a usable concurrency witness.
- Require scoped idempotency keys for retryable state-changing requests. Bind keys to ledger or service scope, caller, the request's observed authority generation, operation, and request digest. Reuse with different content refuses. Check the supplied generation before replay lookup or execution, so restoration cannot turn an old request into a new mutation even when operation history was not retained.
- Return stable machine-readable errors, useful conflict details, and correlation IDs without secrets. Distinguish validation, authorization, revision conflict, and unavailable authority.
- Return `201 Created` with a resource location for synchronous creation and `202 Accepted` with a durable operation location for asynchronous work. Acceptance is not completion.
- Make pagination, filtering, limits, snapshot witnesses, and effective dates explicit. No unbounded collection reads or hidden truncation of item details.
- Preserve operation status across restarts. Do not advertise cancellation until each operation defines a safe cancellation boundary.
- Provide CLI commands for every supported API operation, including upload, download, wait, and inspection. Preserve structured JSON output, stable exit semantics, and noninteractive use. Local service installation and initial credential bootstrap remain host-level prerequisites; they cannot require an already-running authenticated API and do not open ledger databases.

Do not add raw SQL, generic server-file access, hard deletion, unaudited force-unlock, or service shutdown endpoints merely to make the API appear complete. Authentication provider choice and first-administrator bootstrap remain explicit open decisions.

## Transactions, claims, and branch integration

Every supported writer uses one private service storage admission boundary. Only that boundary opens ledger databases, and opening a registered ledger must not create a missing file. Each short mutation transaction checks target identity, expected authority generation, operation identity, and the operation-specific revision and claim predicates; validates current domain state; allocates a number when needed; and writes the mutation, audit event, and operation result atomically. Creation, import acceptance, recovery activation, and internal bookkeeping have explicit admission predicates too. No transaction remains open while an agent reasons, edits code, runs tests, or waits for review.

Preserve ULIDs and unique ledger-scoped handles. A stale update refuses rather than overwriting newer content. Persist operation identity and a request digest with the result so an identical retry returns the same outcome and conflicting reuse refuses.

Claims remain separate from lifecycle status. Publication checks owner, epoch, expiry, and revision in the same transaction. Durable lease clock handling must follow the fenced-claim contract. SQLite alone does not authorize a strict-fencing capability: every supported mutation path must enforce it. Claims cannot prevent stale agents from editing source files or performing external side effects.

An implementation complete on one feature branch is not automatically available in another checkout. Record repository, branch, commit, or PR evidence. Define when completion satisfies dependencies, such as integration into a designated branch, before changing readiness semantics. New statuses are not yet selected.

Network failures have explicit outcomes: bounded retries for transient failure, idempotent replay after response loss, and refusal of stale claim generations. Online operation does not guarantee service availability. No local fallback writes are permitted during an outage.

## Database content and schemas

The database contains all authoritative task data: item metadata, complete Markdown bodies, relations, provenance, decisions, extension values and declarations, ledger configuration, revisions, claims, audit events, operation results, and publication state. Reports must not reopen item files to complete an item.

Storage schema means tables, indexes, constraints, and database migration version. Domain schema means the core's validation and lifecycle contract, with relevant versions and ledger declarations persisted so content is interpretable. Use database constraints for structural invariants and the shared core for domain rules.

Preserve existing lifecycle, dependency, epic accounting, deterministic ready ordering, and reporting semantics unless an explicit decision changes them. Review the current exact-byte revision and lossless source contracts. Either preserve canonical source bytes or version those APIs deliberately; SQLite does not require discarding source fidelity.

Clients verify API compatibility; the service verifies database schema compatibility before serving requests. An older client must not trigger an automatic database downgrade. Schema upgrades require a backup, coordinated service writer exclusion, validation, and explicit activation.

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

Only one publisher advances a ledger's publication branch at a time. This must hold across service workers and service replacement, not merely one in-memory process lock. Use expected remote history to prevent overwriting another publisher or an out-of-band edit. Do not force-push divergent exports automatically.

The service can publish in the background. CLI and dashboard clients may request synchronization through the API. Command names and cadence are proposals, not shipped interfaces.

Expose database position, confirmed publication position and commit, pending state, and last failure. A failed push must not erase a saved mutation or invite duplicate creation.

Two distinct results are under consideration:

- Saved: committed in the service database; publication may be pending.
- Published: committed in the service database and confirmed on GitHub.

Lee has not selected whether every successful command must wait for GitHub publication. That decision determines the accepted unpublished-loss window and outage behavior.

Normal freshness flows from database to GitHub. Direct GitHub edits are out-of-band changes requiring detection and explicit reviewed import, not last-writer-wins synchronization. Database restoration compares identity, generation, publication position, and history before accepting writes. A counter alone cannot establish ancestry across divergent stores.

## Installation, migration, and cutover

A running service is required even for local-only use. Supported tooling should initialize or import, bind clients, start the service for an existing ledger, install supervised startup, diagnose configuration and publication, back up, restore, and upgrade schemas. Foreground versus managed background startup remains an installation choice, not an alternative database access path.

macOS, Windows, and Linux are required service platforms. Cross-platform support includes persistent data and configuration paths, permissions, credentials, SQLite locking, foreground execution, shutdown, upgrades, and backups, not merely a runtime that starts on all three. Optional background-service installation needs platform-specific handling. Exact command interfaces, packaging, supported OS versions, and service-manager integration remain open.

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

Recovery from GitHub selects an exact commit, validates the recovery package, imports into a new database, validates domain state, establishes a new authority generation, invalidates old active claims, and requires explicit activation. Fence the old service authority and stale client requests so an old instance cannot continue accepting writes after replacement. Backups must include SQLite's committed state through a SQLite-aware procedure, not a blind copy of an active WAL database file.

GitHub can restore only published state. If the database reached 428 and GitHub reached 421, changes 422 through 428 require another backup or are lost. Do not claim zero data loss without a corresponding acknowledgment and replication policy.

Active leases, secrets, and old client authority are not restored blindly. Decide which audit and operation-result history is exported, retained only in backups, or reset during recovery. An operation ID whose result was lost during restoration must not be silently treated as a new request from the old authority generation.

## Dashboard and reporting

The HTML dashboard is the primary human reporting surface. The normal workflow is to open it, select a project or ledger, select a named view, and inspect items, dependencies, progress, research, and publication state. Generating a static report is no longer the primary workflow.

Live views use one consistent database snapshot through the service. They include current task state and, where relevant, claim and publication state. No Markdown export or Git checkout is required. The dashboard should refresh without manual report generation; polling versus push updates remains an implementation choice.

Proposed view model: shared view definitions belong to ledger configuration, while the user's current ledger and view selection belong to browser state and a bookmarkable URL. View selection never grants access to another ledger. The API enforces authorization independently of visible dashboard controls.

Agents retain CLI and API access to readiness, summaries, and filtered projections. Dashboard-first does not mean browser-only. Local users run a service regardless of whether they open the dashboard. CLI and browser clients connect to the same ledger through that service; opening the dashboard does not import another copy or change authority.

Historical reporting uses a recovery package at a specific Git commit, uploaded or selected through an authorized service API resource and projected by the service's domain engine. It works without the original live database, but not without a service. It identifies the source commit, included change position, and effective reporting date. Historical leases are not current ownership, and unpublished work is not implied. Optional static HTML export was discussed as a secondary snapshot feature; retaining that command is not yet a requirement.

Live and historical surfaces render full bodies and available attachments. External links remain visibly external. Render stored Markdown safely and prevent attachment paths from escaping their intended storage or materialization roots. Named views and readiness must continue to use complete-ledger dependency context before filtering presentation. Reports remain derived output, not authority for mutation or dispatch.

## Verification and acceptance criteria

The epic is complete only when the following observable contracts are demonstrated:

1. Concurrent CLI and API clients in separate worktrees and clones create unique handles in one bound ledger without Git integration or direct database access.
2. Local and remote deployments expose the same domain semantics through the service API. No normal client operation requires a database path or embedded SQLite access.
3. Stale revisions and expired or superseded claim generations cannot publish; alternate supported mutation paths cannot bypass fencing.
4. Lost-response replay yields one mutation and one recorded result, including conflicting operation-ID refusal.
5. Missing targets, wrong ledger identities, incompatible clients, and uncoordinated schema upgrades refuse safely.
6. Publication preserves consistent item, attachment, configuration, and history snapshots; concurrent publishers cannot regress remote history.
7. A crash or response loss between export, push, and acknowledgment has a deterministic recovery path. Publication lag and failures are visible.
8. Migration rehearsal identifies branch-only content, conflicting revisions, duplicate handles, and nonportable references. Cutover preserves selected content and domain behavior.
9. Restoring a published package reconstructs its promised state, invalidates old authority, and states unpublished loss honestly. Restore drills also cover database backups.
10. Live reports work without Markdown files; historical reports served from a recovery package work without the original live database. Both use the service API, identify their snapshot, and preserve deterministic semantics.
11. Rich bodies and owned attachments survive migration, mutation, publication, and recovery without lost content or broken internal links.
12. Installation and diagnostics cover local and remote service deployments on macOS, Windows, and Linux, including persistent storage, permissions, compatibility, backup, and publication health.
13. Product documentation and skills describe the new authority model and remove obsolete commit-per-mutation and branch-reconciliation instructions only when the replacement ships.
14. Multiple ledgers remain isolated within one service: item operations, claims, reports, attachments, and publication respect ledger-scoped authorization. Connection configuration cannot silently select the wrong authority or expose credentials.
15. The dashboard lets a user select an authorized ledger and named view, inspect the corresponding current report, and refresh it without generating an HTML file. Agents retain equivalent programmatic projections.
16. CLI and dashboard clients use the same service authority. An unavailable local service produces an explicit connection failure, not a direct SQLite fallback.
17. A fresh service with no ledger databases exposes its API and dashboard and can create or import its first ledger. A missing registered database remains a visible recovery error and cannot cause an empty overwrite.
18. Legacy import preview and acceptance bind to the same source revision, preserve content and identity, and reject unsafe uploads. Export produces a validated GitHub-ready package without implicitly pushing it.
19. The REST contract and CLI cover all supported operations with authorization, concurrency controls, durable asynchronous results, and honest retry semantics. Dashboard-only capabilities are not acceptable.

A bounded investigation tested SQLite 3.53.4 mechanics: eight separate writer processes committed 200 items with 200 unique numbers; two same-revision updates produced one success and one rejection; rollback, reopen, and integrity checks passed. This was not a Wowbagger backend test, a throughput benchmark, or a crash-durability proof. The source review inspected existing regression tests but did not run them because this worktree lacked its local YAML dependency at that time.

## Proposed work packages and unresolved decisions

The linked implementation plan decomposes this epic into dependency-ordered, independently verifiable changes. Each behavioral slice includes API and CLI coverage, relevant documentation, and independent review. The orchestrator owns contracts, assignment, integration, and acceptance; implementers own bounded changes. Parallel work starts only after shared contracts are accepted, with separate file ownership and no shared database or publisher branch.

Resolve before implementation:

- Whether command success requires GitHub publication and what recovery-point guarantee users receive.
- Publication branch ownership, batching cadence, authentication, and treatment of reviewed external edits.
- Exact recovery-package contents, operation-history retention, backup policy, and restored-authority fencing.
- Dependency completion policy across code branches and integration targets.
- Byte-level source/revision compatibility and API versioning.
- Attachment limits, aggregate revision semantics, portable link layout, and large-binary policy.
- Multi-project storage layout, connection schemas and precedence, binding trust, and credential providers.
- API wire contract, service authentication, exposure model, packaging and background installation on the three required platforms, and service schema-upgrade coordination.
- Dashboard refresh transport, view-selection URLs, and whether to retain static HTML export as a secondary feature.
- REST resource schemas, import resolution and acceptance, asynchronous operation retention, and first-administrator bootstrap before any ledger exists.

Non-goals are direct SQLite client access, direct SQL maintenance tools, offline writes, writable replicated SQLite stores, automatic Git merges of agent code, hosted-database requirements, automatic out-of-band imports, and claiming high availability from backups alone.

## Beads comparison

Lee noted that the proposed service, shared storage, and dashboard resemble the Beads implementation reviewed earlier. That observation motivates a fresh build-versus-reuse comparison before implementation; it does not establish Beads' current capabilities.

Compare local and remote service operation, multi-project isolation, concurrency guarantees, claims, platform support, migration, recovery, rich research preservation, and reporting against this document. The earlier comparison was not recovered during this discussion, so no specific Beads capability or gap is asserted here. Reuse versus independent implementation remains open.

## SQLite references

- [Transaction isolation](https://www.sqlite.org/isolation.html).
- [WAL operation and restrictions](https://www.sqlite.org/wal.html). Select a maintained runtime containing relevant WAL fixes and verify its actual embedded version.
- [Online backup API](https://www.sqlite.org/backup.html).
- [Appropriate uses](https://www.sqlite.org/whentouse.html).
