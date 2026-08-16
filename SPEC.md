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

An optional committed `<ledger>/.wowbagger/layout.json` binds item placement
for the complete ledger. It accepts exactly:

~~~json
{
  "layout_version": 1,
  "items_directory": "items"
}
~~~

`layout_version` MUST be integer `1`. `items_directory` MUST be a normalized,
ledger-relative path made from one or more portable filename components. It
MUST NOT be empty, absolute, contain `.` or `..`, use `\`, or contain any
component named `.wowbagger` under a case-insensitive comparison. Unknown
members are invalid. If the file is absent, the item
directory is the ledger root. If the file is present, every item MUST be below
the configured item directory. A file outside it that parses as an item makes
the ledger invalid with `item-outside-layout`. A malformed or unreadable
configuration makes the ledger invalid; an implementation MUST NOT fall back
to the ledger root.

The layout file is the only write-path authority. `create` derives its final
path from `items_directory` and the caller-supplied item ID. A mutation request
cannot supply or override a path. Readers still traverse the complete ledger
to detect misplaced items instead of hiding them.

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

## 4. Schema versions 1 and 2

The following frontmatter fields are common to schema versions 1 and 2.

| Field | Required | Meaning |
|---|---:|---|
| schema_version | Yes | Integer 1 or 2. Every item in one non-empty ledger MUST use the same version. |
| id | Yes | Immutable primary identity using the canonical Wowbagger ULID form. |
| title | Yes | Non-empty human-readable summary. |
| kind | Yes | task or epic. |
| status | Yes | triage, backlog, in-progress, done, killed, or archived. |
| created | Yes | ISO calendar date of the ID timestamp in UTC. |
| updated | Yes | ISO calendar date of the latest durable item change. |
| provenance | Yes | Mapping with source and recorded_at fields. |
| depends_on | Yes | In schema 1, a list of currently live blocker IDs. In schema 2, a list of declared, unwaived prerequisite IDs. |
| related | No | List of non-blocking IDs. Schema 1 completion moves satisfied former dependencies here. Schema 2 completion does not. Defaults to an empty list. |
| parent | No | ID of an epic containing this item. |
| snoozed_until | No | ISO calendar date. A future date temporarily removes a backlog task from readiness. |
| priority | No | Non-negative integer supplied by a consumer policy. Lower values sort first; Wowbagger core does not calculate it. |
| number | No | Positive integer, unique within one ledger. A short handle for humans. It is not identity: the immutable ID remains what publication, references, and the filename use. Two worktrees may allocate the same number concurrently; that is a duplicate-number validation error resolved at merge, not an identity collision. |
| completed | Conditional | ISO calendar date required only when status is done. |
| killed | Conditional | ISO calendar date required only when status is killed. |
| archived | Conditional | ISO calendar date required only when status is archived. |
| decisions | Conditional | Sequence of durable decision records, each with action, date, summary, and rationale. A terminal item requires a matching terminal decision; an epic completion also requires structured rollup evidence. |

A non-empty ledger MUST use one schema version. A validator MUST reject every
item in a ledger that mixes schema versions 1 and 2. Schema version 2 changes
dependency satisfaction and retention only. All other fields, lifecycle edges,
relation-integrity rules, and evidence rules remain as defined below unless a
rule explicitly distinguishes the versions.

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
second value `60` are not accepted in schema version 1 or 2.

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

The allowed transitions are the same in schema versions 1 and 2. Their
completion preconditions differ as shown below:

| Item kind | From | Allowed targets | Required cleanup or evidence |
|---|---|---|---|
| task or epic | triage | backlog, killed | action: accept decision for backlog; action: kill decision and killed date for killed. |
| task | backlog | in-progress, archived, killed | Archive or kill preconditions in section 6; matching terminal decision. |
| task | in-progress | backlog, done, killed | Before done, schema 1 depends_on MUST be empty and every schema 2 dependency target MUST be done; done or kill date and matching terminal decision. |
| epic | backlog | done, archived, killed | Before done, schema 1 depends_on MUST be empty and every schema 2 dependency target MUST be done; epic rollup preconditions below; archive or kill child-disposition preconditions in section 6; matching terminal decision. |
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

In schema version 1, any task or epic MAY transition to done only when its
depends_on list is already empty. A validator MUST reject every persisted
schema version 1 done item with a non-empty depends_on list.

In schema version 2, a task or epic MAY transition to done only when every
depends_on target has status done. The satisfied prerequisite IDs MUST remain
in depends_on. A validator MUST accept that retained history and MUST reject a
persisted schema version 2 done item when any dependency target does not have
status done.

In both versions, a mutation MUST NOT infer replacement or waiver. Any
replacement or waiver MUST be recorded explicitly before the completion
attempt, and a replacement remains a prerequisite until it is separately done
or waived.

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

## 6. Relations, prerequisite satisfaction, and safe terminalization

In schema version 1, depends_on contains only live blockers with status triage,
backlog, or in-progress. When a dependency becomes done, a mutation-capable
implementation MUST remove that ID from every affected dependent's depends_on
list and append it to related if absent. That cleanup is part of the successful
done transition.

In schema version 2, depends_on contains declared, unwaived prerequisites. A
dependency is satisfied exactly when its target has status done. A satisfied
prerequisite MUST remain in depends_on as typed history. Completion MUST NOT
copy it to related. Targets with status triage, backlog, or in-progress remain
live blockers. Related items never block readiness in either version.

A mutation preflight MUST inspect every item whose depends_on contains the
target, regardless of the referring item's own status. The explicit disposition
choices below describe live dependents, but they do not permit a terminal
dependent or any other item to retain a reference that would make the complete
proposed ledger invalid. Such a transition MUST fail unchanged when the
backend cannot atomically make every required item change.

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

An archived or killed item MUST NOT remain an incoming prerequisite. A done
item MUST NOT remain in schema version 1 depends_on, but it is the only
satisfied schema version 2 dependency. The validator MUST fail closed on every
other terminal dependency state; it MUST NOT silently make dependents ready.

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
Mutation preflight MUST enumerate every direct child before applying these
status-specific rules and MUST validate the complete proposed ledger before
publication.

Validation MUST reject:

- a dependency that does not resolve to an item in the complete ledger;
- a self-dependency or dependency cycle;
- a done dependency left in schema version 1 depends_on;
- a killed dependency left in either schema version;
- an archived dependency left in depends_on;
- a schema version 1 done item with a non-empty depends_on list;
- a schema version 2 done item whose depends_on contains a target that is not done;
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
4. schema version 1 depends_on is empty, or every schema version 2 depends_on
   target has status done;
5. every epic ancestor reached through parent has status backlog.

The ready result sorts by:

1. items with priority before items without priority;
2. ascending priority;
3. ascending created date;
4. ascending immutable ID.

This order is deterministic even when a consumer does not use a policy engine.
The core reports the supplied priority but never invents, recalculates, or
persists one. A later consumer policy MAY rank or decorate the returned set,
but it MUST NOT change lifecycle validity or core readiness selection.

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
unsupported or mixed schema versions, unknown kind or status values, invalid dates or timestamps, an ID whose
timestamp date disagrees with created, invalid provenance, missing required
fields, invalid field types, impossible status-date combinations, unresolved
relations, invalid parent targets, disallowed terminal dependencies, a done
item with unsatisfied dependencies, terminal epics with non-terminal children,
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
field, then code. An error whose repair the validator can derive MAY also
carry `expected_path`, the ledger-relative path the item belongs at, and
`remediation`, a human-readable string naming the repair. `item-outside-layout`
carries both. No other member is permitted on a validation error. Each item participating in a duplicate ID MUST receive its
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

## 10. Capability boundary and local mutation contract

Core mutation contracts 1 and 2 are defined. The shipped runtime emits version
2; version 1 remains the frozen compatibility definition. Neither version adds
work-claim or revision metadata to Markdown, and ready does not resolve or
exclude claims.

[docs/mutation-contract.md](docs/mutation-contract.md) specifies the
implemented local backend for `capabilities`, inspect/revision, create,
lifecycle transition, and patch commands. Inspect parses, exposes, and hashes
one raw byte buffer and returns a lossless base64 source alongside a normalized
core view.
Create requires a caller-generated canonical ID and either publishes complete
bytes with an atomic no-clobber primitive or fails unchanged. Revision is
SHA-256 over exact item-file bytes; it is not added to frontmatter and YAML is
not normalized before hashing. The backend is explicitly limited to cooperative
single-item CAS among Wowbagger writers in one working copy. [ADR
0003](docs/adr/0003-local-mutation-and-cas.md) records the local lock,
publication, crash-recovery, and portability trade-offs.

Any later backend MUST report a missing capability rather than pretending a
local or Git write is globally atomic. Before transition publication the local
backend validates the complete one-item proposed ledger and refuses every
required dependent cleanup or child disposition when it lacks multi-item
atomicity when the selected schema requires such cleanup. Work-claim
coordination is a separate capability from the fixed same-working-copy mutation
scope. An unprovisioned Git ledger exposes advisory claim visibility. A
provisioned Git ledger exposes the merge-coordinated Git-journal profile:
durable claims, claim-protected single-item publication, and Git history
reconciliation, with `safe_exclusive_dispatch: false`. Direct filesystem
writes, hostile processes, other clones, and non-claim-aware tools remain
bypasses. The profile implements the lower merge-coordinated bar in the
separate [work-claim contract](docs/work-claim-contract.md) and [ADR
0004](docs/adr/0004-fenced-work-claim-protocol.md); it does not add claim state
to schema version 1 or 2 Markdown.

Contract version 2 accepts a uniformly schema-1 or uniformly schema-2 ledger
and rejects a mixture. Schema version 2 uses the prerequisite satisfaction and
retention rules in sections 5 through 7. Migrating this repository's live
ledger is a separate quiesced operation and is not part of publishing the
transport contract.

The command contract distinguishes immutable-ID collision from an unrelated
item or valid directory occupying the default creation path. It also defines a
stable candidate-invalid refusal when the complete proposed ledger fails
validation after more-specific collision, multi-item, and lifecycle checks.
Unexpected mutation failures expose closed operation-phase and reason values
rather than platform exception text.

## 11. Fixture contract

The synthetic fixtures under spec/fixtures are normative executable black-box
tests:

- ready-selection proves deterministic creation-order selection, snooze
  equality, ancestor safety, non-dispatchable epics, a valid epic rollup, and
  the exact minimal public ready result;
- validation-errors proves duplicate IDs, bad status, unresolved dependencies,
  killed and archived prerequisite safety, dependency and containment cycles,
  self-parent validation, invalid parent targets, done-item dependency safety,
  terminal-epic child safety, terminal decisions, and terminal-date invariants.
- mutations defines local mutation vectors with
  invocation manifests for lossless exact-byte inspection, caller-ID creation,
  strict JSON, body boundaries, lifecycle transitions, concurrency and
  recovery states, and deterministic multi-item refusal.
- work-claims defines executable normative reference-model vectors with strict
  JSON, exact base64 source bytes and hashes, immutable ledger namespaces,
  capability honesty across every write path, epochs, leases, publication
  fencing, faults, restart recovery, and monotonic clock-floor evidence. The
  shipped Git-journal profile implements the merge-coordinated subset for
  provisioned ledgers. The no-I/O vectors remain the oracle for a future
  backend that advertises strict fencing and safe exclusive dispatch.

They contain no consumer product data and MUST remain suitable for any
Wowbagger installation.
