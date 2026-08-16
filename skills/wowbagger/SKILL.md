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
`0.1.0-alpha.4` and core `contract_version: 2`.**

- Command not found → the core is not installed. Tell the user, point them at
  <https://github.com/lstutzman/wowbagger>, and stop. Do not fall back to
  editing ledger files by hand — hand-edits bypass validation and atomic
  publication, which is the whole point of the tool.
- If the distribution version is missing or is different, stop and report the
  installed and required versions. An older core can share contract version 2
  while still lacking behavior this skill requires. Do not guess from the
  contract version alone.
- `contract_version` is anything other than `2` → stop and say so plainly. A
  core reporting `1` predates schema version 2, where `depends_on` records
  declared prerequisites rather than only live blockers; an older or newer core
  may have changed the request or response shape. Do not guess.

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
`contract_version: 2`, `result.report_version: 1`, and the requested
`result.as_of`. Read the generated file from the absolute `result.output`.
On failure, require `ok: false` and inspect `error.code`; do not treat an
existing output as fresh because failed publication preserves the prior report.

The generated HTML does not authorize transitions, claims, or parallel work.
It has no live ledger revision. Its readiness state is the canonical projection
at generation time, but the file is only a static view. Area-diverse batches are
scheduling hints. Use `inspect` plus `transition` for lifecycle changes and the
claim commands below for coordination.

## Writing

Every write is an explicit, reviewable Git change. Show the user the command
before running it.

```sh
wowbagger create     --ledger <dir> --input request.json --json
wowbagger transition --ledger <dir> --input request.json --json
```

- `create` publishes only a caller-supplied canonical ID, atomically and
  no-clobber. It will not invent an ID for you.
- **Where `create` publishes is the ledger's decision, not the caller's.** A
  committed `<ledger>/.wowbagger/layout.json` holding exactly
  `{"layout_version":1,"items_directory":"items"}` makes `create` publish
  atomically to `<items_directory>/<id>.md`; without the file it publishes to
  `<ledger>/<id>.md`. Configure it, and commit the directory it names, before
  the first `create` — no file is renamed afterwards. Cores at
  `0.1.0-alpha.4` and earlier ignore the file and publish at the ledger root.
- `create` starts an empty ledger on schema version 2 and returns the selected
  version at `result.item.core.schema_version`. A non-empty schema-version-1
  ledger stays on version 1 until its complete ledger is migrated.
- `transition` changes **one** item. If the change would require touching a
  dependent or a child, it refuses. That refusal is correct — make it a
  reviewable multi-file Git change instead of forcing it.
- See `docs/mutation-contract.md` in the wowbagger repository for the request
  and response shapes.
- After any write, run `validate` and show the user the resulting diff.

## Work claims are merge-coordinated

```sh
wowbagger claim capabilities --ledger <dir> --json
wowbagger provision --ledger <dir> --json
wowbagger claim capabilities --ledger <dir> --json
wowbagger claim read|acquire|renew|release --ledger <dir> --input request.json --json
wowbagger publish-claimed --ledger <dir> --input request.json --json
wowbagger claim-verify --ledger <dir> --json
```

The Git-backed capability reports `mode: "merge-coordinated"` and
`safe_exclusive_dispatch: false`. Say both facts plainly. An acquire uses
observed-state compare-and-swap, and a claimed publication checks the active
owner generation and expected item revision. This protects cooperating
worktrees that use the protocol.

It is not exclusive coordination. Direct filesystem writes, hostile processes,
other clones, and alternate tools can bypass the protocol. Never present a
claim as a lock or build a dispatch loop that requires exclusive ownership.

An item stays in `backlog` while claimed work runs. The active claim is the work-in-flight signal.
Do not use legacy `transition` to set `in-progress` after acquiring a claim; it
correctly refuses with `active-claim-write-refused`.

Use the claimed write path as one complete loop:

1. Before provisioning, run `claim capabilities --ledger <dir> --json`. Require
   `result.operations.work_claim.supported: true`; `false` means the ledger is
   not in an accessible Git checkout. Stop before mutation.
2. Run `provision` once for the ledger. Keep its `ledger_namespace`.
3. Run `claim capabilities --ledger <dir> --json` again. Require
   `result.operations.work_claim.api_version: 1`. Do not compare the claim
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
   branch.
9. Run `claim-verify` after the commit or merge. It finalizes the Git outcome,
   repairs response-loss cases, and reports later revision drift. Run it again
   before the next fenced operation if the prior outcome was not final.
10. Release the claim with its current observed state.
11. Run `validate` and show the resulting diff.

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

## Friction is a finding

If the tool makes something harder than doing it by hand, that is a defect worth
recording. File it as a ledger item rather than leaving it in a transcript —
that is what the ledger is for, and it is how this tool is meant to improve.
