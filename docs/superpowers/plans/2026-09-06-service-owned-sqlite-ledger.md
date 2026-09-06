# Service-owned SQLite ledger implementation plan

> **For agentic workers:** Use the `subagent-driven-development` or `executing-plans` skill when execution is authorized. Read this plan and its linked research document before accepting a task. Use OMP-native children inside OMP; do not launch external coding-agent CLIs.

**Goal:** Replace branch-local ledger authority with service-owned SQLite, accessed exclusively through a REST API by the CLI, dashboard, and maintenance clients.

**Architecture:** One service hosts explicitly selected ledgers. Private storage transactions enforce domain rules, revisions, claims, and operation identity. Portable exports and GitHub publication provide a separate recovery path, not another live writer.

**Tech stack:** Existing JavaScript ES modules, Node 24.20.0, `node:test`, YAML parsing for legacy import and portable representation, SQLite, REST, and OpenAPI. P00 selects the SQLite binding, HTTP implementation, authentication mechanism, and dashboard packaging against the supported runtime. Do not assume Node's bundled SQLite meets the project's warning and durability requirements.

**Spec:** [Approved architecture and research](../specs/2026-09-06-shared-sqlite-ledger-design.md).

**Tracking:** [Epic #211](../../../ledger/items/wb_01M1TZ8E5WHFGA76VNMFFK35J3.md).

**Authorization:** Planning is authorized. Production implementation, release, live migration, destructive operations, credential changes, and work in other repositories are not authorized by this document.

## Global constraints

- Service access is mandatory on macOS, Windows, and Linux, including a single-machine installation.
- Only private service storage code opens ledger databases or issues SQL. All ledger maintenance and historical reporting use the API. Installation and initial identity bootstrap are host operations, not database bypasses.
- Zero registered ledgers is valid. A registered ledger with missing storage is unavailable, never recreated implicitly.
- CLI and dashboard share API authority. Every supported API operation is available to noninteractive CLI automation.
- Preserve item identity, complete bodies, provenance, decisions, relations, declared extensions, readiness ordering, and epic accounting unless a separately accepted contract changes them.
- Preserve existing source-byte and revision guarantees, or explicitly version the affected contract before migration. No silent canonicalization of user research.
- Keep the current Markdown ledger authoritative until the replacement is complete and a cutover is explicitly approved. No dual writes or automatic fallback in the replacement.
- Keep `spec/adapter-reference.js` and `test/work-claim-reference.js` independent. Never import them into production or change them to make a new implementation pass.
- Use Node 24.20.0 and `TMPDIR=/tmp` for tests. Node 26 remains excluded. Validate the embedded SQLite version and maintained WAL fixes on each supported platform.
- No cross-ledger dependencies, offline mutation, raw SQL endpoint, generic server-file endpoint, hard deletion API, unaudited force-unlock, or automatic Git integration of agents' code.
- Each change includes its behavioral proof and relevant documentation. A separate documentation task does not excuse missing documentation in a feature change.

## Delivery structure

A change stands on its own when it builds and passes its gate on its declared accepted parent, demonstrates one coherent behavior, and contains its tests and documentation. It need not cherry-pick onto a pre-service release. It must not depend on an unmerged sibling, a mock service, a future repair commit, or a manually edited shared file.

Use a sequence of small changes on an unreleased integration branch. Publish no incomplete replacement package and migrate no live ledger between partial changes. Existing released tooling continues to operate independently until P16 performs the clean cutover. This is not a permanent compatibility layer inside the new CLI.

Each package below is a review boundary. Its checkbox steps are completed one at a time. If a package needs several behavioral slices, use one red-green-refactor cycle and one coherent commit per slice. Do not batch failing tests before implementation. The orchestrator can subdivide a package only if each resulting change retains an observable contract and its documentation.

## Grounded source map

These paths exist today. Proposed new paths are identified separately in each package.

| Existing code | Treatment |
|---|---|
| `bin/wowbagger.js`, `src/cli.js` | Preserve the process entrypoint and honest machine output. Replace ledger-file dispatch with API client dispatch at cutover. |
| `src/validate.js`, `src/ready.js` | Reuse `validateLedger`, `projectReadiness`, and `selectReady` semantics. Keep complete-ledger graph context before filtering. |
| `src/report.js`, `src/projection.js`, `src/workbench.js` | Reuse report models and bounded projections. Separate model construction from loading files and writing static HTML. |
| `src/mutation.js` | Reuse request and source-format semantics where applicable. Separate candidate construction from filesystem CAS and local number scanning. |
| `src/claim-operations.js` | Reuse claim transition and clock-floor semantics, subject to transactional review. |
| `src/ledger.js` | Retain parsing needed by service-side legacy import. Remove it from the normal client read path. |
| `src/claim-coordinator.js`, `src/claim-store.js`, `src/claim-publication.js` | Replace Git-common-directory fencing and reconciliation with transactional service authority. Do not wrap them behind HTTP and call that a database service. |
| `src/git-autocommit.js`, `src/git-reconciliation.js`, `src/git-worktrees.js`, `src/ledger-repair.js` | Retire live worktree coordination at cutover. Retain only code still needed by explicit import or publication, with a reviewed caller map. |
| `package.json`, `test/packaging.test.js`, `.github/workflows/ci.yml` | Extend actual package contents and the existing three-platform gate. Narrow the current wildcard package exports so service storage is not a supported client API. |
| `scripts/release-version-sites.json`, `scripts/cut-release.js` | Preserve exact version-site accounting. Use release tooling rather than editing release pins opportunistically. |

Source inspection found no existing SQLite or HTTP service implementation. Dependencies currently include `yaml`, with `ajv` as a development dependency. This is a new persistence and transport subsystem, not a small CLI flag.

## Contract and module ownership

Use one OpenAPI operation catalog, proposed at `schemas/service-api.json`. Assign stable operation IDs there. HTTP registration, CLI operation discovery, capability reporting, and contract coverage derive from it. Do not maintain four hand-written endpoint lists.

Proposed module boundaries:

- `src/service/server.js`: process lifecycle and composition. One integration owner edits route registration.
- `src/service/registry.js`: ledger identity and availability, including empty-service onboarding and durable creation intents.
- `src/service/storage.js`: sole connection opener and transaction admission boundary for ledger storage, migrations, and authority generation. Opening a registered ledger forbids create-if-absent; only an explicit staged creation or recovery operation can initialize new storage. Feature SQL can stay beside its service feature, but executes only inside this boundary and never opens its own connection.
- `src/service/<feature>.js`: validated domain operations and their HTTP handlers, grouped by behavior rather than layers of one-caller wrappers.
- `src/client/api.js`: authenticated HTTP transport, revision headers, streaming, operation polling, and honest errors. No SQL or domain decisions.
- `src/client/<feature>.js`: ergonomic CLI commands for a feature. Each feature owns its command module; the integration owner owns `src/cli.js` registration.
- `src/domain/`: only genuinely reusable domain code extracted from storage-coupled modules. Existing pure modules stay where they are unless moving them removes a real dependency.
- `assets/dashboard/`: browser presentation using the same API. No local ledger parsing or duplicate readiness engine.

Every writer enters storage admission: item and lifecycle operations, claims, configuration and views, attachments, import acceptance, recovery activation, and internal publication bookkeeping. Admission validates target identity and authority generation, authorization, operation identity, and the operation-specific revision and claim predicates before committing any change. Creation and administrative activation have explicit predicates rather than fictitious item revisions. Claim rules live in the shared admission path, not only in claim endpoints. Each new route adds a negative admission case to the catalog-driven contract suite.

Ledger mutation requests carry the authority generation observed when the operation was created. Idempotency identity includes ledger, principal, operation, generation, and key, with the request digest bound to the result. Validate the supplied generation before replay lookup or execution. A stale-generation request refuses even if recovery discarded its operation record; clients must not refresh its generation and silently retry it as new work. Service-level creation/import operations use an explicit service-scope equivalent.

P01 fixes these public testing seams before implementers start:

```javascript
// Proposed service lifecycle seam, finalized by P01.
startService({ dataDirectory, host, port, identityProvider })
// Promise<{ origin: string, close: () => Promise<void> }>

// Proposed client seam. operationId resolves only through the approved catalog.
invokeApiOperation({ connection, operationId, parameters, body, expectedGeneration, idempotencyKey })
// Promise<{ status: number, headers: Headers, body: unknown }>
```

Streaming uploads and downloads use the contract's binary representations rather than buffering arbitrary bytes in the JSON helper. P01 specifies that transport alongside request schemas. These signatures describe planned boundaries, not existing exports or permission to create stub implementations.

## Orchestrator, implementers, and reviewers

### Roles and model routing

| Role | Model class | Authority |
|---|---|---|
| Repository orchestrator | Healthy Fable- or GPT-6-class model | Own product interpretation, contracts, dependency graph, assignments, shared integration, final acceptance, and ledger lifecycle. |
| Implementer | Cheaper healthy coding model suitable for the bounded task | Own the assigned files, one behavioral slice at a time, and its tests and documentation. Propose contract changes to the orchestrator rather than making them privately. |
| Contract reviewer | Independent strong reasoning model | Check requirements, API and CLI coverage, domain invariants, compatibility, and documentation. |
| Correctness reviewer | Independent strong coding model | Check transactions, concurrency, failure recovery, security boundaries, and whether the proof could miss a plausible bug. |
| Domain specialist | Strong reviewer when the package requires it | Review authorization and uploads, claims and clocks, publication and recovery, or dashboard behavior. |

Model names describe preferences, not a claim of availability. Resolve actual IDs through configured provider health and fallback policy before dispatch. Never force an exhausted provider through `inherit` or a model-family alias. In OMP, use native `task` children, whose runtime supplies full-access mode. If role-specific routing cannot be enforced, report that fact before launching rather than claiming that a cheap implementer or a Fable reviewer was selected.

Use a strong implementer for transaction, restore-fencing, or security work when a cheaper worker cannot resolve a concrete counterexample. Keep cheap models for bounded implementation, not unresolved architecture. Track first-pass acceptance and review rework per task, not lines of code or number of workers.

### Worker brief

Every dispatched task includes:

1. Accepted base commit, assigned worktree, package ID, and exact owned paths.
2. Relevant research requirements and accepted OpenAPI operation IDs and schemas.
3. Required behavior, one first failing test at an existing or explicitly accepted seam, and negative cases.
4. Documentation paths and the expected change to each.
5. Allowed validation commands and private resource allocation.
6. Explicit stop point at reviewed candidate readiness. Workers do not push, merge, publish a package, activate recovery, or alter another worktree.
7. A report containing changed paths, red failure, green evidence, actual smoke results, assumptions, and unresolved findings.

Copy these machine safety rules verbatim into any worker brief that could encounter them:

> Agents MUST NOT perform a destructive operation without express approval given by Lee directly in the current conversation. Destructive operations include deleting or trashing files, removing worktrees or branches, force-pushing or resetting state, terminating processes or sessions, dropping data or infrastructure, and overwriting state that cannot be recovered losslessly.

> Agents MUST NOT create, update, change, delete, revoke, roll over, or rotate any credential in staging or production without express approval given by Lee directly. Credentials include API keys, tokens, passwords, certificates, signing keys, service accounts, webhook secrets, and connection strings. The rule covers every surface: config files, env vars, secret managers, cloud consoles, CLIs, APIs, and dashboards.

A spawner cannot relay approval. Workers use disposable synthetic ledgers, test principals, and isolated publication fixtures. Resource teardown remains subject to the session's explicit authority rules.

### Parallelism and integration

Parallelize only packages whose prerequisites are accepted and whose owned files and runtime resources are disjoint. Default to two implementers, increase to four after contract stability is demonstrated, and never exceed the runtime's eight-child cap including reviewers.

- Give each worker a separate worktree only when that topology is authorized. Without isolated worktrees, keep concurrent work read-only and serialize edits.
- Give each test run its own service data directory, OS-assigned loopback port, principals, and Git remote fixture. No shared test database or publisher branch.
- Schema migrations have one registry owner. Reserve migration order before concurrent implementation. Workers submit feature migrations; the registry owner integrates them before validation.
- Shared entrypoints, OpenAPI edits, normative documentation, package metadata, and CI registration have one integration owner. A feature's documentation assignment means responsibility for content, not concurrent write ownership of shared files. Workers supply proposed shared-file changes; the owner applies them serially into that same feature's candidate before review and validation. No untracked follow-up is permitted.
- Concurrent authoring batches skip builds, formatters, linters, and tests while shared edits are in flight. The orchestrator schedules exclusive validation slots for the red and green steps. Truly isolated resources may be validated only when the runtime's delegation policy permits it.
- OMP children coordinate through `hub`. Separate machine sessions use Herdr. Wowbagger claims coordinate assigned items, not the entire machine or all work dispatch.
- Before the replacement ships, obey the installed ledger protocol: mutate, commit exact returned paths, run targeted `claim-verify`, then permit another mutation. Future service semantics do not authorize bypassing today's ledger.

### Review and acceptance gate for every change

1. The implementer supplies a frozen candidate commit and evidence. Reviewers receive the full relevant requirements, not only the author's summary.
2. Contract and correctness reviewers inspect independently in parallel. Neither is the author, and they do not copy each other's conclusions before reporting.
3. The orchestrator adjudicates each finding against code and behavior. Fix correctness, data-loss, authorization, and contract gaps before acceptance. Record rejected findings with evidence.
4. The author repairs accepted findings. Re-run affected evidence and obtain review of changed portions. A newer commit invalidates approvals for code it changed.
5. The orchestrator integrates only the reviewed commit onto the declared accepted base and runs the combined gate. Unrelated sibling work cannot supply missing behavior.
6. Record the exact accepted commit, scenario outputs, relevant test results, documentation changes, reviewer dispositions, and capability changes on the assigned item.

No self-approval, silent fallback, weakened test, or 'compiles' substitute for an exercised feature. If a code PR is created, run the repository's required `/code-review` before marking it ready. Planning-only documents do not claim code review or implementation proof.

## Decision gate and implementation packages

### P00: Settle implementation-critical decisions

**Owner:** Orchestrator, with independent architecture and security reviewers. **Depends on:** This approved direction.

**Files:** Update the research document; create a numbered ADR under `docs/adr/` using the next available number when execution begins. No production code.

- [ ] Compare a small service with in-process SQLite ownership against a service with a dedicated database worker. Measure concurrent request handling, shutdown, WAL recovery, and dependency packaging on Node 24.20.0. Prefer the smaller design unless the worker removes measured blocking or ownership risk.
- [ ] Select the actual SQLite binding and HTTP implementation using current primary documentation and a bounded executable probe. Reject unsupported runtime warnings under the pending-deprecation gate. Record the embedded SQLite version on all three platforms.
- [ ] Decide authentication and first-admin bootstrap, browser session and CSRF protections, remote TLS, per-ledger permissions, and server-owned credential references. Bootstrap cannot depend on an existing ledger.
- [ ] Decide registry storage and crash-safe ledger activation, attachment limits and revision scope, source-byte preservation, import conflict decisions, operation retention, and backup retention.
- [ ] Decide the GitHub publication acknowledgment policy and recovery-point guarantee with Lee. Recommendation is explicit saved versus published results with an optional wait for publication; that recommendation is not an approved data-loss policy.
- [ ] Specify recovery authority replacement. A generation stored only in a copied database cannot fence a remote old server. Require proved old-writer isolation and publication protection before activation, or fail closed until an operator establishes that isolation.
- [ ] Preserve current dependency completion semantics unless Lee separately chooses integration-aware readiness. Record branch and commit evidence without inventing a new lifecycle status.
- [ ] Revisit build versus reuse of Beads using accessible primary evidence. Do not assume capabilities or inspect another local repository without Lee's explicit permission. If reuse changes the chosen module ownership, revise this plan before dispatch.
- [ ] Record supported OS versions and foreground versus managed installation scope. Managed background installation is optional in the approved requirements; the three OS platforms are not.

**Acceptance:** Every item has a concrete decision, evidence, and an owner-approved contract. Lee decides business guarantees and any changed scope. Technical defaults can be chosen by the orchestrator. No storage, authentication, or publication worker is dispatched on an unstated assumption.

### P01: Freeze executable API and portability contracts

**Owner:** Contract implementer; strong contract reviewer. **Depends on:** P00.

**New files:** `schemas/service-api.json`, `schemas/ledger-export.schema.json`, `docs/rest-api-contract.md`, `docs/connection-configuration.md`, `docs/export-format.md`, `test/service-contract.test.js`.

- [ ] Specify every approved resource family, including explicit parent migration, snooze, extension declaration, historical snapshot, claim release, operation lookup, and recovery activation operations.
- [ ] Define operation IDs, schemas, representations, permission scopes, size limits, stable errors, pagination, snapshot witnesses, revision guards, and the new response-domain version. Encode the generation-bound idempotency contract above, including service-scope operations, retention loss, and stale-request refusal before replay lookup. Keep HTTP, CLI, domain, and export version numbers distinct.
- [ ] Define project binding, trusted endpoint profiles, credential references, precedence, and expected ledger identity. Reject an untrusted binding that redirects machine credentials.
- [ ] Define the source-preserving export inventory, hashes, authority generation, change position, history coverage, and portable link resolution. Exclude credentials and reusable active authority.
- [ ] Write one contract validation case at a time. Start with a mutation example missing its revision guard, prove rejection, then add the minimal schema. Include valid examples and request-digest conflict semantics.
- [ ] Define generated API-to-CLI operation coverage and the two public runtime seams above. Package these contracts with the documentation when the service package becomes available.

**Acceptance:** Schemas and examples validate. Every required operation has a permission and CLI mapping. This is an independently reviewable contract change, not a stub server advertising nonexistent routes.

### P02: Isolate existing domain behavior from filesystem publication

**Owner:** Bounded domain implementer. **Depends on:** P00. Can run beside P01.

**Existing files:** `src/mutation.js`, `src/validate.js`, `src/ready.js`, `src/report.js`, `src/claim-operations.js`, and affected callers found through symbol references.
**New files only where extraction requires them:** `src/domain/item-candidate.js`, `test/domain-storage-independence.test.js`.
**Docs:** Explain the retained domain boundary in `docs/mutation-contract.md` without claiming the service has shipped.

- [ ] Establish characterization at current public mutation and projection seams before moving code. Start with a body patch retaining unrelated frontmatter and source bytes.
- [ ] Extract candidate construction and pure validation from file locking and atomic publication. Migrate every current caller in the same change; do not leave a deprecated wrapper.
- [ ] Repeat for the full-ledger readiness and report boundary only where storage dependencies require it. Preserve priority/date/ID ordering and direct-child epic rollups.
- [ ] Run existing behavioral and oracle suites. Show that the current CLI still performs the characterized mutation correctly.

**Acceptance:** Current behavior remains intact, pure domain functions can accept an in-memory snapshot, and no oracle or fixture has been altered to accommodate a regression.

### P03: Run an authenticated empty service and create its first ledger

**Owner:** Service implementer with security review. **Depends on:** P01, P02.

**New files:** `src/service/server.js`, `src/service/registry.js`, `src/service/storage.js`, `src/service/identity.js`, `src/client/api.js`, `src/client/service.js`, `test/service-onboarding.test.js`.
**Existing integration:** `src/cli.js`, `package.json`, `.github/workflows/ci.yml`.
**Docs:** Create `docs/service-operations.md`; update the REST and connection guides.

- [ ] RED: start with an empty registry, authenticate, list zero ledgers, create one ledger through the API, and read its stable identity through a second client. Use a real temporary database and real HTTP connection.
- [ ] GREEN: implement the service lifecycle, sole storage opener and shared transaction admission, identity boundary, registry, and OpenAPI-backed CLI transport. Registered ledger opens must not create missing files. Advertise only implemented operations.
- [ ] Repeat for unauthorized creation, two concurrent creation requests with one idempotency key, restart after interrupted registration, and a registered ledger whose database is absent. The latter must remain registered and refuse ledger operations.
- [ ] Exercise health, readiness, capabilities, and caller identity from the actual CLI. Prove service storage cannot be opened through package public exports or a client option.
- [ ] Document foreground startup, first identity, empty-service onboarding, missing-storage diagnosis, and API-only maintenance.

**Acceptance:** A useful running service, not a listening socket with placeholder endpoints. Registry and database activation converge after interruption. A fresh empty service and a damaged ledger have different observable states.

### P04: Create and inspect items with transactional revisions and replay

**Owner:** Item implementer, correctness reviewer. **Depends on:** P03.

**New files:** `src/service/items.js`, `src/client/items.js`, `test/service-items.test.js`.
**Existing integration:** private storage schema, route and command registration through their single owners.
**Docs:** REST item examples, mutation and host contracts, CLI item help.

- [ ] RED: concurrent API clients create items in one ledger and receive distinct immutable numbers. Include a second ledger where the same human number is valid independently.
- [ ] GREEN: persist complete source, metadata, revisions, audit event, and idempotent result in the same short transaction. Allocate numbers transactionally, not by client-side maximum.
- [ ] Repeat for stale body replacement, append preservation, source-size refusal, complete detail retrieval, authorized pagination, and forbidden core-owned fields.
- [ ] Drop the successful response and repeat the identical request with the same key and observed authority generation. Require one item and the recorded result. A different body using that key must refuse. Repeat one key independently in two ledgers and under two principals; it must not replay another scope's result.
- [ ] Exercise CLI create, list, number lookup, inspect, and patch against the running service; never instantiate a database in the client.

**Acceptance:** Real concurrent HTTP and CLI proof, exact body preservation, and atomic replay semantics across restart. Storage writes and operation records cannot commit separately.

### P05: Preserve lifecycle, parent, snooze, and configuration semantics

**Owner:** Domain implementer. **Depends on:** P04.

**New files:** `src/service/lifecycle.js`, `src/service/configuration.js`, `src/client/lifecycle.js`, `test/service-lifecycle.test.js`.
**Docs:** `docs/mutation-contract.md`, `docs/rest-api-contract.md`, command help.

- [ ] RED: attempt to complete an epic with a nonterminal direct child and require refusal with unchanged item revision.
- [ ] GREEN: expose validated transitions, decisions, parent migration, snooze, relation edits, and declared extension updates through the accepted schemas.
- [ ] Repeat for cycles, stale expected parent, terminal-date invariants, anchored legacy extension content, and invalid declaration changes affecting existing items.
- [ ] Exercise each dedicated operation using CLI automation and inspect resulting history through the API.

**Acceptance:** Every current supported lifecycle operation has a service and CLI equivalent. No broad patch route can bypass dedicated mutations or modify create-once identity.

### P06: Enforce transactional claims on every mutation path

**Owner:** Claims implementer; mandatory strong correctness review. **Depends on:** P05.

**New files:** `src/service/claims.js`, `src/client/claims.js`, `test/service-claims.test.js`.
**Reuse:** `src/claim-operations.js`, accepted request and digest semantics from `src/claim-publication.js` without Git reconciliation.
**Docs:** `docs/work-claim-contract.md`, API claim examples, capability definitions.

- [ ] RED: race two claim acquisitions from the same observed state. Exactly one obtains current ownership.
- [ ] GREEN: persist owner, epoch, expiry, clock floor, revision checks, and claimed publication result inside the service transaction boundary.
- [ ] Repeat for expiry, renewal after restart, clock rollback, stale epoch, lost-response replay, and release of superseded ownership.
- [ ] Attempt each alternate mutation route against a claimed item, including attachments and configuration effects as those packages land. Require the accepted fence policy, never accidental bypass.
- [ ] Demonstrate the CLI claim lifecycle. Advertise strict ledger-write fencing only after route-wide tests prove it; never claim exclusive source-code or external-side-effect control.

**Acceptance:** New claims fence ledger mutations independently of worktrees, clones, and Git commits. A capability report states exactly that scope.

### P07: Preserve and serve owned attachments

**Owner:** Attachment implementer with upload security review. **Depends on:** P06.

**New files:** `src/service/attachments.js`, `src/client/attachments.js`, `test/service-attachments.test.js`.
**Docs:** API attachment contract and attachment preservation sections in `docs/export-format.md`.

- [ ] RED: upload an attachment, retrieve identical bytes, then attempt a stale replacement and require the first content to survive.
- [ ] GREEN: implement bounded streaming, ownership, media metadata, hashes, and the P00 revision model. Enforce claims and ledger permissions.
- [ ] Repeat for traversal, symlink escape in materialization, unauthorized artifact retrieval, excessive content, unsafe rendering types, and interrupted uploads that must not expose a partial attachment.
- [ ] Exercise CLI upload, download, and revision-checked replacement; document materialized files as copies rather than authority.

**Acceptance:** Research survives byte-for-byte without arbitrary filesystem access or client-side storage bypass.

### P08: Import a legacy ledger through a staged operation

**Owner:** Import implementer, security and data-preservation reviewers. **Depends on:** P07.

**New files:** `src/service/imports.js`, `src/service/operations.js`, `src/client/imports.js`, `src/client/operations.js`, `test/service-imports.test.js`.
**Reuse:** `src/ledger.js` parsing, schema migration semantics, current lossless inspection format.
**Docs:** Create `docs/legacy-import-guide.md`; cross-link `docs/schema-2-migration.md` rather than rewriting its historical contract.

- [ ] RED: upload a synthetic legacy ledger containing complete bodies, decisions, extensions, and an owned linked document. Preview it without exposing a writable ledger; accept the exact staged revision and recover the same content through the API.
- [ ] GREEN: implement bounded package intake, immutable staging, durable operation state, conflict inspection and acceptance, and crash-safe activation into a new ledger.
- [ ] Repeat for duplicate human handles, conflicting same-ID source, missing and absolute references, mixed source versions, archive bombs, path traversal, and changed staged input. Require explicit resolutions, not silent renumbering or omission.
- [ ] Inventory selected Git refs and branch-only items in the CLI packaging workflow. Do not assume the checked-out branch contains all work, or copy arbitrary linked secrets.
- [ ] Restart during validation and during acceptance. Operation lookup must report a recoverable state and never create a second ledger on replay.

**Acceptance:** One complete end-to-end import from CLI packaging to service inspection. Original files remain untouched. New claims are required; old active authority is not imported.

### P09: Export a complete portable snapshot

**Owner:** Export implementer. **Depends on:** P08.

**New files:** `src/service/exports.js`, `src/client/exports.js`, `test/service-exports.test.js`.
**Docs:** Complete `docs/export-format.md` and CLI export examples.

- [ ] RED: export while another client mutates an item. Require a consistent package at one declared change position with matching inventory hashes.
- [ ] GREEN: implement snapshot capture, durable export operation state, download, and canonical portable layout, using P01's format rather than inventing an endpoint-specific shape.
- [ ] Repeat for complete body and attachment fidelity, history coverage, credentials exclusion, unauthorized downloads, and interruption during artifact creation.
- [ ] Validate package schema and inventory hashes inside export generation against P01's contract, then download and inspect it through the CLI without a GitHub push. P09 does not depend on the maintenance validation resource introduced by P11.

**Acceptance:** An export is self-describing and recoverable under its declared contract. A download does not advance publication state or modify a Git remote.

### P10: Publish exports without losing or regressing remote history

**Owner:** Publication implementer; mandatory strong failure-recovery review. **Depends on:** P09.

**New files:** `src/service/publications.js`, `src/client/publications.js`, `test/service-publications.test.js`.
**Docs:** Create `docs/github-publication-and-recovery.md`; document saved versus published acknowledgments chosen in P00.

- [ ] RED: push to an isolated Git remote, lose the acknowledgment, restart, and require reconciliation to the same published commit rather than a duplicate or regressed export.
- [ ] GREEN: persist publication intents, selected snapshot, expected remote ancestry, and confirmed remote commit. Serialize publishers with the accepted authority mechanism across worker replacement.
- [ ] Repeat for remote outage, conflicting remote edits, two publishers, stale restored authority, and mutations committed after the selected snapshot.
- [ ] Exercise publication request, wait, lag, and failure inspection through the CLI. Use a disposable remote fixture, not production GitHub, for local proof.

**Acceptance:** Failures preserve saved data and visible pending work. Publication never silently force-pushes divergent history. A real GitHub smoke requires separately authorized repository and credentials.

### P11: Back up, recover, and query historical snapshots through the API

**Owner:** Recovery implementer; strong storage and security reviewers. **Depends on:** P10, P12.

**New files:** `src/service/recoveries.js`, `src/service/backups.js`, `src/service/history.js`, `src/client/recoveries.js`, `test/service-recovery.test.js`.
**Docs:** Recovery guide, operations runbook, snapshot and backup guarantees.

- [ ] RED: export a ledger, commit a later unpublished change, and stage recovery from the older package in an isolated service. Require explicit reporting of the recovered position and the unavailable later state.
- [ ] GREEN: implement validation and backup resources, staged package and backup restore, read-only historical projections, explicit activation, and accepted authority fencing.
- [ ] Repeat for corrupted hashes, wrong ledger identity, stale operation replay, active old leases, and an old server that remains reachable. Activation must refuse until the P00 isolation proof is satisfied. Every activated restore, including a copied database backup, establishes a fresh authority generation.
- [ ] Compare verified history as well as identity, generation, and publication position. Test two divergent packages with the same numeric change position. Accept only proven matching or ancestral history, or an explicitly reviewed replacement; a matching counter is not ancestry proof.
- [ ] Retry an old-generation mutation after restore both with retained operation history and with no retained operation row. Both refuse before execution. A client must not rewrite that old operation with the new generation automatically.
- [ ] Prove a database-aware backup includes committed WAL content. Exercise schema upgrade rehearsal, backup, writer exclusion, failure before activation, and restart recovery through maintenance API operations.
- [ ] Query a historical report through the API without the original live database. Exercise all maintenance operations with the CLI. No tool opens SQLite outside private service storage.

**Acceptance:** Restoration is a demonstrated protocol, not an import alias. Historical reads do not create a competing live writer. Data-loss limits are stated exactly.

### P12: Serve named views, readiness, and audit history

**Owner:** Reporting implementer. **Depends on:** P05.

**New files:** `src/service/views.js`, `src/service/events.js`, `src/client/views.js`, `test/service-views.test.js`.
**Reuse:** `src/ready.js`, `src/report.js`, `src/projection.js`, `src/workbench.js`.
**Docs:** API projection contract, create `docs/dashboard-guide.md`, clarify ready versus report recommendation semantics.

- [ ] RED: filter a view so its blocker is hidden, and require the visible dependent to remain blocked.
- [ ] GREEN: project from complete consistent ledger state, then apply named-view filters. Store shared definitions in ledger configuration and expose their guarded management APIs.
- [ ] Repeat for deterministic ready ordering, direct-child epic progress, empty views, snapshot witnesses, effective dates, pagination, and another principal's inaccessible ledger.
- [ ] Exercise ready, report projections, view selection, and audit history using CLI JSON. Keep source-body detail retrieval lossless even where collection projections are bounded.

**Acceptance:** CLI and future dashboard consume the same results. Views never become an authorization boundary or an alternate queue.

### P13: Deliver the live dashboard

**Owner:** UI implementer; independent browser and security reviewers. **Depends on:** P08, P10, P12.

**New files:** `assets/dashboard/index.html`, `assets/dashboard/app.js`, `assets/dashboard/styles.css`, `src/service/dashboard.js`.
**Reuse:** Existing report presentation and vendored graph assets where they fit; do not duplicate domain projections.
**Docs:** `docs/dashboard-guide.md`, including dashboard startup examples. P13 does not edit the operations runbook owned by concurrent P11.

- [ ] Specify the empty-service, unavailable-ledger, loading, denied, and populated states before implementing. Use `/design` for visual exploration if Lee chooses it.
- [ ] RED: cover a genuine behavioral edge, such as a bookmarked unauthorized ledger failing without exposing cached prior-ledger content.
- [ ] GREEN: serve the dashboard from the service, select an authorized ledger and named view, inspect complete bodies and attachments, and display publication status. Use polling unless P00 selected streaming.
- [ ] Drive the real browser through empty onboarding, ledger switching, view switching, refresh after a CLI mutation, network failure, keyboard navigation, and safe Markdown rendering. Record actual screenshots and interaction evidence.
- [ ] Verify no dashboard feature requires a private backend operation unavailable to the CLI. Preserve graph fallback behavior where the graph is retained.

**Acceptance:** Humans open a live dashboard and get current reports without generating HTML. A fixture screenshot alone is not acceptance.

### P14: Ship runnable service packaging on every required platform

**Owner:** Packaging integrator with bounded OS implementers. **Depends on:** P11, P13. Earlier features include their own newly referenced files in the package; P14 certifies the complete artifact after those files exist.

**Existing files:** `package.json`, `.github/workflows/ci.yml`, `test/packaging.test.js`.
**Proposed OS files if managed startup is selected:** `scripts/service/macos.js`, `scripts/service/windows.js`, `scripts/service/linux.js`.
**Docs:** Platform sections in `docs/service-operations.md`, README install prerequisites.

- [ ] RED: install the packed artifact in a clean private directory and require it to start an empty service without source checkout files.
- [ ] GREEN: include service modules, assets, schemas, and referenced docs in the package allowlist. Preserve the supported runtime and narrow public exports deliberately.
- [ ] Assign macOS, Windows, and Linux checks independently after packaging and lifecycle contracts are accepted. Each OS change owns its platform file and evidence; the integrator owns shared CI and package metadata.
- [ ] Verify data-path persistence across upgrades, filesystem or ACL permissions, foreground startup, shutdown, database locking, credential access, and restart. Verify managed installation only if included by P00.
- [ ] Run native CI for all three OSes and record the actual Node and SQLite versions. Linux success does not certify Windows or macOS. Do not create production identities or install a persistent system service without approval.

**Acceptance:** The installable artifact works on each supported platform with its documented operating procedure. Background manager integration is neither silently promised nor silently omitted from the accepted scope.

### P15: Complete CLI and host-adapter parity

**Owner:** Client implementer with contract reviewer. **Depends on:** P06, P11, P13, P14.

**Existing files:** `src/cli.js`, `src/launch.js`, relevant files under `adapters/`, adapter entrypoints discovered by symbol references.
**New files:** `test/service-cli-parity.test.js` and a service adapter conformance runner under `spec/`, separate from existing independent oracles.
**Docs:** `docs/host-contract.md`, `docs/adapter-contract.md`, `docs/rest-api-contract.md`.

- [ ] RED: enumerate supported OpenAPI operations and require each to have a CLI route with request validation and honest machine output. Pair catalog checks with real execution, not a source-text assertion alone.
- [ ] GREEN: complete upload, download, operation wait, error mapping, identity selection, compatibility negotiation, and noninteractive usage. Retain ergonomic existing commands where the domain operation survives.
- [ ] Repeat for response loss, denied operations, unknown operation IDs, incompatible service version, wrong ledger binding, and broken upload delivery. Do not map an HTTP timeout to 'unchanged'.
- [ ] Prove passive adapter discovery remains passive. A process-hosted CLI can remain one-shot even though it calls a service; do not turn every adapter into a daemon manager.
- [ ] Keep existing oracles unchanged. Add independently reviewed service-contract vectors for the new version. Retain old vectors as historical contract evidence without shipping a live legacy writer to satisfy them.

**Acceptance:** Every supported operation is automatable, capability negotiation is truthful, and adapter approval and outcome boundaries survive the transport change.

### P16: Cut over code, public documentation, and shipped skills atomically

**Owner:** Orchestrator/integrator, independent contract and correctness reviewers. **Depends on:** P15.

**Existing files:** `src/cli.js`, obsolete live Git-coordination modules named in the source map, `README.md`, `CHANGELOG.md`, `CONTEXT.md`, `skills/wowbagger/SKILL.md`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `scripts/release-version-sites.json`, package and host-contract files.

- [ ] Build a reference-complete caller inventory. Remove obsolete file-backed CLI dispatch, Git commit-per-mutation options, claim reconciliation commands, and public storage exports in the same change that makes the service path the product default.
- [ ] Preserve legacy parsing only in service import and needed portable export code. Do not retain a compatibility shim, alternate write mode, or client-side SQL path.
- [ ] Update the shipped skill and quickstart to describe actual released capabilities, API-based maintenance, current claim semantics, publication freshness, and error handling. Revise glossary terms that currently define ledger and core by their Markdown implementation.
- [ ] Keep historical ADRs and old design records historical. Add explicit supersession links rather than rewriting evidence. Update active normative contracts and generated-source inputs together.
- [ ] Review prose-pinning tests. Do not re-pin incidental wording to the new prose. Preserve observable domain and safety coverage at real seams, and retire obsolete-contract assertions only as part of the explicit versioned cutover review.
- [ ] Update version-site accounting through its supported release process. Run package and adapter conformance from the installable artifact, then independent code review.

**Acceptance:** One supported runtime access path, no stale active instructions requiring code-branch ledger commits, no missing package docs, and no hidden dependency on a sibling branch. Code deletion requires Lee's explicit approval before this package executes.

### P17: Run recovery drills and approve release and migration separately

**Owner:** Orchestrator with final independent review. **Depends on:** P16 and complete three-platform P14 evidence.

**Docs:** Finalize operations, import, publication/recovery, dashboard, release notes, and research acceptance evidence.

- [ ] Execute the integrated scenario against synthetic data: empty service, import, multi-client mutation, claims, attachment update, dashboard refresh, export, publication, backup, restart, and recovery with stale-request refusal.
- [ ] Run a second isolated clone/client against the same service. Prove no Git integration is needed for ledger visibility or unique numbers.
- [ ] Execute all 19 research acceptance criteria and record their actual results. Refuse release for missing OS, data preservation, authorization, or recovery evidence.
- [ ] Prepare a read-only migration rehearsal and an explicit target-by-target plan for Lee. Include quiesced old writers, preservation of branch-only content, snapshot verification, and rollback limits after new writes.
- [ ] Request separate authorization for package publication, any real GitHub mutation, credential changes, service activation, or live ledger cutover. Planning or test approval does not supply it.

**Acceptance:** A verified release candidate and reviewable migration procedure. A release candidate is not a deployed service, and an approved design is not migration approval.

## Dependency schedule

The schedule is a dependency graph, not a promise to run every listed task at once.

| Package | Required accepted predecessors | Independent work available |
|---|---|---|
| P00 | None | Decision probes only, with separate resources |
| P01 | P00 | P02 |
| P02 | P00 | P01 |
| P03 | P01, P02 | No ungrounded feature workers |
| P04 | P03 | Platform probe preparation only |
| P05 | P04 | No overlapping mutation authoring |
| P06 | P05 | P12 |
| P07 | P06 | P12 |
| P08 | P07 | P12 |
| P09 | P08 | P12 |
| P10 | P09 | P12 |
| P11 | P10, P12 | P13 |
| P12 | P05 | P06 through P10, within file ownership |
| P13 | P08, P10, P12 | P11 |
| P14 | P11, P13 | Separate native platform checks |
| P15 | P06, P11, P13, P14 | Independent reviews |
| P16 | P15 | Independent reviews |
| P17 | P16 | Independent OS verification and reviews |

Critical shared boundaries are serialized: contracts, transaction admission, schema registry, route/CLI registration, and final cutover. Import, export, and recovery are ordered because they share a portable format and durable operations. Sending them to three workers before those contracts exist would create rework, not useful parallelism.

## Verification commands and evidence

The current repository has no application build or lint script. Do not invent one. `npm run check` runs tests and whitespace checks. Run the following existing gates under Node 24.20.0 when production changes begin:

```sh
TMPDIR=/tmp /opt/homebrew/opt/node@24/bin/node --test test/*.test.js
TMPDIR=/tmp /opt/homebrew/opt/node@24/bin/node --pending-deprecation --throw-deprecation --test test/*.test.js
TMPDIR=/tmp /opt/homebrew/opt/node@24/bin/node spec/run-adapter-implementation.js
wowbagger validate --ledger ledger --json
```

The last command validates this project's current work-tracking ledger using the verified installed core during development. After an explicitly approved project-ledger migration, use the new service validation command. Do not assume the new CLI still accepts `--ledger ledger` as a directory.

On Windows and Linux use their verified Node 24.20.0 executable, not the macOS path. P03 extends CI for service tests; P14 certifies native platform behavior. During each red-green-refactor cycle, run the named package test with the same runtime, then the relevant existing suite. For example, after P04 creates its test file:

```sh
TMPDIR=/tmp /opt/homebrew/opt/node@24/bin/node --test test/service-items.test.js
```

Existing adapter conformance remains a gate while its contract is active. P15 adds service-version conformance and P16 reviews the contract transition; do not rewrite an oracle to match new output. Packed-install proof and actual CLI/browser interactions supplement tests. Bounded fault injection uses synthetic resources, fixed wall-clock deadlines, and supervised teardown with prior required approval. Never kill an unrelated process to simulate a crash.

## Documentation ownership and cutover inventory

| Documentation | Feature owner | Required result |
|---|---|---|
| Research and this plan | Orchestrator | Approved requirements remain distinct from implementation status and unresolved business guarantees. |
| `docs/rest-api-contract.md`, `schemas/service-api.json` | P01, then each feature | Every implemented operation has schemas, examples, errors, permissions, concurrency and CLI mapping. |
| `docs/connection-configuration.md` | P01, P03 | Trusted binding, profiles, credential references, precedence, and wrong-ledger refusal. |
| `docs/mutation-contract.md`, `docs/work-claim-contract.md` | P02, P04-P06, P16 | Retain domain invariants; clearly version the replacement transaction and claim contracts. |
| `docs/legacy-import-guide.md`, `docs/schema-2-migration.md` | P08 | Safe upload, preview, conflict resolution, quiescence, and preserved historical schema guidance. |
| `docs/export-format.md`, `docs/github-publication-and-recovery.md` | P09-P11 | Complete inventory, hashes, acknowledged freshness, backup versus export, and tested recovery limits. |
| `docs/dashboard-guide.md` | P12, P13 | Empty onboarding, ledger/view selection, live refresh, complete research, and unavailable-state behavior. |
| `docs/service-operations.md` | P03, P11, P14 | Three-platform installation, health, identities, persistent storage, upgrades, backup, restore, and failure diagnosis. |
| `docs/host-contract.md`, `docs/adapter-contract.md` | P15, P16 | One-shot clients over REST, passive discovery, version negotiation, and honest uncertain outcomes. |
| `README.md`, `CHANGELOG.md`, `CONTEXT.md`, shipped skill and plugin metadata | P16 | New authority model and release instructions only when implementation exists. |
| `package.json`, version-site manifest, package tests | P14, P16 | Ship every referenced runtime guide/schema/asset and keep release metadata consistent. |

Do not edit `.agents/skills/` generated mirrors directly. If a shipped skill changes, run its independent skill and plugin review before release. Documentation examples must be exercised against the packed artifact rather than copied from a proposed route table.

## Research acceptance coverage

| Research criterion | Implementation packages |
|---|---|
| 1: concurrent clients and unique handles | P03, P04, P17 |
| 2: equivalent local and remote API semantics | P01, P03, P15, P17 |
| 3: revisions and claim fences | P04, P06, P07, P11 |
| 4: lost-response replay | P04, P08-P11, P15 |
| 5: identity, availability, and compatibility refusal | P03, P11, P15 |
| 6: consistent publication | P09, P10 |
| 7: publication interruption and freshness | P10, P11 |
| 8: migration rehearsal and preserved content | P08, P17 |
| 9: restoration and stale-authority refusal | P00, P11, P17 |
| 10: service-backed live and historical reports | P11, P12 |
| 11: rich bodies and owned attachments | P04, P07-P09, P11 |
| 12: three-platform operations | P03, P11, P14 |
| 13: documentation and skill cutover | Every feature, P16 |
| 14: multi-ledger isolation and credential safety | P01, P03, P07-P12, P15 |
| 15: dashboard and equivalent projections | P12, P13, P15 |
| 16: no direct SQLite fallback | P03, P15, P16 |
| 17: empty service versus missing database | P03, P08, P13 |
| 18: safe import and separate export | P08, P09 |
| 19: complete REST and CLI contract | P01, every API feature, P15 |

The plan is complete as a delivery design. P00 is an explicit prerequisite to implementation because acknowledgment policy, bootstrap, storage binding, recovery fencing, and packaging details affect correctness. Completing this planning task does not mean those decisions or any production feature have already been implemented.
