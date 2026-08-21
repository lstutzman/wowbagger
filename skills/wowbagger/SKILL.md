---
name: wowbagger
description: Use when coordinating work through a wowbagger ledger — reading the ready queue, inspecting or filing an item, generating an HTML ledger report, transitioning one through its lifecycle, taking a work claim, or publishing claimed work. Triggers on "ready queue", "ledger report", "backlog report", "what should I work on", "file a ledger item", "close this item", "claim this work", "publish claimed work", or any mention of a wowbagger ledger. Not for general backlog talk where no wowbagger ledger exists.
---

# Wowbagger

A work ledger that is plain Markdown in Git. Every item is a file; every change
is a reviewable diff. The core is read-only unless you explicitly ask it to
publish something.

## Before anything else: check the core

This skill does **not** bundle the wowbagger core. It drives an installed one,
so a version mismatch is detectable rather than silent.

```sh
wowbagger --version
wowbagger capabilities --json
```

Read the plain distribution version from the first command and the top-level
`contract_version` from the second. **This skill requires distribution version
`0.1.0-alpha.7` and core `contract_version: 5`.**

The distribution pin names the published `0.1.0-alpha.7` release; the cut that
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
- `contract_version` is anything other than `4` → stop and say so plainly. A
  core reporting `1` predates schema version 2, where `depends_on` records
  declared prerequisites rather than only live blockers. A core reporting `2`
  predates the widened date-refusal issue shape, the `depends_on`/`related`
  patch field set, and core-assigned item numbers. A core reporting `3` accepts
  an item source of any size, so it publishes items this skill's bound would
  refuse. An older or newer core may have changed the request or response
  shape. Do not guess.

Run both commands once per session before the first ledger command, not before
every command.

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
`contract_version: 5`, `result.report_version: 1`, and the requested
`result.as_of`. Read the generated file from the absolute `result.output`.
On failure, require `ok: false` and inspect `error.code`; do not treat an
existing output as fresh because failed publication preserves the prior report.

The report ends its decision surface with a 3D dependency graph of the whole
ledger. Its renderer is a pinned, checksummed `3d-force-graph` build vendored
at `vendor/3d-force-graph/` and inlined at generation time, so the report is
still one self-contained file that fetches nothing — it is roughly 1.3 MB
larger for it. A browser without WebGL shows the graph section's plain
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
  ledger stays on version 1 until its complete ledger is migrated.
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
- Patch appends no decision; the Git diff is the audit trail. It never mutates
  a second item, and it cannot touch status or provenance.

**Which fields are yours.** Do not discover this by sending a patch and reading
the refusal — every frontmatter member is in exactly one of three classes:

- **Core-owned**, never yours: `schema_version`, `id`, `number`, `status`,
  `created`, `updated`, the terminal dates (`completed`, `killed`, `archived`,
  `deferred`), and `decisions`. `transition` writes these; nothing else does.
- **Consumer-editable through `patch`**: `title`, `priority`, `depends_on`,
  `related`, the body, and every extension member the ledger declares.
- **Create-once**: `kind`, `provenance`, `parent`, `snoozed_until`. Set at
  `create` and fixed after. `kind` is refused deliberately — a task-to-epic
  flip changes which parent and children rules apply and which lifecycle edges
  are allowed, so it needs its own verb, not a wider `set`.

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

The claim store validates every recorded mutation against Git `HEAD`, never
against working-tree bytes — that is what makes a mutation durable rather than
a local edit. So an uncommitted mutation blocks the next one. Skip the commit
and the next `create`, `transition`, `patch`, or `publish-claimed` returns
exit 6 `claim-store-unavailable` with
`details.reason: "publication-reconciliation-required"`. `state` is
`unchanged`, so nothing was written.

**`claim-verify` is the reconciliation procedure for that refusal.** Do not go
looking for another verb; there is none. Read `details.findings`, do exactly
what each finding's `remediation` string says (it names the path), run
`claim-verify` until it exits 0, then repeat the refused command. Never hand-
edit a ledger file to get past it.

Batch work is where this bites: filing ten items means ten commits, not one
commit at the end. Tell the user that before starting a batch.

### Or use --auto-commit and let one invocation do it

On a provisioned ledger, `--auto-commit` performs that whole loop inside one
invocation. It is accepted on `create`, `transition`, `patch`, and
`publish-claimed`, once each, and only with the flag present — there is no
setting that turns it on for you.

```sh
wowbagger transition --ledger <dir> --input next.json --json --auto-commit
```

One flagged invocation refuses if anything is staged anywhere or any path under
the ledger is dirty, reconciles, runs the mutation unchanged, commits exactly
the changed item plus at most one `.wowbagger/reconcile-<namespace>.md` with a
fixed subject, verifies that commit, and runs `claim-verify` before it answers.
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

## Work claims are merge-coordinated

```sh
wowbagger claim capabilities --ledger <dir> --json
wowbagger provision --ledger <dir> --json
wowbagger claim capabilities --ledger <dir> --json
wowbagger claim read|acquire|renew|release --ledger <dir> --input request.json --json
wowbagger publish-claimed --ledger <dir> --input request.json --json [--auto-commit]
wowbagger claim-verify --ledger <dir> --json
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

### One worktree's write blocks the others

The claim journal lives in the shared Git common directory, so **one journal
serializes every worktree of one repository**. Read the scope from
`result.backend.write_serialization` in `claim capabilities`; the provisioned
profile reports `scope: "all-worktrees-of-one-repository"`. Do not read the
core envelope's `limits.cross_worktree_coordination: false` as permission to
write in parallel — it only says the core never synchronizes checkouts.

A recorded `transition` or `patch` in one worktree refuses every mutation in
the others with exit 6 `claim-store-unavailable`, reason
`publication-reconciliation-required`, until the writing commit is visible in
the blocked checkout. `create` records nothing, so `create` never causes a
block — but it is usually the command that gets refused by one.

Read `error.details.findings[0].reason` and say which case it is:

- `git-finalization-required` — you wrote it here and have not committed.
  Commit, then `claim-verify`.
- `worktree-synchronization-required` — another worktree wrote it. Stop
  writing. Wait for that worktree to commit and push, remove the untracked
  reconcile log, pull or merge, run `claim-verify`, then resume.
- `unauthorized-revision` — the item was changed outside the protocol. Two
  remedies, and the choice is the operator's, not yours. **Restore** the
  authorized revision and `claim-verify`: this discards the edit. **Adopt** the
  committed revision and `claim-verify`: this keeps the edit and moves the
  authorized revision to it. Ask before you discard reviewed work.

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
   `result.operations.work_claim.api_version: 2`. Do not compare the claim
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
   branch. Do this now, not at the end of a batch — the next mutating command
   refuses while this one is uncommitted.
9. Run `claim-verify` after the commit or merge. It finalizes the Git outcome,
   repairs response-loss cases, and reports later revision drift. Require exit
   0 before the next mutating command; exit 6 means findings remain, so act on
   each `remediation` string and run it again.
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
8. On a provisioned ledger, run `claim-verify --ledger <dir> --json` and
   require exit 0 before the next `create`, `transition`, or `patch`.

Write, commit, `claim-verify`, next write. The unclaimed loop obeys the same
rule as the claimed one, because both run through the same coordinator. Steps 7
and 8 collapse into step 5 when you pass `--auto-commit`.

## Friction is a finding

If the tool makes something harder than doing it by hand, that is a defect worth
recording. File it as a ledger item rather than leaving it in a transcript —
that is what the ledger is for, and it is how this tool is meant to improve.
