# Local mutation contract

Status: implemented by the pre-alpha standalone local-filesystem runtime.

This document defines the machine contract implemented by the local-filesystem
mutation backend. It supplements [SPEC.md](../SPEC.md) and
[ADR 0003](adr/0003-local-mutation-and-cas.md); it does not relax schema version
1 lifecycle invariants.

The executable supports `validate`, `ready`, and the commands below. Clients
must still call `capabilities` and honor its advertised limits before assuming a
backend can provide a particular write guarantee.

## 1. Scope

The contract keeps five concerns separate:

- capabilities describes guarantees and limitations;
- inspect reads one item and returns a revision from the same bytes it exposes;
- create publishes one caller-identified triage item;
- patch changes a narrow set of frontmatter fields under a guarded replacement;
  and
- transition changes one existing item through a guarded lifecycle edge.

Work claiming is unsupported. A write lock protects a short mutation attempt;
it is not a claim, assignment, lease, or reservation. The separate [fenced
work-claim contract](work-claim-contract.md) defines a future backend protocol;
it does not add a member or guarantee to these version 1 requests.

If a future backend advertises safely fenced claims while retaining these
legacy entry points, it must run them through the same coordinator: patch and
transition refuse an active claimed `(ledger_namespace, item_id)` and create
refuses an identity with claim history. Until then, the local runtime's
unsupported capability is authoritative; callers cannot combine this API with
an external claim hint and infer fencing.

The first backend coordinates only cooperative Wowbagger writers using the same
ledger directory in one working copy. It does not coordinate clones, worktrees,
machines, hostile or non-cooperating writers, or Git operations. Its write
scope is one Markdown item and it has no multi-item atomicity.

Schema version 1 remains canonical Markdown. Revision and lock data are
transport state and are not persisted in item frontmatter.

## 2. Commands and transport

The local commands are:

~~~text
wowbagger capabilities --json
wowbagger inspect --ledger <dir> --id <id> --json
wowbagger create --ledger <dir> --input <json-file|-> --json
wowbagger patch --ledger <dir> --input <json-file|-> --json
wowbagger transition --ledger <dir> --input <json-file|-> --json
~~~

A dash for --input means standard input. File and standard-input requests have
identical semantics. Request bytes must be valid UTF-8 JSON with one top-level
object and no duplicate member names at any depth. Duplicate members are
invalid; a parser must not apply last-member-wins behaviour.

Unknown, missing, and repeated command arguments are invalid-request. Create,
patch, and transition use JSON input rather than parallel field flags.

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
recovery rules in section 9.

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

A successful create or transition has state committed. A successful patch has
state committed or unchanged and adds state:

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

Every create, patch, or transition error has a state member:

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
| 2 | Argument, request, lookup, candidate/lifecycle-precondition, or unsafe YAML mutation failure. | invalid-request, item-not-found, transition-precondition-failed, candidate-invalid, unsafe-yaml-mutation |
| 3 | The complete configured ledger is invalid. | ledger-invalid |
| 4 | Cooperative comparison, lock, identity, or default-path conflict. | revision-conflict, lock-held, id-collision, path-collision |
| 5 | The backend lacks the required capability or write scope. | atomic-scope-required, capability-unavailable |
| 6 | An unexpected operating or post-publication recovery condition. | operation-failed, post-commit-recovery-required, write-outcome-unknown |

Only exit 0 is normal completion. A client must inspect mutation state on every
nonzero create, patch, or transition result.

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
      "patch": {
        "supported": true,
        "write_scope": "single-item",
        "cas_scope": "exact-byte-sha256"
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
  "path": "wb_....md",
  "revision": "sha256:<lowercase hex digest>",
  "source_encoding": "base64",
  "source_media_type": "text/markdown; charset=utf-8",
  "source_base64": "<RFC 4648 base64 without line breaks>",
  "core": {},
  "body": "exact decoded body suffix"
}
~~~

No frontmatter field is promoted to the item level. Every frontmatter field
that core carries is read from item.core, including id, title, and status. The
item-level path, revision, body, source_base64, source_encoding, and
source_media_type members describe the file envelope rather than its
frontmatter.

core is a fixed normalized view, not the whole frontmatter. The member list
below is exhaustive. A frontmatter field outside that list, including priority
and number, is absent from core and is recoverable only from source_base64.

path is a forward-slash, ledger-relative display path and is not identity.
Decoding source_base64 recovers every original byte. The decoded bytes must
hash to revision and must be valid UTF-8.

core contains only schema version 1 fields:

- schema_version, id, title, kind, status, created, updated;
- provenance.source and provenance.recorded_at;
- depends_on and related;
- optional parent, snoozed_until, completed, killed, archived; and
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
Patch locks the target and the old and proposed parent and dependency IDs.
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
Patch and transition compare expected_revision only after this locked re-read.

Patch and transition construct an in-memory complete ledger with exactly the
proposed target bytes substituted, then run complete-ledger validation again
before publication. If another item would need mutation, the target is not
published.

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
create, patch, or transition. The remaining values must match their schema and
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
| item.title | Yes | Non-empty schema version 1 string. |
| item.kind | Yes | task or epic. |
| item.provenance | Yes | Valid required provenance; extension members are preserved. |
| item.depends_on | Yes | Valid relation list. |
| item.related | No | Valid relation list; omitted means empty. |
| item.parent | No | Valid epic ID. |
| item.snoozed_until | No | Valid ISO calendar date. |
| item extension members | No | Permitted schema extensions. |
| body | Yes | JSON string; empty and LF-leading strings are distinct and valid. |

If a file named by `--input` cannot be read before a request ID is known,
create, patch, or transition returns `invalid-request` with one `invalid-value`
issue at `/input`, the stable message `Request input could not be read.`, and
mutation state `unchanged`.

The caller generates id with the timestamp for the intended creation instant
and at least 80 bits of collision-resistant entropy. Create validates its
canonical form before acquiring its per-ID lock. id is not accepted inside
item.

item must not supply schema_version, id, status, created, updated, completed,
killed, archived, decisions, or body. Create inserts schema_version 1, status
triage, created and updated equal to the UTC date encoded by id, and related []
when omitted. It adds no terminal date or decision.

The refusal for a supplied status states the assigned status and the accepting
step, so a caller who tries to set it learns the rule from the refusal rather
than from an empty ready result.

The candidate complete ledger must validate before publication. After the
requested-ID lock and locked revalidation, create applies this collision
precedence:

1. If the requested ID exists anywhere in the ledger, return id-collision,
   exit 4, and unchanged. details contain id, the existing item's
   ledger-relative path, and actual_revision.
2. Otherwise, lstat the default path without following symbolic links. If any
   filesystem object occupies it, return path-collision, exit 4, and unchanged.
   details contain id, the ledger-relative default path, and occupant_kind.
   occupant_kind is exactly item or directory. For item it also contains
   occupying_id; for directory occupying_id is absent. The message is exactly
   "The default item path is occupied by a different item." This stable human
   message is shared by both kinds; automation distinguishes them through
   occupant_kind.
3. Otherwise, continue to candidate validation.

Create never chooses a different ID or path for the caller. Collision checks
do not infer identity from a filename: an item whose frontmatter has another
ID occupies a path without claiming the requested ID. Complete-ledger
validation precedes these collision checks. A symbolic link, special file, or
invalid regular .md occupant therefore produces ledger-invalid rather than
path-collision. A real directory whose name ends in .md and whose contents
leave the complete ledger valid is valid input under SPEC.md and produces
path-collision when it occupies the default path.

The default final path is:

    <ledger>/<id>.md

The filename is a portable default, not identity. The request cannot supply an
arbitrary path.

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
section 5, with no additional members.

The status create assigned is reported at item.core.status, which is always
triage. A triage item is not eligible for ready. To accept it, call transition
with to_status backlog and the required accept decision. A caller that reads
only the returned JSON therefore learns both the assigned status and why the
new item is absent from ready, without decoding source_base64.

Create does not repeat the status at the item level. Per section 5 no
frontmatter field is promoted, and a member whose only possible value is triage
would carry no information.

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
items do not reopen. Transition cannot supply a frontmatter patch. Use patch
for the fields listed in section 8A.

### Lossless preservation

Transition locates each changed root key/value pair from the parsed YAML source
ranges and splices only those byte ranges. A removed field loses its complete
pair range and line terminator. A new terminal field is inserted after updated.
A missing decisions block is inserted at its schema slot relative to
controlled fields, before any extension that already follows that slot. An
extension that appears early keeps its existing position. Every byte outside
those edits is copied from the original source without
serialization. This includes comments, tags, anchors, aliases, blank lines,
flow spacing, indentation, key order, scalar spelling, extension data, and the
body.

Appending a decision inserts one newly serialized sequence item after the last
existing item. It does not serialize any prior decision item. Existing decision
bytes are therefore append-only evidence. A missing decisions field inserts a
new block at the controlled-metadata boundary without moving extension fields.

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
validates it completely before publication. The parsed candidate must exactly
equal the complete requested successor, including operator and provenance
extension members. Unchanged root nodes and all extension nodes must retain
exact source identity. Every byte outside the serializer's declared edit
ranges must equal the source, including prior decisions and the body. Missing
or invalid edit-range evidence is a candidate-validation failure; it never
disables the byte comparison.

Every item whose depends_on contains the target is considered when the target
would become done, killed, or archived, regardless of the referring item's own
status. Every direct child is considered for an epic transition. The backend
does not limit relation checks to ready or non-terminal referring items.

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
      "related_ids": []
    }
  ]
}
~~~

Issue codes are date-before-created, date-before-updated, invalid-edge,
live-dependencies, or nonterminal-children. related_ids are unique immutable IDs
sorted ascending. Issues sort by code, then field, then their related ID
sequence. Date checks are all reported: a date earlier than both created and
updated produces both date issues.

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
| dependent-cleanup | A done target is still present in another item's depends_on, regardless of that item's status. |
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
a proposed single-item create, patch, or transition for a reason not already
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

## 8A. Patch

Patch is a guarded single-item frontmatter replacement. It uses the same
per-ID lock closure, locked complete-ledger re-read, exact-byte revision
compare-and-swap, candidate validation, atomic replacement, and publication
verification as transition.

### Request

Patch accepts exactly:

~~~json
{
  "id": "wb_...",
  "expected_revision": "sha256:<64 lowercase hexadecimal characters>",
  "patch": {
    "priority": 3
  },
  "date": "2030-01-11",
  "decision": {
    "summary": "Raise the survey priority.",
    "rationale": "The survey now blocks the next planning pass."
  }
}
~~~

| Member | Required | Rules |
|---|---:|---|
| id | Yes | Canonical existing item ID. |
| expected_revision | Yes | Exact lowercase SHA-256 token returned by inspect. |
| patch | Yes | Nonempty object containing only the patchable fields below. |
| date | Yes | ISO calendar date used for updated and the appended decision. |
| decision | Yes | Object containing exactly summary and rationale. |
| decision.summary | Yes | Non-empty string. |
| decision.rationale | Yes | Non-empty string. |

### Exact patchable field set

The patchable fields are exactly `priority`, `number`, `parent`, `depends_on`,
and `title`:

| Field | Patch value |
|---|---|
| priority | A non-negative integer; null removes the field. |
| number | A positive integer; null removes the field. |
| parent | A canonical item ID; null removes the field. |
| depends_on | A complete replacement array of canonical item IDs; an empty array clears it. |
| title | A non-empty string. |

The JSON spellings `-0`, fractional forms such as `7.0`, and exponent forms
such as `1e2` are not integer patch values, even when JavaScript converts them
to an integer-valued Number.

The set is deliberately narrow. Patch does not accept `id`, `schema_version`,
or `created`, because they define identity, schema interpretation, and creation
history. It does not accept `status` or terminal dates, which belong to
transition; `updated`, which is derived from request.date; or `decisions`, which
is append-only and generated by this operation. It does not accept provenance,
kind, related, snoozed_until, extension fields, or body in this first contract.
Unknown patch members are invalid-request; they are not ignored.

Every successful patch sets updated to request.date and appends exactly one
decision with action `record`, date request.date, and the supplied summary and
rationale. Complete-ledger validation remains authoritative, including date
invariants. In particular, because patch does not alter terminal dates, a
terminal item can only be patched with a date that keeps its terminal date and
updated valid.

A patch that would change nothing is refused. If every requested patchable field
already holds the requested value, including clearing an optional field that is
already absent, patch returns invalid-request, exit 2, and state unchanged. It
publishes no bytes, changes no revision, and appends no decision.

The refusal is checked last, so a request that is also wrong for a stronger
reason reports that reason instead. Patch therefore has exactly one success
exit: no request reaches it without passing every check, and no decision records
a change that did not happen.

### Refusal and publication

After locked revalidation, a revision mismatch returns revision-conflict,
exit 4, and unchanged. Missing relation targets, dependency cycles, duplicate
numbers, date violations, and other invalid complete-ledger proposals return
candidate-invalid, exit 2, and unchanged with the exact validator errors.

Changing a child's parent into or out of a done epic would also require
changing that epic's recorded completion rollup. Patch therefore returns
atomic-scope-required, exit 5, and unchanged, with a `child-disposition`
blocker for each affected done epic and an empty precondition_issues array.
Patch never silently updates another item.

Patch uses the same source-range splice rules as transition. It replaces only
the named patch field pairs, the derived updated pair, and the new decision
insertion. A removed pair includes its line terminator. A newly present patch
field is inserted at its schema slot relative to controlled fields, before
decisions and before any extension that already follows that slot. An extension
that appears early keeps its existing position. Every other source byte is
copied verbatim. Publication uses the same fully written and synced
same-directory temporary file, existing-file atomic replacement, exact-byte
read-back, and recovery mapping as transition.

Before publication, the parsed candidate must exactly equal the complete
requested successor, including operator and provenance extension members.
Unchanged root nodes and all extension nodes must retain exact source identity.
Every byte outside the serializer's declared edit ranges must equal the source,
including prior decisions and the body. The complete proposed ledger must also
validate.

Patch and transition return unsafe-yaml-mutation, exit 2, and unchanged when a
changed field contains an anchor that an alias outside that field references.
Changing only the pair bytes would otherwise change the decoded value of an
unmodified field. They also return this error when decisions is an alias,
because detaching it would copy or rewrite prior decision evidence. The exact
message is "The mutation cannot safely edit YAML whose alias semantics cross an
edited byte range. Hand-edit the item at details.path to remove the cross-field
anchor or alias, run validate, then retry." Details contain exactly id, path,
field, and reason.
reason is anchor-referenced-outside-field or decisions-alias. Comments, tags,
unrelated anchors and aliases, and unreferenced anchors do not cause refusal.

## 9. Errors, artifacts, and recovery

### Stable error details

| Code | Required details |
|---|---|
| invalid-request | issues |
| item-not-found | id |
| ledger-invalid | validation_errors |
| transition-precondition-failed | id, issues |
| candidate-invalid | id, validation_errors |
| unsafe-yaml-mutation | id, path, field, reason |
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
respectively. candidate-invalid always has the exact message "The proposed item
would make the ledger invalid." unsafe-yaml-mutation is the permanent source
representation refusal above and never uses validation_errors. Error messages
are stable human summaries; automation branches on code, mutation state, and
documented details.

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
- cleanup; or
- serialize-candidate.

reason is exactly retry-limit-exhausted, io-error, verification-failed, or
internal-error.
retry-limit-exhausted is used only with lock-closure. verification-failed is
used only when verification proves the expected publication is absent for
create or proves the original bytes remain for patch or transition. All other handled
filesystem failures use io-error. Platform exception text, errno names,
numeric OS error codes, and absolute paths are not members of the normative
JSON envelope and cannot alter operation or reason.

internal-error is used only with serialize-candidate. It reports an unexpected
serializer or range-writer defect as operation-failed instead of blaming item
data. The envelope does not include exception text.

Before a publication attempt, lock-closure, prepare-temporary, sync-temporary,
or cleanup failure returns operation-failed with state unchanged. After a
publication attempt, the backend must inspect the final path before choosing a
response:

- exact expected final bytes produce state committed; a remaining verify or
  cleanup problem is post-commit-recovery-required;
- proven absence for create or exact original bytes for patch or transition produce
  operation-failed with state unchanged, operation publish or
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

## 10. Normative design vectors

The synthetic vectors under
[spec/fixtures/mutations](../spec/fixtures/mutations/README.md) are the
executable compatibility target for this contract. Each case has a manifest with
arguments, input transport, expected exit, exact stdout/stderr expectations,
and before/after file digests.

The matrix covers capability honesty; lossless inspect and failure envelopes;
caller-known create identity, file/stdin equivalence, strict input, ID and path
collision, candidate validation, body boundaries, publication limitation and
recovery outcomes; transition revision, locking, date monotonicity, lifecycle
edges, all three multi-item reasons, terminal referrers, combined blockers, and
candidate validation; patch successful existing-value replacement, revision and
lock refusal, multi-item refusal, exact-field validation, required decision
evidence, non-canonical integer-token refusal, and candidate validation,
plus the permanent unsafe-yaml-mutation refusal;
deterministic operation failures; and
unchanged/committed/unknown states.

The runtime executes every vector as a black-box CLI test, including exact
response bytes and the complete before/after ledger snapshot.
