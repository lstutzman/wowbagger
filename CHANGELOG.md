# Changelog

Behaviour changes land here when they ship, not when someone remembers them.
A change to what a command accepts, refuses, emits, or writes is a behaviour
change even when the commit that carried it was labelled refactor, docs, or
consolidation. The first tagged release inherits this file.

## Unreleased

### Behaviour changes
- **Merge-coordinated work claims (item 17):** Provisioned Git-backed ledgers
  now expose durable claim acquire/read/renew/release operations in Git's shared
  common directory. `publish-claimed` fences one-item publication against the
  active owner generation and expected revision, and `claim-verify` reconciles
  committed, merged, response-loss, and later-revision outcomes. The capability
  reports `mode: "merge-coordinated"`, `claim_protected_publication: true`, and
  `safe_exclusive_dispatch: false`; direct writes, other clones, and
  non-claim-aware tools remain bypasses.

- **Bootstrap wire (item 39):** `describe` and `invoke` both bound their stdin
  read to the configured `max_request_bytes` (describe was unbounded before).
  An unknown operation is refused as `invalid-invocation` before any stdin is
  read, instead of reading stdin and hanging or misreporting a malformed read
  as a describe error. Refusal messages moved to a single
  `src/adapter/messages.js` source; the wire no longer carries a bare literal.
  The split refusal message now appears in exactly one shipped place. Item 39.
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
  coordination as false. Work-claim coordination is a separate capability:
  unprovisioned Git ledgers remain advisory, while provisioned Git ledgers can
  report merge-coordinated claim-protected publication. Neither profile widens
  the mutation backend's fixed scope or advertises safe exclusive dispatch.
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

- `wowbagger` is distributed as a public npm package with a `wowbagger` binary
  (`npm install -g wowbagger`), alongside the git-ref install route. The
  package ships `bin`, `src`, the skill, and every adapter. README gains an
  Installation, Compatibility, and Security section. Item 11.
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
