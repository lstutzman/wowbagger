# Design — number as the human-facing identity (2026-08-15)

## Problem

The maintainer asked for human-readable IDs as the public face of items. The
data model already says so — CONTEXT.md: *"number / handle — the short integer
humans say ('item 30'); never identity — the ULID is identity."* But every
machine surface and the skill speak the `wb_` ULID:

- `ready --json` returns `result.ready` as an array of ULID strings
  (`src/ready.js` `selectReady` → `.map(item.data.id)`); the one output that
  tells an agent what to work on never mentions the number.
- `inspect` resolves only `--id wb_…` (`src/cli.js`); no number lookup.
- `create`/`transition`/`patch` reference items by ULID in their request JSON.
- `skills/wowbagger/SKILL.md` shows `--id wb_…` in every example; the number is
  never mentioned.

So agents parrot the ULID because it is the only word the tools and skill say.

The number is also weaker than an identity: `inspectOptionalNumber`
(`src/validate.js`) makes it optional, and it is mutable via `patch`
(`PATCHABLE_FIELDS = ['number','priority']`). Something optional and mutable is
not an identity.

## Decision

Make the integer `number` a real identity — required, unique, immutable,
core-assigned — and make it the face that tools and the skill speak. The ULID
stays as the internal surrogate key (on-disk filename, publication fence, merge
safety); humans and agents never see it in normal use.

Gated on `schema_version === 2` so the whole change lands as a schema-2
refinement with **no `CORE_CONTRACT_VERSION` bump** — the same mechanism the
project already uses for stricter schema-2 rules (e.g. `depends_on` semantics).
This deliberately avoids the contract-v2 break the project rejected in item 63
and keeps the adapter/conformance suite (oracle + fixtures + manifest)
untouched.

### Allocation: on create

Empirically the ledger already assigns numbers at creation (triage items 71–82
carry numbers), matching GitHub issue/PR numbering — identity exists from birth.
So the core assigns the number the instant a schema-2 item is created:
`number = 1 + max(existing numbers in the ledger)`, or 1 if none. Computed under
the existing `NUMBER_INDEX_LOCK_ID` so concurrent creates in one working copy do
not collide. Offline concurrent creates in separate clones can still pick the
same integer; that is caught by the existing `duplicate-number` validation error
and resolved at merge — the case `validate.js` already anticipates.

### Rules

- **D1 — required on schema 2.** A schema-2 item MUST carry a valid positive
  integer `number` (`missing-number` error when absent). Schema 1 unchanged
  (number optional). Duplicates remain `duplicate-number` (unchanged).
- **D2 — core-assigned, caller may not supply (strict DB-identity).** `create`
  rejects a caller-supplied `item.number` (controlled field, like `status`).
  On a schema-2 ledger the core assigns `max+1`; on schema 1 it assigns nothing
  (legacy items stay number-optional).
- **D3 — immutable.** `patch` no longer accepts `number`
  (`PATCHABLE_FIELDS = ['priority']`). `transition` never touches it. Assigned
  once, at create, forever.
- **D4 — addressing by number.** `inspect --number N` resolves N to the ULID
  (`item-not-found` when absent, `ambiguous-number` when a duplicate exists).
  `--id` still works. `ready --json` carries `number` alongside `id`.
- **D5 — migration assigns numbers.** The schema 1→2 migration tool assigns
  `max+1` numbers to any item that lacks one, so a migrated ledger satisfies D1.
- **D6 — the skill speaks numbers.** `SKILL.md` instructs agents to refer to
  items to the human as `#N` and to use `--number`/the ULID only as the tool
  argument.

## Non-goals

- No `CORE_CONTRACT_VERSION` bump; no adapter-wire change.
- Schema-1 behavior is unchanged except that `create` no longer accepts a
  caller number (legacy create yields a number-less schema-1 item, still valid
  under schema 1).

## Blast radius

`src/validate.js`, `src/mutation.js` (create, patch, locks), `src/cli.js`
(inspect, ready, parse), `src/ready.js`/report surfaces, `src/schema-migration.js`,
`spec/adapter-reference.js` (oracle — number-aware patch/create paths, mirrored
carefully and never merged with `src/`), schema-2 fixtures lacking a number,
and the test suites for number/create/patch/migration/cli. `SKILL.md`.

## Verification

The four-command block (both Node runtimes, adapter conformance, ledger
validate) plus mutation-guarded tests for each new rule. Coverage judged by
mutation: break each guard, confirm a test goes red.
