# ADR 0001: Identity and claim contract

Status: accepted for the standalone v0 contract

## Context

Wowbagger must work in a local repository, a shared Git repository, and a
harness that has no permission to push a shared branch. Sequential numeric IDs
allocated by a direct push race require a specific remote and branch policy.
They are therefore not a portable identity mechanism.

The words create, claim, and transition describe different operations. Treating
them as one operation hides the concurrency guarantee a host actually has.

## Decision

Wowbagger uses immutable collision-resistant IDs as its primary identity:

    wb_<ULID>

The ULID is generated when an item is created. It permits independent local
creation without a remote round trip. It is an identifier, not a globally
authoritative clock, sequence, or lock. A merge-time validator still detects a
duplicate ID; collision-resistant does not mean mathematically impossible.

Sequential numbers, filenames, and priority positions are optional consumer
views. They MUST NOT be required to create an item or to determine identity.

## Separate operations

| Operation | Purpose | Minimum guarantee |
|---|---|---|
| Create | Add a new durable item with a fresh immutable ID. | The created item has a syntactically valid, collision-resistant identity. |
| Work claim | State that a worker intends to work on an existing item. | Only the guarantee advertised by the configured claim backend. |
| Lifecycle transition | Change item state, such as triage to backlog or in-progress to done. | The transition is validated against the current item representation and backend capability. |

Creation is not a claim on existing work. A claim is not proof that a lifecycle
transition was accepted. A lifecycle transition does not grant an exclusive
claim unless its backend explicitly says so.

## Capability tiers and backends

| Tier | Typical backend | What it can promise | What it must not claim |
|---|---|---|---|
| Read-only | Filesystem snapshot or exported ledger | Validate and calculate deterministic readiness. | Any mutation or cross-worker coordination. |
| Local write | One working copy | Create unique-format IDs and write validated state locally. | Atomicity across processes, worktrees, or clones. |
| Git-mediated | Shared Git with normal merges and per-file changes | Auditability, conflict detection, and merge review. | Linearizable global claims or conflict-free concurrent edits to the same item. |
| Coordinated CAS | Explicit pluggable lock or compare-and-set service | The backend's documented single-item claim or transition semantics. | Guarantees beyond the backend's scope, availability, or lease duration. |

A backend exposes its available capabilities to the caller. If a requested
claim or compare-and-set operation is unavailable, the operation MUST fail
clearly and leave the ledger unchanged.

## Transition preconditions

Every mutation-capable backend needs an expected-current-state check. It may
use an opaque revision token, content hash, Git object identity, or an
equivalent backend-specific comparison. The exact transport is intentionally
deferred until the mutation phase.

A failed comparison is a conflict result, not permission to overwrite the item.
The caller must reload the ledger and decide whether to retry, merge, or stop.

## Consequences

- A standalone read-only validate and ready implementation needs no remote,
  lock service, sequential counter, or claim backend.
- The first mutating implementation cannot claim global atomicity merely
  because it writes Git files.
- Consumer-specific branch names, remote names, direct-push carve-outs, and
  human numbering policies belong in a consumer backend or adapter, never in
  core identity.
- Claim expiry, owner identity, and lease renewal remain backend concerns. The
  core only defines how an unexpired recognised claim affects readiness.

## Alternatives considered

### Sequential IDs with a shared-branch push race

Rejected as the core default. It assumes a remote, permission to push, and a
specific branch topology. It provides optimistic conflict handling rather than
a portable atomic claim.

### Require a hosted coordination service

Rejected for v0. It violates the plain Markdown and Git posture and prevents
offline or local-only use.

### Collision-resistant identity plus explicit capability reporting

Accepted. It makes creation independent of a remote while being honest about
the additional backend required for exclusive claims and compare-and-set
transitions.

## Deferred decisions

- The implementation language and distribution format.
- The concrete mutation transport and revision-token representation.
- Whether a future optional backend offers leases, locks, or both.
- Any consumer's friendly numbering, display order, or branch policy.
