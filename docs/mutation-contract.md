# Proposed mutation contract

Status: proposed for the next standalone phase; not implemented by the current
read-only executable.

This document defines the machine contract a future local-filesystem mutation
backend must implement. It supplements [SPEC.md](../SPEC.md) and
[ADR 0003](adr/0003-local-mutation-and-cas.md); it does not relax any schema
version 1 lifecycle invariant.

The current executable supports only validate and ready. In particular, the
commands below are contract targets, not commands a caller may assume are
present today. A future runtime must expose an accurate capabilities result
before callers rely on mutation behaviour.

## 1. Scope

The contract deliberately separates:

- create: publish one fresh triage item;
- inspect: read one item and return an exact-byte revision;
- transition: change one existing item along a permitted lifecycle edge; and
- work claim: not implemented and explicitly unsupported.

The local backend's atomic scope is one Markdown item. It may coordinate only
Wowbagger writers using the same ledger directory in one working copy. It does
not coordinate clones, worktrees, machines, non-cooperating editors, or a
future claim backend.

The contract does not add a persisted revision or claim field to schema version
1. It also does not offer a generic metadata patch, a body-edit command,
consumer adapters, or a multi-item transaction.

## 2. Command forms and JSON transport

The proposed forms are:

~~~text
wowbagger capabilities --json
wowbagger inspect --ledger <dir> --id <id> --json
wowbagger create --ledger <dir> --input <json-file|-> --json
wowbagger transition --ledger <dir> --input <json-file|-> --json
~~~

The JSON input file and standard input form must be UTF-8 JSON objects without
duplicate object member names. A dash means standard input. Create and
transition reject unknown command flags and do not grow a large parallel set of
field flags; their structured request is the stable automation interface.

For every invocation with --json, the command writes exactly one JSON envelope
followed by one line-feed to standard output. Expected request, validation,
conflict, lock, and capability failures write no prose to standard error.
Unexpected operating failures may add a concise standard-error diagnostic only
when an envelope is still emitted. A process crash before it can emit an
envelope is outside this interface and must be treated as an unknown outcome.

The existing validate and ready outputs remain their separately specified
read-only envelopes. This document does not retroactively wrap them.

### Common response envelope

A successful non-mutating response has exactly these root fields:

~~~json
{
  "ok": true,
  "command": "inspect",
  "contract_version": 1,
  "result": {}
}
~~~

A normal error response has exactly these root fields:

~~~json
{
  "ok": false,
  "command": "transition",
  "contract_version": 1,
  "state": "unchanged",
  "error": {
    "code": "revision-conflict",
    "message": "The item changed after it was inspected.",
    "details": {}
  }
}
~~~

Successful create and transition responses add a required state member. Error
responses add it only for create and transition. Its values have precise
meaning:

| State | Meaning |
|---|---|
| unchanged | No Markdown item file was created, removed, renamed, or byte-modified by this invocation. |
| committed | The command re-read the intended published bytes and knows the one-item mutation is visible now. |
| unknown | A filesystem failure occurred at or after publication was attempted, so the caller must inspect before retrying. |

An error response with state committed is possible only for a
post-commit-recovery-required error: the new bytes were verified, but cleanup
or a durability step could not be confirmed. It is deliberately not reported
as unchanged.

The error object always has a stable string code and message. Its details
object is code-specific and contains only the members defined below. Implementations
must not add undocumented root fields to successful or expected-error
envelopes.

### Exit behaviour

| Exit | Condition | Error codes |
|---:|---|---|
| 0 | Successful command and, for a mutation, state committed with normal cleanup. | None |
| 2 | CLI, input JSON, request-schema, or lifecycle-precondition failure; an item was not found. | invalid-request, item-not-found, transition-precondition-failed |
| 3 | The configured ledger is unreadable or invalid under SPEC.md. | ledger-invalid |
| 4 | A cooperative concurrency result prevented the mutation. | revision-conflict, lock-held |
| 5 | The backend deliberately lacks the needed capability or atomic scope. | atomic-scope-required, capability-unavailable |
| 6 | An unexpected local operating failure or a post-publication recovery condition occurred. | id-allocation-failed, operation-failed, post-commit-recovery-required, write-outcome-unknown |

Only an exit 0 means the command completed normally. Clients must inspect the
state member on every nonzero create or transition response; nonzero does not
by itself imply unchanged.

## 3. Capabilities

The future local backend returns this result shape:

~~~json
{
  "ok": true,
  "command": "capabilities",
  "contract_version": 1,
  "result": {
    "backend": {
      "name": "local-filesystem",
      "coordination_scope": "same-working-copy-cooperative-writers"
    },
    "operations": {
      "inspect": { "supported": true },
      "create": { "supported": true, "atomic_scope": "single-item" },
      "transition": { "supported": true, "atomic_scope": "single-item" },
      "work_claim": { "supported": false, "reason": "not-implemented" }
    },
    "limits": {
      "multi_item_atomicity": false,
      "cross_clone_coordination": false,
      "cross_worktree_coordination": false,
      "cross_machine_coordination": false,
      "noncooperating_writer_protection": false,
      "automatic_stale_lock_breaking": false
    }
  }
}
~~~

The work_claim member is intentional. A local mutation lock protects a short
write attempt; it is not a lease, assignment, reservation, or work claim.
There is no proposed claim command in this phase.

## 4. Inspect and revision semantics

Inspect first loads and validates the complete ledger. It then resolves exactly
one item by its canonical ID. The result is:

~~~json
{
  "ok": true,
  "command": "inspect",
  "contract_version": 1,
  "result": {
    "item": {
      "id": "wb_...",
      "path": "wb_....md",
      "revision": "sha256:<64 lowercase hexadecimal characters>",
      "frontmatter": {},
      "body": "exact decoded body suffix"
    }
  }
}
~~~

The path is a forward-slash, ledger-relative display path and is not identity.
The frontmatter object is the complete parsed YAML mapping, including permitted
unknown top-level fields and permitted extra provenance fields. The body is the
exact UTF-8 decoded content after the closing frontmatter delimiter, including
leading, trailing, and blank lines. It is not trimmed or normalized.

The revision is SHA-256 over the complete raw bytes of the item file. It always
uses the lowercase form:

    sha256:<lowercase hex digest>

It does not hash parsed JSON, parsed YAML, normalized line endings, or a Git
object. An implementation must read and hash the actual regular file with the
same fail-closed read hygiene used by validation.

If the ID does not resolve, inspect returns item-not-found with exit 2 and:

~~~json
{
  "id": "wb_..."
}
~~~

If the ledger is invalid, inspect returns ledger-invalid with exit 3 and:

~~~json
{
  "validation_errors": [
    {
      "path": "ledger/item.md",
      "field": "status",
      "code": "invalid-status",
      "message": "..."
    }
  ]
}
~~~

The validation-errors sequence is exactly the existing SPEC.md validation
sequence, including its deterministic ordering.

## 5. Create

### Request

Create accepts this root object:

~~~json
{
  "item": {
    "title": "Map the fictional route",
    "kind": "task",
    "provenance": {
      "source": "fixture/mutations",
      "recorded_at": "2030-01-10T12:34:56.789Z"
    },
    "depends_on": [],
    "related": []
  },
  "body": "A fictional Markdown body.\n"
}
~~~

| Member | Required | Rules |
|---|---:|---|
| item | Yes | Frontmatter draft mapping. |
| item.title | Yes | Non-empty string accepted by schema version 1. |
| item.kind | Yes | task or epic. |
| item.provenance | Yes | Valid required provenance mapping; extra provenance members are preserved. |
| item.depends_on | Yes | Valid relation list. |
| item.related | No | Valid relation list; omitted means an empty list. |
| item.parent | No | Valid epic ID. |
| item.snoozed_until | No | Valid ISO calendar date. |
| item extension members | No | Permitted only when they do not change core semantics and survive schema validation. |
| body | Yes | JSON string; an empty string is valid. |

The item draft MUST NOT supply schema_version, id, status, created, updated,
completed, killed, archived, decisions, or body. Those names are controlled by
the operation and a request containing one is invalid-request. Duplicate JSON
keys are invalid-request rather than last-member-wins input.

Create produces only a triage item. It generates a collision-resistant canonical
ULID, sets schema_version to 1, sets created and updated to the UTC calendar
date encoded by that ID, sets status to triage, inserts an empty related list
when omitted, and writes no terminal date or decision. A caller accepts a
triage item through a later transition rather than smuggling an implicit
backlog promotion into creation.

The draft plus generated fields must validate against the complete ledger
before publication. A create with a parent or a live dependency locks those
referenced existing items before publication and revalidates them, as described
by ADR 0003. It writes only the newly created item.

The default physical filename is:

    <generated-id>.md

at the ledger root. Callers cannot select it through this request. It is a
portable default, not an identity rule; a later consumer configuration may use
another filename layout.

### Body and field preservation

The created source is UTF-8 with line-feed delimiters and exactly one YAML
frontmatter document. The body request is appended as supplied after the
closing delimiter's line-feed. No extra body newline is invented or removed.

For an existing item, transition preserves the body's raw bytes exactly. It
also preserves every frontmatter member and value other than status, updated,
the terminal-date fields controlled by the transition, and the one required
decision appended by the transition. This includes unknown permitted top-level
fields and extra provenance fields.

Schema version 1 does not canonicalize hand-authored YAML comments, quoting, or
key order. A mutation implementation may reserialize frontmatter while
preserving those semantic fields; that reserialization changes the revision.
Callers must use the returned revision rather than derive a revision from a
normalized object. The normative fixtures provide exact source bytes for their
own vectors.

### Successful response

Create returns state committed and the same item object shape as inspect:

~~~json
{
  "ok": true,
  "command": "create",
  "contract_version": 1,
  "state": "committed",
  "result": {
    "item": {
      "id": "wb_...",
      "path": "wb_....md",
      "revision": "sha256:<lowercase hex digest>",
      "frontmatter": {},
      "body": "..."
    }
  }
}
~~~

## 6. Transition

### Request

Transition accepts this root object:

~~~json
{
  "id": "wb_...",
  "expected_revision": "sha256:<64 lowercase hexadecimal characters>",
  "to_status": "backlog",
  "date": "2030-01-11",
  "decision": {
    "summary": "Accept the fictional route work.",
    "rationale": "It is a self-contained fictional fixture item."
  }
}
~~~

| Member | Required | Rules |
|---|---:|---|
| id | Yes | Canonical item ID. |
| expected_revision | Yes | Exact lowercase SHA-256 token returned by inspect. |
| to_status | Yes | One target in the allowed-transition table. |
| date | Yes | ISO calendar date used for updated and any terminal date. |
| decision | Conditional | Required only for an edge that records accept, complete, kill, archive, or restore evidence. |
| decision.summary | Conditional | Required non-empty summary when decision is required. |
| decision.rationale | Conditional | Required non-empty rationale when decision is required. |

The request must not supply a decision action, decision date, rollup, body,
frontmatter patch, terminal dates, or any item field. Wowbagger derives those
values. A decision is rejected for a transition that does not append one.

### Allowed lifecycle edges

| Kind | From | To | Required generated evidence |
|---|---|---|---|
| task or epic | triage | backlog | append accept decision |
| task or epic | triage | killed | set killed and append kill decision |
| task | backlog | in-progress | none |
| task | backlog | archived | set archived and append archive decision |
| task | backlog | killed | set killed and append kill decision |
| task | in-progress | backlog | none |
| task | in-progress | done | set completed and append complete decision |
| task | in-progress | killed | set killed and append kill decision |
| epic | backlog | done | set completed and append complete decision with generated rollup |
| epic | backlog | archived | set archived and append archive decision |
| epic | backlog | killed | set killed and append kill decision |
| task or epic | archived | backlog | clear archived and append restore decision |

Every transition sets updated to date. A transition into a non-terminal state
clears every terminal date. A transition into a terminal state sets only its
matching terminal date. Existing decisions are retained and the required
decision is appended; a completed epic's rollup is generated from its terminal
direct children in immutable-ID order.

All SPEC.md transition preconditions remain mandatory. In particular, a done
target must have an empty depends_on list, and an epic can be done only when
every direct child is already done or killed. A legal request that fails one of
these target-state tests returns transition-precondition-failed, exit 2, and
state unchanged. Its details are:

~~~json
{
  "id": "wb_...",
  "reason": "live-dependencies"
}
~~~

The reason is one of live-dependencies, nonterminal-children, or
date-before-created. An invalid ISO date is instead invalid-request. These
failures do not authorize the backend to alter dependencies or children to make
the request succeed.

No other edge is supported. In particular, an epic never enters in-progress,
done and killed items do not reopen, and this contract cannot directly edit
dependencies, parents, titles, unknown fields, or body text.

### Compare-and-set and local scope

The backend locks the target, re-loads and validates the complete ledger, then
re-reads and hashes the target's exact raw bytes. Only then does it compare
expected_revision. A mismatch returns:

~~~json
{
  "id": "wb_...",
  "expected_revision": "sha256:<request digest>",
  "actual_revision": "sha256:<current digest>"
}
~~~

with revision-conflict, exit 4, and state unchanged. It must not overwrite the
current bytes, append a decision, or perform relation cleanup.

If the per-item lock already exists, the backend returns lock-held, exit 4,
and state unchanged. Its details are:

~~~json
{
  "id": "wb_...",
  "lock_path": ".wowbagger-locks/wb_....lock",
  "owner": {
    "lock_version": 1,
    "item_id": "wb_...",
    "operation": "transition",
    "writer_id": "opaque-random-value",
    "started_at": "2030-01-10T12:34:56.789Z"
  }
}
~~~

Owner is null when the held lock cannot be safely parsed. Lock metadata is
untrusted diagnostics, never authorization, and an old timestamp never permits
automatic lock removal.

### Multi-item refusal

The local backend must refuse, before writing the target, whenever successful
execution would require another Markdown item write. It returns
atomic-scope-required, exit 5, state unchanged, and:

~~~json
{
  "id": "wb_...",
  "reason": "dependent-cleanup",
  "affected_ids": ["wb_..."]
}
~~~

The reason is one of:

| Reason | When it applies |
|---|---|
| dependent-cleanup | A done transition would need to remove the completed prerequisite from a live dependent's depends_on list and add it to related. |
| dependent-disposition | A killed or archived prerequisite has live dependents that need replacement, waiver, or terminal disposition. |
| child-disposition | A killed or archived epic has non-terminal direct children that need reparenting or terminal disposition. |

Affected IDs are unique and sorted by immutable ID. An epic backlog-to-done
transition remains a one-item transition only if it has no live dependencies,
every direct child is already done or killed, and there are no live incoming
dependents that require cleanup. The generated rollup is written only to the
epic's complete decision; no child file changes.

These refusals preserve the lifecycle invariants rather than weakening them
for a local filesystem backend. A backend that later advertises a broader
atomic scope must define and expose that capability separately.

## 7. No-change and recovery rules

For invalid-request, item-not-found, ledger-invalid, revision-conflict,
lock-held, atomic-scope-required, and capability-unavailable, the command
returns state unchanged. It must not create, remove, rename, or alter any
Markdown item. In a normal handled failure it also removes temporary and lock
artifacts it created.

Transient lock and temporary files are not ledger items. A process crash or a
cleanup I/O failure can leave such an artifact even when item bytes are
unchanged; ADR 0003 defines the explicit audited recovery procedure. No
implementation may silently break a stale lock only because it is old.

After a final create publication or transition replacement has been attempted,
the backend must never claim unchanged unless it can prove it. It returns
write-outcome-unknown with state unknown when it cannot establish the visible
result. If it re-reads the new bytes but cannot clean a lock or confirm a
durability step, it returns post-commit-recovery-required with state committed.
The caller must inspect and validate the ledger before retrying either result.

## 8. Error-detail schemas

| Code | Required details |
|---|---|
| invalid-request | issues: ordered sequence of objects with path, code, and message |
| item-not-found | id |
| transition-precondition-failed | id, reason |
| ledger-invalid | validation_errors: exact SPEC.md validation-error sequence |
| revision-conflict | id, expected_revision, actual_revision |
| lock-held | id, lock_path, owner object or null |
| atomic-scope-required | id, reason, affected_ids |
| capability-unavailable | capability, reason |
| id-allocation-failed | reason |
| operation-failed | operation, reason |
| post-commit-recovery-required | id, revision, recovery_artifacts |
| write-outcome-unknown | id, recovery_artifacts |

Messages remain concise human explanations. Automation must branch on code,
state, and documented details rather than message text.

## 9. Normative design vectors

The fictional vectors under
[spec/fixtures/mutations](../spec/fixtures/mutations/README.md) are the
compatibility target for this proposed contract. They cover capabilities,
inspection and exact-byte revision calculation, deterministic fixture creation,
a successful single-item transition, a stale revision conflict, a held lock,
and a required multi-item refusal.

They are design vectors only in this phase. They do not assert that the current
read-only executable implements mutation commands.
