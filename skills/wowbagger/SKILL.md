---
name: wowbagger
description: Use when coordinating work through a wowbagger ledger — reading the ready queue, inspecting or filing an item, transitioning one through its lifecycle, or taking an advisory work claim. Triggers on "ready queue", "what should I work on", "file a ledger item", "close this item", "claim this work", or any mention of a wowbagger ledger. Not for general backlog talk where no wowbagger ledger exists.
---

# Wowbagger

A work ledger that is plain Markdown in Git. Every item is a file; every change
is a reviewable diff. The core is read-only unless you explicitly ask it to
publish something.

## Before anything else: check the core

This skill does **not** bundle the wowbagger core. It drives an installed one,
so a version mismatch is detectable rather than silent.

```sh
wowbagger capabilities --json
```

Read `contract_version` from the result. **This skill requires
`contract_version: 2`.**

- Command not found → the core is not installed. Tell the user, point them at
  <https://github.com/lstutzman/wowbagger>, and stop. Do not fall back to
  editing ledger files by hand — hand-edits bypass validation and atomic
  publication, which is the whole point of the tool.
- `contract_version` is anything other than `2` → stop and say so plainly. A
  core reporting `1` predates schema version 2, where `depends_on` records
  declared prerequisites rather than only live blockers; an older or newer core
  may have changed the request or response shape. Do not guess.

Run this once per session before the first ledger command, not before every
command.

## Reading

These never modify anything. Prefer them.

```sh
wowbagger validate --ledger <dir> --json
wowbagger ready     --ledger <dir> --as-of <YYYY-MM-DD> --json
wowbagger inspect   --ledger <dir> --id wb_... --json
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

## Writing

Every write is an explicit, reviewable Git change. Show the user the command
before running it.

```sh
wowbagger create     --ledger <dir> --input request.json --json
wowbagger transition --ledger <dir> --input request.json --json
```

- `create` publishes only a caller-supplied canonical ID, atomically and
  no-clobber. It will not invent an ID for you.
- `transition` changes **one** item. If the change would require touching a
  dependent or a child, it refuses. That refusal is correct — make it a
  reviewable multi-file Git change instead of forcing it.
- See `docs/mutation-contract.md` in the wowbagger repository for the request
  and response shapes.
- After any write, run `validate` and show the user the resulting diff.

## Work claims are advisory

```sh
wowbagger provision --ledger <dir> --json
wowbagger claim capabilities --json
wowbagger claim read|acquire|renew|release --json
```

`claim capabilities` reports `mode: "advisory"` and
`safe_exclusive_dispatch: false`. **Say that plainly whenever claims come up.**

An advisory claim is a courtesy note that someone is working on an item. It
enforces nothing. Two agents can hold the same claim. Do not tell a user a claim
makes concurrent work safe, and do not build a dispatch loop on top of one.
Fenced claims — the kind that actually enforce — are unimplemented.

`publish-claimed` exists and always refuses. Do not offer it.

## Working the loop

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
