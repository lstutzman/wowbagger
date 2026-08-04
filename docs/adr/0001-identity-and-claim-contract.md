# ADR 0001: Identity and future claim contract

Status: accepted for standalone v0

## Context

Wowbagger must work in a local repository, a shared Git repository, and a
harness that cannot push a shared branch. Sequential numeric IDs allocated by a
push race require a particular remote and branch policy. They are not a
portable identity mechanism.

Creation, a work claim, and a lifecycle transition are different operations.
Treating them as one operation hides the guarantee a backend actually has.

## Decision

Wowbagger version 1 uses immutable collision-resistant IDs:

    wb_<ULID>

The full identity rule, UTC timestamp-date check, 80-bit entropy expectation,
and collision retry requirement live in SPEC.md. An ID permits independent
local creation without a remote round trip. It is not a global sequence, lock,
or authoritative clock. Merge-time validation still detects duplicate IDs;
collision-resistant does not mean impossible.

Sequential numbers, filenames, and display positions are optional consumer
views. They MUST NOT be required to create an item or to determine identity.

## Operation boundaries

| Operation | Purpose | Version 1 position |
|---|---|---|
| Create | Add a new durable item with a fresh immutable ID and provenance. | Implemented by the local mutation runtime. |
| Work claim | State that a worker intends to perform an existing item. | Deliberately not stored or resolved by schema version 1. |
| Lifecycle transition | Change a validated status and required relations. | Implemented for guarded one-item local transitions. |

Creation is not a claim on existing work. A future claim is not proof that a
lifecycle transition was accepted. A future lifecycle transition does not grant
an exclusive claim unless its backend explicitly says so.

## Capability tiers and backends

| Tier | Typical backend | What it can promise | What it must not claim |
|---|---|---|---|
| Read-only | Filesystem snapshot or exported ledger | Validate and calculate deterministic readiness. | Mutation or cross-worker coordination. |
| Local write | One working copy | Create valid IDs and write validated state locally. | Atomicity across processes, worktrees, or clones. |
| Git-mediated | Shared Git with normal merges and per-file changes | Auditability, conflict detection, and merge review. | Linearizable global claims or conflict-free concurrent edits to the same item. |
| Coordinated CAS | Explicit pluggable compare-and-set or lease service | Only the documented single-item claim or transition semantics of that backend. | Guarantees beyond backend scope, availability, or lease duration. |

Version 1 has the read-only core and a deliberately narrow local mutation
contract. The work-claim row defines future capability vocabulary; it does not
make a claim backend exist today.

## Deferred claim storage

Claim metadata is intentionally absent from schema version 1. Therefore version
1 ready selection does not resolve, expire, or exclude claims.

Before a mutation release adds claims, a follow-on ADR and schema version MUST
define all of the following together:

- a common persisted claim envelope, including backend identity, holder, issued
  instant, expiry or lease semantics, and an opaque comparison token;
- how a backend resolves that envelope and reports unsupported or stale claims;
- the precise fail-closed behaviour when claim resolution is unavailable; and
- whether a recognised unexpired claim changes ready output or only reports
  coordination state.

Deferring the envelope is safer than publishing an optional field no portable
reader can interpret.

## Transition preconditions

Every additional mutation backend needs an expected-current-state check, such
as an opaque revision token, content hash, Git object identity, or equivalent
comparison. The local runtime uses the exact SHA-256 item-byte revision defined
by the mutation contract.

For a done transition, dependent cleanup is part of the operation. For a killed
or archived transition, the backend must apply every dependent disposition
required by SPEC.md within its advertised atomic scope or fail unchanged. A
failed comparison or incomplete dependent disposition is a conflict result, not
permission to overwrite the ledger.

## Alternatives considered

### Sequential IDs with a shared-branch push race

Rejected as the core default. It assumes a remote, permission to push, and a
specific branch topology. It offers optimistic conflict handling, not a
portable atomic claim.

### Require a hosted coordination service

Rejected for v0. It violates the plain Markdown and Git posture and prevents
offline or local-only use.

### Persist an optional claim field now

Rejected. Without a shared envelope and resolution rules, readers would either
ignore it or invent unsafe semantics.

### Collision-resistant identity plus explicit capability reporting

Accepted. It makes creation remote-independent while remaining honest that
exclusive claims and compare-and-set transitions need a capable backend.

## Deferred decisions

- The claim envelope, ownership model, expiry, and renewal behaviour.
- Whether a future optional backend offers leases, locks, or both.
- Any consumer's friendly numbering, policy ranking, display order, or branch
  policy.
