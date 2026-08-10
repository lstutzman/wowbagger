# Changelog

Behaviour changes land here when they ship, not when someone remembers them.
A change to what a command accepts, refuses, emits, or writes is a behaviour
change even when the commit that carried it was labelled refactor, docs, or
consolidation. The first tagged release inherits this file.

## Unreleased

### Behaviour changes

- The shipped core mutation contract and adapter contract are version 2.
  Version 1 of each remains defined and unchanged; a v1-only consumer now
  receives `unsupported-adapter-contract-version` instead of silently
  receiving the wider adapter surface.
- Schema version 2 treats `depends_on` as retained prerequisite history: a
  target satisfies the dependency exactly when it is `done`, completion keeps
  the ID in `depends_on`, and it does not copy the ID to `related`. Mixed
  schema-version ledgers remain invalid. The repository ledger is not migrated
  by this change.
- Core contract version 2 always reports mutation coordination as
  `same-working-copy-cooperative-writers` and cross-worktree mutation
  coordination as false. Advisory claim visibility may still cross worktrees
  through the Git common directory under `operations.work_claim`; it does not
  fence or widen mutation publication.
- Adapter contract version 2 advertises and forwards approved `patch` requests
  with exact stdin bytes and the same mutation-unknown recovery discipline as
  create and transition.
- A claim request carrying an own `__proto__` member is refused as
  `invalid-request`. Previously three of four drifted JSON normalizer copies
  silently erased the member, so the shipped adapter accepted a request its
  own conformance runner would have refused. The consolidation into one
  normalizer (`src/request.js`) shipped inside an adapter commit and is a
  behaviour change, not a refactor. No stored data is affected: the old code
  erased such a member before it could be persisted.
- `create` refuses a malformed `number` or `priority` at the request level
  with an `/item/number` or `/item/priority` issue. Previously a bad value
  surfaced later as a generic `candidate-invalid`.
- `create` serializes caller-supplied `number` directly after `id` and
  `priority` directly after `kind`. Previously both landed after the
  extension members at the end of the frontmatter.
- The refusal for a caller-supplied `status` on create now teaches the
  lifecycle rule: create assigns triage, and a transition from triage to
  backlog accepts the item into ready.
- `inspect`, `create`, `transition`, and `patch` results include `number` and
  `priority` in `core` when the item carries them. Previously both were
  recoverable only by decoding `source_base64`.

### Added

- `wowbagger --help` prints the command inventory and exits 0; `wowbagger <command> --help`
  prints that command's usage and exits 0; `wowbagger --version` prints the distribution
  version from package.json and exits 0. An unknown command now suggests a close match
  (or points at `--help`) instead of throwing the bare ready usage. Existing JSON
  contracts, exit codes, and usage-error refusals for genuinely wrong arguments are
  unchanged.
- `scripts/migrate-schema-2.js` dry-runs a schema-version-1 ledger migration by
  default and requires `--apply` to write. It refuses invalid schema-1 or
  schema-2, mixed, already migrated, empty, or locked ledgers; reports each
  item; validates the complete schema-version-2 result; and directs partial
  failures to backup/Git recovery.
- `wowbagger patch` changes an item's caller-supplied fields — `number` and
  `priority` — under the same per-ID lock, revision compare-and-swap, and
  candidate validation as transition. Mutation contract section 9.
- `wowbagger mint-id` prints a canonical item ID; `--date` selects the
  creation date; `src/mint.js` exports `mintId`. No consumer writes Crockford
  base32 again.
- `ready` without `--json` prints a human queue: `#number pri=priority title`
  per ready item, in ready order. `ready --json` is byte-identical to before.
- `priority` restored to the ready ordering with validation, and `number`, a
  short integer handle, on every item (shipped 2026-08-07; recorded in
  ADR-0006).
