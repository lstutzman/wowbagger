# Changelog

What belongs in this file: every change a consumer can observe. That means a
change to the item schema, to ready or validate output, to a CLI command or its
exit codes, to a JSON envelope or an error code, to the adapter contract, or to
the plugin. A behaviour change belongs here even when it arrives inside a commit
about something else — especially then, because that is the change most likely
to reach a consumer unannounced.

What does not belong: internal refactoring with no observable effect, test-only
changes, and ledger or handoff edits.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project intends to follow [Semantic
Versioning](https://semver.org/spec/v2.0.0.html). The repository has no tagged
release yet, so everything below is unreleased.

## [Unreleased]

### Added

- `patch`, a guarded single-item frontmatter replacement. It changes exactly
  `priority`, `number`, `parent`, `depends_on`, and `title`, under the same
  per-ID lock, exact-byte revision compare-and-swap, candidate validation, and
  atomic publication that `transition` uses. It requires an `expected_revision`
  and a decision with a summary and rationale; a silent priority change is the
  failure [ADR 0006](docs/adr/0006-priority-is-a-contract-field.md) records.
  `status` stays with `transition`, so no second path can bypass the decision
  record that transition appends. Request shape in
  `docs/mutation-contract.md` section 8A (`286ca74`).
- `mint-id`, and an exported `mintId()` in `src/mint-id.js`, which produce a
  canonical contract-valid ID. `--date` pins the encoded timestamp to the start
  of that UTC day so the ID agrees with the item's `created`. Both reuse the
  validator's own Crockford alphabet and calendar-date rule rather than copying
  them. Before this, every consumer wrote their own base32 encoder before they
  could file anything (`286ca74`).
- `ready` with no `--json` prints a human table of number, priority, and title
  in the existing ready order. `ready --json` is unchanged (`286ca74`).

- `priority` validation. `priority` MUST be a non-negative integer. An invalid
  value is now the validation error `invalid-priority`. Before this,
  `priority: high` validated clean and the ordering ignored it silently
  (`b0ee411`).
- `number`, a short positive integer handle on every item, unique within one
  ledger and validated. It exists so people can say "item 30" instead of a
  26-character ULID. It is explicitly not identity: publication, references,
  and filenames still use the immutable ID, and a duplicate number is a
  `duplicate-number` validation error a merge resolves (`eac8954`).
- The Claude Code adapter, Plan 1 of 3: a shared engine in `src/adapter/`, a
  runnable package in `adapters/claude-code/`, and an executable conformance
  runner for the adapter fixtures. Section 10's platform status table still
  reads `Unverified` for every platform (`68154f5` and following).
- A self-hosted Claude Code plugin. The repository carries both the plugin and
  its marketplace in `.claude-plugin/`, so a consumer can run
  `plugin marketplace add lstutzman/wowbagger`. The skill drives an installed
  core, checks `contract_version` once per session, and refuses when the core is
  absent or reports anything other than 1. This install path is not yet
  verified by anyone other than its author (`84ed5b2`).

### Fixed

- `patch` could write bytes the caller never requested and report success.
  Patching an anchored field wrote through the YAML anchor and silently
  changed an aliasing field the request never named; removing a field that
  carried a YAML comment destroyed the comment. Both returned exit 0 with
  `state: committed`. The cause was an ignore list: the patched field names
  were passed to candidate validation as fields to skip, and since `item.core`
  carries neither `priority` nor `number`, that removed their only byte-level
  guard. The candidate is now reparsed and deep-compared against the complete
  expected successor, and every unpatched node must retain exact node
  identity. A target that cannot be rewritten losslessly — anchored, aliased,
  or comment-bearing — is refused with `candidate-invalid` and
  `state: unchanged` (`dab4252`).
- `patch` accepted float and exponent JSON tokens for `priority` and `number`,
  coercing `7.0` to `7` and `1e2` to `100` instead of refusing them as the
  contract requires (`dab4252`).
- A field added by `patch` landed after the `decisions` history instead of in
  the metadata area, so identical items differed in layout depending on
  whether the field was set at create time or patched in later (`dab4252`).
- `mint-id` printed an ID containing the literal string `undefined` and exited
  0 for any date before 1970. It now refuses dates outside 1970-01-01 to
  9999-12-31 (`dab4252`).
- `ready` with no `--json` answered an invalid ledger with raw validation JSON,
  so the human surface became a machine surface at the moment it was needed
  most. It now prints prose naming the error count and pointing at `validate`.
  `ready --json` is unchanged (`dab4252`).

### Changed

- **Breaking.** `inspect` and every successful mutation result no longer return
  `item.id`. No frontmatter field is promoted to the item level; read
  identity from `item.core.id`. The promoted member duplicated `item.core.id`
  and earned nothing, while making a caller who had just used `item.id`
  reasonably expect `item.title` to work — it never did. Note that `item.core`
  is a fixed view rather than the whole frontmatter: it does not carry
  `priority` or `number`, which remain recoverable from `source_base64`
  (`286ca74`).
- **Breaking.** The adapter command list gained `patch`, across `capabilities`,
  the core probe, the Claude Code entrypoint, the independent adapter oracle,
  and the byte-compared capabilities and negotiation fixtures. A core that does
  not offer `patch` is now refused during negotiation rather than accepted.
  Recorded as a deliberate contract widening in
  [ADR 0008](docs/adr/0008-guarded-frontmatter-patch.md); nothing in the wild
  depended on the list, since section 10 reads `Unverified` for every platform
  (`286ca74`).
- The refusal for a caller-supplied `status` on `create` now names the assigned
  status and the accepting step: "Create assigns triage; call transition to
  accept the item into backlog." It previously said only that the member was
  controlled, which left a consumer to discover the rule from an empty `ready`
  result (`286ca74`).

- **Behaviour change.** A claim request carrying an own `__proto__` member is
  now refused as `invalid-request`. Previously the request was accepted and the
  member was silently erased.

  The cause was four drifted copies of the same JSON normalizer, consolidated
  into one shared implementation in `src/request.js`. Three copies rebuilt
  objects with assignment. For the key `__proto__` that invokes the prototype
  setter, which installs the value as the new object's prototype and drops it
  as an own key, so every exact-member check counting `Object.keys` never saw
  it. The fourth copy used `Object.fromEntries` and kept it. That fourth copy
  was the conformance runner. The measuring instrument and the thing being
  measured therefore disagreed on exactly that input, and the shipped adapter
  accepted a request its own conformance runner would have refused.

  The fix is correct and tested, and the claim tests pass unchanged. No stored
  data is affected: the old code erased such a member before it could be
  persisted, so no ledger can contain one.

  This is a behaviour change, not a refactor, and it shipped inside a commit
  about the adapter (`04d6867`). That is the reason this file now exists.

- Ready ordering restores priority. The result sorts by: items with priority
  before items without priority; ascending priority; ascending created date;
  ascending immutable ID. This is the four-step rule specified in `73245c1` and
  removed without an ADR in `1058b8c`. Steps three and four are the previous
  creation-order behaviour, unchanged, so a ledger with no priority at all
  sorts exactly as before. See [ADR
  0006](docs/adr/0006-priority-is-a-contract-field.md) (`b0ee411`).

### Fixed

- The adapter conformance runner no longer fails open. An unknown assertion
  type is refused (`f516eea`). An empty fixture root, a root whose cases all
  target another adapter, and a case with an empty assertions array reported
  pass without measuring anything; the vector manifest was also the only
  fixture file parsed leniently (`92347e5`). A scenario with a missing or
  misspelled `expected` key compared against `undefined` (`06a3d63`).
- JSON comparison in the adapter engine is canonical. `sameJson` compared
  `JSON.stringify` output, which made member order significant, so a manifest
  and a describe result listing the same platform map under different key
  orders were falsely refused with `adapter-platform-mismatch`. Array element
  order is still significant and is not reordered (`06a3d63`).
- The Claude Code adapter entrypoint refuses a corrupt own package manifest
  instead of parsing it leniently (`5a4fbcc`).
- The adapter refuses unsafe entrypoint paths and argument lists, and resolves
  entrypoints without following symbolic links, with a stable-identity recheck
  (`117fb45`, `7870f6b`).
