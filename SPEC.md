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
- Item files MUST be valid UTF-8. Invalid byte sequences are a ledger
  validation error; readers MUST NOT substitute replacement characters.
- Every cross-item reference uses an item ID, never a filename or display rank.
- A reader loads the complete configured ledger before validation or readiness.
  It MUST NOT treat a missing item as satisfied.

Only regular files whose names end in `.md` are item files. A real directory
whose name ends in `.md` remains a container and is traversed. A symbolic link
encountered anywhere below the configured ledger, and any non-regular
filesystem entry named `.md` (for example a FIFO, socket, or device), MUST make
the ledger invalid. A read or traversal failure MUST likewise be surfaced as a
ledger error rather than producing a partial result.

This rejection is a deterministic-read hygiene boundary, not a hostile
filesystem sandbox. It prevents the configured ledger from silently expanding
through links or blocking on special item paths. It does not claim to prevent a
privileged local process from racing or replacing ancestor directories while a
read is in progress.

The configured ledger root is part of validation's fail-closed boundary. A
root that cannot be inspected produces `ledger-read-error`, a root symbolic
link produces `symlink-not-allowed`, and an existing root that is not a real
directory produces `ledger-root-not-directory`. These root errors use the
root's final path component as their machine-readable path and MUST be returned
as validation output rather than an operational stderr failure.

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
| decisions | Conditional | Sequence of durable decision records, each with action, date, summary, and rationale. A terminal item requires a matching terminal decision; an epic completion also requires structured rollup evidence. |

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
| recorded_at | Yes | Canonical RFC 3339 UTC instant at which the item was recorded. |

The canonical recorded_at representation is
`YYYY-MM-DDTHH:MM:SS[.fraction]Z`: uppercase `T` and `Z`, a valid calendar date,
hours 00 through 23, minutes and seconds 00 through 59, and an optional
fractional-second component. Numeric offsets, including `+00:00`, and leap
second value `60` are not accepted in schema version 1.

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
| task or epic | triage | backlog, killed | action: accept decision for backlog; action: kill decision and killed date for killed. |
| task | backlog | in-progress, archived, killed | Archive or kill preconditions in section 6; matching terminal decision. |
| task | in-progress | backlog, done, killed | depends_on MUST be empty before done; done or kill date and matching terminal decision. |
| epic | backlog | done, archived, killed | depends_on MUST be empty before done; epic rollup preconditions below; archive or kill child-disposition preconditions in section 6; matching terminal decision. |
| task or epic | archived | backlog | Clear archived date and add an action: restore decision. |
| task or epic | done or killed | none | Create a new item if work is reconsidered or discovered. |

For every transition, updated MUST be set to the transition date and MUST NOT
be earlier than created. The active terminal date (completed, killed, or
archived) MUST equal that transition date; a transition into a non-terminal
status MUST clear every terminal date. Terminal-date invariants are strict:

- done requires completed and forbids killed and archived;
- killed requires killed and forbids completed and archived;
- archived requires archived and forbids completed and killed;
- triage, backlog, and in-progress forbid completed, killed, and archived.

Any task or epic MAY transition to done only when its depends_on list is already
empty. A mutation MUST refuse completion while any dependency remains; it MUST
NOT infer that a dependency was satisfied, replaced, or waived. Any replacement
or waiver MUST be recorded explicitly before the completion attempt, and a
replacement remains a blocker until it is separately resolved or waived. A
validator MUST reject every persisted done item with a non-empty depends_on
list.

An epic is a container regardless of status. An epic MUST NEVER enter
in-progress, be dispatched, or be returned by a ready query. A backlog epic MAY
transition directly to done only when every item whose parent equals the epic
ID (every direct child in the complete ledger) has status done or killed.
Archived, triage, backlog, and in-progress children do not silently satisfy an
epic rollup. A validator MUST reject an epic whose status is in-progress.

The epic completion MUST include the action: complete Decisions record required
by section 7, dated completed and containing a rollup list. Each rollup entry is
a mapping with id and status fields. The list MUST contain each direct child
exactly once, ordered by immutable ID, and each entry status MUST equal that
child's actual done or killed status. An epic done transition with a
non-terminal child, missing rollup entry, extra rollup entry, or mismatched
child status MUST be rejected without changing the ledger. A validator MUST
reject the corresponding persisted done epic state.

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
2. waive the dependency by moving it to related; or
3. remove the prerequisite from depends_on and transition the dependent to a
   terminal state with its own required evidence.

A replacement MUST add an action: replace-dependency Decisions record to the
dependent, and a waiver MUST add an action: waive-dependency record. The record
MUST identify the old dependency and, for replacement, the new dependency in
its rationale. These dispositions are explicit ledger changes; neither may be
inferred from a later completion transition.

The backend MUST either apply the prerequisite transition and every required
dependent disposition within its advertised atomic scope, or reject the whole
operation and leave the ledger unchanged. This is not a claim of global
atomicity across backends.

An archived item MUST NOT remain an incoming prerequisite. Manual data in which
a dependent still lists an archived item in depends_on is invalid, just as a
done or killed prerequisite left in depends_on is invalid. The validator MUST
fail closed; it MUST NOT silently make dependents ready.

Before an epic transitions to killed or archived, the implementation MUST find
every direct child with status triage, backlog, or in-progress. It MUST refuse
the transition unless the same backend operation explicitly handles each such
child by either:

1. reparenting it to another valid non-terminal epic and adding an action:
   reparent Decisions record to the child; or
2. transitioning it to a terminal state allowed by section 5, with the child's
   own matching terminal decision and evidence.

The backend MUST apply the epic transition and every child disposition within
its advertised atomic scope or reject the whole operation unchanged. A
validator MUST reject each non-terminal child whose direct parent is a killed
or archived epic. A done epic remains subject to the stricter rollup rule in
section 5. Because validation precedes readiness, an invalid terminal ancestor
causes the whole ready query to fail closed rather than exposing a descendant.

Validation MUST reject:

- a dependency that does not resolve to an item in the complete ledger;
- a self-dependency or dependency cycle;
- a done or killed dependency left in depends_on;
- an archived dependency left in depends_on;
- any done item with a non-empty depends_on list;
- a parent that does not resolve to an epic;
- a parent equal to the item's own ID;
- a containment cycle through parent references;
- a non-terminal child whose parent is a killed or archived epic;
- duplicate references within a relation list;
- the same ID in depends_on and related.

## 7. Durable Decisions

Decisions are optional generally, but every record MUST contain:

- action: one of accept, complete, kill, archive, restore,
  replace-dependency, waive-dependency, reparent, or record;
- date: ISO calendar date;
- summary: the decision in one sentence;
- rationale: the evidence or trade-off that explains it.

The action value makes lifecycle evidence mechanically identifiable. A terminal
item MUST contain at least one decision with the action and date in this table:

| Terminal status | Required action | Required decision date |
|---|---|---|
| done | complete | completed |
| killed | kill | killed |
| archived | archive | archived |

An unrelated or differently dated decision does not satisfy this requirement.
Archive restoration MUST add an action: restore decision. Decisions MUST be
retained across lifecycle transitions. The rollup field is required on the
matching complete decision for an epic and MUST NOT appear on any other
decision. Its sequence of id and status mappings is the durable evidence
described in section 5.

## 8. Deterministic ready semantics

A ready query evaluates a complete, valid ledger as of an explicit ISO calendar
date. A future interactive implementation MAY default that date to the current
UTC date, but tests and machine calls MUST be able to supply it.

An item is ready only when all are true:

1. kind is task;
2. status is backlog;
3. snoozed_until is absent or is on or before the evaluation date;
4. depends_on is empty;
5. every epic ancestor reached through parent has status backlog.

The ready result sorts by ascending created date, then ascending immutable ID.
This is deterministic without a policy engine. A later consumer policy MAY rank
or decorate the returned set, but it MUST NOT change lifecycle validity or core
readiness selection.

The normative successful public result is an exact JSON object with only these
fields:

    {
      "as_of": "2030-01-15",
      "valid": true,
      "ready": ["wb_...", "wb_..."]
    }

ready is the ordered list of immutable item IDs. Exclusion reasons and other
diagnostics are non-normative and MUST be emitted separately, not added to this
public result. For an invalid ledger, ready MUST surface the validation failure
and MUST NOT emit a successful result or a partial ready list.

## 9. Fail-closed validation

Validation is a prerequisite for every core operation. A validator MUST reject
the whole configured ledger, rather than returning a partial ready list, when
it finds a structural error in any included item.

At minimum, validation rejects malformed or missing frontmatter, duplicate IDs,
unknown kind or status values, invalid dates or timestamps, an ID whose
timestamp date disagrees with created, invalid provenance, missing required
fields, invalid field types, impossible status-date combinations, unresolved
relations, invalid parent targets, terminal or archived live dependencies, a
done item with live dependencies, terminal epics with non-terminal children,
invalid or mismatched terminal decisions, dependency cycles, parent
self-references, containment cycles, and invalid epic rollup evidence.

Validation errors have deterministic prerequisites. For a terminal item, the
required terminal date is validated before the matching decision action and
date, and before date-dependent epic rollup evidence. If that required date is
missing or invalid, the validator MUST emit the terminal-date error and MUST
suppress decision-mismatch and rollup-date errors whose evaluation depends on
it. Independent errors on the same item are not suppressed. This rule makes a
missing completed field produce its missing-terminal-date error without a
second derived missing-matching-terminal-decision error.

Machine-readable validation errors MUST contain a stable code, file path, field
when applicable, and a human-readable message. Output sorts by path, then
field, then code. Each item participating in a duplicate ID MUST receive its
own duplicate-id error. Each item participating in a dependency cycle MUST
receive its own dependency-cycle error. A self-parent MUST receive its own
self-parent error, and each item participating in a multi-item containment
cycle MUST receive its own containment-cycle error. A multi-item cycle message
identifies the relation, strongly connected component size, and the
participating item's own ID; it does not enumerate an unbounded cycle path.

The stable code for a killed dependency that remains in depends_on is
terminal-dependency-invalid. The code is repair-neutral; its message MUST allow
replacement, waiver, or terminalization rather than prescribe only one repair.

A ready query MUST surface validation failure rather than silently omitting
invalid work.

## 10. Capability boundary and proposed mutation contract

The currently implemented version 1 core is read-only. It contains no
persisted work-claim or revision metadata, and ready does not resolve or
exclude claims.

[docs/mutation-contract.md](docs/mutation-contract.md) is the clearly marked
**proposed** next-phase contract for separate capabilities, inspect/revision,
create, and lifecycle transition commands. It uses a response revision of
SHA-256 over the exact item-file bytes; it does not add that value to
frontmatter or normalize YAML before hashing. Its first backend is explicitly
limited to cooperative single-item CAS among Wowbagger writers in one working
copy. [ADR 0003](docs/adr/0003-local-mutation-and-cas.md) records the local
lock, publication, crash-recovery, and portability trade-offs.

The proposed contract is not implemented by the current executable. A future
backend MUST report a missing capability rather than pretending a local or Git
write is globally atomic, must refuse a transition requiring multi-item
dependent cleanup or child disposition when it lacks that atomic scope, and
must report work claims unsupported until a separate claim contract exists.

## 11. Fixture contract

The synthetic fixtures under spec/fixtures are normative examples for later
black-box tests:

- ready-selection proves deterministic creation-order selection, snooze
  equality, ancestor safety, non-dispatchable epics, a valid epic rollup, and
  the exact minimal public ready result;
- validation-errors proves duplicate IDs, bad status, unresolved dependencies,
  killed and archived prerequisite safety, dependency and containment cycles,
  self-parent validation, invalid parent targets, done-item dependency safety,
  terminal-epic child safety, terminal decisions, and terminal-date invariants.
- mutations defines proposed, non-executable local mutation design vectors for
  capabilities, exact-byte revision inspection, creation, a single-item
  transition, stale revisions, held locks, and multi-item refusal.

They contain no consumer product data and MUST remain suitable for any
Wowbagger installation.
