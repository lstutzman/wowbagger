# Wowbagger Ledger Specification

Status: draft for standalone v0

## 1. Scope and normative language

This specification defines the portable Markdown ledger that Wowbagger reads
and later may mutate. It deliberately does not choose a programming language,
package manager, hosted service, Git branch, or harness integration.

The words MUST, MUST NOT, SHOULD, and MAY are normative.

## 2. Ledger boundary

A ledger item is durable work that a human would expect in the repository's
outstanding-work record. It has immutable identity, provenance, history, and a
lifecycle.

Run-local work is orchestration bookkeeping: a worker's phase, retry decision,
temporary plan, process identifier, or scratch analysis. It MUST NOT receive a
ledger ID, affect readiness, or be written to the ledger merely because it is
work. A host MAY keep run-local state elsewhere; Wowbagger does not prescribe
that storage or retention.

An optional durable Decisions record belongs to an item when a decision will
matter to a later human or worker. It records why an item was scoped, accepted,
waived, deferred, restored, or closed. Decisions are not a substitute for
run-local notes.

## 3. Item storage

- One Markdown file represents one item. The configured ledger directory and
  filename convention are consumer configuration; filenames are not identities.
- Every item starts with exactly one YAML frontmatter document delimited by
  lines containing three hyphens.
- Every cross-item reference uses an item ID, never a filename or display rank.
- A reader loads the complete configured ledger before validation or readiness.
  It MUST NOT treat a missing item as satisfied.

## 4. Schema version 1

The following frontmatter fields are part of schema version 1.

| Field | Required | Meaning |
|---|---:|---|
| schema_version | Yes | Integer 1 for this contract version. |
| id | Yes | Immutable primary identity using the canonical Wowbagger ULID form. |
| title | Yes | Non-empty human-readable summary. |
| kind | Yes | task or epic. |
| status | Yes | triage, backlog, in-progress, done, killed, or archived. |
| created | Yes | ISO calendar date of the ID timestamp in UTC. |
| updated | Yes | ISO calendar date of the latest durable item change. |
| provenance | Yes | Mapping with source and recorded_at fields. |
| depends_on | Yes | List of currently live blocker IDs. |
| related | No | List of non-blocking IDs, including satisfied former dependencies. Defaults to an empty list. |
| parent | No | ID of an epic containing this item. |
| snoozed_until | No | ISO calendar date. A future date temporarily removes a backlog task from readiness. |
| completed | Conditional | ISO calendar date required only when status is done. |
| killed | Conditional | ISO calendar date required only when status is killed. |
| archived | Conditional | ISO calendar date required only when status is archived. |
| decisions | No | Sequence of durable decision records, each with date, summary, and rationale; an epic completion also requires its structured rollup evidence. |

### 4.1 Canonical identity

An ID has this form:

    wb_[0-7][0-9A-HJKMNP-TV-Z]{25}

The 26 characters after wb_ are a canonical ULID:

- the first 10 characters encode a Unix timestamp in milliseconds;
- the remaining 16 characters encode 80 bits of entropy;
- the first character is restricted to 0 through 7, as required by the
  48-bit timestamp representation.

A creator MUST generate the timestamp from the creation instant in UTC and use
at least 80 bits of collision-resistant entropy. Before durably creating an
item, it MUST check the candidate ID against the complete loaded ledger. If the
ID is already present, it MUST generate fresh entropy and retry; if it cannot
produce a unique ID, it MUST fail without writing an item.

The created field MUST equal the UTC calendar date encoded by the ID timestamp.
An ID is not a global clock, sequence, lock, or ordering authority. IDs MUST
NOT change, be reused, or be inferred from filenames.

### 4.2 Structured provenance

Provenance is a required portable mapping:

| Subfield | Required | Meaning |
|---|---:|---|
| source | Yes | Non-empty opaque origin label or reference, such as user-request, import, or fixture. |
| recorded_at | Yes | RFC 3339 UTC instant at which the item was recorded. |

Consumers MAY add provenance subfields, but source and recorded_at remain
mandatory. Provenance identifies where the durable item came from; it is not a
claim of current worker ownership.

Unknown top-level fields are permitted for consumer policy only when they do
not change required core semantics. A core validator MUST preserve unknown
fields and MUST reject duplicate YAML keys.

## 5. Lifecycle invariants

| Status | Meaning | Dispatchable |
|---|---|---:|
| triage | Unvetted intake awaiting an explicit accept or decline decision. | No |
| backlog | Accepted, unstarted work. | Potentially |
| in-progress | Accepted work currently being performed. | No |
| done | Work completed with a durable completion date. | No |
| killed | Work was wrong, duplicate, or deliberately abandoned with a durable reason. | No |
| archived | Judgment-free non-dispatch staleness state with a durable archive reason. | No |

The triage gate is mandatory: a triage item MUST NOT be scored, selected as
ready, or implicitly promoted. Only an explicit lifecycle transition may accept
it into backlog.

The allowed version 1 transitions are kind-specific:

| Item kind | From | Allowed targets | Required cleanup or evidence |
|---|---|---|---|
| task or epic | triage | backlog, killed | Accept decision for backlog; kill decision and killed date for killed. |
| task | backlog | in-progress, archived, killed | Archive or kill preconditions in section 6; durable decision for terminal action. |
| task | in-progress | backlog, done, killed | Done or kill date and durable decision for terminal action. |
| epic | backlog | done, archived, killed | Epic done rollup preconditions below; archive or kill preconditions in section 6; durable decision for terminal action. |
| task or epic | archived | backlog | Clear archived date and add a durable restore decision. |
| task or epic | done or killed | none | Create a new item if work is reconsidered or discovered. |

For every transition, updated MUST be set to the transition date and MUST NOT
be earlier than created. The active terminal date (completed, killed, or
archived) MUST equal that transition date; a transition into a non-terminal
status MUST clear every terminal date. Terminal-date invariants are strict:

- done requires completed and forbids killed and archived;
- killed requires killed and forbids completed and archived;
- archived requires archived and forbids completed and killed;
- triage, backlog, and in-progress forbid completed, killed, and archived.

An epic is a container regardless of status. An epic MUST NEVER enter
in-progress, be dispatched, or be returned by a ready query. A backlog epic MAY
transition directly to done only when every item whose parent equals the epic
ID (every direct child in the complete ledger) has status done or killed.
Archived, triage, backlog, and in-progress children do not silently satisfy an
epic rollup. A validator MUST reject an epic whose status is in-progress.

The epic completion MUST include a Decisions record dated completed with a
rollup list. Each rollup entry is a mapping with id and status fields. The list
MUST contain each direct child exactly once, ordered by immutable ID, and each
entry status MUST equal that child's actual done or killed status. An epic done
transition with a non-terminal child, missing rollup entry, extra rollup entry,
or mismatched child status MUST be rejected without changing the ledger.
A validator MUST reject the corresponding persisted done epic state.

Killed and archived are intentionally different:

- killed asserts that the work itself was wrong, duplicate, or no longer wanted;
- archived preserves a valid item that is stale or intentionally parked without
  judging the work invalid.

No implementation may silently turn one into the other.

## 6. Relations, dependency liveness, and safe terminalization

The depends_on list contains only live blockers with status triage, backlog, or
in-progress. Related items never block readiness.

When a dependency becomes done, a mutation-capable implementation MUST remove
that ID from every affected dependent's depends_on list and append it to related
if absent. That cleanup is part of the successful done transition.

Killing or archiving a prerequisite is different. Before either transition, the
implementation MUST find every live dependent that lists the prerequisite in
depends_on. It MUST refuse the transition unless, in the same backend operation,
each dependent is explicitly dispositioned by one of these choices:

1. replace the dependency with another valid live blocker;
2. waive the dependency by moving it to related and adding a durable Decisions
   record that explains the waiver; or
3. transition the dependent to a terminal state with its own required evidence.

The backend MUST either apply the prerequisite transition and every required
dependent disposition within its advertised atomic scope, or reject the whole
operation and leave the ledger unchanged. This is not a claim of global
atomicity across backends.

An archived item MUST NOT remain an incoming prerequisite. Manual data in which
a dependent still lists an archived item in depends_on is invalid, just as a
done or killed prerequisite left in depends_on is invalid. The validator MUST
fail closed; it MUST NOT silently make dependents ready.

Validation MUST reject:

- a dependency that does not resolve to an item in the complete ledger;
- a self-dependency or dependency cycle;
- a done or killed dependency left in depends_on;
- an archived dependency left in depends_on;
- a parent that does not resolve to an epic;
- a parent equal to the item's own ID;
- a containment cycle through parent references;
- duplicate references within a relation list;
- the same ID in depends_on and related.

## 7. Durable Decisions

Decisions are optional generally, but when present each record MUST contain:

- date: ISO calendar date;
- summary: the decision in one sentence;
- rationale: the evidence or trade-off that explains it.

Terminal transitions, dependency waivers, and archive restoration MUST include
a durable Decisions record. Decisions MUST be retained across lifecycle
transitions. The rollup field is required only for the Decisions record that
completes an epic: it is a sequence of mappings with id and status, and is the
durable evidence described in section 5.

## 8. Deterministic ready semantics

A ready query evaluates a complete, valid ledger as of an explicit ISO calendar
date. A future interactive implementation MAY default that date to the current
UTC date, but tests and machine calls MUST be able to supply it.

An item is ready only when all are true:

1. kind is task;
2. status is backlog;
3. snoozed_until is absent or is on or before the evaluation date;
4. depends_on is empty.

The ready result sorts by ascending created date, then ascending immutable ID.
This is deterministic without a policy engine. A later consumer policy MAY rank
or decorate the returned set, but it MUST NOT change lifecycle validity or core
readiness selection.

If a machine result includes excluded items, it MUST sort them by immutable ID.

## 9. Fail-closed validation

Validation is a prerequisite for every core operation. A validator MUST reject
the whole configured ledger, rather than returning a partial ready list, when
it finds a structural error in any included item.

At minimum, validation rejects malformed or missing frontmatter, duplicate IDs,
unknown kind or status values, invalid dates or timestamps, an ID whose
timestamp date disagrees with created, invalid provenance, missing required
fields, invalid field types, impossible status-date combinations, unresolved
relations, invalid parent targets, terminal or archived live dependencies, and
dependency cycles, parent self-references, containment cycles, and invalid
epic rollup evidence.

Machine-readable validation errors MUST contain a stable code, file path, field
when applicable, and a human-readable message. Output sorts by path, then
field, then code. Each item participating in a duplicate ID MUST receive its
own duplicate-id error. Each item participating in a dependency cycle MUST
receive its own dependency-cycle error. A self-parent MUST receive its own
self-parent error, and each item participating in a multi-item containment
cycle MUST receive its own containment-cycle error.

A ready query MUST surface validation failure rather than silently omitting
invalid work.

## 10. Capability boundary

Version 1 defines a read-only ledger contract. It contains no work-claim or
revision metadata, and ready does not resolve or exclude claims. Creation,
claims, lifecycle mutation, compare-and-set transport, and claim storage are
deferred to a later mutation contract described by ADR 0001.

A future backend MUST report a missing capability rather than pretending a
local or Git write is globally atomic.

## 11. Fixture contract

The synthetic fixtures under spec/fixtures are normative examples for later
black-box tests:

- ready-selection proves deterministic creation-order selection, snooze
  equality, triage, non-dispatchable epics, a valid epic rollup, active
  blockers, and archived exclusion;
- validation-errors proves duplicate IDs, bad status, unresolved dependencies,
  killed and archived prerequisite safety, dependency and containment cycles,
  self-parent validation, invalid parent targets, and terminal-date invariants.

They contain no consumer product data and MUST remain suitable for any
Wowbagger installation.
