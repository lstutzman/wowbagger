# Local mutation contract

Status: versions 1 through 5 are defined; the pre-alpha standalone
local-filesystem runtime currently emits version 5.

This document defines the machine contract implemented by the local-filesystem
mutation backend. It supplements [SPEC.md](../SPEC.md) and
[ADR 0003](adr/0003-local-mutation-and-cas.md); it does not relax schema version
1 or 2 lifecycle invariants.

The executable supports `validate`, `ready`, and the commands below. Clients
must still call `capabilities` and honor its advertised limits before assuming a
backend can provide a particular write guarantee. A non-agent consumer that
launches this executable directly reads
[docs/host-contract.md](host-contract.md) for the package seam, the process
tuple, and the packaged JSON Schemas.

## Contract versions

Version 1 remains the frozen contract described by the version 1 envelopes and
capability example below. Version 2 retained every version 1 request, response,
state, exit, locking, CAS, publication, and recovery rule except for these
explicit deltas:

- every core command envelope carried `contract_version: 2`;
- one non-empty ledger may use schema version 1 or schema version 2, but never a
  mixture;
- the capability envelope uses the fixed local mutation scope described in
  section 4 and advertises `patch`; and
- adapter contract version 2 may invoke `patch` as an approved mutation.

### Version 3

Version 3 retains every version 2 request, response, state, exit, locking, CAS,
publication, and recovery rule except for these explicit deltas, which are the
complete difference against published version 2 (`0.1.0-alpha.4`):

- every core command envelope carries `contract_version: 3`;
- **the widened date-refusal issue shape.** `date-before-created` and
  `date-before-updated` carry `item_created` and `item_updated` after
  `related_ids`, on `transition` and `patch` alike (section 7). These two codes
  are the only ones that carry them; every other issue code keeps its
  four-member shape. This is the delta that requires the bump: a version 2
  consumer that validates issue members exactly refuses the six-member shape,
  so the version 2 compatibility argument below no longer holds for these two
  codes;
- **the widened patch field set.** The patchable set is `priority`,
  `depends_on`, and `related`, replacing version 2's `number` and `priority`
  (section 9). A relation value replaces the whole list; `null` removes the
  field, and removing the required `depends_on` returns `candidate-invalid`.
  Relations patches ride the same lock, CAS, candidate-validation, publication,
  and claim rules as any other patch;
- **number as item identity on schema version 2.** The core assigns `number` at
  `create` as one more than the highest existing number; a `create` request
  that supplies one is refused, `number` is no longer patchable, and `inspect`
  accepts `--number <n>` as an alternative selector to `--id`. Schema version 1
  ledgers are unaffected; and
- **the patchable body.** `body` joins the patchable set as a JSON string that
  replaces the whole body under create's body rules; `null` is refused at
  `/set/body` rather than removing anything, and the frontmatter bytes survive
  a body swap untouched (section 9). The version stays 3: this widens the patch
  request schema exactly as the relations delta above did, and no response
  envelope member is added, removed, or renamed. A version 3 consumer that
  never sends `body` cannot observe the difference, so the version 2 to 3
  compatibility argument is unaffected and the version does not move again;
- **the configured item directory.** `create` derives the published path from
  the committed `<ledger>/.wowbagger/layout.json`, and validation rejects a
  parsed item outside it (section 5). A ledger without that file keeps the
  version 2 `<ledger>/<id>.md` path. `create` refuses the new
  `items-directory-unavailable`, exit 2, `unchanged`, when the configured
  directory is not an existing directory (section 7); and
- **the diagnosable inspect refusal.** An `inspect` `ledger-invalid` refusal may
  carry `details.item`, the lossless snapshot of the item the request selected,
  when that item resolves and no validation error names its path (section 5).
  The version stays 3: this widens one read-only refusal's details on one
  command, and version 3 is not yet published, so no consumer can have
  negotiated the narrower shape. A consumer that reads only
  `details.validation_errors` cannot observe the difference; a consumer that
  matches `ledger-invalid` details exactly must accept the optional member on
  `inspect`, which is why this is listed as a delta rather than left silent; and
- **the patchable title.** `title` joins the patchable set as a non-empty
  schema string that replaces the current title whole (section 9), and section
  9 gains the frontmatter ownership table that states, member by member, which
  members are core-owned, which are consumer-editable through `patch`, and
  which are create-once. The version stays 3 by the same argument the relations
  and body deltas used: this widens the patch request schema, and adds, removes,
  and renames no response envelope member. **Version 3 is published, so state
  the consequence plainly: a consumer probing for title-patch support cannot
  distinguish `0.1.0-alpha.5` from this build by contract version.** Both emit
  `contract_version: 3`, and `0.1.0-alpha.5` refuses `set.title` as an unknown
  member. The next release is the real carrier. A consumer that must know
  before it sends either reads the release version or sends a title patch on a
  scratch item and reads the refusal — the version field will not answer, and
  no member of the capability envelope was widened to make it answer; and
- **the documented inspect selector detail.** An `inspect` `item-not-found`
  refusal carries the selector the request used — `details.id` for `--id`,
  `details.number` for `--number` (section 5). This entry documents an already
  published wire; it does not change one. `--number` and this refusal shipped
  together in `0.1.0-alpha.5`, the release that published version 3, and that
  release already emits `{"number": N}` here. No emitted byte moves, and no
  version 2 consumer can have negotiated the narrower shape, because version 2
  had no `--number` selector to reach it. What was wrong was the prose: section
  5 claimed these details contain only `id` from the day `--number` shipped.
  The version stays 3; and
- **the appendable body.** `body_append` joins the patch request as a JSON
  string appended after the current body, mutually exclusive with `body` in one
  request, `null` refused at `/set/body_append` (section 9). The version stays
  3 by the same argument the `body` delta makes: it widens the patch request
  schema, adds, removes, and renames no response envelope member, and a
  consumer that never sends it cannot observe the difference. The honesty this
  entry owes is the other half. Version 3 is **published** — `0.1.0-alpha.5`
  released it, and that release has no `body_append` — so a consumer **cannot**
  probe for append support by reading `contract_version`. The core that lacks
  it and the core that carries it both report 3. A consumer that needs append
  either pins the distribution version, where the first release after
  `0.1.0-alpha.5` carries it, or sends an append and reads the refusal: a core
  without it answers `invalid-request` with an `unknown-member` issue at
  `/set/body_append`, exit 2, `unchanged`, so the probe costs nothing and
  changes no byte.

- **the patchable extension member.** `set.extensions` joins the patch request
  as a container whose members name consumer-owned extension members and whose
  values replace each named member whole (section 9). The fixed `set` allowlist
  is unchanged: `extensions` is one more name on it, not an opening for
  arbitrary keys, so a typo outside the allowlist is still an
  `unknown-member` issue. Which members the container may name comes from the
  committed `<ledger>/.wowbagger/extensions.json`, so a ledger without that
  file has no patchable extension member at all. Five
  `patch-precondition-failed` issue codes join the contract:
  `extension-declaration-missing`, `extension-declaration-invalid`,
  `extension-not-declared`, `extension-value-invalid`, and
  `extension-anchored`. The issue **shape** does not move — all five carry
  exactly `code`, `field`, `message`, and `related_ids`, the four-member shape
  every non-date code keeps — so this is not the class of change that forced
  the version 2 to 3 bump. A version 3 consumer that enumerates patch issue
  codes exactly must accept the five; one that branches on `error.code` alone
  cannot observe them. The version stays 3 by the argument the relations, body,
  title, and append deltas made: it widens the patch request schema, adds,
  removes, and renames no response envelope member, and a consumer that never
  sends `set.extensions` cannot observe the difference. The honesty this entry
  owes is the published half. Version 3 is **published** — `0.1.0-alpha.5`
  released it and has no `set.extensions` — so `contract_version` cannot
  answer whether a core carries this path. A consumer that must know either
  pins the distribution version, where the first release after
  `0.1.0-alpha.5` carries it, or sends an extension patch on a scratch item and
  reads the refusal: a core without it answers `invalid-request` with an
  `unknown-member` issue at `/set/extensions`, exit 2, `unchanged`, so the
  probe costs nothing and changes no byte.

Two version-2-era changes are deliberately **not** version 3 deltas. The
section 2 envelope rule documents the wire that versions 1, 2, and 3 all emit:
it adds no member, removes none, and renames none, so it is not a version
delta. What changed is that the rule is now stated once, the `ledger-mutation`
domain is named, and `spec/fixtures/envelope-domains/manifest.json` pins every
response class. The `claim capabilities` backend now advertises
`result.backend.write_serialization`, which belongs to the work-claim version
domain and leaves the core capability envelope unchanged.

A version 1 or version 2 consumer fails closed against a version 3 core: it
reads `contract_version: 3` from `capabilities --json`, does not recognize it,
and stops. That is the intended outcome, not a regression.

### Version 4

Version 4 retained every version 3 request, response, state, exit, locking,
CAS, publication, and recovery rule except for these explicit deltas, which are
the complete difference against published version 3 (`0.1.0-alpha.6`):

- every core command envelope carries `contract_version: 4`;
- **the bounded item source.** `MAX_ITEM_SOURCE_BYTES` is 8,388,608 and bounds
  the complete serialized item source at every candidate door: `create`,
  `transition`, and `patch` in this contract, and `publish-claimed` in the
  work-claim contract. A successor over the bound returns the new refusal
  `item-source-too-large`, exit 2, `unchanged` (section 10). This is the delta
  that requires the bump: version 3 accepted an item of any size, so this
  narrows accepted input against a published version and every version 3
  consumer must fail closed rather than discover the bound at a refusal; and
- **the advertised bound.** `result.limits.max_item_source_bytes` carries the
  same value in the capability envelope (section 4). A version 3 consumer that
  validated `result.limits` by exact members refuses the new member, which is
  the same fail-closed outcome the version field already produces.

Nothing else moves. The bound is not retrofitted to reads: an item already
committed above it still validates, still inspects, and can still be repaired
by a patch whose successor is at or below the bound.

A version 3 consumer fails closed against a version 4 core the same way: it
reads `contract_version: 4` from `capabilities --json`, does not recognize it,
and stops.

The bootstrap wire, adapter approval, instruction, handoff, and fixture-format
versions are separate version domains and remain version 1. The adapter
contract remains version 2. The work-claim API moves to 2 with this release,
for its own reason stated in
[the work-claim contract](work-claim-contract.md), section 6: the item-source
refusal replaces the version 1 error that an oversized candidate used to
receive.

Version negotiation uses distinct existing fields. A core consumer MUST read
the top-level `contract_version` from `capabilities --json`. A work-claim
consumer MUST read `result.operations.work_claim.api_version` from
`claim capabilities --ledger <dir> --json`. It MUST NOT compare a claim
response's top-level `contract_version` with the core version. That claim member
remains the legacy envelope marker, which is `1` and does not move with the
work-claim API version.

This rule is the migration path for generic consumers: dispatch by response
domain first, then check the version field for that domain. Section 2 states
the domains, the exact dispatch steps, and the two sanctioned exceptions. No
root envelope member changes across versions 1, 2, 3, and 4, so a consumer that
matches root members exactly still matches; a consumer that matches issue
members exactly must negotiate version 3 before reading a date refusal, and a
consumer that must not have its accepted input narrowed underneath it must
negotiate version 4 before writing an item.

### Version 5

Version 5 is the version this document defines and the runtime emits. It
retains every version 4 request, response, state, exit, locking, CAS,
publication, and recovery rule except for these explicit deltas, which are the
complete difference against published version 4 (`0.1.0-alpha.7`):

- every core command envelope carries `contract_version: 5`;
- **the bounded list operation.** `list` is a new read-only core command
  (section 5.1). It enumerates a validated ledger as bounded item summaries
  under closed filters, one selected sort field, and cursor pagination. It adds
  the refusals `list-snapshot-changed` (exit 4) and `list-response-too-large`
  (exit 2);
- **the advertised list bounds.** `result.operations.list` and four new
  `result.limits` members carry the list contract's exact numbers (section 4).
  A version 4 consumer that validated `result.operations` or `result.limits` by
  exact members refuses the new members, which is the same fail-closed outcome
  the version field already produces;
- **the bounded workbench projection.** `inspect` accepts the opt-in flag pair
  `--workbench --as-of YYYY-MM-DD` and answers with a bounded per-item lifecycle
  affordance projection under `result.workbench` (section 5.2). It adds the
  refusal `workbench-response-too-large` (exit 2) and the advertisement
  `result.operations.inspect.workbench` with three new `result.limits` members
  (section 4). An `inspect` invocation without `--workbench` keeps its exact
  result members and its exact bytes; and
- **named custom report views.** `report` accepts an optional `--view <name>`
  against report configuration `report_version: 2`, adds `result.view` to a
  named success, adds the refusal `report-view-not-found` (exit 2), and is
  advertised at `result.operations.report` (section 4). An invocation without
  `--view` keeps its exact result members and its exact bytes under either
  configuration version.

Nothing else moves. `validate` and `ready` carry no version member and their
bytes are unchanged. `create`, `transition`, `patch`, `mint-id`, and
`capabilities` change only in the `contract_version` number, and an `inspect`
invocation without `--workbench` changes only in that number too: no root
member, result member, issue member, error code, or exit meaning of an existing
invocation changes.

A version 4 consumer fails closed against a version 5 core the same way: it
reads `contract_version: 5` from `capabilities --json`, does not recognize it,
and stops.

The bootstrap wire, adapter approval, instruction, handoff, and fixture-format
versions are separate version domains and remain version 1. The adapter
contract remains version 2 and the work-claim API remains version 2. The list
query and the workbench projection each have their own version domain,
`query_version` and `projection_version`, both `1`: a consumer negotiates them
through `result.operations.list.query_version` and
`result.operations.inspect.workbench.projection_version`, not through the core
contract version.

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
not add a fencing guarantee to any mutation-contract version.

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
wowbagger inspect --ledger <dir> --id <id> --workbench --as-of YYYY-MM-DD --json
wowbagger list --ledger <dir> --input <json-file|-> --json
wowbagger create --ledger <dir> --input <json-file|-> --json [--auto-commit]
wowbagger transition --ledger <dir> --input <json-file|-> --json [--auto-commit]
wowbagger patch --ledger <dir> --input <json-file|-> --json [--auto-commit]
wowbagger mint-id [--date YYYY-MM-DD] --json
wowbagger mutation-finalize --ledger <dir> --recovery-token <token> --json
~~~

`--auto-commit` is a bare opt-in flag. It is accepted once on `create`,
`transition`, `patch`, and `publish-claimed`, and it is an unknown argument
everywhere else. Repeating it is `invalid-request`. Section 13 defines what it
does. Without it, every existing invocation keeps its exact stdout, exit,
files, index, and Git `HEAD`.

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

### Response domains and the dispatch rule

Every --json response belongs to exactly one response domain. A domain owns its
own version field, its own command names, and its own root members. This is the
one envelope rule, and every surface follows it.

A consumer dispatches on the root `namespace` member first, then reads the
version field that the selected domain names. It must not dispatch on `command`
first: two domains both answer to `capabilities`, and one core command can
answer in two domains.

| Domain | Root `namespace` | `contract_version` | Version to negotiate |
|---|---|---|---|
| core | absent | 5 | top-level `contract_version` of `capabilities --json` |
| work-claim | `work-claim` | 1, the legacy envelope marker | `result.operations.work_claim.api_version` of `claim capabilities --json` |
| ledger-publication | `ledger-publication` | 1, the legacy envelope marker | the same work-claim `api_version` |
| ledger-mutation | `ledger-mutation` | 1, the legacy envelope marker | the same work-claim `api_version` |
| bare result | absent, and no `ok` member either | none | none |

The rule has three steps:

1. A response with a root `namespace` member belongs to the domain that member
   names.
2. A response with no `namespace` member but a root `ok` member belongs to the
   core domain. Its `contract_version` is this contract's version.
3. A response with neither is a bare result. Only `validate` and `ready` emit
   one.

A claim-domain `contract_version: 1` is not this contract's version 1. It is the
legacy claim-envelope marker, and a consumer must never compare it with the core
`contract_version`.

**Which command answers in which domain**

| Command | Success | Refusals |
|---|---|---|
| `validate` | bare result `{valid, errors}` | bare result `{valid, errors}`, exit 1 |
| `ready` | bare result `{as_of, valid, ready}` | bare result `{valid, errors}` on an invalid ledger, exit 1 |
| `capabilities` | core | core |
| `inspect` | core | core |
| `list` | core | core |
| `mint-id` | core | core |
| `report` | core | core |
| `create` | core | core, or ledger-mutation when the claim fence refuses |
| `transition` | core | core, or ledger-mutation when the claim fence refuses |
| `parent-migrate` | core | core, or ledger-mutation when the claim fence refuses |
| `snooze` | core | core, or ledger-mutation when the claim fence refuses |
| `patch` | core | core, or ledger-mutation when the claim fence refuses |
| `extensions-provision` | core | core |
| `provision` | work-claim | work-claim |
| `claim capabilities/read/acquire/renew/release` | work-claim | work-claim |
| `claim-verify` | work-claim | work-claim |
| `claim-merge-verify` | work-claim | work-claim |
| `claim-sync` | work-claim | work-claim |
| `claim-adopt` | work-claim | work-claim |
| `mutation-finalize` | work-claim | work-claim |
| `claim verify` | ledger-publication, `command: "read"` | ledger-publication |
| `publish-claimed` | ledger-publication | ledger-publication |

**Exact root members**

A core response has exactly `ok`, `command`, `contract_version`, and one of
`result` or `error`; `create`, `transition`, and `patch` add `state`. A
claim-domain response has exactly `ok`, `namespace`, `command`,
`contract_version`, `state`, and one of `result` or `error`; a `claim
capabilities` response omits `state`, and a claimed-publication response adds

Successful mutation responses may carry `result.changed_paths`. It is the
complete deterministic ledger-relative set whose bytes this invocation changed
in the working tree. It does not mean Git committed those paths. `create`
returns only its item path; `transition`, `patch`, and `publish-claimed` return
their item path plus the tracked reconciliation log when that log changed.
`--auto-commit` additionally returns `commit_paths` and `git_commit`; its
`changed_paths` equals the committed set.
`operation_id` once schema validation has accepted it. No expected envelope has
undocumented root members.

**The two sanctioned exceptions, and why they stay**

`validate` and `ready` emit a bare result rather than an envelope. That shape is
load-bearing: scripts read `.valid` and `.errors` directly, `ready --json` feeds
`.ready` to shell pipelines, and both shapes are pinned by
`spec/fixtures/validation-errors` and `spec/fixtures/ready-selection`. Wrapping
them would break every existing reader for no gain a consumer can use, because
neither command mutates and neither participates in version negotiation. They
stay bare, and step 3 of the rule is how a consumer recognizes them.

A claim-fenced refusal to `create`, `transition`, or `patch` answers in the
ledger-mutation domain with `command: "<command>-v1"` and
`contract_version: 1`. This is not envelope drift: it is the work-claim
contract answering, because a merge-coordinated backend refused the write
before the core mutation ran. The shape is a pinned consumer surface of
work-claim contract version 1, fixed by
[work-claim contract](work-claim-contract.md) section 8, by
`spec/fixtures/work-claims/legacy-write-refusals`, and by
`spec/fixtures/mutation-refusals/uncommitted-prior-mutation`, and reproduced
independently by the reference model in `test/work-claim-reference.js`.
Re-wrapping it in a core envelope would silently change three pinned surfaces
and split one refusal across two version domains. The split is real, so the
contract states it here instead of hiding it.

The practical consequence for a consumer: a mutating command can return either
domain, so read `namespace` before anything else. A consumer that dispatches on
`command === "create"` alone misses every fenced refusal.

`spec/fixtures/envelope-domains/manifest.json` is the normative pin for this
rule. It records the domain, command member, version field, exit, state, error
code, and exact root members of every response class the CLI emits.

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
| 1 | A bare-result command found the ledger invalid, or `report` failed before or during publication. `report` answers an invalid ledger here rather than at exit 3. | bare result `{valid, errors}`, ledger-invalid (`report` only), report-read-failed, report-write-failed |
| 2 | Argument, request, lookup, or candidate/lifecycle/layout-precondition failure. | invalid-request, item-not-found, transition-precondition-failed, patch-precondition-failed, candidate-invalid, item-source-too-large, items-directory-unavailable, list-response-too-large, report-config-invalid, report-view-not-found |
| 3 | The complete configured ledger is invalid, for every command except `report`. | ledger-invalid |
| 4 | Cooperative comparison, lock, identity, or default-path conflict. | revision-conflict, lock-held, id-collision, path-collision, auto-commit-preflight-failed, mutation-finalize-refused, list-snapshot-changed |
| 5 | The backend lacks the required capability or write scope. | atomic-scope-required, capability-unavailable |
| 6 | An unexpected operating or post-publication recovery condition. | operation-failed, post-commit-recovery-required, write-outcome-unknown, git-commit-failed, git-commit-outcome-unknown, post-commit-reconciliation-failed |

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

### Contract version 5 capability delta

The preceding JSON and three-member Git-dependent coupling remain the exact
version 1 definition. Versions 2, 3, 4, and 5 change only the following
capability paths; all omitted paths retain their version 1 values:

| Path | Version 5 value |
|---|---|
| `contract_version` | `5` |
| `result.backend.coordination_scope` | `"same-working-copy-cooperative-writers"` |
| `result.operations.inspect.workbench` | `{"supported":true,"projection_version":1}` |
| `result.operations.list` | `{"supported":true,"write_scope":"none","cas_scope":"none","query_version":1}` |
| `result.operations.patch` | `{"supported":true,"write_scope":"single-item","cas_scope":"exact-byte-sha256"}` |
| `result.operations.report` | `{"supported":true,"write_scope":"derived-output","config_versions":[1,2],"named_views":true}` |
| `result.operations.work_claim.api_version` | `2` |
| `result.limits.max_item_source_bytes` | `8388608` |
| `result.limits.default_list_page_size` | `50` |
| `result.limits.max_list_page_size` | `200` |
| `result.limits.max_list_title_characters` | `120` |
| `result.limits.max_list_response_bytes` | `131072` |
| `result.limits.max_workbench_title_characters` | `120` |
| `result.limits.max_workbench_collection_entries` | `50` |
| `result.limits.max_workbench_response_bytes` | `65536` |
| `result.limits.cross_worktree_coordination` | `false` |

`result.operations` advertises in the fixed order `inspect`, `list`, `create`,
`transition`, `patch`, `report`, `work_claim`. `result.limits` advertises
`max_item_source_bytes` first, then the four list bounds in the order above,
then the three workbench bounds, then the version 1 booleans. `list` is
read-only, so its `write_scope` and `cas_scope` are `none`, exactly like
`inspect`. `inspect` keeps its version 1 members and gains the nested
`workbench` member, which is how a consumer learns the opt-in affordance
projection of section 5.2 exists and which projection shape it will receive.

The four list bounds are exact numbers, not advice:

- `default_list_page_size` is the page size a query that omits `page_size` receives;
- `max_list_page_size` is the largest `page_size` a query may request;
- `max_list_title_characters` is the exact number of Unicode code points a row's
  projected title may carry before it is truncated and flagged; and
- `max_list_response_bytes` bounds the complete `list` response, envelope and
  trailing LF included.

A full page of maximum-width rows can exceed `max_list_response_bytes`. When it
does, the command refuses the page whole with `list-response-too-large` and the
caller lowers `page_size`; neither bound silently rewrites the other, and a
`list` response is never a partial page. A consumer with its own transport
budget uses the lower of that budget and `max_list_response_bytes`.

The three workbench bounds are exact numbers on the same terms:

- `max_workbench_title_characters` is the exact number of Unicode code points
  the projected item title may carry before it is truncated and flagged;
- `max_workbench_collection_entries` is the largest number of entries any one
  variable-size workbench collection carries — the relation lists, an option's
  precondition issues, an option's blockers, and the related IDs inside one
  issue. A longer collection carries its first entries, its observed `total`,
  and `truncated: true`; and
- `max_workbench_response_bytes` bounds the complete workbench response,
  envelope and trailing LF included.

The entry bound keeps every projection this core can build well inside the
response bound, so `max_workbench_response_bytes` is a promise rather than a
knob: a workbench request carries no size to lower. A projection that would
exceed it is refused whole with `workbench-response-too-large` at exit 2 rather
than written short.

`result.operations.report` is how a consumer learns what the read-only report
command accepts, so it never has to probe by generating an artifact.
`write_scope: "derived-output"` states that the command writes one configured
output path and no ledger item. `config_versions` lists the accepted
`<ledger>/.wowbagger/report.json` versions: version 1 is unchanged, and
`report_version: 2` adds a `views` object whose named members — for example
`security-blockers` — each project the validated ledger through grouped filters
with **OR within one filter group; AND across groups**. `named_views: true` says
the core accepts a selection by name:

~~~text
wowbagger report --ledger <dir> --view <name> --as-of YYYY-MM-DD --json
~~~

A named success adds `result.view` and nothing else; a base report's result is
unchanged. A selection that names no configured view, or any `--view` against a
version 1 configuration, is refused with `report-view-not-found` at exit 2,
`details.view` naming the requested name, and every existing output left as it
was. The report request, the configuration, and the generated artifact are
defined in [the README](../README.md#named-custom-report-views); this contract
defines the advertisement.

`result.limits.max_item_source_bytes` is the first member of `result.limits`,
before `multi_item_atomicity`. It is the exact number of bytes the complete
serialized item source may occupy, and it applies to successor bytes accepted
by `create`, `transition`, `patch`, and `publish-claimed`. It does not claim a
raw request limit and it does not claim an `inspect` output limit; the
serialized `publish-claimed` request keeps its own separate transport bound.

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
- optional parent, snoozed_until, completed, killed, archived, deferred;
- optional number, the core-assigned item identity on schema version 2, and
  optional priority, the caller-supplied schema priority; and
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

item-not-found exits 2 and has details containing exactly the selector the
request used: id when the request selected by `--id`, number when it selected
by `--number`. The one member present repeats the value the caller supplied,
because the selector the caller named is the honest thing to hand back. Only
inspect accepts `--number`; every other command that can refuse item-not-found
selects an item by id alone, so their details contain only id. ledger-invalid
exits 3 and has details.validation_errors equal to the existing deterministic
SPEC.md validation-error sequence. Neither read-only error has state.

An invalid ledger stays a refusal. Inspect does not fall back to reading one
item without validating the rest, and there is no escape flag that skips
validation: a success envelope carrying a revision is what a caller feeds to
expected_revision, and that revision must never come from a ledger state the
core has not judged.

The refusal still shows the operator the item they asked for. On inspect only,
ledger-invalid details carry an optional item, and it is the same lossless
snapshot the successful item shape above defines, for the item the request
selected. It is present when the request resolves an item and no validation
error names that item's path. It is absent when nothing resolves, and absent
when the resolved item is itself faulted, because that item's own frontmatter
or placement is what validation rejects. A create, transition, or patch
ledger-invalid refusal never carries it.

This keeps the section 5 rule intact — inspect loads and validates the complete
ledger, and every member of the attached snapshot comes from the one raw byte
buffer that item's own handle supplied — while removing the trap the refusal
used to set: the tool refusing to show the item it tells the operator to fix.
An operator repairing an invalid ledger reads the bytes and revision of the
items around the fault with `inspect`, and reads the fault itself from
`validation_errors`, whose `expected_path` and `remediation` name the repair.

### 5.1 The bounded list query

`list` enumerates a validated ledger. It is read-only, takes no lock, and
returns no item source and no body: a caller selects a row, then reads that one
item with `inspect`. `--ledger` is required; `list` performs no ledger discovery
and binds no implicit path.

`list` loads and validates the complete ledger before it projects anything. An
invalid ledger returns `ledger-invalid`, exit 3, with `details.validation_errors`
and no rows: there is no partial list.

#### The query

The request is UTF-8 JSON with one top-level object and exactly these members:

| Member | Required | Value |
|---|---|---|
| `query_version` | yes | `1` |
| `as_of` | yes | ISO calendar date; readiness is projected as of this date |
| `sort` | yes | object with exactly `field` and `direction` |
| `filters` | no | object with a subset of the closed filter members below |
| `page_size` | no | integer from 1 to `max_list_page_size`; default `default_list_page_size` |
| `cursor` | no | an opaque cursor from a previous `list` response |

`sort.field` is one of `created`, `id`, `number`, `priority`, `status`, `title`,
`updated`. `sort.direction` is `ascending` or `descending`.

`filters` members are:

| Filter | Value | Meaning |
|---|---|---|
| `status` | non-empty array of distinct statuses | row status is in the set |
| `kind` | non-empty array of distinct kinds | row kind is in the set |
| `ready` | boolean | row readiness as of `as_of` equals the value |
| `number` | non-empty array of distinct positive integers | row number is in the set |
| `title_contains` | non-empty string | the stored title contains it |

Filters are a conjunction: every named filter must accept the item. A value
filter is a set, so an empty array or a repeated entry is `invalid-request`
rather than a silently widened or deduplicated query. `title_contains` is a
case-sensitive substring test against the whole stored title, not against the
bounded excerpt a row carries; there is no locale collation, case folding, or
Unicode normalization.

Unknown, missing, and mistyped members are `invalid-request`, exit 2, with the
aggregated issues of section 3. A JSON number is an integer only when its
literal is canonical, so `page_size: 1.0` is `invalid-value`.

#### Order

The selected field decides the primary order. An item that does not carry the
selected member sorts after every item that does in `ascending` order;
`descending` is the exact reverse of the ascending primary comparison. Every
order then breaks ties on ascending immutable ID, in both directions, so the
total order is stable across invocations and a full traversal never depends on
file order.

#### The response

~~~json
{
  "ok": true,
  "command": "list",
  "contract_version": 5,
  "result": {
    "query_version": 1,
    "as_of": "2026-08-21",
    "snapshot": { "revision": "sha256:…", "item_count": 5 },
    "page": {
      "size": 2,
      "offset": 0,
      "returned": 2,
      "matched": 5,
      "has_more": true,
      "next_cursor": "…"
    },
    "items": []
  }
}
~~~

`snapshot.revision` is the ledger-snapshot witness: a digest over every item's
ledger-relative path and exact item revision, so any item added, removed,
renamed, or byte-modified changes it. `snapshot.item_count` counts the whole
validated ledger, not the filtered page.

`page.matched` counts every row the filters accept in that snapshot.
`page.next_cursor` is a string when `has_more` is `true` and `null` otherwise.

Each row has exactly:

| Member | Presence | Value |
|---|---|---|
| `id` | always | immutable item ID; the only identity |
| `number` | when the item carries one | the short handle, never identity |
| `title` | always | the title, truncated to `max_list_title_characters` code points |
| `title_truncated` | always | `true` when the projection dropped code points |
| `kind` | always | `task` or `epic` |
| `status` | always | the item status |
| `priority` | when the item carries one | the supplied priority, never recomputed |
| `created` | always | ISO calendar date |
| `updated` | always | ISO calendar date |
| `revision` | always | the exact item revision, as `inspect` reports it |
| `ready` | always | readiness as of `as_of` |

#### Cursor pagination

A cursor is opaque and carries no ledger content. It binds three things: the
digest of the query it was issued for, the snapshot revision it was issued
against, and the offset to resume at. A caller passes it back unchanged with the
same query.

A string that is not a cursor this core issued is `invalid-request`, exit 2, at
`/cursor`. It is never treated as a restart from offset zero.

When either binding no longer holds, the cursor is refused with
`list-snapshot-changed`, exit 4:

~~~json
{
  "ok": false,
  "command": "list",
  "contract_version": 5,
  "error": {
    "code": "list-snapshot-changed",
    "message": "The ledger snapshot the cursor was issued against is no longer current.",
    "details": {
      "mismatch": "snapshot",
      "cursor_snapshot_revision": "sha256:…",
      "current_snapshot_revision": "sha256:…"
    }
  }
}
~~~

`details.mismatch` is `snapshot` when the ledger changed and `query` when the
same cursor was replayed under a different `as_of`, `filters`, or `sort`. Both
carry one remedy: restart pagination with no cursor. A caller MUST NOT combine
pages from different snapshot revisions; across one unchanged traversal every
matching item appears exactly once.

The response is a live projection on every invocation. A consumer may cache it
as transient interface state only; it never becomes a second ledger store.

#### Exit and error summary

| Exit | Code | Condition |
|---:|---|---|
| 0 | none | the page was projected and fits the response bound |
| 2 | `invalid-request` | arguments, JSON, query schema, or cursor form |
| 2 | `list-response-too-large` | the exact rows exceed `max_list_response_bytes` |
| 3 | `ledger-invalid` | the complete configured ledger is invalid |
| 4 | `list-snapshot-changed` | the cursor's snapshot or query binding moved |

### 5.2 The bounded workbench projection

A workbench shows a person which native lifecycle transitions an item can take
before it asks for consent. `inspect` answers that read opt-in:

~~~text
wowbagger inspect --ledger <dir> (--id <id> | --number <n>) --workbench --as-of YYYY-MM-DD --json
~~~

`--workbench` requires `--as-of`, and `--as-of` is accepted only with
`--workbench`: the projection reports readiness for an explicit date, so the
date is part of the request rather than a default this core invents. An
unpaired flag is an `invalid-request` issue at `/arguments`
(`missing-argument` for the missing `--as-of`, `conflicting-argument` for the
unpaired `--as-of`), and a date that is not an ISO calendar date is
`invalid-value`. An invocation without `--workbench` is byte-identical to the
lossless read of section 5: the two reads share one item resolution, and only
the flagged one answers with a projection.

The read changes no ledger item, lock, claim journal, reconciliation log, or Git
state. It takes no lock: a lock would make a read look like a lease.

`inspect --workbench` loads and validates the complete ledger and answers from
that one snapshot. An invalid ledger returns `ledger-invalid`, exit 3, with
`details.validation_errors` and nothing else. The lossless read attaches the
resolved item to that refusal so an operator can read the bytes to repair; the
workbench read cannot, because an affordance derived from a ledger this core has
not judged would be a claim it cannot support. An unresolved selector is
`item-not-found`, exit 2, with exactly the selector the caller used, as in
section 5.

#### The response

~~~json
{
  "ok": true,
  "command": "inspect",
  "contract_version": 5,
  "result": {
    "workbench": {
      "projection_version": 1,
      "as_of": "2026-08-22",
      "snapshot": { "revision": "sha256:<hex>", "item_count": 5 },
      "observation": {
        "authority": "observed-snapshot",
        "rechecked_by": [
          "revision", "lock", "claim-fence", "reconciliation", "candidate-validation"
        ]
      },
      "item": {
        "id": "wb_...",
        "number": 10,
        "title": "Epic awaiting disposition",
        "title_truncated": false,
        "kind": "epic",
        "status": "backlog",
        "priority": 1,
        "parent": "wb_...",
        "created": "2026-08-02",
        "updated": "2026-08-05",
        "revision": "sha256:<hex>",
        "ready": false,
        "depends_on": { "entries": ["wb_..."], "total": 1, "truncated": false },
        "related": { "entries": [], "total": 0, "truncated": false }
      },
      "transition_options": [
        {
          "to_status": "done",
          "action": "complete",
          "decision_required": true,
          "minimum_date": "2026-08-05",
          "enabled": false,
          "precondition_issues": {
            "entries": [
              {
                "code": "live-dependencies",
                "field": "depends_on",
                "message": "Completion requires every depends_on target to be done.",
                "related_ids": { "entries": ["wb_..."], "total": 1, "truncated": false }
              }
            ],
            "total": 1,
            "truncated": false
          },
          "blockers": { "entries": [], "total": 0, "truncated": false }
        }
      ]
    }
  }
}
~~~

`result` carries exactly one member, `workbench`, and its members are in the
order above. The projection is negotiated by `projection_version`, its own
version domain, exactly as `list` is negotiated by `query_version`.

`snapshot` is the same witness `list` returns: it covers every item's
ledger-relative path and exact revision, so any item added, removed, renamed, or
byte-modified changes it. It is in the response because an option's blockers and
precondition issues are functions of the whole ledger, not of the one item, so
the item revision alone would not name what was observed.

`item` is a bounded summary: `number`, `priority`, and `parent` are present only
when the item carries them, `title` is projected to
`max_workbench_title_characters` with `title_truncated` saying whether it was
cut, `depends_on` and `related` are bounded collections, and `ready` is the
section 5.1 readiness state for `as_of`. The projection carries no item source
and no body: those are the lossless read of section 5, and this response stays
inside an advertised bound.

`revision` is the exact revision of the item's own bytes, and it is what a caller
sends as `transition`'s `expected_revision`.

#### Transition options

`transition_options` holds one option for every lifecycle target the section 8
edge table allows out of this item's kind and status, in ascending status order.
A target the table does not allow is absent, so `invalid-edge` never appears in a
projected issue. A terminal item has no allowed target and its
`transition_options` is `[]`.

| Member | Meaning |
|---|---|
| `to_status` | the target status a `transition` request would name |
| `action` | the generated decision action, or `null` for the two no-decision edges |
| `decision_required` | whether the request must carry `decision.summary` and `decision.rationale` |
| `minimum_date` | the earliest legal transition date, `max(created, updated)` |
| `enabled` | whether the observed ledger refuses nothing for this target at `minimum_date` |
| `precondition_issues` | the observed section 8 precondition issues, bounded |
| `blockers` | the observed section 8 multi-item blockers, bounded |

An option is evaluated at `minimum_date`, so neither date precondition can be
what disables it: a caller reads `minimum_date` and sends that date or a later
one. Issues and blockers use exactly the `transition` vocabulary — the same
`code`, `field`, `message`, `item_id`, and ordering — so a consumer renders one
set of refusal reasons. The one reshaped member is an issue's `related_ids`,
which is a bounded collection here because that list grows with the ledger.

`enabled` is `true` exactly when both bounded collections observed nothing:
`precondition_issues.total` and `blockers.total` are `0`. A disabled option still
names why, so a workbench can show a target and the reason it cannot be taken
rather than hiding it.

#### What the projection does not promise

`observation` states the semantics in the response rather than leaving them to a
reader of this contract. `authority: "observed-snapshot"` says the projection is
one observation of the named snapshot: it is not a lease, not a reservation, and
not a promise that the option remains executable after the returned revision.
`rechecked_by` names what a later `transition` rechecks under lock — the exact
revision, the cooperative lock, the claim fence, reconciliation, and complete
candidate validation — in the refusal precedence of section 8. A transition
dispatched against a returned option can still be refused by any of them, and
that refusal is the authority.

The affordance projection and `transition` share one implementation-level
lifecycle definition (`src/lifecycle.js`): the edge table, the generated actions,
the precondition issues, and the blockers have exactly one home, so an
advertised option cannot drift from what the mutation does. A consumer therefore
never reimplements the edge table, the date derivation, the decision
requirement, or the blocker rules.

#### Exit and error summary

| Exit | Code | Condition |
|---:|---|---|
| 0 | none | the projection was answered and fits the response bound |
| 2 | `invalid-request` | arguments, including the `--workbench`/`--as-of` pairing |
| 2 | `item-not-found` | the selector resolved no item in a valid ledger |
| 2 | `workbench-response-too-large` | the exact projection exceeds `max_workbench_response_bytes` |
| 3 | `ledger-invalid` | the complete configured ledger is invalid |

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

`publish-claimed` is the exception. It runs from journal replay through its
terminal record inside the namespace write lock of a provisioned ledger, and
every other cooperative writer of that ledger enters the same lock before it
writes, so the namespace lock already serializes it against every writer a
per-ID closure would exclude. It therefore acquires no per-ID locks at all and
has no closure to widen or retry. Everything after the closure is unchanged: it
re-reads the complete working tree, compares expected_revision against those
bytes, validates the complete candidate ledger, and publishes atomically at the
same path. This exception exists only where the namespace lock is held; a
backend without it MUST NOT write an item without a lock closure. Because the
serialization moved, every cooperative writer of one ledger must be upgraded
together: a writer that honors only per-ID locks can race one that honors only
the namespace lock.

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
create, transition, or patch — the three operations that take per-ID locks.
`publish-claimed` writes no lock file, so no lock file names it and a reader
never has to classify one. The remaining values must match their schema and
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
| item.number | No | Refused. On schema version 2, number is the item identity and create assigns it. |
| item.priority | No | Non-negative integer; the caller-supplied schema priority. |
| item extension members | No | Permitted schema extensions. |
| body | Yes | JSON string; empty and LF-leading strings are distinct and valid. |

The member name `extensions` is reserved for the `patch` request container.
Create refuses `item.extensions`; extension members must be named directly on
the item, such as `item.tags` or `item.tier`. This prevents a nested mapping
from becoming an extension value that `patch` and the declaration workflow
cannot address.

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

item must not supply schema_version, id, number, status, created, updated,
completed, killed, archived, decisions, or body. For a non-empty valid ledger,
create inserts the schema_version already used by every existing item. For an
empty ledger, it inserts schema_version 2. Create returns that selection in
`result.item.core.schema_version`. It also inserts status triage, created
and updated equal to the UTC date encoded by id, and related [] when omitted.
On a schema version 2 ledger it inserts number as one more than the highest
existing number, assigned under a number-index lock so concurrent creates
cannot collide. It adds no terminal date or decision.

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

### The configured items directory must exist

Because create never creates the configured directory, create resolves it and
refuses by name when it is not an existing directory:

~~~json
{
  "ok": false,
  "command": "create",
  "contract_version": 3,
  "state": "unchanged",
  "error": {
    "code": "items-directory-unavailable",
    "message": "The configured items directory is unavailable.",
    "details": {
      "id": "wb_...",
      "path": "items",
      "reason": "absent",
      "remediation": "Create the ledger directory items and commit it, then retry create."
    }
  }
}
~~~

The exit is 2 and the state is `unchanged`. details have exactly id, path,
reason, and remediation:

- path is the resolved ledger-relative directory, exactly the configured
  `items_directory`;
- reason is `absent` when nothing occupies that path, and `not-a-directory`
  when a regular or special file does;
- remediation names that same path and the operator action that makes create
  possible. For `absent` it is `Create the ledger directory <path> and commit
  it, then retry create.`; for `not-a-directory` it is `Replace <path> with a
  directory and commit it, then retry create.`; and
- the message is stable across both reasons. Automation reads `reason`.

This is a ledger-setup precondition, not a request defect: the request is
well-formed, so it is not an invalid-request issue under section 3, and no JSON
Pointer into the request could name the fault.

Precedence. Create resolves the directory after complete-ledger validation and
**before it acquires any lock**, so the refusal precedes id-collision,
path-collision, and candidate validation, and no lock file, temporary file, or
lock directory is created. Complete-ledger validation still precedes it: a
symbolic link occupying the configured directory name is a
`symlink-not-allowed` validation error, so that case returns `ledger-invalid`
with exit 3 and never reaches this refusal.

Only create can hit this refusal. transition, patch, and publish-claimed
rewrite an item that already exists, so the directory holding it exists too;
they return item-not-found when it does not.

`spec/fixtures/mutations/missing-items-directory/` is the normative vector for
both reasons.

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
| task or epic | backlog | deferred | set deferred; append defer decision |
| task | backlog | in-progress | none |
| task | backlog | archived | set archived; append archive decision |
| task | backlog | killed | set killed; append kill decision |
| task | in-progress | backlog | none |
| task | in-progress | done | set completed; append complete decision |
| task | in-progress | killed | set killed; append kill decision |
| epic | backlog | done | set completed; append complete decision with generated rollup |
| epic | backlog | archived | set archived; append archive decision |
| epic | backlog | killed | set killed; append kill decision |
| task or epic | deferred | backlog | clear deferred; append undefer decision |
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

The missing epic backlog to in-progress edge is by design, not by omission: an
epic carries no progress of its own to record, so there is no state for that
edge to reach. Read [Epic progress is derived from direct
children](#epic-progress-is-derived-from-direct-children) below for the model
that replaces it.

### Epic progress is derived from direct children

An epic stores no progress. Its status records disposition only — which of
triage, backlog, deferred, archived, killed, or done the epic itself sits in —
and never how much work is under way beneath it. An epic's progress is derived
from its direct children: every item whose parent is that epic's immutable ID.
Grandchildren never count, even under a nested epic; each epic derives from its
own direct children only.

Both derived values below are computed from item bytes alone. No ledger field
holds either one, and no reader needs anything the items do not already carry.

**Terminal ratio.** Direct children whose status is done or killed, divided by
all direct children. An epic with no direct children has no ratio at all: 0/0
is undefined, not zero.

The epic complete rollup uses this same set. The epic backlog to done edge
refuses unless every direct child is already done or killed, and the generated
rollup then lists exactly those children in immutable ID order. So a ratio of 1
is the precondition of the rollup, and the contract, the transition gate, and
the rollup provably share one definition of terminal.

The report's epic-enablement factor reads this same set: done or killed direct
children over all direct children, as defined here, so the contract, the epic
complete rollup, and the report all derive the same number from the same items.
A terminal date is not the test. An archived or a deferred child carries one,
but archived restores and deferred undefers — both edges are in the table above
— so a parked child is work postponed, not work retired, and counting it would
report progress that one transition takes back.

**Activity.** Exactly one of three derived states:

- **active** — at least one direct child is in-progress or holds an active work
  claim. An active claim is an unexpired lease, defined by the [work-claim
  contract](work-claim-contract.md) section 4; a claim read reports it as a
  non-null active object.
- **untouched** — no direct child has left triage or backlog, and no direct
  child holds an active work claim. An epic with no direct children is
  untouched.
- **in progress by derivation** — every other case.

Test active first, then untouched, then in progress by derivation. The order is
part of the definition: a backlog child under an active claim is active, not
untouched, and only the fixed order makes two independent implementations agree
on it.

The terminal ratio, not the activity state, reports completeness. An epic whose
every direct child is done or killed, with no child claimed, derives a ratio of
1 and the state in progress by derivation; it is awaiting its own complete
transition, which is real remaining work.

**Mirroring.** A consumer mirroring a store that does model epic activity
compares its stored epic status against this derived state, never against the
ledger's stored status field. The stored field cannot follow an active epic,
because epics never enter in-progress; an audit that compares stored against
stored therefore reports a permanent false positive on every epic under work,
and whitelisting epics to silence it blinds the audit to genuine epic-status
errors.

Worked example, the shape a dual-run mirror actually hit. Legacy epic #1075 is
in-progress since 2026-06-16. Its ledger mirror is backlog and cannot be
anything else. One direct child is in-progress, so the epic derives active.
Comparing legacy in-progress against the ledger's stored backlog reports drift
that no mutation can ever clear. Comparing legacy in-progress against the
derived active state agrees, and the audit keeps its power to fail on a real
disagreement — a legacy epic marked in-progress whose children are all still in
triage derives untouched, and that is a genuine finding.

**No machine surface exposes the derived value.** This is a recorded decision,
not an oversight. A consumer audit already loads every item to compare them, so
the two definitions above are computable where the audit already stands; the
report model keeps carrying epic enablement for sequencing, and inspect gains
no derived member. Adding one is a wire change and needs its own justification
and its own item.

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
item-source-too-large when the serialized successor exceeds the advertised
bound; otherwise candidate-invalid when the candidate validator reports errors.
For create, items-directory-unavailable precedes id-collision, id-collision
precedes path-collision as specified in section 7, and all four precede
item-source-too-large, which precedes candidate-invalid. No validator issue already represented by the
selected more-specific response is duplicated in a second envelope. A proposed
ledger that remains invalid for any reason is never published.

Transition publication uses a fully written and synced same-directory
temporary file followed by the platform's existing-file atomic replacement
primitive. It then re-reads exact final bytes. This remains a local filesystem
operation without universal crash durability or hostile-writer protection.

## 9. Patch

Patch changes the mutable non-lifecycle content of one existing item — its
title, its priority, its relation lists, and its body — and nothing else. It
exists so a consumer can re-scope an item in band, without hand-editing
frontmatter: the dependent of an item you want to kill is re-scoped with patch,
then the kill proceeds. It is also the sanctioned way to correct a title or
rewrite a body: a consumer whose items mirror an external card edits both
through patch, and gets the lock, the compare-and-swap, candidate validation,
and atomic publication that a hand-edit skips.

That last point is the reason title is patchable at all. On a provisioned
ledger a hand-edit is not merely unreviewed — it is a stale write. The next
guarded mutation refuses exit 6 with an `unauthorized-revision` finding, and
every later mutation stays blocked until an operator reconciles by hand. A
protocol that forces the edit it then punishes is a contradiction, and the
field reported it twice in two days.
It runs under the same per-ID lock, locked re-read,
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
  "set": {
    "title": "The corrected title",
    "priority": 3,
    "depends_on": [],
    "related": ["wb_..."],
    "body": "\nReplacement body.\n"
  }
}
~~~

| Member | Required | Rules |
|---|---:|---|
| id | Yes | Canonical existing item ID. |
| expected_revision | Yes | Exact lowercase SHA-256 token returned by inspect. |
| date | Yes | ISO calendar date not earlier than existing created or updated. |
| set | Yes | Mapping naming at least one patchable field. |

For an item whose status is `done`, `killed`, `archived`, or `deferred`, the
request date must equal the existing `updated` date for `patch`, `snooze`, and
`parent-migrate`. The active lifecycle date must equal `updated`; these three
verbs update `updated` without changing that lifecycle date. An earlier request
fails the date floor, while a later request produces `candidate-invalid` with
`terminal-date-must-match-updated`. Inspect immediately before the mutation and
reuse the item's current `updated` date.

The patchable field set is exactly `title`, `priority`, `depends_on`,
`related`, `body`, `body_append`, and `extensions`. A set member outside it is an invalid-request issue at
its /set pointer — the boundary is stated here, not discovered from the
implementation. `number` is the immutable item identity, assigned once at
create, so it is not patchable and a request naming it is refused. `kind` and
`provenance` are refused too. A consumer-owned extension member is written
through the `extensions` container and only when the ledger declares it; it is
never one more name in this list. The complete boundary,
member by member, is the ownership table below; a consumer never has to send a
patch to learn which side of it a field is on.

`title` takes a non-empty schema string, the same rule create validates it
under, and replaces the current title whole. A non-string title, the empty
string, and a whitespace-only string are all one invalid-type issue at
`/set/title` with the message `Set member title must be a non-empty string.`

`priority` takes a non-negative integer. `depends_on` and `related` each take
a whole relation list, which replaces the current list; the value must be an
array whose entries are all canonical item IDs. A non-array value is an
invalid-type issue at `/set/<field>`; a malformed entry is an invalid-value
issue at `/set/<field>/<index>`.

`body` takes a JSON string that replaces the whole body, under create's body
rules: the empty string and an LF-leading string are distinct and both valid,
and the bytes are written exactly as the UTF-8 encoding of the string. A
non-string body is an invalid-type issue at `/set/body`.

`set.body` replaces the whole body and never merges. Nothing in the item's
current body survives a body patch that does not carry it: the core reads
`set.body` as the complete successor body and splices those bytes in. The
compare-and-swap fence does not soften this. `expected_revision` is a byte-level
lost-update guard and carries no semantic safety at all: a request built from
the item's current revision is accepted, committed, and reported `ok: true`
however much meaning it destroys.

A consumer whose items mirror an external source — a card, an issue, an
upstream document — MUST read-modify-write from the current item body, and MUST
never regenerate from the source alone. Regeneration passes every check the core
can make and discards every ledger-only byte the caller just read: the
annotations, decisions, and local notes that exist in the ledger because they
exist nowhere upstream. The merge is the consumer's, and it belongs on the body
returned by the `inspect` whose revision the request fences with.
`set.body_append` covers the append-only case without a merge.

`body_append` takes a JSON string under the same rules `body` takes one: the
empty string is valid, the bytes are written exactly as the UTF-8 encoding of
the string, and a non-string value is an invalid-type issue at
`/set/body_append`. `null` is refused as an invalid-value issue at
`/set/body_append` — appending nothing is the empty string, not a removal — for
the same reason `set.body` refuses it. The published body is the item's current
body bytes followed by the string. The request never names the bytes in front
of the addition, so every existing byte survives by construction: an annotation
cannot destroy a ledger-only block by forgetting it.

`body` and `body_append` are mutually exclusive in one request. A replacement
and an append cannot both describe the successor body, so a `set` naming both
is an invalid-request issue at `/set` naming the exclusivity, exit 2, and
unchanged, whatever the two values are. An append is otherwise an ordinary
patch: it rides the same lock, locked re-read, exact-byte compare-and-swap,
candidate validation, atomic publication, and claim rules, it sets `updated` to
request.date, and it rewrites no frontmatter byte — the addition is the same
byte splice after the closing delimiter that a replacement is.

null removes the field, for every patchable **frontmatter** field alike.
`related` is optional, so removing it succeeds and the item reads back with an
empty related list. `depends_on` and `title` are required item fields, so
removing either makes the candidate item invalid: the patch returns
candidate-invalid, exit 2, and unchanged. Clear a dependency list with `[]`,
not null; correct a title by sending the corrected one, and note that the empty
string is not the escape hatch it is for `body` — a title must be non-empty, so
`""` is refused at the request, one step earlier than `null` is.

`body` is the deliberate exception to that convention, and the asymmetry is
stated here so no consumer has to infer it. The body is a region of the file,
not a frontmatter member: every item has one, and there is nothing to remove.
"Remove the body" means the empty string. `{"body": null}` is therefore refused
as an invalid-value issue at `/set/body`, exit 2, unchanged — it is not read as
a removal and it is not read as the empty string.

`extensions` takes a mapping whose keys name consumer-owned extension members
and whose values replace each named member whole. It is one member of the
fixed `set` allowlist, not a hole in it: a typo at the top level
(`prioirty`) is still an `unknown-member` issue at `/set/prioirty`, and only
what is inside this container is read as an extension member name. A
non-object value is an invalid-type issue at `/set/extensions`; a container
naming no member is an invalid-value issue at the same pointer.

Request-shape validation of the container stops there. Which members it may
name, and what each value must be, is the **ledger's** answer, not the
request's, so both are deterministic patch preconditions rather than
invalid-request issues, and each of them costs the lock the request already
takes.

Request-shape validation stops at the rules above. Referential integrity,
dependency cycles, the schema-2 done-dependency rule, self-reference, repeated
references, and depends_on/related overlap are candidate complete-ledger
validation's job, exactly as they are for create and transition: a relations
edit that breaks any of them returns candidate-invalid, exit 2, and unchanged,
and the ledger keeps its bytes. Relations edits ride the same per-ID lock,
locked re-read, exact-byte revision compare-and-swap, candidate
complete-ledger validation, and atomic same-path publication protocol as every
other patch, and the same claim protocol: on a claim-protected ledger a
relations patch of an item with an active claim is refused
`active-claim-write-refused`, exit 4, unchanged — no exception for relations,
and none for a body.

Patch sets updated to request.date. A date earlier than the existing created
or updated date returns patch-precondition-failed, exit 2, and unchanged,
with date-before-created and date-before-updated issue codes matching
transition's, including the item_created and item_updated members. The same
UTC ULID derivation applies: an item created just after midnight UTC refuses
the operator's local calendar date here too.

Patch appends no decision: the ledger's Git history is the audit trail for a
consumer-field change. Identity, lifecycle, provenance, snooze, and decisions
cannot change through patch, and neither can an extension member the ledger
does not declare.

Patch never mutates another item. A candidate ledger that flags any other
item — for example a duplicate-number collision with an existing handle —
returns candidate-invalid, exit 2, and unchanged, and both items keep their
bytes. Re-scoping one item's dependency onto `related` and dispositioning the
item it depended on is therefore two patch and transition calls, not one
atomic multi-item mutation.

### The extension declaration

`<ledger>/.wowbagger/extensions.json` is the committed declaration of which
extension members are patchable on that ledger and what value each one takes.
It sits beside `layout.json` and is the same class of artifact: core-owned
ledger structure, read from the ledger the caller named, never discovered by a
walk. It is version 1:

~~~json
{
  "extensions_version": 1,
  "members": {
    "external_id": "string",
    "tier": "string",
    "sequence": "integer",
    "verified": "boolean",
    "tags": "string-list"
  }
}
~~~

Its members are exactly `extensions_version`, which is `1`, and `members`, a
non-empty mapping from a member name to one declared value type. A member name
matches `[A-Za-z][A-Za-z0-9_-]*` and is never one of the frontmatter members
the ownership table above governs: a declaration cannot smuggle `title` or
`status` past that table by naming it. The declared value types are exactly
`string`, `integer`, `boolean`, and `string-list`, a flat list of strings.

This is deliberately not a schema engine. A whole-value replace can serialize a
scalar or a flat list of scalars into an item without inventing structure the
item never carried; a map, a nested list, or a value with its own internal
shape cannot be described by one declared type and is not offered. A consumer
whose extension member is a map keeps it exactly as before — consumer-owned,
preserved by every verb, changed by a reviewable hand-edit — and the boundary
is stated here rather than discovered from a refusal. If nested extension
values ever need a patch path, they need their own declaration shape, and this
one does not pretend to be it.

**A declaration authorizes a write; it does not describe the ledger.** It is
checked against the request's values and against the item's node shapes, and
never against the values other items already carry. Enforcing it over stored
items would make the repair it exists for impossible: one item with the wrong
type would make the whole ledger invalid, and `patch` refuses `ledger-invalid`
before it can correct anything. `validate` is therefore unchanged by this file,
and an item whose extension member disagrees with the declaration is still a
valid item — it is simply an item a patch can correct.

Absence is fail-closed and total. A ledger with no `extensions.json` has **no**
patchable extension member, and a `set.extensions` request against it is
refused `patch-precondition-failed`, exit 2, `unchanged`, with one
`extension-declaration-missing` issue whose field is `extensions` and whose
message names the missing file. A declaration that is present but unreadable —
malformed JSON, a wrong shape, a member name or value type outside the rules
above, a symlink, a directory, non-UTF-8 bytes — is refused the same way with
`extension-declaration-invalid`, which names the file rather than blaming the
request.

### Extension preconditions

Every extension refusal is a `patch-precondition-failed` issue in the shape
transition and patch issues already share — `code`, `field`, `message`, and
`related_ids`, and nothing else. The member at fault is named in `field`,
because that is where the item's frontmatter member at fault is named
everywhere else; the issue shape does not grow a member to carry it.

| Code | field | Meaning |
|---|---|---|
| extension-declaration-missing | `extensions` | The ledger has no `.wowbagger/extensions.json`, so nothing is patchable. |
| extension-declaration-invalid | `extensions` | The declaration exists and is not a valid version 1 declaration. |
| extension-not-declared | the member | The container names a member the declaration does not declare. |
| extension-value-invalid | the member | The value does not match the type the declaration gives that member. |
| extension-anchored | the member | The item writes that member with a YAML anchor or alias. |

`null` removes the named member, the same convention every patchable
frontmatter field shares, and it is accepted whatever type the declaration
gives the member. Removing an extension member never makes the candidate
invalid, because no extension member is required.

**The anchored rule.** An extension value may carry a YAML anchor another node
aliases, and the successor guard compares extension nodes by exact node
identity. A whole-value replace of such a node would change every node bound
to it, silently, and a replace of a subtree that carries an anchor inside it
would leave an alias elsewhere with nothing to resolve. So it is refused, not
attempted: if the item writes the named member as an alias, or with an anchor
anywhere in its value, the patch returns `extension-anchored`, exit 2,
`unchanged`. The refusal is per named member, so an anchored `mirror` does not
stop a patch of `external_id` on the same item. Removing the anchor is a
reviewable hand-edit, exactly as it was before this path existed.

**What the guard still proves.** Every extension member the request does *not*
name keeps its exact `extensionNodeIdentity` guarantee: its key, value,
anchor, alias, comment, tag, quoting style, flow or block style, and position
must all survive the patch, or the candidate is refused. Only the named
members leave that guard, and they are checked a second way instead — the
serialized candidate is parsed back and each named member must read as exactly
the value the request asked for. A value the YAML writer emitted in a style
that parses as something else is caught before publication, not after.

### Frontmatter ownership

Every frontmatter member belongs to exactly one of three classes, and this
table is the whole boundary. A consumer reads it instead of sending a patch and
interpreting the refusal.

| Member | Class | How it changes |
|---|---|---|
| `schema_version` | Core-owned | Create selects it; only a whole-ledger schema migration moves it. |
| `id` | Core-owned | Create publishes it. It is identity and never moves. |
| `number` | Core-owned | Create assigns it on schema version 2. It is the item handle and never moves. |
| `status` | Core-owned | `transition` only, along an allowed lifecycle edge. |
| `created` | Core-owned | Create derives it from the UTC date the ID encodes. |
| `updated` | Core-owned | Every `transition` and `patch` sets it to `request.date`. |
| `completed` | Core-owned | `transition` writes it on completion and clears it on any other edge. |
| `killed` | Core-owned | `transition` writes it on a kill and clears it on any other edge. |
| `archived` | Core-owned | `transition` writes it on an archive and clears it on any other edge. |
| `deferred` | Core-owned | `transition` writes it on a defer and clears it on any other edge. |
| `decisions` | Core-owned | `transition` appends one record on a decision edge. Nothing edits or removes one. |
| `title` | Consumer-editable through `patch` | `set.title` replaces it whole. Non-empty string. |
| `priority` | Consumer-editable through `patch` | `set.priority` replaces it; `null` removes it. |
| `depends_on` | Consumer-editable through `patch` | `set.depends_on` replaces the whole list. |
| `related` | Consumer-editable through `patch` | `set.related` replaces the whole list; `null` removes it. |
| `body` (the region after the frontmatter, not a member) | Consumer-editable through `patch` | `set.body` replaces the whole body; `""` empties it. `set.body_append` appends without a merge; the two are mutually exclusive in one request. |
| `kind` | Create-once | Create fixes it. `patch` refuses it. |
| `provenance` | Create-once | Create writes it. Every later verb preserves it byte for byte. |
| `parent` | Create-once, migratable through `parent-migrate` | Create writes it; `parent-migrate` moves it with a compare-and-swap witness. |
| `snoozed_until` | Create-once, mutable through `snooze` | Create writes it; `snooze` sets or clears it with a compare-and-swap witness. |
| declared extension members (`tags`, `tier`, a consumer's own identifier fields) | Consumer-owned, patchable through `set.extensions` | `set.extensions.<member>` replaces the member whole; `null` removes it. Patchable only where `<ledger>/.wowbagger/extensions.json` declares the member and its value type, and only where the item does not write it with a YAML anchor or alias. |
| undeclared extension members | Consumer-owned, not patchable | Supplied at create, preserved byte for byte by every verb, and otherwise a reviewable hand-edit. A ledger with no extension declaration has no patchable extension member at all. |

**Why `kind` is refused.** A task-to-epic flip is not a field edit. Kind
decides the parent and children rules an item is validated under and the
allowed lifecycle edges it may take: an epic completes only when every direct
child is done or killed, a task may enter in-progress and an epic may not, and
an epic carries a rollup on its completion decision. Flipping the member
without reconciling those consequences produces an item the ledger cannot
validate or a lifecycle the contract never sanctioned. If kind is ever to
change, it needs its own verb with its own preconditions, not a widened patch
set.

**How extension members became patchable, and what stayed out.** Two field
reports in two days asked for this — a consumer's own identifier fields ride
permitted extension members, and a wrong or missing one had no ledger-side
repair verb at all. The widening was assessed against title's machinery and is
not the same machinery. Four differences were real, and each one is answered by
a specific piece of the shipped path rather than waived:

1. **The request shape had no room for an arbitrary key.** A set member outside
   the patchable set is an invalid-request issue, and that fail-closed rule is
   what turns a typo (`prioirty`) into a refusal instead of a new frontmatter
   member. Accepting arbitrary keys in `set` would destroy it. Answered by the
   `set.extensions` container: the fixed allowlist gains exactly one more name,
   and only what is inside the container is read as a member name.
2. **There was no value schema to validate against.** Title is a schema string
   the validator already enforces; candidate validation constrains no extension
   value at all. Answered by the committed per-ledger declaration: a member is
   patchable only where the ledger declares it, with one declared value type,
   and a value outside that type is refused before the serializer sees it. The
   declaration authorizes a write and never describes the ledger — see "The
   extension declaration" above for why enforcing it over stored items would
   make the repair impossible.
3. **Nested values do not survive a whole-value replace the way a scalar
   does.** An extension value may be a map or a sequence, may carry an anchor
   that another node aliases, and is compared by the successor guard through
   exact node identity. Answered in two parts and no further. Anchored and
   aliased members are refused outright with `extension-anchored`, so the guard
   that proves the other extension nodes were untouched is never relaxed for
   them; and the declared types stop at scalars and flat string lists, so a map
   or a nested list has no patch path at all and stays a reviewable hand-edit.
   Only the members a request names leave the node-identity guard, and they are
   checked by value against the serialized candidate read back instead.
4. **The oracle had no observable surface to correlate against.** Extension
   members are absent from the lossless core view, so an independent
   re-implementation cannot check an extension patch result from `core` alone.
   Answered by correlating through `source_base64`: the oracle decodes the item
   source the response already carries, parses its frontmatter, and checks each
   named member against the request — a removal against the member's absence.
   This is surface the oracle deliberately avoided for patch, and taking it on
   was the price of the path; nothing else in patch correlation changed.

What is still out: an undeclared member on any ledger, every member on a ledger
with no declaration, a member whose value is a map or a nested list, and a
member the item writes with an anchor or an alias. For all four, the honest
answer is the table's: consumer-owned, preserved by every verb, changed only by
a reviewable hand-edit — and on a provisioned ledger, that hand-edit is the
stale write described at the top of this section, so it must be reconciled, not
merely committed.

### Serialization

An updated field is rewritten in place. `title` is always rewritten in place
and never inserted, because it is a required member every valid item already
carries; its scalar node is edited, so the quoting style the item was written
in survives the correction. A newly added priority serializes
directly after kind; a newly added depends_on directly after provenance, and a
newly added related directly after depends_on. A relation list this patch adds
is written as a YAML flow sequence, the style create writes; a relation list
already on the item keeps its sequence node, so its style — and any anchor on
it — survives the replacement. Extension nodes the request does not name are
preserved exactly as in transition, and a patch that names no body preserves
the body bytes the same way.

A named extension member is rewritten in place when the item already carries
it, so its quoting style and its position in the item's own member order both
survive the correction; a declared string list already on the item keeps its
sequence node and its style. A named member the item does not carry is
**appended after the item's last frontmatter member**, because an extension
member has no canonical position the core may claim — there is no core member
it belongs after. A list this patch adds is written as a YAML flow sequence,
the style create writes. A named member set to `null` is deleted.

A body patch rewrites no frontmatter byte. The published frontmatter — from the
opening delimiter through the closing delimiter and its newline — is identical
to the item's own frontmatter bytes except the `updated` value, which every
patch sets to request.date. Anchors, aliases, comments, quoting and flow or
block styles, member order, and extension members all survive, because the body
swap is a byte splice after the closing delimiter and never reaches them. This
is a hard invariant, pinned byte for byte by the vectors, not a best effort.

The body bytes are written exactly as the UTF-8 encoding of `set.body`, the
same rule create serializes under: no newline is invented, trimmed, or removed,
and no line ending is translated. An empty body leaves no byte after the
closing delimiter's newline.

An append serializes through the same splice with the item's current body bytes
in front of the addition, so the same rules hold: nothing is invented between
the two, no line ending is translated, and an empty `body_append` republishes
the body byte for byte.

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
| ledger-invalid | validation_errors; item iff the command is inspect and the request resolves an unfaulted item |
| transition-precondition-failed | id, issues |
| patch-precondition-failed | id, issues |
| candidate-invalid | id, validation_errors |
| item-source-too-large | id, size_bytes, limit_bytes |
| list-response-too-large | max_list_response_bytes, response_bytes, page_size |
| list-snapshot-changed | mismatch, cursor_snapshot_revision, current_snapshot_revision |
| workbench-response-too-large | id, max_workbench_response_bytes, response_bytes |
| revision-conflict | id, expected_revision, actual_revision |
| lock-held | id, lock_path, owner, owner_diagnostic |
| id-collision | id, path, actual_revision |
| path-collision | id, path, occupant_kind; occupying_id iff occupant_kind is item |
| items-directory-unavailable | id, path, reason, remediation |
| atomic-scope-required | id, blockers, precondition_issues |
| capability-unavailable | capability, reason, recovery_artifacts, recovery_artifacts_truncated |
| operation-failed | id, operation, reason, recovery_artifacts, recovery_artifacts_truncated |
| post-commit-recovery-required | id, revision, recovery_artifacts, recovery_artifacts_truncated |
| write-outcome-unknown | id, recovery_artifacts, recovery_artifacts_truncated |

ledger-invalid and candidate-invalid validation_errors are exactly the
deterministic SPEC.md error sequence for the current or proposed ledger,
respectively. Error messages are stable human summaries; automation branches
on code, mutation state, and documented details.

### The bounded item source

`create`, `transition`, and `patch` each measure the complete serialized
successor before validating it as a ledger candidate. A successor larger than
`result.limits.max_item_source_bytes` returns:

- code `item-source-too-large`;
- message `The proposed item source exceeds the supported byte limit.`;
- exit 2 and state `unchanged`;
- details exactly `{id, size_bytes, limit_bytes}`, where `size_bytes` is the
  measured successor and `limit_bytes` is the advertised bound.

The measurement is serialized UTF-8 bytes, not string length, base64 length, or
body length: frontmatter, decisions, extensions, and body all draw on the same
budget. `transition` is bounded for the same reason the two body-writing verbs
are, because its decision block can push a legal stored item past the bound.

Precedence is normative. Everything the command decides before it serializes a
successor still decides first: `ledger-invalid`, `item-not-found`, `lock-held`,
`id-collision`, `path-collision`, `revision-conflict`,
`transition-precondition-failed`, `patch-precondition-failed`,
`atomic-scope-required`, and the section 12 claim-fence refusals.
`candidate-invalid` is decided from the serialized successor, so it decides
after: an oversized successor that would also make the ledger invalid returns
`item-source-too-large`.

The bound is a bound on successors, never on stored bytes. An item committed
before the bound existed still validates, still inspects, and can be repaired
by any patch whose successor is at or below the bound. A successor still above
it refuses, so an oversized legacy item has exactly one way forward: shrink it.

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

### Response loss and once-only dispatch

A caller can lose the response to a mutation it already dispatched: the
transport between the caller and the owning host can drop after the core
started, and a dropped transport observes nothing about the ledger. This
section is normative for every explicit user-triggered `create`, `transition`,
and `patch`.

Only a complete observed process result establishes an outcome. A result is
complete when the process is observed to have exited, both captured streams are
complete and within their bounds, and standard output is one valid envelope for
the dispatched command. Anything else establishes nothing about the ledger.

| Observation | Established outcome | Required client action |
|---|---|---|
| Complete envelope, exit 0, state committed | The mutation applied exactly as returned. | Continue. |
| Complete envelope, state unchanged, any nonzero exit | The mutation did not create, remove, rename, or byte-modify an item. | Read the refusal; a revision conflict re-inspects. |
| Complete envelope, exit 6 post-commit-recovery-required, state committed | The item is published; a verify or cleanup step still needs recovery. | Inspect the item and clear the reported recovery artifacts. Never repeat the mutation. |
| Complete envelope, exit 6 write-outcome-unknown, state unknown | Publication was attempted and the visible bytes are indeterminate. | Validate, inspect, and compare the caller-known revision. Never repeat the mutation. |
| Signal, timeout, orphan or containment doubt, or an incomplete or over-limit stream | Nothing. The mutation may or may not have applied. | Treat as unresolved. |
| No envelope, a partial envelope, or no response at all because the transport was lost | Nothing. | Treat as unresolved. |

No row reports success that was not observed, and no row licenses a repeat of
the mutation.

An unresolved outcome is answered by one sequence, never by a retry:

1. Dispatch once, never replay, invalidate the inspected revision, reconnect,
   then re-read the ledger.
2. Re-read means `validate`, then `inspect` the caller-known ID. For `create`
   the caller already knows the ID it minted; for `transition` and `patch` the
   caller already knows the expected revision it sent.
3. Compare the observed current state with the caller's own pre-dispatch
   observation, and report the comparison as current state. A later item state
   describes only current ledger state; it never proves that the lost dispatch
   caused it.
4. Dispatch a fresh mutation only after a person reviews that comparison, and
   only as a new explicit decision built on the current revision.

Exit 4 is not response loss. A `revision-conflict` is a complete observed
refusal with state unchanged: the item changed after it was inspected, and the
core proves the write did not run. It invalidates the inspected revision and
requires re-inspection; it never becomes an unresolved outcome and never
triggers a retry of the same request bytes.

This contract carries no operation identity. There is no operation ID, no
durable outcome store, and no replay endpoint, because the caller never
replays: once-only dispatch plus honest unresolved outcomes need no
correlation. Introducing replay-safe correlation requires a new contract
decision that defines request binding, retention, and collision behavior before
implementation.

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
serialization, preconditions, the body swap with its untouched
frontmatter, the body append with its exclusivity refusal, and the declared
extension-member correction with its untouched anchored extension nodes and
its undeclared-member refusal.

The `list` cases cover the seven categories section 5.1 is accepted against: an
empty ledger's witnessed empty page (`list-empty`), a mixed-status filtered
first page with its continuation cursor (`list-page`), a cursor whose bound
snapshot moved (`list-stale-cursor`), an invalid ledger refused with no rows
beside the error (`list-invalid-ledger`), and a maximum page whose exact rows
exceed the advertised response bound (`list-response-too-large`).

The `workbench` cases cover section 5.2 the same way: a task's four allowed
edges with their generated actions and derived minimum date
(`workbench-task-options`), an epic carrying both observed precondition issues
and both observed disposition blockers (`workbench-epic-blocked`), a terminal
item with no target at all (`workbench-terminal`), and an invalid ledger refused
with no projection beside the error (`workbench-invalid-ledger`). Every one
declares identical before and after ledger digests: the projection is a read.

The runtime executes every vector as a black-box CLI test, including exact
response bytes and the complete before/after ledger snapshot.

[spec/fixtures/envelope-domains](../spec/fixtures/envelope-domains/README.md)
is the companion vector for the section 2 envelope rule. It pins the response
domain of every command's success and every refusal class, including the
claim-fenced mutation refusals and the bare `validate` and `ready` results.

## 12. Commit-per-mutation on a provisioned ledger

A ledger becomes provisioned when `provision` binds a namespace to the
repository and `claim capabilities` reports `mode: "merge-coordinated"`. On
such a ledger, `create`, `transition`, `parent-migrate`, `snooze`, and `patch`
run inside the claim coordinator described by the [work-claim
contract](work-claim-contract.md).

### The rule

**Commit each mutation to Git before running the next mutating command.**

The coordinator records every authorized mutation in the durable journal and
validates the recorded revisions against Git `HEAD`, not against working-tree
bytes. An uncommitted mutation is therefore an unreconciled mutation, and the
next `create`, `transition`, `parent-migrate`, `snooze`, or `patch` refuses
rather than writing on top of work that is not yet durable.

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

An uncommitted prior mutation makes the next mutating command return exit 6.
The refusal answers in the ledger-mutation domain, not the core domain, because
the claim coordinator refused before the core mutation ran. Section 2 states
that rule; `namespace` is what a consumer reads to recognize it.

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
`spec/fixtures/mutation-autocommit/` is the companion set for section 13: it
pins the success envelope, the commit-failed envelope, and the recovery
envelope, subject and commit set included.

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

## 13. Auto-commit: folding the commit into the mutation

`--auto-commit` performs the section 12 loop inside one invocation. It is
opt-in per invocation, it exists only on a provisioned merge-coordinated
ledger, and it never changes what the mutation itself does.

There is no configuration file setting, environment default, or repository
default for it. A hidden default would make existing automation create Git
commits unexpectedly, so the flag must appear in the argument vector every
time.

### Version position

The flag is additive. The core contract stays version 3 and the work-claim API
stays version 1. An invocation without the flag is byte-identical to the
version-3 behaviour, and a consumer that never sends the flag can never observe
a new outcome, so neither version needs to move. A consumer detects the feature
by sending the flag, not by reading a version.

### What it may commit

Only the paths this invocation owns:

| `create` | the created item |
| `transition` | the changed item and one `<ledger>/.wowbagger/reconcile-<namespace>.md` |
| `parent-migrate` | the changed item and one reconciliation log |
| `snooze` | the changed item and one reconciliation log |
| `patch` | the changed item and one reconciliation log |
| `publish-claimed` | the published item and one reconciliation log |

The item path appears in the set only when the successor bytes differ from the
item bytes at `HEAD`. A byte-identical `parent-migrate`, `snooze`, or `patch`
still records its decision in the reconciliation log, so its auto-commit set
contains the log alone.

`create` is journal-silent by design, so its commit set has no log. The
pre-mutation and post-mutation verification steps do not materialize an empty
log for `create`; this lets the first auto-commit run after namespace
provisioning commit the created item without an extra metadata ceremony. For
the other commands, the log must already carry this invocation's terminal
entry before it may be staged; if it does not, the invocation reports
`git-commit-failed` with `reason: "log-unavailable"`.

Commit subjects are fixed:

    wowbagger: create item #N
    wowbagger: transition item #N
    wowbagger: parent-migrate item #N
    wowbagger: snooze item #N
    wowbagger: patch item #N
    wowbagger: publish claimed item #N

A schema-1 item has no number, so its subject names the canonical item ID
instead of `#N`. No title, body, decision text, or caller-supplied message text
ever reaches a commit message.

Git's own author and committer resolution applies. `core.hooksPath`,
`commit.gpgSign`, signing programs, and every hook are honoured. `--no-verify`
is never passed, signing is never disabled, and no commit is ever amended,
squashed, reset, force-updated, or retried blindly. Nothing is pushed, fetched,
pulled, merged, or rebased: a local commit satisfies the `HEAD` surface this
contract validates against.

### The preflight

Before the mutation runs, the invocation takes a per-working-tree mutex and
requires all of:

- No path staged anywhere in the repository.
- No dirty path under the ledger: tracked, untracked, or partially staged.
- A Git identity Git can resolve without committing.
- A `HEAD` that exists. A detached `HEAD` is supported, because a commit works
  from one; an unborn `HEAD` refuses.
- A clean internal `claim-verify`, which is also what makes an unreconciled
  prior mutation refuse before `publish-claimed`.

Unstaged and untracked paths **outside** the ledger are allowed and stay
byte-identical; they are never staged. Any other failure returns exit 4
`auto-commit-preflight-failed` with `state: "unchanged"`, and no core mutation,
staging, or commit occurs. `details.reason` is one of `staged-paths-present`,
`ledger-not-clean`, `identity-unavailable`, `unborn-head`, `mutex-held`,
`claim-state-unreconciled`, or `git-unavailable`.

Every `auto-commit-preflight-failed` refusal also carries
`details.retryable`. It is `true` only for `details.reason: "mutex-held"`;
all other preflight reasons are `false`. Clients must branch on this boolean,
not infer retryability from the generic error code or message.

The rule is deliberately strict rather than preserving foreign staged work in a
temporary index. Reconciliation excludes `.wowbagger/` from the Git item
surface, and a dirty reconciliation log does not itself refuse a mutation, so a
broad add would silently commit foreign ledger work. Refusing is the cheaper
correct answer.

A flagged invocation on an advisory or non-provisioned ledger returns exit 5
`capability-unavailable` with `state: "unchanged"` before the mutation. It does
not fall back to manual mode.

### The state machine after the mutation

1. `state: "unchanged"` returns the mutation's own envelope and performs no Git
   action. This includes a claim-fence refusal, a reconciliation refusal, and a
   refused `publish-claimed` whose durable refusal terminal legitimately changed
   the reconciliation log. A refusal never commits.
2. `state: "unknown"` returns unchanged and performs no Git action. A caller
   must inspect; auto mode must not guess which bytes to commit.
3. `state: "committed"` continues even when `ok` is `false`, because that state
   already proves the published item bytes. The original error, exit, and
   `recovery_artifacts` are preserved and the Git evidence is added inside
   `error.details`. A transient lock or temporary file this invocation could not
   remove is reported there, is never staged, and never counts as foreign ledger
   dirt: refusing on it would make an already-published item impossible to
   commit.

When a successful mutation produces item bytes identical to `HEAD`, the item
path is omitted from `commit_paths`; the journal log remains the only changed
path. This avoids reporting a staged-path mismatch for a valid audit-only
mutation and keeps `mutation-finalize` idempotent after an advanced `HEAD`.

On success the response keeps its original domain and adds three members to
`result`: `git_commit`, `commit_paths`, and `claim_verified: true`. A successful
invocation does not return until an internal `claim-verify` exits 0 with no
findings and a valid ledger. For `publish-claimed` the same `claim-verify` must
also report `git_finalized: true` and the new commit in the publication's
finalization row.

### The commit-failed contract

Exit 6, `state: "committed"`, code `git-commit-failed`, message
`The item was published, but its Git commit was not established.` The state
still describes item publication as section 2 defines it. It does not claim Git
finalization.

`create`, `transition`, and `patch` keep the core domain: no `namespace`, the
original command name, and the core `contract_version`. `ledger-mutation` is
not used, because that domain means the fence refused before the core mutation
ran. `publish-claimed` keeps `namespace: "ledger-publication"`,
`command: "publish-claimed"`, its legacy envelope marker, and its top-level
`operation_id`.

~~~json
{"ok":false,"command":"transition","contract_version":3,"state":"committed","error":{"code":"git-commit-failed","message":"The item was published, but its Git commit was not established.","details":{"id":"wb_...","published_revision":"sha256:...","expected_path":"items/wb_....md","commit_set":[{"path":".wowbagger/reconcile-wbns_....md","sha256":"sha256:..."},{"path":"items/wb_....md","sha256":"sha256:..."}],"pre_commit_head":"<git-oid>","failure_stage":"prepare-commit-set","reason":"log-unavailable","recovery_token":"<bounded-base64url>"}}}
~~~

`failure_stage` is `prepare-commit-set`, `stage`, or `commit`. `reason` is one
of `log-unavailable`, `index-unavailable`, `head-changed`,
`commit-command-failed`, or `tree-changed`. `commit_set` paths are
ledger-relative and ordered; a `null` digest means the path was never observed
and recovery must re-derive it.

An **ambiguous** Git outcome is `git-commit-outcome-unknown`, never
`git-commit-failed`. A commit is this invocation's only when its parent,
subject, changed-path set, and every blob match what was prepared; a hook that
rewrites the subject or the tree lands here. History is never rewritten to make
it match.

A commit that is established while reconciliation then refuses is exit 6
`post-commit-reconciliation-failed` with `state: "committed"`. It carries
`git_commit`, `commit_paths`, and the `findings`. The commit stands.

No failure envelope contains raw hook output, signing output, an absolute path,
an environment value, or platform exception text. A bounded human diagnostic may
use standard error under the section 2 transport rule.

### mutation-finalize

One idempotent recovery command completes a failed commit and a lost response
alike:

~~~sh
wowbagger mutation-finalize --ledger <dir> --recovery-token <token> --json
~~~

It answers in the work-claim domain, because it changes Git reconciliation
state and no item byte. The token is not authority to select paths. It binds the
command, the item, the published revision, the pre-commit `HEAD`, the ordered
ledger-relative commit set with content digests, the fixed message, and the
terminal entry the log must carry. `mutation-finalize` re-derives every path
from the ledger and the provisioned namespace, re-checks the current bytes and
the foreign-change rules, creates the exact commit if it is absent, then runs
`claim-verify`.

If `HEAD` already holds the exact commit, it verifies and returns that commit
without creating a second one, so repeating the command is safe. A changed item,
a log without this invocation's terminal, a moved `HEAD`, a foreign staged or
dirty path, or a token that no longer matches the ledger returns exit 4
`mutation-finalize-refused` with `state: "unchanged"` and no Git write.

A failed attempt leaves its own commit set staged, because the design forbids
unstaging. Recovery tolerates exactly that residue and still refuses anything
else staged. Until recovery runs, the next `--auto-commit` invocation refuses on
`staged-paths-present`, which is the intended signal.

### What auto-commit does not make true

It does not make `safe_exclusive_dispatch` true. Item publication, the Git
commit, and journal finalization cannot be one transaction in this profile, so a
crash or `SIGKILL` after publication can still prevent any envelope at all. Auto
mode removes ceremony and names every failure it can observe; it does not remove
the need to inspect after a process dies.

The flag is direct-CLI only. No adapter advertises or constructs it, and adapter
handoff resume still forbids automatic Git commits. The ledger-specific
`claim capabilities` envelope does not advertise it either: its shape is an
exact pinned consumer surface, and adding a member there would require a
coordinated adapter contract change this release does not make. A consumer
detects the feature by sending the flag.

`spec/fixtures/mutation-autocommit/` pins the success, commit-failed, and
recovery envelopes; `spec/fixtures/envelope-domains/manifest.json` pins their
response domains and exact root members.
