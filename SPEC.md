# Wowbagger Ledger Specification

Status: draft for standalone v0

## 1. Scope and normative language

This specification defines the portable Markdown ledger that Wowbagger reads and
eventually mutates. It deliberately does not define a programming language,
package manager, hosted service, Git branch, or harness integration.

The words MUST, MUST NOT, SHOULD, and MAY are normative.

## 2. Ledger boundary

A ledger item is durable work that a human would expect to find in the
repository's outstanding-work record. It has an immutable identity, provenance,
history, and a lifecycle.

Run-local work is orchestration bookkeeping: an agent's current phase, retry
decision, temporary plan, process identifier, or scratch analysis. It MUST NOT
receive a ledger ID, affect readiness, or be written into the ledger merely
because it is work. A host MAY keep run-local state elsewhere, but Wowbagger
does not prescribe its storage or retention.

An optional durable Decisions record belongs to an item when a decision will
matter to a later human or worker. It records why an item was scoped, accepted,
deferred, or closed. Decisions are not a substitute for run-local notes.

## 3. Item storage

- One Markdown file represents one item. The configured ledger directory and
  filename convention are consumer configuration; filenames are not identities.
- Every item starts with exactly one YAML frontmatter document delimited by
  lines containing three hyphens.
- Every cross-item reference uses an item ID, never a filename or display rank.
- A reader loads the complete configured ledger before validating dependencies
  or calculating readiness. It MUST NOT treat a missing item as satisfied.

## 4. Schema

The following frontmatter fields are part of schema version 1.

| Field | Required | Meaning |
|---|---:|---|
| schema_version | Yes | Integer 1 for this version of the contract. |
| id | Yes | Immutable primary identity. It matches wb_ followed by a 26-character Crockford-base32 ULID. |
| title | Yes | Non-empty human-readable summary. |
| kind | Yes | task or epic. |
| status | Yes | triage, backlog, in-progress, done, killed, or archived. |
| created | Yes | ISO calendar date on which the item was created. |
| updated | Yes | ISO calendar date of the latest durable item change. |
| depends_on | Yes | List of IDs that are currently live blockers. |
| related | No | List of non-blocking IDs, including satisfied former dependencies. Defaults to an empty list. |
| parent | No | ID of an epic containing this item. |
| priority | No | Non-negative integer supplied by a consumer policy. Lower values sort first; Wowbagger core does not calculate it. |
| snoozed_until | No | ISO calendar date. A future date temporarily removes a backlog task from readiness. |
| completed | Conditional | ISO calendar date required when status is done. |
| killed | Conditional | ISO calendar date required when status is killed. |
| archived | Conditional | ISO calendar date required when status is archived. |
| decisions | No | Sequence of durable decision records, each with date, summary, and rationale. |
| claim | No | Backend-owned current work-claim metadata. It is valid only when a configured backend advertises claim capability. |
| revision | No | Backend-owned opaque comparison token for a mutation-capable backend. |

The ID pattern is:

    wb_[0-9A-HJKMNP-TV-Z]{26}

An item ID MUST NOT change, be reused, or be inferred from a filename. A
consumer MAY display a separate rank or friendly label, but it is not identity.

Unknown top-level fields are permitted for consumer policy only when they do not
change the meaning of the required core fields. A core validator MUST preserve
unknown fields and MUST reject duplicate YAML keys.

## 5. Lifecycle invariants

| Status | Meaning | Dispatchable |
|---|---|---:|
| triage | Unvetted intake awaiting an explicit accept or decline decision. | No |
| backlog | Accepted, unstarted work. | Potentially |
| in-progress | Work has begun or has an active durable claim. | No |
| done | Work completed with a durable completion date. | No |
| killed | Work was wrong, duplicate, or deliberately abandoned with a reason. | No |
| archived | Judgment-free non-dispatch staleness state with an archive date; it is reversible only by an explicit restore decision. | No |

The triage gate is mandatory: a triage item MUST NOT be scored, selected as
ready, or implicitly promoted. Only an explicit lifecycle transition may accept
it into backlog.

An epic is a container regardless of its status. An epic MUST NEVER be
dispatched or returned by a ready query. A lifecycle implementation may mark an
epic done only after every direct child is done or killed and the rollup records
the evidence. Archived children do not silently satisfy an epic rollup.

Archived ends dispatch eligibility; it does not satisfy a dependency. A task
that remains depended on MUST NOT be archived until its dependents are handled.

Killed and archived are intentionally different:

- killed asserts that the work itself was wrong, duplicate, or no longer wanted;
- archived preserves a valid item that is stale or intentionally parked without
  judging the work invalid.

No implementation may silently turn one into the other.

## 6. Relations and dependency liveness

The depends_on list contains only live blockers. A live blocker has status
triage, backlog, in-progress, or archived. Done and killed items are satisfied,
not live blockers.

When a dependency becomes done or killed, a mutation-capable implementation
MUST remove that ID from each affected dependent's depends_on list and append it
to related if it is not already present. This preserves the relationship without
leaving stale blockers behind.

Validation MUST reject:

- a dependency that does not resolve to an item in the complete ledger;
- a self-dependency;
- a dependency cycle;
- a done or killed item left in depends_on;
- a parent that does not resolve to an epic;
- duplicate references within a relation list.

Related items never block readiness. A relation may be present in both the body
and frontmatter only if the structured frontmatter remains the canonical
machine-readable reference.

## 7. Durable Decisions

Decisions are optional, but when present each record MUST contain:

- date: an ISO calendar date;
- summary: the decision in one sentence;
- rationale: the evidence or trade-off that explains it.

Decisions MUST be retained across lifecycle transitions. A terminal decision
such as kill, archive, or restore MUST include a durable decision record or an
equivalent reason in the item body.

## 8. Deterministic ready semantics

A ready query evaluates a complete, valid ledger as of an explicit ISO
calendar date. A future implementation MAY default that date to the current UTC
date for interactive use, but tests and machine calls MUST be able to supply it.

An item is ready only when all of the following are true:

1. kind is task;
2. status is backlog;
3. snoozed_until is absent or is on or before the evaluation date;
4. it has no live depends_on entries;
5. it has no unexpired claim recognised by the configured claim backend.

The ready result sorts by:

1. items with priority before items without priority;
2. ascending priority;
3. ascending created date;
4. ascending immutable ID.

This order is deterministic even when a consumer does not use a policy engine.
The core reports the supplied priority but never invents, recalculates, or
persists one.

If a machine result includes excluded items, it MUST sort them by immutable ID.

## 9. Fail-closed validation

Validation is a prerequisite for every core operation. A validator MUST reject
the whole ledger, rather than returning a partial ready list, when it finds a
structural error in any item that the configured ledger includes.

At minimum, validation rejects malformed or missing frontmatter, duplicate IDs,
unknown kind or status values, invalid dates, invalid ID shape, missing required
fields, invalid field types, impossible status-date combinations, unresolved
relations, and dependency cycles.

Each item that participates in a duplicate ID MUST receive its own duplicate-id
error so that a caller can repair either file without guessing which one the
validator chose first.

Machine-readable validation errors MUST identify a stable error code, file path,
field when applicable, and a human-readable message. Error output sorts by path
then field then code. A ready query MUST surface validation failure instead of
silently omitting invalid work.

## 10. Capability boundary

This specification defines ledger semantics, not a guarantee that every host
can coordinate writers. Read-only validation and readiness require no remote.
Creation, work claims, and lifecycle transitions require capabilities described
by ADR 0001. A backend MUST report a missing capability rather than pretending
that a local write is globally atomic.

## 11. Fixture contract

The synthetic fixtures under spec/fixtures are normative examples for later
black-box tests:

- ready-selection defines a valid ledger and its expected ready result;
- validation-errors defines invalid ledgers and stable expected error codes.

They contain no consumer product data and MUST remain suitable for any
Wowbagger installation.
