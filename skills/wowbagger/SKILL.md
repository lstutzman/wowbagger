---
name: wowbagger
description: Use when coordinating work through a Wowbagger ledger — reading deterministic ready work, inspecting lossless revisions, generating HTML reports and named views, filing or mutating items, taking a work claim, or publishing claimed work. Triggers on "ready queue", "ledger report", "report view", "backlog report", "what should I work on", "file a ledger item", "close this item", "claim this work", "publish claimed work", or any mention of a Wowbagger ledger. Not for general backlog talk where no Wowbagger ledger exists.
---

# Wowbagger

A work ledger that is plain Markdown in Git. Every item is a file; every change
is a reviewable diff. The core is read-only unless you explicitly ask it to
publish something.

## Setup

Install the core separately before using this skill:

```sh
npm install -g wowbagger@0.1.0-alpha.17
```

The core requires Node.js 24 or later. This plugin ships only agent
instructions; it does not bundle the core, an MCP server, a remote service, a
hook, or a background process. It operates on the ledger and its Git working
copy through the core's validated CLI.

The supported runtime matrix is Node 24.20.0. Node 26 remains excluded until
the separate Vitest incompatibility reported by Lee is resolved; do not certify
Node 26 based on ambient availability.

## Before anything else: check the core

This skill does **not** bundle the wowbagger core. It drives an installed one,
so a version mismatch is detectable rather than silent.

```sh
wowbagger --version
wowbagger capabilities --json
```

Read the plain distribution version from the first command and the top-level
`contract_version` from the second. **This skill requires distribution version
`0.1.0-alpha.17` and core `contract_version: 5`.**

The distribution pin names the published `0.1.0-alpha.17` release; the cut that
publishes core `contract_version: 5` moves it. Earlier cores report
`contract_version: 3` or lower and lack behavior this skill requires, including
the bounded item source, so the version check refuses them. Do not soften
either pin to make a check pass.

- Command not found → the core is not installed. Tell the user, point them at
  <https://github.com/lstutzman/wowbagger>, and stop. Do not fall back to
  editing ledger files by hand — hand-edits bypass validation and atomic
  publication, which is the whole point of the tool.
- If the distribution version is missing or is different, stop and report the
  installed and required versions. An older core can share a contract version
  while still lacking behavior this skill requires. Do not guess from the
  contract version alone.
- `contract_version` is anything other than `5` → stop and say so plainly. A
  core reporting `1` predates schema version 2, where `depends_on` records
  declared prerequisites rather than only live blockers. A core reporting `2`
  predates the widened date-refusal issue shape, the `depends_on`/`related`
  patch field set, and core-assigned item numbers. A core reporting `3` accepts
  an item source of any size, so it publishes items this skill's bound would
  refuse. A core reporting `4` has no `list` command, so the ledger cannot be
  enumerated through a supported seam. An older or newer core may have changed
  the request or response shape. Do not guess.

Run both commands once per session before the first ledger command, not before
every command.

Run the read-only drift preflight before the first ledger mutation:

```sh
wowbagger version-drift --json
```

It compares the installed skill pin with the required distribution and core
contract, then compares those requirements with the running core. If it refuses,
do not mutate the ledger. Update the stale package, plugin cache, or linked
checkout named by `result.error.details.provenance`, then rerun the preflight.

You drive the core as an agent, through the commands below. A UI plugin or
another non-agent consumer drives it as a process instead: absolute Node
executable, absolute `wowbagger.js`, argument array, `shell: false`. If the
user asks how to call wowbagger from their own program, point them at
`docs/host-contract.md` in the wowbagger repository rather than describing a
launch here.

## Reading

These never modify anything. Prefer them.

```sh
wowbagger validate --ledger <dir> --json
wowbagger ready     --ledger <dir> --as-of <YYYY-MM-DD> --json
wowbagger inspect   --ledger <dir> --id wb_... --json
wowbagger inspect   --ledger <dir> --number <n> --json
wowbagger capabilities --json
```

- `ready` is the source of truth for what is workable. Never infer the queue by
  reading files yourself — dependency and parent rules decide it, and a
  directory listing does not.
- `--as-of` is a real calendar date. Use today's date; do not invent one to make
  an item appear.
- `validate` returns `{"valid":true,"errors":[]}` on a clean ledger and exits
  nonzero on a broken one. Run it after any change you make.
- `inspect` returns a lossless byte snapshot plus a SHA-256 revision. That
  revision is what `transition` compares against, so inspect immediately before
  transitioning.

## Talk to people in numbers, not ULIDs

Every item has two identifiers. The `wb_...` ULID is the **internal** identity —
the filename, the publication fence, what `transition`/`inspect` take as `--id`.
The integer **number** is the **human-facing** identity: on a schema-2 ledger it
is required, unique, and immutable, and the core assigns it at `create`.

- When you refer to an item to a person, say **#N** (its number), e.g. "item #30",
  never the `wb_...` ULID. Show the ULID only if they ask for it.
- You can address an item by number: `inspect --number <n>` resolves it (and
  refuses `item-not-found` when no item carries that number). `--id wb_...` still
  works; use exactly one.
- The number is not caller-settable. `create` refuses a supplied `number` and
  assigns the next one itself; `patch` refuses `number` because it is immutable.
  To read an item's number, `inspect` it and read `result.item.core.number`.

## Generating an HTML report

The report is read-only derived output. Its configuration is
`<ledger>/.wowbagger/report.json`.

```sh
wowbagger report --ledger <dir> --as-of <YYYY-MM-DD> --json
```

Use today's date for `--as-of`. Use `--out <file>` only when the caller needs to
override the configured output. The resolved output must stay outside the
ledger. Do not use an npm script as a machine protocol; invoke `wowbagger`
directly so standard output contains exactly one compact JSON object.

On success, require exit `0`, `ok: true`, `command: "report"`,
`contract_version: 5`, `result.report_version` equal to the configuration's own
`report_version`, and the requested `result.as_of`. Read the generated file from
the absolute `result.output`. On failure, require `ok: false` and inspect
`error.code`; do not treat an existing output as fresh because failed
publication preserves the prior report. Do not parse the generated HTML and do
not parse human output: the JSON result is the only machine surface.

The report ends its decision surface with a 3D dependency graph of the items the
artifact covers. Its renderer is a pinned, checksummed `3d-force-graph` build
vendored at `vendor/3d-force-graph/` and inlined at generation time, so the
report is still one self-contained file that fetches nothing — it is roughly
1.3 MB larger for it. A browser without WebGL shows the graph section's plain
explanation and its per-node roster instead; nothing the graph shows is
missing from the rest of the report.

The generated HTML does not authorize transitions, claims, or parallel work.
It has no live ledger revision. Its readiness state is the canonical projection
at generation time, but the file is only a static view. Area-diverse batches are
scheduling hints. Use `inspect` plus `transition` for lifecycle changes and the
claim commands below for coordination.

The report's "Work next" list is a recommended order derived in the report
layer for a human reader. It is not the queue. `ready --json` remains the only
machine queue, and its order is priority, created date, then ID. Do not dispatch
from the report and do not present its order as core output.

### Named custom report views

A configuration at `report_version: 2` names one or more `views`, each a
read-only projection of the same complete ledger. Generate one by name:

```sh
wowbagger report --ledger <dir> --view <name> --as-of YYYY-MM-DD --json
```

For a configured view named `security-blockers`, `<name>` is
`security-blockers`. Name only a view the configuration defines.

A view's criteria are grouped facets with **OR within one filter group; AND
across groups**. Every section of the generated file — statistics, Work next,
Attention, evidence, graph, drill-down, and terminal history — describes only the
retained subset, and excluded items are absent from the bytes. Readiness is still
computed against the complete ledger, so excluding a blocker never makes blocked
work read as ready.

- A named success adds `result.view` naming the selection, and `result.item_count`
  and `result.ready_count` describe the subset. A base report adds no `view`
  member, so do not require one.
- Version 1 configuration is unchanged, and a version 2 configuration with no
  `--view` publishes the same base report. Do not pass `--view` against a version
  1 configuration: that and an unknown name both refuse with
  `report-view-not-found` at exit 2 and leave every output untouched.
- `--out <file>` overrides the selected output, view or base alike. An empty
  matched subset is a success with zero items, not a failure.
- Discover support from `result.operations.report` in `capabilities --json`
  (`config_versions` and `named_views`). Never probe by generating a file.
- A custom view is scoped output, **not a security boundary**. It applies no
  redaction and no access control. Say that plainly if a user asks for a report
  that hides work from a reader.

## Every writer must be on the same core before the first create

On a provisioned ledger, `create` now records its allocation in the shared
claim journal before it publishes anything. That grammar is new, so the upgrade
is a hard cutover with no automatic migration and no mixed-version grace
period: **upgrade every writer in one Git coordination domain to the current
core before the first alpha.14 create.** A worktree left on the old core does
not write a duplicate — it stops making claim-protected mutations, which is the
safe outcome, not a usable one.

An old core cannot read the new create entry and says so badly. It answers
exit 6, `error.code` `claim-store-unavailable`, message
`The durable claim store is unavailable.`, and `error.details.reason`
`claim-store-unreadable`, leaves state unchanged, and writes no item. Read that
exact combination as **this repository was written by a newer Wowbagger;
upgrade this worktree to continue**, and say so to the user: the old binary is
immutable and can never print better guidance. (Item #185 is open for general
version-drift detection.)

Do not confuse that with a full journal. Exit 6
`claim-store-unavailable` with reason `journal-capacity-exceeded` means the
65,536-entry or 8,388,608-byte bound was reached before publication. State is
unchanged and prior history stays intact. Do not upgrade, truncate, compact, or
hand-edit the journal; no automatic recovery verb exists. Report the capacity
refusal as the blocker. A real persistence failure remains
`clock-floor-persistence-failed`, and uncertainty after an intent remains an
outcome-unknown refusal.

Say what the fix does and does not cover. It closes the reported
PropertyCompass2 collision: cooperating alpha.14 worktrees of one clone that
share one Git common directory can no longer commit two items carrying the same
number. Separate clones, separate machines, alpha.13 writers before the hard
cutover, and noncooperating writes stay outside that fence and still rely on
branch integration plus `validate`.

## Writing

Every write is an explicit, reviewable Git change. Show the user the command
before running it.

```sh
wowbagger create     --ledger <dir> --input request.json --json
wowbagger transition --ledger <dir> --input request.json --json
wowbagger patch      --ledger <dir> --input request.json --json
```

- `create` publishes only a caller-supplied canonical ID, atomically and
  no-clobber. It will not invent an ID for you.
- **Where `create` publishes is the ledger's decision, not the caller's.** A
  committed `<ledger>/.wowbagger/layout.json` holding exactly
  `{"layout_version":1,"items_directory":"items"}` makes `create` publish
  atomically to `<items_directory>/<id>.md`; without the file it publishes to
  `<ledger>/<id>.md`. Configure it, and commit the directory it names, before
  the first `create` — no file is renamed afterwards. If that directory is
  missing, `create` refuses `items-directory-unavailable`, exit 2, and its
  `error.details.remediation` names the directory to create. Cores at
  `0.1.0-alpha.4` and earlier ignore the file and publish at the ledger root.
- **Never relocate an item with `git mv` straight after a create.** `create`
  writes an untracked file, so `git mv` refuses it; the `git add -A` behind it
  in an unchecked batch then commits the item at the ledger root. Use plain
  `mv`, then `git add`, and check every exit code before you commit:

  ```sh
  mv <ledger>/<id>.md <ledger>/items/<id>.md || exit 1
  git add <ledger> || exit 1
  ```

  A committed item outside the configured items directory fails validation and
  refuses every read and every guarded mutation on that ledger, including ones
  that never touch it. The `item-outside-layout` refusal carries
  `expected_path` and a `remediation` naming the move; make it, commit it, then
  run `claim-verify`.
- **An item source is bounded at 8,388,608 bytes.** `create`, `transition`,
  `patch`, and `publish-claimed` each measure the complete serialized successor
  — frontmatter, decisions, extensions, and body together, not the body alone —
  and refuse a larger one with `item-source-too-large`, exit 2, state
  `unchanged`, and `error.details.size_bytes`. `transition` is bounded too,
  because a long decision can push a legal item past it. Read the exact bound
  from `capabilities --json` at `result.limits.max_item_source_bytes`. An item
  already committed above the bound still reads and still validates; repair it
  with a `patch` that brings the successor under the bound.
- `create` starts an empty ledger on schema version 2 and returns the selected
  version at `result.item.core.schema_version`. A non-empty schema-version-1
  ledger stays on version 1 until its complete ledger is migrated. The create
  request name `extensions` is reserved for the patch container; name extension
  members directly on `item`.
- `transition` changes **one** item. If the change would require touching a
  dependent or a child, it refuses. That refusal is correct — make it a
  reviewable multi-file Git change instead of forcing it.
- **The body is patchable.** `patch` takes `set.body` — a whole-body string
  replacement that keeps every frontmatter byte. A mirror whose items track an
  external card updates bodies through `patch`, never by hand-editing the
  Markdown: the hand-edit skips the lock, the revision check, and validation.
  Removing a body is `""`; `null` is refused.
- **`set.body` replaces the whole body and never merges.** When you mirror an
  external source, read-modify-write from the current item body — `inspect`,
  edit the body you got back, send that — and never regenerate from the source
  alone. Regeneration passes every check (`expected_revision` is a byte guard,
  not a meaning guard) and silently deletes every ledger-only byte the item
  carried: the annotations and local notes that live nowhere upstream.
- **To add to a body without merging, use `set.body_append`.** The string it
  takes is written after the current body, so every existing byte survives
  without your naming it. It is mutually exclusive with `set.body` in one
  request, and `null` is refused — appending nothing is `""`. A core that
  predates it answers `invalid-request` with an `unknown-member` issue at
  `/set/body_append` and changes nothing, so trying it is a safe probe.
- See `docs/mutation-contract.md` in the wowbagger repository for the request
  and response shapes.
- After any write, run `validate` and show the user the resulting diff.

### Diagnosing an invalid ledger

An invalid ledger refuses every read and every guarded mutation, so the exit 3
`ledger-invalid` refusals are the diagnosis. Read them; do not hand-parse the
Markdown.

- `validate --ledger <dir> --json` lists every error, each with its `path`,
  `code`, and `message`, and with `expected_path` and `remediation` where the
  validator can derive the repair.
- `inspect` still refuses with exit 3, but its
  `error.details.item` carries the complete snapshot — `revision`,
  `source_base64`, `core`, `body` — of the item you asked for, whenever no
  validation error names that item's path. An item the ledger faults is
  withheld: `validate` already names its repair.
- `claim-verify --ledger <dir> --json` reports `result.ledger_validation`. An
  exit 0 with `findings: []` and `ledger_validation.valid: false` means the
  claim journal is consistent and validation is what blocks every mutation.
  Repair validation first; the claim state needs nothing.

### Patch edits fields, never lifecycle

`patch` re-scopes one existing item in band, so nobody hand-edits frontmatter.
The patchable field set is exactly `title`, `priority`, `depends_on`,
`related`, `body`, `body_append`, and `extensions`. A
`set` naming anything else is an `invalid-request` issue at its `/set` pointer,
and `number` is refused because it is immutable identity.

- `title` is a non-empty string, replaced whole. **Correct a wrong title
  through `patch`, never by editing the Markdown.** On a provisioned ledger the
  hand-edit is a stale write: the next mutation refuses exit 6 with an
  `unauthorized-revision` finding and every later mutation stays blocked.
- A relation list is replaced whole. There is no add or remove member — send
  the complete list you want the item to carry.
- `[]` clears a list. `null` removes the field, but `depends_on` and `title`
  are required, so a null one returns `candidate-invalid`, exit 2,
  `unchanged`. Use `[]` for a list; send the corrected string for a title.
- `priority` takes a non-negative integer.
- For an item whose status is `done`, `killed`, `archived`, or `deferred`, the
  request date must equal the existing `updated` date for `patch`, `snooze`, and
  `parent-migrate`. Inspect immediately before the mutation and reuse that date;
  an earlier date fails the request floor and a later date violates the
  terminal-date invariant.
- Patch appends no decision; the Git diff is the audit trail. It never mutates
  a second item, and it cannot touch status or provenance.

**Which fields are yours.** Do not discover this by sending a patch and reading
the refusal — every frontmatter member is in exactly one of four classes:

- **Core-owned**, never directly editable: `schema_version`, `id`, `number`,
  `status`, `created`, `updated`, the terminal dates (`completed`, `killed`,
  `archived`, `deferred`), and `decisions`. The core derives these through
  lifecycle and mutation commands; `patch` cannot name them.
- **Consumer-editable through `patch`**: `title`, `priority`, `depends_on`,
  `related`, the body, and every extension member the ledger declares.
- **Dedicated mutations**: use `parent-migrate` to repoint an existing item to
  an epic or detach it, and use `snooze` to set or clear `snoozed_until`. Both
  use exact-revision compare-and-swap and accept `--auto-commit`.
- **Create-once**: `kind` and `provenance`. `kind` is refused deliberately — a
  task-to-epic flip changes which parent and children rules apply and which
  lifecycle edges are allowed, so it needs its own future verb, not a wider
  `set`. Provenance remains byte-identical after create.

**Extension members are patchable only where the ledger declares them.**
`tags`, `tier`, and a consumer's own identifier fields are consumer-owned. Send
them through the `set.extensions` container, one member per name, each value
replacing that member whole:

~~~json
{"set": {"extensions": {"external_id": "PC-1475", "tier": null}}}
~~~

- The ledger's committed `<ledger>/.wowbagger/extensions.json` decides which
  members that container may name and what type each value takes — `string`,
  `integer`, `boolean`, or `string-list`. **A ledger without that file has no
  patchable extension member at all.**
- `null` removes a member. A member the item lacks is added, after the item's
  last frontmatter member.
- Members you do not name are untouched, byte for byte.
- Four things stay a hand-edit: an undeclared member, every member on a ledger
  with no declaration, a member whose value is a map or a nested list, and a
  member the item writes with a YAML anchor or alias — that last one is refused
  `extension-anchored` rather than replaced, because replacing it would change
  every node bound to the anchor.

On a provisioned ledger, treat a hand-edit like any other out-of-protocol
write: commit it, then run `claim-verify` and reconcile. The full table, the
declaration's shape, and the five extension refusal codes are in
`docs/mutation-contract.md` section 9.

### An epic's progress lives in its children, not in its status

An epic stores no progress. There is no `epic backlog -> in-progress` edge, and
asking for one is refused. Read an epic's progress off its direct children —
the items whose `parent` is that epic's ID — and never off the epic's own
`status`:

- **How far along:** direct children whose status is `done` or `killed`, over
  all direct children. That is the same set the epic's own completion needs:
  `epic backlog -> done` refuses until every direct child is `done` or
  `killed`, and it generates the rollup from exactly those children.
- **Whether anyone is on it:** the epic is *active* when at least one direct
  child is `in-progress` or holds an active work claim; *untouched* when no
  direct child has left `triage` or `backlog`; otherwise *in progress by
  derivation*. Test those three in that order.

**Mirroring a tracker that does model epic activity?** Compare its stored epic
status against the derived state above, never against the ledger's stored
`status` field. A stored-against-stored comparison reports drift that no
mutation can clear — legacy epic #1075 sat `in-progress` while its correct
ledger mirror sat `backlog` with one `in-progress` child, so the two stores
agreed on the work and disagreed only on where progress is kept. Derive, then
compare. `docs/mutation-contract.md` section 8 carries the exact definitions.

### A refused disposition is one relations patch away

Killing or archiving an item that another item still declares in `depends_on`
returns exit 5 `atomic-scope-required`:

```
error.details.blockers[]
  code: "dependent-disposition"   item_id: "wb_..."   field: "depends_on"
```

That refusal is a routing instruction, not a dead end. Read `item_id`,
`inspect` that dependent, `patch` it to move the target out of `depends_on` and
into `related`, commit, then retry the disposition with a fresh revision. Two
mutations and two reviewable diffs, never one atomic multi-item write.

### Item dates are UTC, so do not assume today

An item's `created` date is not your calendar date. `create` writes `created`
and `updated` from the item ID: the date derives from the ULID timestamp,
which is UTC. An item created just after midnight UTC carries **tomorrow's**
date for anyone west of UTC.

`transition` and `patch` refuse a `date` earlier than the item's `created` or
`updated`, so today's local date can be refused by an item minted minutes ago:

```
error.details.issues[]
  code: "date-before-created"        item_created: "2026-08-17"
  code: "date-before-updated"        item_updated: "2026-08-17"
```

Both codes carry `item_created` and `item_updated` — the item's own dates.
Read them from the refusal and resend with a date that is not earlier than
`item_updated`. Do not run `inspect` to find them, and do not invent a date to
get past the guard: the invariant is correct, your date was wrong.

### Commit every mutation before the next one

On a **provisioned** ledger (`claim capabilities` reports
`mode: "merge-coordinated"`) this is not optional:

**Commit each mutation to Git before running the next mutating command.**

```sh
wowbagger create --ledger <dir> --input request.json --json
git add <dir> && git commit -m "Record the mutation"
wowbagger claim-verify --ledger <dir> --json
wowbagger transition --ledger <dir> --input next.json --json
```

The claim store reconciles every recorded mutation with Git `HEAD` and the
working tree. It refuses the next mutation when it finds an
`unauthorized-revision`, requires Git finalization, or requires synchronization
for the target item. A synchronization finding on an unrelated item remains
visible to `claim-verify` but does not block that command.

One exact window is nonblocking: an existing item's latest authorized
working-tree bytes with an earlier authorized revision at `HEAD`. That
authorized predecessor/successor window produces no finding, so another
mutation can run before the first is committed. Do not mistake acceptance for
durability. Commit each mutation anyway, then run `claim-verify`.

`create` never gets that window. A new item has no earlier authorized revision,
so Git `HEAD` is the only place its authorized bytes can live, and an
uncommitted create blocks every later mutation — including the next create —
with `git-finalization-required`.

**`claim-verify` is the reconciliation procedure for that refusal.** Do not go
looking for another verb; there is none. Read `details.findings`, do exactly
what each finding's `remediation` string says (it names the path), run
`claim-verify` until it exits 0, then repeat the refused command. Never hand-
edit a ledger file to get past it.

For an existing ledger, bootstrap patch authority before managed corrections.
For standard tags, `declaration.json` is:

```json
{"members":{"tags":"string-list"}}
```

Review the proposal, then publish the same declaration:

```sh
wowbagger extensions-provision --ledger <dir> --input declaration.json --json --dry-run
wowbagger extensions-provision --ledger <dir> --input declaration.json --json
```

The request names every selected member and type explicitly. The core requires
a valid complete ledger, validates every occurrence of each selected member,
and reports occurrence counts; a member need not appear on every item, but it
must appear at least once. Dry-run writes nothing. Publication creates one
canonical declaration without changing item bytes and refuses to overwrite a
different declaration. Commit only `.wowbagger/extensions.json`, inspect the
target again, then patch `set.extensions.tags`. A YAML anchor or alias on that
item still refuses `extension-anchored`.

To detach or reparent an item without recreating its identity, use the
CAS-fenced relation migration:

```sh
wowbagger parent-migrate --ledger <dir> --input relation.json --json [--auto-commit]
```

The parent-migrate request is:

```json
{"id":"wb_...","expected_revision":"sha256:...","expected_parent":"wb_...","parent":null,"date":"YYYY-MM-DD"}
```

Every member is required; `expected_parent` and `parent` may be `null`. Inspect
immediately before sending it. The complete ledger validates old and new parent
accounting before publication.

Set or clear a snooze date with:

```sh
wowbagger snooze --ledger <dir> --input snooze.json --json [--auto-commit]
```

The snooze request is:

```json
{"id":"wb_...","expected_revision":"sha256:...","snoozed_until":"YYYY-MM-DD","date":"YYYY-MM-DD"}
```

Use `snoozed_until: null` to clear it. Every member is required.

Successful mutation responses also return `result.changed_paths`: the exact
ledger-relative paths changed by that invocation. Use this set for manual
staging; never broaden it to `git add <ledger>` and never treat it as proof of
commit. With `--auto-commit`, `changed_paths` matches `commit_paths`, and
`git_commit` proves the commit.

Batch work is where this bites: filing ten items means ten commits, not one
commit at the end. Tell the user that before starting. There is permanently no
batch-create mutation in the direct-Markdown architecture; serial
`create --auto-commit` calls are the supported bulk path. Run them in request
order and do not start the next until the previous result or recovery is final.

### Or use --auto-commit and let one invocation do it

On a provisioned ledger, `--auto-commit` performs that whole loop inside one
invocation. It is accepted on `create`, `transition`, `parent-migrate`, `snooze`,
`patch`, and `publish-claimed`, once each, and only with the flag present — there
is no setting that turns it on for you.

```sh
wowbagger transition --ledger <dir> --input next.json --json --auto-commit
```

One flagged invocation refuses if anything is staged anywhere or any foreign
path under the ledger is dirty, reconciles, runs the mutation unchanged,
commits exactly the changed item plus at most one
`.wowbagger/reconcile-<namespace>.md` with a fixed subject, verifies that commit,
and runs `claim-verify` before it answers. A successful `create --auto-commit`
commits exactly two paths: the created item and that reconciliation log. Every
command rebuilds its own derived reconciliation log during preflight, but
`create` refuses a log that was already dirty when you invoked it, and every
other dirty ledger path still refuses.

Preflight and post-commit reconciliation block findings for the requested item.
An unrelated `worktree-synchronization-required` finding remains visible to
`claim-verify` without turning a successful mutation into failure. If claim
verification refuses, the result preserves `claim_verify_code` and
`claim_verify_reason`; only `claim-store-locked` is retryable.

Success adds `git_commit`, `commit_paths`, and `claim_verified` to `result`.

Say these limits plainly when you use it:

- A refused mutation never commits. `state: "unchanged"` means no Git action.
- Files outside the ledger are never staged, and nothing is ever pushed.
- Hooks and signing run. It never passes `--no-verify`.
- It does not make claims exclusive. `safe_exclusive_dispatch` is still false.

When the item is published but the commit fails, the answer is exit 6
`git-commit-failed` carrying `recovery_token`. Do not retry the mutation and do
not hand-commit. Run the one recovery command, which is idempotent:

```sh
wowbagger mutation-finalize --ledger <dir> --recovery-token <token> --json
```

An ambiguous Git outcome is `git-commit-outcome-unknown` instead. Stop, report
it, and inspect before writing anything else.

## When the response is lost

A mutation you dispatched can lose its response. The process is signalled or
times out, output arrives truncated, or the connection to the machine that owns
the ledger drops. None of that watched the ledger, so none of it tells you
whether the write applied. Say that out loud instead of guessing.

Only a complete result decides anything:

- exit 0 with `state: "committed"` — it applied, exactly as returned;
- a complete refusal with `state: "unchanged"` — it did not run;
- exit 6 `post-commit-recovery-required`, `state: "committed"` — the item is
  published and cleanup remains;
- exit 6 `write-outcome-unknown`, `state: "unknown"` — publication was attempted
  and the visible bytes are indeterminate.

Everything else — signal, timeout, truncated output, no envelope, no response —
is unresolved. Do this, in order, and nothing else:

1. Dispatch once, never replay, invalidate the inspected revision, reconnect,
   then re-read the ledger.
2. Re-read with `validate`, then `inspect` the ID you already know. You minted
   the ID for a `create`; you sent the `expected_revision` for a `transition` or
   `patch`.
3. Compare what you read with what you observed before dispatching, and report
   it as current state. It never proves that the lost dispatch caused it.
4. Ask the human before any new mutation, and build that mutation on the current
   revision. Never resend the same request bytes.

Exit 4 `revision-conflict` is not response loss. It is proof the write did not
run: re-inspect, then decide again with the revision you just read.

There is no operation ID and no replay command. Do not invent one.

## Work claims are merge-coordinated

```sh
wowbagger claim capabilities --ledger <dir> --json
wowbagger provision --ledger <dir> --json
wowbagger claim capabilities --ledger <dir> --json
wowbagger claim read|acquire|renew|release --ledger <dir> --input request.json --json
wowbagger publish-claimed --ledger <dir> --input request.json --json [--auto-commit]
wowbagger claim-verify --ledger <dir> --json
wowbagger claim-sync --ledger <dir> --json
wowbagger claim-merge-verify --ledger <dir> --base <ref> --head <ref> --json
```

`--auto-commit` on `publish-claimed` commits the published item and its
reconciliation log and runs `claim-verify` in the same invocation, so the
claimed loop needs no separate commit step.

The Git-backed capability reports `mode: "merge-coordinated"` and
`safe_exclusive_dispatch: false`. Say both facts plainly. An acquire uses
observed-state compare-and-swap, and a claimed publication checks the active
owner generation and expected item revision. This protects cooperating
worktrees that use the protocol.

It is not exclusive coordination. Direct filesystem writes, hostile processes,
other clones, and alternate tools can bypass the protocol. Never present a
claim as a lock or build a dispatch loop that requires exclusive ownership.

### One worktree's private publication does not block unrelated items

The claim journal lives in the shared Git common directory, so every worktree
shares durable publication evidence. Read `result.backend.write_serialization`
from `claim capabilities`; the provisioned profile reports
`scope: "target-item-reconciliation"` and
`blocks_until: "target-item-publication-reconciled"`. Do not read the core
envelope's `limits.cross_worktree_coordination: false` as permission to write
with hostile or noncooperating tools — it only says the core never synchronizes
checkouts.

A recorded `create`, `transition`, `patch`, or claimed publication blocks
mutations targeting that same item with exit 6 `claim-store-unavailable`,
reason `publication-reconciliation-required`. An unrelated item mutation may
proceed when the only finding is `worktree-synchronization-required`.

`create` is the one exception to that scoping, because it allocates the next
number from the items this checkout can see. It also refuses when the journal
records a committed item this worktree does not hold at all: that item carries
a number nobody here can read, so the next number allocated here might already
be taken. A stale revision of an item this worktree does hold is not a blocker
for `create` — a number is immutable, so the local maximum is still right. The
refusal is the same exit 6 `claim-store-unavailable` with reason
`publication-reconciliation-required`, state `unchanged`, and no item file
written; integrate the missing item, run `claim-verify` until it exits 0, and
resend the same request, which then takes the next number.

That fence stops new collisions; it does not repair old ones through core
version 5 or claim operations. Existing duplicate numbers are item #182
recovery work. Use the separate `ledger-repair` contract:
`number-repair-proposal --ledger <dir> --json` is read-only and writes no item
file; `number-repair --ledger <dir> --input <repair.json> --json` applies a
reviewed complete mapping under the shared namespace fence. Number-only repair
preserves ULID identities and relation values. Never hand-edit the ledger:
arbitrary edits can damage IDs, paths, or references.

Read `error.details.findings[0].reason` and act on the named item:

- `git-finalization-required` — you wrote the item here and have not committed.
  Commit, then `claim-verify`.
- `worktree-synchronization-required` — another worktree wrote the item.
  `owner_ref` names an **active named worktree** and nothing else: it is always
  the branch of a live worktree that carries the expected revision. If the
  finding names `owner_ref` and `owner_commit`, WAIT for that owner to publish,
  then synchronize this checkout and run `claim-verify`. `owner_unavailable:
  true` means no such worktree exists, and it covers three cases: the expected
  revision is not reachable at all, a live sibling holds it on a detached
  `HEAD`, or it is reachable only from a tag, a remote-tracking ref, or a
  branch no worktree has checked out. Reachability is not ownership; a ref you
  can see is not a worktree that can publish. Follow the `remediation`, which
  separates those cases. A revision that is **not yet reachable** means WAIT for
  the owning worktree to commit, then synchronize. A revision that is
  **reachable in Git while no active named worktree owner is established** —
  a tag, a remote-tracking ref, an unchecked-out branch, or a detached sibling
  carries it — is not a wait at all: inspect that reachable history, then
  restore the authorized bytes or use explicit `claim-adopt` after review.
  Ownership that **cannot be established from reachable refs** — the item has
  never existed in this checkout — calls for inspecting reachable or dangling
  commits with the same explicit restore or `claim-adopt`. Never merge unrelated
  live work.
- `unauthorized-revision` — the item changed outside the protocol. Two remedies
  are explicit: **restore** the authorized revision and run `claim-verify` to
  discard the edit, or **adopt** the committed revision and run `claim-verify`
  to keep it. Ask before discarding reviewed work.

Two live worktrees answering to one identity, or a worktree roster the
coordinator could not finish reading, refuse before anything is classified.
You get exit 6 `claim-store-unavailable`, reason `claim-store-unreadable`, with
`error.details.identity_diagnostic`: `duplicate-worktree-identity` naming the
`worktree_id` and `live_worktree_count`, or `worktree-enumeration-failed` with
no further member. Auto-commit reports the same diagnostic inside
`auto-commit-preflight-failed` with `retryable: false`. Neither is retryable
and neither is yours to repair by editing files. Report the diagnostic verbatim,
including the `worktree_id` and `live_worktree_count`: a duplicate means two
live worktrees hold the same identity file, usually because a private Git
directory was copied, and which worktree keeps the UUID is a person's decision.
An enumeration failure means a registered worktree path could not be read. The
identity itself is an opaque UUID a worktree writes once into its private Git
directory. Never create, copy, or edit it.

**Choose verification scope deliberately.** Bare
`claim-verify --ledger <dir> --json` is strict repository diagnosis: any
blocking finding anywhere keeps it at exit 6. After working one item, use
`claim-verify --ledger <dir> --id <item> --json`. It keeps every repository
finding visible and marks each with `blocks_verification_scope`, but unrelated
target-scoped findings do not fail that item's gate. Global barriers still
fail every target. Never adopt or hand-edit a sibling's item to force either
scope clean.

Adoption is per item and per revision explicit. Name the item and both
revisions, take them from the finding, and commit the edited bytes first:

```sh
wowbagger claim-adopt --ledger <dir> --input adopt.json --json
```

```json
{
  "ledger_namespace": "<from claim capabilities>",
  "item_id": "<finding.item_id>",
  "from_revision": "<finding.expected_revision>",
  "to_revision": "<finding.actual_revision>",
  "adopted_by": "<your owner id>"
}
```

It refuses `adoption-revision-uncommitted` until the bytes are at Git `HEAD` and
in your own working tree, `claim-held` while a claim holds the item,
`adoption-ledger-invalid` if the ledger would not validate, and
`adoption-witness-mismatch` if the witness is stale — including a replay of an
adoption that already succeeded. It writes no item byte, so `updated` and the
body survive. Run `claim-verify` after it and require exit 0.

Two traps. Do not retry with the `expected_revision` from the refusal: a
sibling that is still working moves it, and you cannot win that race. Do not
copy the sibling's item file into your checkout: the refusal only changes to
`git-finalization-required`, which asks you to commit their work into your
branch, and the next sibling write blocks you again.

An item stays in `backlog` while claimed work runs. The active claim is the work-in-flight signal.
Do not use legacy `transition` to set `in-progress` after acquiring a claim; it
correctly refuses with `active-claim-write-refused`.

Use the claimed write path as one complete loop:

1. Before provisioning, run `claim capabilities --ledger <dir> --json`. Require
   `result.operations.work_claim.supported: true`; `false` means the ledger is
   not in an accessible Git checkout. Stop before mutation.
2. Run `provision` once for the ledger. Keep its `ledger_namespace`.
3. Run `claim capabilities --ledger <dir> --json` again. Require
   `result.operations.work_claim.api_version: 3`. Do not compare the claim
   response's top-level `contract_version` with the core version; it is the
   legacy claim-envelope marker. Stop if the namespace is absent or the mode is
   not `merge-coordinated`.
4. Read the current claim record. Acquire with its observed state in
   `expected`; keep the returned `owner_id`, `epoch`, and expiry as the fence.
5. Renew before the lease expires if the work continues.
6. Inspect the item again. Build the complete desired item bytes.
7. Call `publish-claimed` with a unique operation ID, the exact inspected
   revision, the candidate bytes and digest, and the active claim fence. Never
   retry with only the operation ID; retry the complete request.
8. Commit the item change, or merge the worker commit into the coordinating
   branch. Do this now, not at the end of a batch. Acceptance of another command
   does not prove this mutation is durable, and a blocking finding still
   refuses that command.
9. Run `claim-verify --ledger <dir> --id <item> --json` after the commit or
   merge. It finalizes the Git outcome, repairs response-loss cases, and reports
   later revision drift. Require exit 0 before the next mutating command; exit
   6 means findings block this item, so act on each blocking finding's
   `remediation` and run it again. Unrelated nonblocking findings remain
   visible for repository diagnosis.
10. Release the claim with its current observed state.
11. Run `validate` and show the resulting diff.

Steps 7 to 9 are the whole rule in order: write, commit, `claim-verify`, next
write.

Legacy `create` refuses an ID with claim history. Legacy `transition` refuses an
item with an active claim. Do not bypass those refusals. Read
`docs/work-claim-contract.md` in the wowbagger repository for exact request and
response envelopes, refusal precedence, and recovery rules.

## Working the unclaimed loop

1. `validate` the ledger.
2. `ready --as-of <today>` to see what is actually workable.
3. `inspect` the item you intend to take, and read its body — the acceptance
   criteria live there, not in the metadata.
4. Do the work.
5. `inspect` again for the current revision, then `transition` to close it.
6. `validate`, then show the diff.
7. On a provisioned ledger, commit the ledger change now:
   `git add <dir> && git commit`.
8. On a provisioned ledger, run
   `claim-verify --ledger <dir> --id <item> --json` and require exit 0 before
   the next `create`, `transition`, `parent-migrate`, `snooze`, `patch`, or
   `publish-claimed`. Use bare verification separately for strict
   repository-wide diagnosis.

Write, commit, `claim-verify`, next write. The unclaimed loop obeys the same
rule as the claimed one, because both run through the same coordinator. Steps 7
and 8 collapse into step 5 when you pass `--auto-commit`.

## Friction is a finding

If the tool makes something harder than doing it by hand, that is a defect worth
recording. File it as a ledger item rather than leaving it in a transcript —
that is what the ledger is for, and it is how this tool is meant to improve.
