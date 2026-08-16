# Local mutation contract

Status: versions 1 and 2 are defined; the pre-alpha standalone
local-filesystem runtime currently emits version 2.

This document defines the machine contract implemented by the local-filesystem
mutation backend. It supplements [SPEC.md](../SPEC.md) and
[ADR 0003](adr/0003-local-mutation-and-cas.md); it does not relax schema version
1 or 2 lifecycle invariants.

The executable supports `validate`, `ready`, and the commands below. Clients
must still call `capabilities` and honor its advertised limits before assuming a
backend can provide a particular write guarantee.

## Contract versions

Version 1 remains the frozen contract described by the version 1 envelopes and
capability example below. Version 2 retains every version 1 request, response,
state, exit, locking, CAS, publication, and recovery rule except for these
explicit deltas:

- every core command envelope in this contract carries `contract_version: 2`;
- one non-empty ledger may use schema version 1 or schema version 2, but never a
  mixture;
- the capability envelope uses the fixed local mutation scope described in
  section 4 and advertises `patch`; and
- adapter contract version 2 may invoke `patch` as an approved mutation.

The bootstrap wire, work-claim API, adapter approval, instruction, handoff, and
fixture-format versions are separate version domains and remain version 1.

Version negotiation uses distinct existing fields. A core consumer MUST read
the top-level `contract_version` from `capabilities --json`. A work-claim
consumer MUST read `result.operations.work_claim.api_version` from
`claim capabilities --ledger <dir> --json`. It MUST NOT compare a claim
response's top-level `contract_version` with the core version. That claim member
remains the version 1 envelope marker for exact version 1 consumers.

This rule is the migration path for generic consumers: dispatch by command
namespace first, then check the version field for that domain. No envelope
member changes, so existing exact-member consumers remain compatible.

## 1. Scope

The contract keeps four concerns separate:

- capabilities describes guarantees and limitations;
- inspect reads one item and returns a revision from the same bytes it exposes;
- create publishes one caller-identified triage item;
- transition changes one existing item through a guarded lifecycle edge; and
- patch changes one existing item's caller-supplied fields (section 9).

Fenced work claiming is unsupported. Advisory claims may be visible through a
Git common directory, but they do not protect publication or coordinate a
mutation. A write lock protects a short mutation attempt; it is not a claim,
assignment, lease, or reservation. The separate [fenced work-claim
contract](work-claim-contract.md) defines a future backend protocol; it does
not add a fencing guarantee to either mutation-contract version.

If a future backend advertises safely fenced claims while retaining these
legacy entry points, it must run them through the same coordinator: transition
refuses an active claimed `(ledger_namespace, item_id)` and create refuses an
identity with claim history. Until then, the local runtime's unsupported
capability is authoritative; callers cannot combine this API with an external
claim hint and infer fencing.

A **provisioned** ledger is that coordinated backend. It adds one operating
rule that governs every command in this document: **commit each mutation to Git
before running the next mutating command.** Section 12 states the rule, the
refusal it produces, and its reconciliation procedure. Read it before writing a
batch of mutations against a provisioned ledger.

The first backend coordinates only cooperative Wowbagger writers using the same
ledger directory in one working copy. It does not coordinate clones, worktrees,
machines, hostile or non-cooperating writers, or Git operations. Its write
scope is one Markdown item and it has no multi-item atomicity.

Schema versions 1 and 2 remain canonical Markdown. One non-empty ledger must
use one schema version; complete-ledger validation rejects a mixture. Revision
and lock data are transport state and are not persisted in item frontmatter.

Validation and ready selection use the versioned semantics in SPEC.md. Schema
version 1 ready tasks have an empty depends_on list. Schema version 2 ready
tasks may retain declared prerequisites, but every target must have status
done. These schema rules do not change the version 1 request or response
envelopes in this document.

## 2. Commands and transport

The local commands are:

~~~text
wowbagger capabilities --json
wowbagger inspect --ledger <dir> --id <id> --json
wowbagger create --ledger <dir> --input <json-file|-> --json
wowbagger transition --ledger <dir> --input <json-file|-> --json
wowbagger patch --ledger <dir> --input <json-file|-> --json
wowbagger mint-id [--date YYYY-MM-DD] --json
~~~

A dash for --input means standard input. File and standard-input requests have
identical semantics. Request bytes must be valid UTF-8 JSON with one top-level
object and no duplicate member names at any depth. Duplicate members are
invalid; a parser must not apply last-member-wins behaviour.

Unknown, missing, and repeated command arguments are invalid-request. Create,
transition, and patch use JSON input rather than parallel field flags.

### Standard output and standard error

For an invocation with --json, the process writes exactly one compact JSON
object followed by one LF to standard output.

Expected request, validation, lookup, conflict, lock, capability, and lifecycle
failures leave standard error empty. An unexpected operating failure may write
one UTF-8 diagnostic line of at most 1024 bytes to standard error. That line is
for a human and must not contain credentials, raw lock contents, or a path
outside the configured ledger. Automation uses the JSON envelope.

A process crash before an envelope is emitted is outside the command protocol.
A caller must treat the outcome of a mutating command as unknown and follow the
recovery rules in section 10.

### Response envelopes

A successful read-only command has exactly:

~~~json
{
  "ok": true,
  "command": "inspect",
  "contract_version": 1,
  "result": {}
}
~~~

A successful create, transition, or patch adds state:

~~~json
{
  "ok": true,
  "command": "create",
  "contract_version": 1,
  "state": "committed",
  "result": {}
}
~~~

A read-only error has exactly:

~~~json
{
  "ok": false,
  "command": "inspect",
  "contract_version": 1,
  "error": {
    "code": "item-not-found",
    "message": "The requested item was not found.",
    "details": {}
  }
}
~~~

Every create, transition, or patch error has a state member:

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

No expected envelope has undocumented root members.

Mutation state values mean:

| State | Meaning |
|---|---|
| unchanged | This invocation did not create, remove, rename, or byte-modify a Markdown item. |
| committed | The intended final path was re-read and contains exactly the expected published bytes. |
| unknown | Publication was attempted, but the process cannot establish which bytes are visible. |

Transient locks and temporary files are not Markdown items. Their possible
presence is reported separately as bounded recovery_artifacts.

### Exit status

| Exit | Condition | Error codes |
|---:|---|---|
| 0 | Successful command; a mutation is state committed. | none |
| 2 | Argument, request, lookup, or candidate/lifecycle-precondition failure. | invalid-request, item-not-found, transition-precondition-failed, patch-precondition-failed, candidate-invalid |
| 3 | The complete configured ledger is invalid. | ledger-invalid |
| 4 | Cooperative comparison, lock, identity, or default-path conflict. | revision-conflict, lock-held, id-collision, path-collision |
| 5 | The backend lacks the required capability or write scope. | atomic-scope-required, capability-unavailable |
| 6 | An unexpected operating or post-publication recovery condition. | operation-failed, post-commit-recovery-required, write-outcome-unknown |

Only exit 0 is normal completion. A client must inspect mutation state on every
nonzero create, transition, or patch result.

## 3. Deterministic invalid-request issues

invalid-request details are:

~~~json
{
  "issues": [
    {
      "path": "/body",
      "code": "missing-member",
      "message": "Required member body is missing."
    }
  ]
}
~~~

Each issue has exactly path, code, and message:

- path is an RFC 6901 JSON Pointer into the decoded request;
- the empty string identifies the request root;
- command-line issues use the synthetic root /arguments followed by the
  zero-based argument index when known;
- code is one of invalid-json, duplicate-key, missing-member, unknown-member,
  invalid-type, invalid-value, missing-argument, repeated-argument, or
  unknown-argument; and
- message is the stable sentence shown by the normative vector for that issue.

A duplicate-key path points to the duplicate occurrence. A syntactically
unrecoverable JSON document produces one invalid-json issue at the empty path.
Otherwise, issues are aggregated and sorted by path, then code, then message,
using ascending Unicode code-point order without locale collation.

Unknown members at the request root are rejected. Unknown members inside item
are schema extensions and are allowed only when they do not change core
semantics. Controlled core names forbidden by create are invalid-value issues.
The status refusal additionally teaches the lifecycle rule, with the stable
message `Item member status is controlled by Wowbagger. Create assigns triage;
a transition from triage to backlog accepts the item into ready.` A caller
therefore learns the assigned status from the create result's `core.status`
and the accepting transition from the refusal, without reading this document
first.

## 4. Capabilities

The local backend, run from inside a git working copy, returns:

~~~json
{
  "ok": true,
  "command": "capabilities",
  "contract_version": 1,
  "result": {
    "backend": {
      "name": "local-filesystem",
      "coordination_scope": "shared-git-directory-cooperative-writers"
    },
    "operations": {
      "inspect": {
        "supported": true,
        "write_scope": "none",
        "cas_scope": "none"
      },
      "create": {
        "supported": true,
        "write_scope": "single-item",
        "cas_scope": "requested-id-lock",
        "publication_visibility": "atomic-no-clobber-or-fail",
        "publication_probe": "per-ledger-operation"
      },
      "transition": {
        "supported": true,
        "write_scope": "single-item",
        "cas_scope": "exact-byte-sha256"
      },
      "work_claim": {
        "supported": true,
        "api_version": 1,
        "mode": "advisory",
        "claim_protected_publication": false,
        "fencing_enforced_at": "none",
        "safe_exclusive_dispatch": false
      }
    },
    "durability": {
      "temporary_file_sync": "required-before-publication",
      "directory_sync": "best-effort-when-supported",
      "post_publication_verification": "exact-bytes-required",
      "power_loss_guarantee": "none"
    },
    "limits": {
      "multi_item_atomicity": false,
      "cross_clone_coordination": false,
      "cross_worktree_coordination": true,
      "cross_machine_coordination": false,
      "noncooperating_writer_protection": false,
      "automatic_stale_lock_breaking": false
    }
  }
}
~~~

Outside a git working copy, three members flip together:
`backend.coordination_scope` becomes `"same-working-copy-cooperative-writers"`,
`operations.work_claim.supported` becomes `false`, and
`limits.cross_worktree_coordination` becomes `false`. Every other member of the
envelope, including the rest of `operations.work_claim`
(`api_version`, `mode`, `claim_protected_publication`, `fencing_enforced_at`,
`safe_exclusive_dispatch`), is fixed regardless of git presence: work claims are
always advisory, never fence a writer, and never advertise safe exclusive
dispatch.

`capabilities` resolves the git common directory by walking upward from the
`--ledger` directory when given, or from the current working directory
otherwise (see `resolveGitCommonDir` in `src/claim-store.js`); presence of a
`.git` directory or file at or above that point is what flips the three
members above. This is the one input to `capabilities`, so the response is
deterministic for a given working directory but not fixed across working
directories.

### Contract version 2 capability delta

The preceding JSON and three-member Git-dependent coupling remain the exact
version 1 definition. Version 2 changes only the following capability paths;
all omitted paths retain their version 1 values:

| Path | Version 2 value |
|---|---|
| `contract_version` | `2` |
| `result.backend.coordination_scope` | `"same-working-copy-cooperative-writers"` |
| `result.operations.patch` | `{"supported":true,"write_scope":"single-item","cas_scope":"exact-byte-sha256"}` |
| `result.limits.cross_worktree_coordination` | `false` |

`result.operations.work_claim.supported` remains independently derived from
Git-common-directory discovery: it is `true` when claims are visible there and
`false` otherwise. This core capability envelope reports the unbound default
claim profile. It does not read a provisioned ledger namespace and does not
prove that a ledger is provisioned. Use
`claim capabilities --ledger <dir> --json` to discover whether that ledger is
unprovisioned and advisory or provisioned and merge-coordinated. Automation
MUST gate `publish-claimed` on that ledger-specific response. Neither result
elevates the fixed mutation scope. Version 2 keeps
`transition.write_scope: "single-item"`,
`transition.cas_scope: "exact-byte-sha256"`, and
`limits.multi_item_atomicity: false`.

`limits.cross_worktree_coordination: false` states one thing only: the core
never synchronizes checkouts. It does not merge, pull, or copy item files
between worktrees, and it never makes a write in one worktree appear in
another. It is **not** a statement that worktrees write independently.

On a provisioned Git-backed ledger they do not. One claim journal lives in the
shared Git common directory, so it serializes every worktree of that
repository: a recorded `transition` or `patch` in one worktree refuses every
mutation in the others with exit 6 `claim-store-unavailable`, reason
`publication-reconciliation-required`, until the writing commit is visible in
the blocked checkout. Clones do not share the common directory, so
`limits.cross_clone_coordination: false` carries no such consequence.

That serialization is discoverable, per ledger, at
`result.backend.write_serialization` in
`claim capabilities --ledger <dir> --json`. See
[the work-claim contract](work-claim-contract.md), section 3.1, for the
behaviour and section 3.2 for the recovery. Work-claim serialization across
worktrees is still not cross-worktree mutation coordination: it refuses
writers, it does not reconcile them.

Because capabilities takes no ledger content and does not write, it still
cannot prove that a particular filesystem supports the required atomic
no-clobber publication primitive. Create probes or attempts that primitive for
the configured ledger and returns capability-unavailable unchanged when it is
unavailable.

Directory fsync is capability-reported best effort. Neither a successful file
sync nor a directory sync is a universal power-loss durability guarantee.

## 5. Reads, revisions, and lossless inspection

An item revision is:

    sha256:<64 lowercase hexadecimal characters>

The digest covers the complete raw item-file bytes. It is not computed from
normalized YAML, JSON, line endings, the Markdown body, or a Git object.

Inspect loads and validates the complete ledger. For the requested item, one
validated regular-file handle supplies one raw byte buffer. The implementation
must parse the item, derive its normalized core view and body, compute the
revision, and produce source_base64 from that same buffer. It must never combine
parsed data from one file version with a digest or source from another.

The successful item shape is:

~~~json
{
  "id": "wb_...",
  "path": "wb_....md",
  "revision": "sha256:<lowercase hex digest>",
  "source_encoding": "base64",
  "source_media_type": "text/markdown; charset=utf-8",
  "source_base64": "<RFC 4648 base64 without line breaks>",
  "core": {},
  "body": "exact decoded body suffix"
}
~~~

path is a forward-slash, ledger-relative display path and is not identity.
Decoding source_base64 recovers every original byte. The decoded bytes must
hash to revision and must be valid UTF-8.

The promotion rule: the item level carries addressing and payload members
only — id, path, revision, source_encoding, source_media_type, source_base64,
and body. Every frontmatter field is read from core. id is the single member
present at both levels, because the item level must identify the resource it
addresses; no other frontmatter field is promoted, and none will be.

core contains only fields defined by supported item schema versions:

- schema_version, id, title, kind, status, created, updated;
- provenance.source and provenance.recorded_at;
- depends_on and related;
- optional parent, snoozed_until, completed, killed, archived;
- optional number and priority, the caller-supplied schema fields;
  and
- decisions with only their defined action, date, summary, rationale, and
  optional rollup id/status members.

Permitted unknown top-level fields, extra provenance members, and unknown
members or YAML representations inside extension data are omitted from core.
They remain recoverable from source_base64. This avoids pretending that every
valid YAML node, tag, anchor, integer, or mapping key has a lossless ordinary
JSON representation.

body is the exact UTF-8-decoded byte suffix after the closing frontmatter
delimiter. It is not trimmed or normalized. An item with no bytes after the
delimiter LF has body "". A conventional blank line before Markdown means body
begins with LF.

item-not-found exits 2 and has details containing only id. ledger-invalid exits
3 and has details.validation_errors equal to the existing deterministic
SPEC.md validation-error sequence. Neither read-only error has state.

## 6. Cooperative lock and snapshot protocol

Per-ID locks live at:

    <ledger>/.wowbagger-locks/<item-id>.lock

Create locks its requested new ID and every existing parent or dependency ID.
Transition locks the target, its referenced parent and dependency items, every
item whose depends_on contains the target, and every direct child when the
target is an epic. IDs are unique and acquired in ascending immutable-ID order.

Because referring items can be discovered while another cooperative writer is
finishing, lock acquisition is a closure loop:

1. load the complete valid ledger and determine the relevant IDs;
2. acquire the ordered lock set;
3. re-read the complete ledger and recompute the relevant set;
4. if the set expanded, release all locks and retry with the expanded ordered
   set; otherwise continue; and
5. fail unchanged with operation-failed if a bounded implementation retry limit
   is exhausted.

Cooperative create operations that add parent or dependency edges obey the same
protocol, so holding the target ID lock prevents a new incoming edge from being
published during terminalization.

After the stable lock set is held, the backend re-reads, re-parses, revalidates,
and re-hashes the target and every relevant referenced or referring item from
their validated file handles. It then validates the complete current ledger.
Transition compares expected_revision only after this locked re-read.

A transition constructs an in-memory complete ledger with exactly the proposed
target bytes substituted, then runs complete-ledger validation again before
publication. If another item would need mutation, the target is not published.

### Lock metadata

A writer creates the lock file exclusively as valid UTF-8 JSON no larger than
4096 bytes:

~~~json
{
  "lock_version": 1,
  "item_id": "wb_...",
  "operation": "transition",
  "writer_id": "opaque-random-value",
  "started_at": "2030-01-10T12:34:56.789Z"
}
~~~

writer_id is an opaque ASCII string of 1 through 128 characters. operation is
create, transition, or patch. The remaining values must match their schema and
lock path. Metadata contains no credentials, user name, host name, or command
arguments.

A reader reads at most 4097 bytes. A lock larger than 4096 bytes, invalid UTF-8,
duplicate-key JSON, invalid JSON, unknown members, or invalid field values is
still held. lock-held details set owner to null and owner_diagnostic to exactly
one of too-large, invalid-utf8, duplicate-key, invalid-json, or invalid-shape.
Valid metadata returns owner and owner_diagnostic null. Raw invalid bytes are
never returned.

Locks are never removed automatically merely because started_at is old. Manual
recovery follows ADR 0003.

## 7. Create

### Request

Create accepts exactly:

~~~json
{
  "id": "wb_...",
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
  "body": "\nA fictional Markdown body.\n"
}
~~~

| Member | Required | Rules |
|---|---:|---|
| id | Yes | Caller-generated canonical Wowbagger ULID. |
| item | Yes | Frontmatter draft mapping. |
| item.title | Yes | Non-empty schema string. |
| item.kind | Yes | task or epic. |
| item.provenance | Yes | Valid required provenance; extension members are preserved. |
| item.depends_on | Yes | Valid relation list. |
| item.related | No | Valid relation list; omitted means empty. |
| item.parent | No | Valid epic ID. |
| item.snoozed_until | No | Valid ISO calendar date. |
| item.number | No | Positive integer; the caller-supplied schema handle. |
| item.priority | No | Non-negative integer; the caller-supplied schema priority. |
| item extension members | No | Permitted schema extensions. |
| body | Yes | JSON string; empty and LF-leading strings are distinct and valid. |

If a file named by `--input` cannot be read before a request ID is known,
create or transition returns `invalid-request` with one `invalid-value` issue at
`/input`, the stable message `Request input could not be read.`, and mutation
state `unchanged`.

The caller generates id with the timestamp for the intended creation instant
and at least 80 bits of collision-resistant entropy. Create validates its
canonical form before acquiring its per-ID lock. id is not accepted inside
item.

No caller writes the base32 encoding themselves: `wowbagger mint-id --json`
prints a canonical ID for now, `--date` selects another creation date, and
`src/mint.js` exports `mintId` so an adapter or plugin can mint one without
shelling out.

item must not supply schema_version, id, status, created, updated, completed,
killed, archived, decisions, or body. For a non-empty valid ledger, create
inserts the schema_version already used by every existing item. For an empty
ledger, it inserts schema_version 2. Create returns that selection in
`result.item.core.schema_version`. It also inserts status triage, created
and updated equal to the UTC date encoded by id, and related [] when omitted.
It adds no terminal date or decision.

The candidate complete ledger must validate before publication. After the
requested-ID lock and locked revalidation, create applies this collision
precedence:

1. If the requested ID exists anywhere in the ledger, return id-collision,
   exit 4, and unchanged. details contain id, the existing item's
   ledger-relative path, and actual_revision.
2. Otherwise, lstat the configured identity-derived path without following
   symbolic links. If any filesystem object occupies it, return
   path-collision, exit 4, and unchanged. details contain id, that
   ledger-relative path, and occupant_kind. occupant_kind is exactly item or
   directory. For item it also contains occupying_id; for directory
   occupying_id is absent. The stable message remains exactly "The default
   item path is occupied by a different item." Automation distinguishes the
   configured path through details.path and the occupant through
   occupant_kind.
3. Otherwise, continue to candidate validation.

Create never chooses a different ID or request-supplied path. Collision checks
do not infer identity from a filename: an item whose frontmatter has another
ID occupies a path without claiming the requested ID. Complete-ledger
validation precedes these collision checks. A symbolic link, special file, or
invalid regular .md occupant therefore produces ledger-invalid rather than
path-collision. A real directory whose name ends in .md and whose contents
leave the complete ledger valid is valid input under SPEC.md and produces
path-collision when it occupies the configured identity-derived path.

The final path is derived from the committed item layout, never from the
request and never from a later rename:

    <ledger>/<items_directory>/<id>.md

`items_directory` comes from `<ledger>/.wowbagger/layout.json`, whose only
accepted shape is:

~~~json
{
  "layout_version": 1,
  "items_directory": "items"
}
~~~

When that file is absent, `items_directory` is empty and the compatible path is
`<ledger>/<id>.md`. Configuring the file is therefore ledger setup that
precedes the first create: an already-published item keeps the path its create
derived, and moving it is a consumer Git operation this contract neither
performs nor prescribes. The configured directory must already exist; create
publishes into it and never creates it.

The request cannot supply an arbitrary path. The no-clobber publication
protocol and collision rules are bound to this derived path. A malformed layout
configuration fails closed before mutation. Validation rejects any parsed item
outside the configured item directory.

### Body

The generated source uses UTF-8 and LF for generated frontmatter lines. The
closing delimiter includes its required LF; body bytes are appended exactly as
the UTF-8 encoding of request.body.

- body "" produces no byte after the closing delimiter LF;
- body "\nText\n" produces the conventional blank line before Text; and
- create never invents, trims, or removes a body newline.

### Atomic no-clobber publication

Create must never reveal an empty or partially written final item. It:

1. creates a uniquely named non-.md temporary file in the final directory;
2. writes the complete intended bytes;
3. calls fsync or the platform-equivalent sync on the completed open temporary
   file and waits for success;
4. publishes the complete temporary file to the absent final name with one
   atomic no-clobber primitive, such as same-filesystem hard-link publication;
5. re-opens the final regular file without following a symbolic link and
   verifies its exact expected bytes;
6. attempts directory fsync when supported; and
7. removes the temporary name and locks best effort.

A check-then-rename and a rename that can replace a destination are not
no-clobber publication. Opening the final path and copying bytes into it is
forbidden. Hard links are not assumed portable: if the configured filesystem
or platform cannot provide an atomic no-clobber primitive, create returns
capability-unavailable unchanged and cleans the temporary file best effort.

If a failure follows the publication attempt, the backend re-inspects the
known final path:

- exact expected bytes present means state committed; cleanup or sync failure
  returns post-commit-recovery-required;
- proven absence means state unchanged and operation-failed; and
- a different or unreadable result means write-outcome-unknown with state
  unknown.

Directory sync failure cannot turn verified exact bytes into unchanged. It
also does not justify a power-loss durability promise.

### Recovery by known ID

After a crash or unknown create result, automation inspects the caller-known ID.
If exact intended bytes are present, the create committed. If a different item
exists, the result is a collision requiring human resolution. Retry is allowed
only after inspect returns item-not-found and any reported lock or temporary
artifact has been handled under the audited recovery procedure. The atomic
no-clobber publication still protects an intervening creator.

Successful create returns state committed and the inspect item shape from
section 5.

## 8. Transition

### Request

Transition accepts exactly:

~~~json
{
  "id": "wb_...",
  "expected_revision": "sha256:<64 lowercase hexadecimal characters>",
  "to_status": "backlog",
  "date": "2030-01-11",
  "decision": {
    "summary": "Accept the fictional item.",
    "rationale": "The fictional scope is ready."
  }
}
~~~

| Member | Required | Rules |
|---|---:|---|
| id | Yes | Canonical existing item ID. |
| expected_revision | Yes | Exact lowercase SHA-256 token returned by inspect. |
| to_status | Yes | Target in the allowed edge table. |
| date | Yes | ISO calendar date not earlier than existing created or updated. |
| decision | Conditional | Required exactly when the edge appends evidence. |
| decision.summary | Conditional | Required non-empty string. |
| decision.rationale | Conditional | Required non-empty string. |

The request cannot supply action, decision date, rollup, body, frontmatter
patches, or terminal dates. Wowbagger derives them. A decision is rejected for
an edge that does not append one.

An item's created date is not the operator's calendar date. Create writes
created and updated from the UTC date encoded by the item ID: the date
derives from the ULID timestamp, which is UTC. An item created just after
midnight UTC therefore carries tomorrow's date for every operator west of
UTC. A transition dated with the operator's local calendar date is then
earlier than created, and the request refuses with date-before-created and
date-before-updated. Read the item's created and updated dates before
choosing a transition date; the refusal carries both (next section).

### Allowed edges

| Kind | From | To | Generated evidence |
|---|---|---|---|
| task or epic | triage | backlog | append accept decision |
| task or epic | triage | killed | set killed; append kill decision |
| task | backlog | in-progress | none |
| task | backlog | archived | set archived; append archive decision |
| task | backlog | killed | set killed; append kill decision |
| task | in-progress | backlog | none |
| task | in-progress | done | set completed; append complete decision |
| task | in-progress | killed | set killed; append kill decision |
| epic | backlog | done | set completed; append complete decision with generated rollup |
| epic | backlog | archived | set archived; append archive decision |
| epic | backlog | killed | set killed; append kill decision |
| task or epic | archived | backlog | clear archived; append restore decision |

Every transition sets updated to request.date. request.date must be greater than
or equal to both the existing created and existing updated dates. It cannot
move updated backwards.

A non-terminal target clears every terminal date. A terminal target sets only
its matching date. Existing decisions are retained and the required decision is
appended. Epic complete rollup is generated from every direct child, each of
which must already be done or killed, ordered by immutable ID.

No other edge is supported. Epics never enter in-progress; done and killed
items do not reopen; and transition cannot edit identity, title, relations,
parent, snooze, body, or extension fields. A schema version 2 done transition
therefore retains the target's depends_on and related lists unchanged.

### Lossless preservation

Transition preserves body bytes exactly. It preserves every permitted extension
YAML node, including tags, aliases, mapping structure, scalar precision, and
extra provenance members, without coercing it through the normalized core JSON
view. The implementation may reserialize controlled core frontmatter, but must
retain extension semantics and must not drop extension nodes or comments
attached to them.

The successful response exposes the new complete source_base64 and revision, so
the caller can verify the exact rewritten bytes.

### Revision and candidate validation

After the stable lock-set re-read in section 6, a target hash mismatch returns
revision-conflict, exit 4, and unchanged:

~~~json
{
  "id": "wb_...",
  "expected_revision": "sha256:<request digest>",
  "actual_revision": "sha256:<locked current digest>"
}
~~~

For a matching revision, the backend builds the one-item proposed ledger and
validates it completely before publication.

Every item whose depends_on contains the target is considered when the target
would become done, killed, or archived, regardless of the referring item's own
status. Every direct child is considered for an epic transition. The backend
does not limit relation checks to ready or non-terminal referring items. For a
schema version 2 done transition, incoming depends_on references become
satisfied and remain in place; they do not require another item mutation and
do not create a multi-item blocker.

### Deterministic precondition issues

A valid request that cannot produce a valid one-item successor returns
transition-precondition-failed, exit 2, and unchanged when no multi-item blocker
exists. details are:

~~~json
{
  "id": "wb_...",
  "issues": [
    {
      "code": "date-before-updated",
      "field": "date",
      "message": "Transition date must not be earlier than the current updated date.",
      "related_ids": [],
      "item_created": "2030-01-13",
      "item_updated": "2030-01-15"
    }
  ]
}
~~~

Issue codes are date-before-created, date-before-updated, invalid-edge,
live-dependencies, or nonterminal-children. related_ids are unique immutable IDs
sorted ascending. Issues sort by code, then field, then their related ID
sequence. Date checks are all reported: a date earlier than both created and
updated produces both date issues.

date-before-created and date-before-updated carry item_created and
item_updated after related_ids: the target's own dates at refusal time, both
on both codes, so one refusal states the whole acceptable window without an
inspect round-trip. No other issue code carries them. Every other code keeps
the four-member shape exactly, and a consumer that validates issue members
exactly must accept six members for these two codes.

For a schema version 1 done transition, any non-empty depends_on list produces
live-dependencies and related_ids contains the complete list. For a schema
version 2 done transition, only targets whose status is not done produce
live-dependencies, and related_ids contains only those unsatisfied prerequisite
IDs. A successful schema version 2 done transition retains every satisfied ID
in depends_on and does not append it to related.

### Deterministic multi-item refusal

If any other item would need mutation, transition returns
atomic-scope-required, exit 5, and unchanged. It aggregates every blocker:

~~~json
{
  "id": "wb_...",
  "blockers": [
    {
      "code": "child-disposition",
      "item_id": "wb_...",
      "field": "parent"
    },
    {
      "code": "dependent-disposition",
      "item_id": "wb_...",
      "field": "depends_on"
    }
  ],
  "precondition_issues": []
}
~~~

Blocker codes are:

| Code | Condition |
|---|---|
| dependent-cleanup | Schema version 1 only: a done target is still present in another item's depends_on, regardless of that item's status. Schema version 2 keeps this reference as satisfied prerequisite history and does not produce this blocker. |
| dependent-disposition | A killed or archived target is still present in another item's depends_on, regardless of that item's status. |
| child-disposition | A killed or archived epic has a direct triage, backlog, or in-progress child. |

Blockers are unique by code, item_id, and field, then sorted by code, item_id,
and field using ascending code-point order. An item that is both a child and a
dependent contributes both blockers. precondition_issues uses the schema above
and is included even when nonempty, so combined conditions are never hidden by
an ambiguous precedence rule.

If blockers is nonempty, atomic-scope-required is returned after collecting
both all blockers and all precondition issues. If blockers is empty but
precondition issues is nonempty, transition-precondition-failed is returned.
Only an empty set of both proceeds to the candidate validator.

### Candidate-validation refusal and precedence

The candidate complete-ledger validator is the final authority. When it rejects
a proposed single-item create or transition for a reason not already
represented by a more specific collision, multi-item blocker, or transition
precondition, the command returns candidate-invalid, exit 2, and unchanged:

~~~json
{
  "id": "wb_...",
  "validation_errors": [
    {
      "path": "ledger/wb_....md",
      "field": "parent",
      "code": "nonterminal-child-of-terminal-epic",
      "message": "Triage child wb_... cannot remain under archived epic wb_...; terminalize or reparent the child before the epic transition."
    }
  ]
}
~~~

validation_errors is exactly the deterministic SPEC.md validator sequence for
the complete proposed ledger, sorted by path, field, code, and message under
the existing validator rules. The response message is exactly "The proposed
item would make the ledger invalid."

For transition, refusal precedence after locked revalidation is: revision and
lock conflicts; aggregate all multi-item blockers and ordinary precondition
issues; atomic-scope-required when blockers exist; otherwise
transition-precondition-failed when ordinary issues exist; otherwise
candidate-invalid when the candidate validator reports errors. For create,
id-collision precedes path-collision as specified in section 7, and both
precede candidate-invalid. No validator issue already represented by the
selected more-specific response is duplicated in a second envelope. A proposed
ledger that remains invalid for any reason is never published.

Transition publication uses a fully written and synced same-directory
temporary file followed by the platform's existing-file atomic replacement
primitive. It then re-reads exact final bytes. This remains a local filesystem
operation without universal crash durability or hostile-writer protection.

## 9. Patch

Patch changes the caller-supplied fields common to schema versions 1 and 2 of
one existing item — nothing else. It runs under the same per-ID lock, locked re-read,
exact-byte revision compare-and-swap, candidate complete-ledger validation,
and atomic same-path publication protocol as transition (section 6), and it
shares transition's envelopes, exits, and recovery rules except where this
section says otherwise.

### Request

Patch accepts exactly:

~~~json
{
  "id": "wb_...",
  "expected_revision": "sha256:...",
  "date": "2030-01-11",
  "set": { "priority": 3, "number": null }
}
~~~

| Member | Required | Rules |
|---|---:|---|
| id | Yes | Canonical existing item ID. |
| expected_revision | Yes | Exact lowercase SHA-256 token returned by inspect. |
| date | Yes | ISO calendar date not earlier than existing created or updated. |
| set | Yes | Mapping naming at least one patchable field. |

The patchable field set is exactly `number` and `priority`. A set member
outside it is an invalid-request issue at its /set pointer — the boundary is
stated here, not discovered from the implementation. An integer value sets
the field: number must be a positive integer, priority a non-negative
integer. null removes the field.

Patch sets updated to request.date. A date earlier than the existing created
or updated date returns patch-precondition-failed, exit 2, and unchanged,
with date-before-created and date-before-updated issue codes matching
transition's, including the item_created and item_updated members. The same
UTC ULID derivation applies: an item created just after midnight UTC refuses
the operator's local calendar date here too.

Patch appends no decision: the ledger's Git history is the audit trail for a
consumer-field change. Identity, lifecycle, title, relations, provenance,
snooze, decisions, body, and extension members cannot change through patch.

Patch never mutates another item. A candidate ledger that flags any other
item — for example a duplicate-number collision with an existing handle —
returns candidate-invalid, exit 2, and unchanged, and both items keep their
bytes.

### Serialization

An updated field is rewritten in place. A newly added number serializes
directly after id; a newly added priority directly after kind. Body bytes and
extension nodes are preserved exactly as in transition.

### Adapter advertisement

The version 1 capabilities envelope and the version 1 adapter core probe do
not advertise patch. Their operation and command lists are pinned by the
version 1 adapter contract, so widening them is an adapter contract version
change. Version 2 makes that change: its capability envelope includes the exact
`operations.patch` member from section 4 and adapter contract version 2 inserts
`patch` between `inspect` and `ready` in the fixed core-command order. The
fail-closed direction is preserved: a version 1 consumer never sees the wider
surface, and automation that plans from version 1 capabilities does not use
patch.

## 10. Errors, artifacts, and recovery

### Stable error details

| Code | Required details |
|---|---|
| invalid-request | issues |
| item-not-found | id |
| ledger-invalid | validation_errors |
| transition-precondition-failed | id, issues |
| patch-precondition-failed | id, issues |
| candidate-invalid | id, validation_errors |
| revision-conflict | id, expected_revision, actual_revision |
| lock-held | id, lock_path, owner, owner_diagnostic |
| id-collision | id, path, actual_revision |
| path-collision | id, path, occupant_kind; occupying_id iff occupant_kind is item |
| atomic-scope-required | id, blockers, precondition_issues |
| capability-unavailable | capability, reason, recovery_artifacts, recovery_artifacts_truncated |
| operation-failed | id, operation, reason, recovery_artifacts, recovery_artifacts_truncated |
| post-commit-recovery-required | id, revision, recovery_artifacts, recovery_artifacts_truncated |
| write-outcome-unknown | id, recovery_artifacts, recovery_artifacts_truncated |

ledger-invalid and candidate-invalid validation_errors are exactly the
deterministic SPEC.md error sequence for the current or proposed ledger,
respectively. Error messages are stable human summaries; automation branches
on code, mutation state, and documented details.

### Recovery artifact shape

recovery_artifacts is an array of at most 16 objects:

~~~json
{
  "path": ".wowbagger-tmp-wb_...",
  "kind": "temporary-file",
  "sha256": "sha256:<lowercase hex digest>",
  "size_bytes": 321
}
~~~

path is ledger-relative, uses forward slashes, and is at most 1024 Unicode
scalar values. kind is temporary-file, lock-file, or final-item. sha256 and
size_bytes are null when the artifact cannot be safely read; otherwise the
digest covers its exact bytes and size_bytes is a nonnegative integer.

Artifacts are unique by path and sorted by path, then kind. If more than 16 are
observed, the first 16 are returned and recovery_artifacts_truncated is true.
Otherwise it is false. No artifact content is returned.

### Deterministic operation failures and state mapping

operation-failed is a mutation-only error. operation is exactly one of:

- lock-closure;
- prepare-temporary;
- sync-temporary;
- publish;
- verify-publication; or
- cleanup.

reason is exactly retry-limit-exhausted, io-error, or verification-failed.
retry-limit-exhausted is used only with lock-closure. verification-failed is
used only when verification proves the expected publication is absent for
create or proves the original bytes remain for transition or patch. All other
handled filesystem failures use io-error. Platform exception text, errno names,
numeric OS error codes, and absolute paths are not members of the normative
JSON envelope and cannot alter operation or reason.

Before a publication attempt, lock-closure, prepare-temporary, sync-temporary,
or cleanup failure returns operation-failed with state unchanged. After a
publication attempt, the backend must inspect the final path before choosing a
response:

- exact expected final bytes produce state committed; a remaining verify or
  cleanup problem is post-commit-recovery-required;
- proven absence for create or exact original bytes for transition or patch
  produce operation-failed with state unchanged, operation publish or
  verify-publication as applicable, and reason io-error or
  verification-failed as applicable; and
- unreadable, different, or otherwise indeterminate final bytes produce
  write-outcome-unknown with state unknown.

operation-failed always contains the canonical target id and the bounded
recovery artifact fields. Its message is exactly "The mutation operation
failed before a commit was established."

A normal handled unchanged failure removes its own temporary files and locks.
A cleanup failure reports the remaining bounded artifacts. Locks are never
auto-broken by age. Clients must inspect after committed-recovery or unknown
outcomes and must not retry blindly.

## 11. Normative design vectors

The synthetic vectors under
[spec/fixtures/mutations](../spec/fixtures/mutations/README.md) are the
executable compatibility target for this contract. Each case has a manifest with
arguments, input transport, expected exit, exact stdout/stderr expectations,
and before/after file digests.

The matrix covers capability honesty; lossless inspect and failure envelopes;
caller-known create identity, file/stdin equivalence, strict input, ID and path
collision, candidate validation, body boundaries, publication limitation and
recovery outcomes; transition revision, locking, date monotonicity, lifecycle
edges, the schema version 1 dependent-cleanup blocker and the other two
multi-item reasons, terminal referrers, combined blockers,
candidate validation, deterministic operation failures, and
unchanged/committed/unknown states; and patch field boundaries, CAS,
serialization, and preconditions.

The runtime executes every vector as a black-box CLI test, including exact
response bytes and the complete before/after ledger snapshot.

## 12. Commit-per-mutation on a provisioned ledger

A ledger becomes provisioned when `provision` binds a namespace to the
repository and `claim capabilities` reports `mode: "merge-coordinated"`. On
such a ledger, `create`, `transition`, and `patch` run inside the claim
coordinator described by the [work-claim
contract](work-claim-contract.md).

### The rule

**Commit each mutation to Git before running the next mutating command.**

The coordinator records every authorized mutation in the durable journal and
validates the recorded revisions against Git `HEAD`, not against working-tree
bytes. An uncommitted mutation is therefore an unreconciled mutation, and the
next `create`, `transition`, or `patch` refuses rather than writing on top of
work that is not yet durable.

The loop that works:

~~~sh
wowbagger create --ledger <dir> --input request.json --json
git add <dir> && git commit -m "Record the mutation"
wowbagger claim-verify --ledger <dir> --json
wowbagger transition --ledger <dir> --input next.json --json
~~~

`claim-verify` is the reconciliation procedure. It is not optional bookkeeping:
it is the command that moves the journal forward to the new commit, and the
refusals below name it by design.

### The refusal

An uncommitted prior mutation makes the next mutating command return exit 6:

~~~json
{
  "ok": false,
  "namespace": "ledger-mutation",
  "command": "create-v1",
  "contract_version": 1,
  "state": "unchanged",
  "error": {
    "code": "claim-store-unavailable",
    "message": "The durable claim store is unavailable.",
    "details": {
      "reason": "publication-reconciliation-required",
      "findings": [
        {
          "code": "stale-write-detected",
          "item_id": "wb_...",
          "actual_revision": null,
          "expected_revision": "sha256:...",
          "observed_surface": "git-head",
          "reason": "git-finalization-required",
          "expected_path": "wb_....md",
          "remediation": "Commit wb_....md in Git, then run claim-verify."
        }
      ]
    }
  }
}
~~~

`state: "unchanged"` is exact: the refused command wrote nothing. Read
`details.findings`. Every finding that blocks a mutation carries a
`remediation` string, and every such string names both the path to act on and
`claim-verify`. `actual_revision: null` with `observed_surface: "git-head"`
means the authorized revision is not in `HEAD` at all, which is what an
uncommitted mutation looks like.

`spec/fixtures/mutation-refusals/uncommitted-prior-mutation/manifest.json` is
the normative envelope for this refusal.

### Reconciliation

For every blocking finding:

1. Do what `remediation` says, for each finding, using its `expected_path`.
   `git-finalization-required` means commit that path.
2. Run `wowbagger claim-verify --ledger <dir> --json`.
3. Exit 0 with `state: "committed"` means the ledger is reconciled and the next
   mutating command may run. Exit 6 means findings remain; repeat from step 1.

The reasons a `stale-write-detected` finding can carry, and the other blocking
finding codes, are enumerated in the [work-claim
contract](work-claim-contract.md).

### Rejected alternative: validate against working-tree bytes

The obvious way to remove this friction is to validate recorded revisions
against the working tree instead of Git `HEAD`. It was considered and
rejected.

The journal exists to make a mutation durable and reviewable. Working-tree
bytes are neither: they are unpublished, unshared, and one `git checkout` away
from vanishing. Validating against them would let the coordinator declare a
mutation reconciled while nothing outside one uncommitted directory records it,
which is precisely the guarantee the journal is for. It would also make a
cooperating worktree unable to tell an authorized publication from a local
edit, because both look identical in a working tree.

The invariant stays. What changed is its visibility: it is stated here, in the
work-claim contract, in the README workflow, and in the installed skill's
loops, and every blocking finding now names its own remedy.
