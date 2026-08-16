# Changelog

Behaviour changes land here when they ship, not when someone remembers them.
A change to what a command accepts, refuses, emits, or writes is a behaviour
change even when the commit that carried it was labelled refactor, docs, or
consolidation. The first tagged release inherits this file.

## Unreleased

### Changed

- **The core contract version is now `3`.** Every core command envelope
  (`capabilities`, `inspect`, `create`, `transition`, `patch`, `mint-id`,
  `report`) carries `contract_version: 3`, the shipped adapters require core
  contract version 3, and the installed skill's version check gates on 3. A
  version 1 or version 2 consumer fails closed against this core, which is the
  point of the bump. Version 3 is version 2 plus four deltas against published
  `0.1.0-alpha.4`: the widened `date-before-created` / `date-before-updated`
  issue shape carrying `item_created` and `item_updated` (the delta that forced
  the bump — a version 2 consumer validating issue members exactly refuses the
  six-member shape); the patch field set widening from `number`/`priority` to
  `priority`/`depends_on`/`related`; number as the core-assigned immutable item
  identity on schema version 2, with `create` refusing a supplied number and
  `inspect` accepting `--number`; and `create` deriving its published path from
  a committed `.wowbagger/layout.json`. The mutation contract's "Contract
  versions" section carries the full enumeration. The legacy work-claim,
  ledger-publication, and ledger-mutation envelopes and
  `result.operations.work_claim.api_version` are separate version domains and
  stay at 1; the adapter contract stays at 2.

### Added

- One envelope rule now covers every `--json` response. The mutation contract
  states the response domains (core, work-claim, ledger-publication,
  ledger-mutation, and bare result), the dispatch steps a generic consumer
  follows, which domain each command's success and each refusal class answers
  in, and the exact root members of each shape. Both sanctioned exceptions are
  stated with their reasons: `validate` and `ready` stay bare results because
  scripts and fixtures depend on those bytes, and a claim-fenced refusal to
  `create`, `transition`, or `patch` answers in the `ledger-mutation` domain
  with `command: "<command>-v1"` and `contract_version: 1` because it is the
  work-claim contract refusing, not the core contract. The work-claim contract
  now names all three of its `namespace` values.
  `spec/fixtures/envelope-domains/manifest.json` pins all 37 response classes,
  and `test/envelope-dispatch.test.js` walks every one of them through the
  documented dispatch rule and rejects drift in either direction. No emitted
  byte changed and no contract version moved.
- `report` now renders a sequencing dashboard instead of a state snapshot. The
  HTML opens with **Work next**, the ready set in a recommended order with the
  factors that placed each entry printed beside it; then **Attention**, naming
  blockers by number, the oldest open work with its age, and started work past
  this ledger's own 85th-percentile cycle time; then an evidence layer with
  aging buckets, weekly arrivals against completions, accept-to-complete cycle
  time, and a Monte Carlo forecast as 50 and 85 percent bands. State counts,
  item cards, and swarm batches remain, below that decision surface. Relations
  and readiness reasons inside the drill-down now name items by number.
  Ordering is a report-layer derivation, recomputed from ledger bytes at render
  time and never persisted: `ready --json`, its four-step order, and the
  mutation contract are unchanged. The report file stays self-contained with no
  external runtime dependency.
- Report configuration accepts two more `fields` mappings, `class` and `due`.
  `class` is a class of service from `expedite | fixed-date | standard |
  intangible`; `expedite` lifts an item above every other ready item, an absent
  value means `standard`, and an unrecognised value is ranked as standard and
  reported in the report rather than dropped. `due` is an ISO calendar date
  ordered by proximity. Both ride the existing extension-member channel, so no
  core field carries them.
- The commit-per-mutation invariant is documented. On a provisioned ledger,
  every mutation must be committed to Git before the next mutating command,
  and `claim-verify` is the reconciliation procedure for the exit 6
  `publication-reconciliation-required` refusal. The mutation contract, the
  work-claim contract, the README, and the installed skill's claimed and
  unclaimed loops all state the rule and the loop it implies. The mutation
  contract also records why validating against working-tree bytes was
  rejected.
- `claim capabilities --ledger <dir> --json` now advertises
  `result.backend.write_serialization`. A provisioned Git-journal backend
  reports `scope: "all-worktrees-of-one-repository"` and
  `blocks_until: "peer-commit-visible-in-this-checkout"`; an unprovisioned
  backend reports `scope: "none"`. This makes the serialization the shared
  Git-common-directory journal already performed discoverable instead of
  implied. The core `capabilities` envelope is unchanged; this change is not
  one of the version 3 deltas.

- A `date-before-created` or `date-before-updated` issue now carries
  `item_created` and `item_updated` after `related_ids` — the target item's own
  dates at refusal time, both dates on both codes, on `transition` and `patch`
  alike. One refusal now states the whole acceptable date window, so correcting
  the request no longer costs an `inspect` round-trip. No other issue code
  changes shape; a consumer that validates issue members exactly must accept
  six members for these two codes. This widening is the reason the core
  contract version moves to 3 (see Changed, above).
  The mutation contract and the installed skill now also state that `create`
  derives `created` from the ULID timestamp, which is UTC, with the
  across-midnight example that produces this refusal.

### Fixed

- A mutation on a large provisioned ledger no longer spends its wall time in
  process spawns. Git HEAD reconciliation read every committed item with its
  own `git show`, one subprocess per item, serially; it now reads them with
  one `git cat-file --batch` subprocess per 16 MiB of tree content. On a
  1,500-item fixture a create fell from about 15.4 s to about 1.2 s and a
  transition from about 15.4 s to about 1.3 s. The reconciliation reads the
  same bytes for the same items, and no validation is skipped: candidate
  validation still validates the complete ledger.

- Every reconciliation finding that blocks a mutation now carries a
  `remediation` string naming the path to act on and `claim-verify`.
  `revision-regression`, `legacy-mutation-outcome-unknown`, and
  `publication-outcome-unknown` previously blocked with no recovery action;
  they now also carry `expected_path` when it is identifiable.

- A committed `.wowbagger/layout.json` now binds the ledger's item directory.
  `create` derives its path from that configuration. Validation rejects parsed
  items outside it, special or symbolic layout files, and metadata-directory
  aliases. Malformed configuration fails closed. Ledgers without the file
  retain the root-level `<id>.md` layout.
- A refused legacy mutation and a clean `claim-verify` now leave the ledger
  working tree byte-identical. The tracked reconciliation log projects only
  journal entries that record a decision, so per-invocation clock entries no
  longer dirty it, and a successful legacy mutation now projects its own
  entries before returning instead of one command later. Batch tooling no
  longer needs to stage the log after a failure.
- `claim-verify` now classifies stale writes as unauthorized revisions, missing
  Git finalization, worktree synchronization, or pending claimed publication.
  Working-tree deletions of an authorized Git revision are unauthorized.
  Findings name the expected item path and give a direct recovery action.
- The contracts and the skill now state that a provisioned ledger's claim
  journal serializes every worktree of one repository, and that a recorded
  write blocks mutations in the other worktrees until its commit is visible
  there. `limits.cross_worktree_coordination: false` is documented as "the
  core never synchronizes checkouts", not as independent worktree writes.
  Both stale-write remedies, the moving-`expected_revision` trap, and the
  failed copy-the-item-in workaround are documented and pinned by tests.

## 0.1.0-alpha.4 - 2026-08-14

### Added

- `report` validates a ledger and atomically writes a deterministic,
  self-contained HTML report from `.wowbagger/report.json`. The report includes
  canonical readiness, semantic-field search, filters, sorting, grouping,
  three detail levels, terminal history, and optional area-diverse swarm
  batches. This repository includes a local report configuration and ignores
  the generated artifact.

### Fixed

- The Claude Code adapter now declares Darwin `supported`. Native Darwin
  conformance passes all 183 common-vector assertions across all 15 cases, so
  configured consumer workspaces can invoke the published adapter read path.

## 0.1.0-alpha.3 - 2026-08-12

### Fixed

- Published install and upgrade guidance now names this release's immutable Git
  tag and uses the prerelease `next` npm channel instead of the older `latest`
  artifact. Item 62.
- The installed plugin skill now requires the exact core distribution version
  that shipped with it, in addition to core contract version 2. This detects an
  older core that shares the contract number but lacks behavior required by the
  newer skill. Item 64; item 63 records the rejected capability-schema change.

## 0.1.0-alpha.2 - 2026-08-12

### Fixed

- `claim-verify` now reports `git_finalized` and `git_commit` for each successful
  claimed publication. Reconciliation logs stay inside the configured ledger,
  including repository-root ledgers. Items 55-57.
- A new empty ledger now starts on schema version 2. Existing non-empty
  schema-version-1 ledgers remain compatible until migration. Item 54.
- The installed skill now identifies the active claim as the work-in-flight
  signal while the item remains in `backlog`. Item 58.
- The npm package now ships the mutation and work-claim contract documents that
  the installed skill references. Item 59.
- The npm package now ships the documented schema-version-2 migration
  entrypoint for package-only consumers. Item 60.
- The installed work-claim contract now distinguishes durable reconciliation
  state from per-publication Git finalization. Item 61.

- The Claude Code plugin manifest and marketplace metadata now use the same
  distribution version as `package.json`. The packaging gate rejects release
  identity drift before npm, Git, or marketplace publication. Item 48.
- Capability help now distinguishes the core's unbound default claim profile
  from one provisioned ledger's work-claim profile. It names
  `contract_version` as the core version and
  `operations.work_claim.api_version` as the work-claim API version. Items 47
  and 51.
- `provision --help`, README, and the shipped skill now expose the accessible
  Git-checkout prerequisite and the pre-provision
  `claim capabilities --ledger <dir> --json` gate. Item 50.
- The isolated consumer dogfood runbook now creates or selects the disposable
  worktree before agent launch and requires a session-root Git preflight before
  installation or ledger mutation. Item 52.

## 0.1.0-alpha.1 - 2026-08-11

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
