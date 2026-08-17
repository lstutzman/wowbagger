# Changelog

Behaviour changes land here when they ship, not when someone remembers them.
A change to what a command accepts, refuses, emits, or writes is a behaviour
change even when the commit that carried it was labelled refactor, docs, or
consolidation. The first tagged release inherits this file.

## Unreleased

## 0.1.0-alpha.6 - 2026-08-17

### Added

- **`set.extensions` gives consumer-owned extension members a sanctioned patch
  path.** Two field reports in two days: a consumer's own identifier field
  rides a permitted extension member, and a wrong or missing one had no
  ledger-side repair verb at all. On a provisioned ledger the hand-edit that
  filled the gap is a stale write, so the protocol was forcing the edit it then
  punished. `patch` now accepts an `extensions` container whose members name
  extension members and whose values replace each one whole; `null` removes a
  member. The fixed `set` allowlist is unchanged — `extensions` is one more
  name on it, not an opening for arbitrary keys — so a top-level typo is still
  an `unknown-member` refusal. Which members the container may name comes from
  the committed `<ledger>/.wowbagger/extensions.json`, which declares a member
  name and one value type each (`string`, `integer`, `boolean`, `string-list`).
  **A ledger without that file has no patchable extension member at all**, and
  the refusal names the missing declaration. Five new
  `patch-precondition-failed` issue codes carry the refusals —
  `extension-declaration-missing`, `extension-declaration-invalid`,
  `extension-not-declared`, `extension-value-invalid`, `extension-anchored` —
  in the existing four-member issue shape, with the member at fault named in
  `field`. A member the item writes with a YAML anchor or alias is refused
  rather than replaced, because replacing it would change every node bound to
  the anchor; every member the request does not name keeps its exact
  `extensionNodeIdentity` guarantee. The declaration authorizes a write and
  never describes the ledger: `validate` does not read it, so an item whose
  extension member disagrees with it stays valid and stays repairable. Nested
  extension values still have no patch path and stay a reviewable hand-edit.
  Core contract version stays 3 — the patch request schema widens and no
  response envelope member is added, removed, or renamed — but version 3 is
  published, so `contract_version` cannot answer whether a core carries this:
  probe by sending an extension patch and reading the refusal, or pin the
  distribution version. Documented in mutation contract section 9 and pinned by
  `spec/fixtures/mutations/patch-extensions/`.

- **`claim-adopt` gives `unauthorized-revision` a non-destructive remedy.** A
  consumer's staging checkout was blocked exit 6 on three items whose bodies
  were hand-edited in a design session and merged. The refusal was correct, but
  the only documented remedy — restore the authorized revision, then
  `claim-verify` — discards reviewed, merged work. `claim-adopt` records that an
  operator ruled the committed bytes legitimate and moves the coordinator's
  authorized revision to them. It writes no item byte, so `updated` and the body
  survive exactly. It is a standalone verb in the work-claim domain, a sibling
  of `claim-verify`, and it is per item and per revision explicit: the request
  names the item, the revision it believes is authorized, the revision being
  adopted, and who is ruling. There is no adopt-all. It refuses
  `adoption-witness-mismatch` on a stale witness (including a replay of a
  successful adoption), `claim-held` while an unexpired claim holds the item,
  `adoption-revision-uncommitted` unless the adopted revision is at Git `HEAD`
  and in the caller's own working tree, and `adoption-ledger-invalid` when the
  complete ledger would not validate. Success appends one `revision-adoption`
  journal entry naming who, when, and both revisions, so the audit trail records
  the ruling instead of losing it. Adoption is not a fence hole: the next
  out-of-protocol edit is `unauthorized-revision` again, measured against the
  adopted revision. Additive at contract version 1 — one new command, one new
  journal entry type, three new error codes, no existing shape changed.
  Documented in work-claim contract section 3.3 and pinned by
  `spec/fixtures/work-claims/revision-adoption/`.

### Changed

- **The report's epic-enablement factor now counts done or killed children
  only.** It counted every child carrying a terminal date, which folded
  archived and deferred children into the numerator: an epic with one done,
  one archived, one deferred, and one backlog child reported enablement 0.75
  while the mutation contract's terminal ratio for the same epic was 0.25. Two
  numbers wore one name. A terminal date is not a terminal disposition —
  archived restores and deferred undefers, both documented edges — so a parked
  child is work postponed, not work retired, and counting it reported progress
  that one transition takes back. The factor now reads the same done-or-killed
  set as the contract and the epic complete rollup: one definition, three
  surfaces. This is display-only and recomputed at render time; no ledger byte,
  no wire shape, and no `ready` ordering changes. What does change is the
  report: an epic with parked children reports a lower percentage, and its open
  children rank lower on the epic-enablement step of `work next`.
- **Every `unauthorized-revision` remediation string now names both remedies.**
  It was one sentence naming only the restore path, which reads as an
  instruction to throw the edit away; the field report above did exactly that.
  It is now two sentences, and each says what happens to the edit: `Restore the
  authorized revision at <path>, then run claim-verify; that discards the edit.
  Or adopt the committed revision of <path> with claim-adopt, then run
  claim-verify; that keeps the edit.` The finding's `code`, `reason`,
  `observed_surface`, `expected_path`, and revisions are unchanged; only the
  human-readable `remediation` prose changed. `revision-regression` keeps its
  restore-only string on purpose: it only fires while an active claim holds the
  item, which is a state adoption refuses.
- **`patch` corrects an item title.** `set.title` takes a non-empty schema
  string and replaces the title whole, under the same per-ID lock, exact-byte
  compare-and-swap, candidate complete-ledger validation, and atomic
  publication as every other patch; an item with an active claim is refused,
  and `updated` moves to `request.date`. The scalar node is rewritten in place,
  so the quoting style, the comments, the anchors, and every extension node
  survive byte for byte. This closes a protocol contradiction reported twice
  from the field: correcting a title used to require an out-of-protocol edit,
  and on a provisioned ledger that edit is a stale write, so the next mutation
  refused exit 6 `unauthorized-revision` and every later mutation stayed
  blocked. `null` follows the frontmatter removal convention onto
  `candidate-invalid`, because title is required; `""` is refused one step
  earlier, at the request.
- **The mutation contract states the frontmatter ownership boundary.** Section
  9 gains a `Frontmatter ownership` table: one row per member, sorted into
  core-owned (`schema_version`, `id`, `number`, `status`, `created`, `updated`,
  the terminal dates, `decisions`), consumer-editable through `patch` (`title`,
  `priority`, `depends_on`, `related`, `body`), and create-once (`kind`,
  `provenance`, `parent`, `snoozed_until`). The boundary was previously
  discoverable only by sending a patch and reading the refusal. A docs test
  pins every row and the skill teaches the same three classes.

### Decided

- **`kind` stays unpatchable, and the contract now says why.** A task-to-epic
  flip changes which parent and children rules the item is validated under and
  which lifecycle edges it may take. It needs its own verb with its own
  preconditions, not a wider patch set.
- **Extension members stay out of `patch`, and the contract records the
  reasons.** Two field reports asked for a sanctioned path for consumer-owned
  identifier fields riding permitted extension members. The widening was
  assessed against title's machinery and is not the same machinery: the
  fail-closed `set` rule has no room for an arbitrary key, candidate validation
  constrains no extension value, nested and anchored values do not survive a
  whole-value replace the way a scalar does, and the oracle has no observable
  surface to correlate an extension patch against. Section 9 names what a real
  path would need — a `set.extensions` container, a declared per-ledger
  extension schema, a stated rule for anchored and nested values, and an
  oracle-visible surface — so the deferral is a design boundary rather than a
  silence. Their status is stated in the ownership table either way.
- **`patch` gains `set.body_append`.** It takes a JSON string written after the
  item's current body, under the same string rules `set.body` takes: the empty
  string is valid, the bytes are the UTF-8 encoding of the string exactly, and
  `null` is refused at `/set/body_append` because appending nothing is the empty
  string. It is the same byte splice after the closing delimiter, so no
  frontmatter byte moves, `updated` becomes request.date, and every existing
  body byte survives — the request never names them. `body` and `body_append`
  are mutually exclusive in one request: naming both is an `invalid-request`
  issue at `/set`, exit 2, unchanged. This covers the annotation shape a mirror
  consumer needs without making it carry a merge. The core contract stays
  version 3 — it widens the patch request schema and moves no response envelope
  member — but version 3 is already published without it, so a consumer
  **cannot** probe for append support by reading `contract_version`. Send an
  append and read the refusal instead: a core without it answers `unknown-member`
  at `/set/body_append`, exit 2, unchanged.

### Documentation

- **The allowed-edges table carries the defer and undefer edges.** `task` and
  `epic` `backlog` to `deferred` and `deferred` to `backlog` have shipped in
  `src/mutation.js` since deferral existed, both requiring a decision, and the
  ownership table already documented `deferred` as a core-owned field that
  `transition` writes on a defer. Section 8's edge table listed neither row, so
  the one place a consumer looks up what it may drive under-reported the
  lifecycle by two edges. Both rows are added with the evidence the code
  generates — `set deferred; append defer decision` and `clear deferred; append
  undefer decision` — and a docs guard pins the kind, the date, and the
  decision on each. No emitted byte changes and the core contract stays version
  3: this documents shipped edges, it does not add them.

- **The epic derivation section cites one shared definition instead of a
  divergence.** It recorded the report's epic-enablement factor as a different,
  wider number than the terminal ratio. The report factor was narrowed to match
  (see Changed above), so the paragraph is replaced: the contract, the epic
  complete rollup, and the report all count done or killed direct children over
  all direct children, and the section now says outright that a terminal date is
  not the test. The docs guard is re-pointed at the new truth rather than
  relaxed.

- **The contract states that `set.body` replaces and never merges.** A consumer
  mirroring an external source regenerated an item body from its upstream card
  and destroyed a ledger-only annotation; every check passed, because
  `expected_revision` is a byte-level lost-update guard with no semantic safety.
  Mutation contract section 9 and the skill's body bullet now say it plainly:
  the replacement is total, and a mirroring consumer MUST read-modify-write from
  the current item body and MUST never regenerate from the source alone. Docs
  guards pin both sentences.

- **The contract documents the selector an `inspect` `item-not-found` refusal
  echoes.** `inspect --number <n>` on a number no item carries emits
  `details: {"number": <n>}`, and it has done so since `--number` shipped in
  0.1.0-alpha.5. Mutation contract section 5 claimed these details contain only
  `id`, so the published prose and the published wire disagreed. Section 5 now
  states the rule the runtime follows — the details carry exactly the selector
  the request used, `id` for `--id` and `number` for `--number` — and
  `spec/fixtures/mutations/inspect-number-not-found/` pins it. No emitted byte
  changes and the core contract stays version 3: this documents a shipped
  shape, it does not introduce one. The adapter surfaces still require id-only
  details, deliberately: the adapter's `inspect` request accepts no `number`
  member and always invokes `--id`, so it can never see the number variant.

## 0.1.0-alpha.5 - 2026-08-16

### Breaking

- **`number` is no longer caller-settable on schema version 2 ledgers.**
  `create` refuses a request supplying `item.number` and assigns the next
  number itself (`max + 1` under the number-index lock); `patch` refuses
  `set.number` because the number is the immutable item identity. A consumer
  mirroring a legacy backlog cannot carry its legacy numbers into wowbagger
  handles — keep legacy identifiers in a permitted extension member or in the
  item body instead. (Shipped as part of the number-as-identity work; this
  notice was added after the 0.1.0-alpha.5 tarball was cut, so the packaged
  changelog carries it only inside the contract version 3 delta note.)

### Added

- **The report draws the whole ledger as a 3D dependency graph.** It sits below
  the evidence layer, under the decision surface. Every item is a node labelled
  `#N`, coloured by readiness or terminal status and sized by the same
  transitive unblocking leverage the recommended order uses; `depends_on` edges
  are straight and arrowed, `parent` edges are curved and unarrowed, and both
  run from the prerequisite to the item it releases. Hovering or clicking a node
  shows its number, title, status, age, leverage, and the same reasons line the
  ranked list prints for it. The renderer is `3d-force-graph` 1.80.0 over
  Three.js r183, vendored at `vendor/3d-force-graph/` with its upstream SHA-256
  recorded beside it and pinned by a test, and inlined at generation time: the
  report stays one self-contained file and fetches nothing at generation or view
  time. It costs roughly 1.3 MB of report size. A browser without WebGL gets the
  section's plain explanation and a per-node roster instead; no
  decision-relevant content exists only in the 3D view.

### Changed

- **An invalid ledger can now be diagnosed with the documented commands.** One
  invalid item still refuses every read and every guarded mutation on that
  ledger, but the refusals no longer hide what the operator has to read.
  `inspect` keeps refusing exit 3 `ledger-invalid` — handing back a revision
  from a ledger the core has not judged would read as a mutation precondition,
  and there is no flag that skips validation — and its refusal now carries
  `error.details.item`, the same lossless snapshot the success envelope
  defines, for the item the request selected, whenever no validation error
  names that item's path. A faulted item is withheld; `validate` already names
  its repair. `claim-verify` now reports `result.ledger_validation`, carrying
  `valid` and `errors` exactly as the bare `validate` result does, plus a
  `remediation` when the ledger is invalid. Its claim answer is unchanged:
  `findings`, `state`, and the exit status still describe claim state alone, so
  a consistent journal over an invalid ledger is still exit 0 with
  `findings: []` — it just no longer pretends that is a clear road. The report
  costs no extra ledger read. Fixtures extend item #104's misplaced-item
  scenario.
- **The adapter forwards `inspect` refusals instead of calling them protocol
  errors.** Both the engine and the independent oracle demanded a canonical
  mutation request before they would accept any error details, which no read
  command has, so every `inspect` `item-not-found` and `ledger-invalid` refusal
  was mapped to `core-protocol-error`. The precondition now applies only to
  mutation commands. The same surfaces accept the `expected_path` and
  `remediation` that item #104 added to a validation error, and the optional
  `details.item` on an `inspect` `ledger-invalid` refusal — on `inspect` only;
  a mutation refusal that carries one is still rejected.

- **The report's content security policy now also forbids `connect-src`.** The
  report has never opened a connection; the policy now says so.

- **The `item-outside-layout` validation error now names the expected path and
  the relocation that repairs it.** It keeps its stable code and its actual
  `path`, and gains `expected_path` plus a `remediation`; its message names
  both paths. A committed item outside the configured items directory refuses
  every read and every guarded mutation on that ledger, including ones that
  never touch the misplaced item, so the refusal has to say where the item
  belongs. The claim fence is not involved: `claim-verify` reports no finding
  on such a ledger, refuting the PropertyCompass2 PR #2184 claim that a
  root-misplaced item makes the fence report `stale-write-detected` with
  `actual_revision: null`. Fixtures pin both configuration orders — layout
  bound first, and layout bound after the item was already committed at the
  root.
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

- The README and the installed skill warn that `git mv` refuses a freshly
  created item, because `create` writes an untracked file and the `git add -A`
  behind it in an unchecked batch commits the item at the ledger root instead.
  Both state the safe sequence: plain `mv`, then `git add`, checking every exit
  code before the commit. The warning sits in the `0.1.0-alpha.4` boundary text
  that already tells consumers that core ignores the layout file.
- **`patch` can replace an item body.** `set.body` takes a JSON string that
  replaces the whole body under `create`'s body rules, so a consumer whose
  items mirror an external card updates them through the managed path instead
  of hand-editing the Markdown. A body patch rewrites no frontmatter byte —
  anchors, aliases, comments, quoting, styles, member order, and extension
  members all survive, and only `updated` changes, as it does for every patch.
  A body may be set in the same `set` as `priority`, `depends_on`, or
  `related`, in one compare-and-swap write. `null` is refused at `/set/body`:
  the body is a region of the file, so removing it means `""`, not null. A
  claimed item, a stale revision, and a non-string body refuse as before. This
  widens the patch request schema inside core contract version 3 and does not
  move the version.
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

### Documentation

- **`create` stays journal-silent, and the work-claim contract now says why.**
  Section 3.1 already stated that `create` records no claim-journal entry and
  therefore never blocks a sibling worktree. It now records the decision to
  keep that asymmetry and the three reasons behind it: create's publication is
  already atomic, no-clobber, and byte-verified; journaling create would
  serialize every worktree on the highest-volume mutation; and the remaining
  exposure window closes at the item's first `transition` or `patch`. The
  window is stated honestly — until that first journal-visible mutation an
  out-of-protocol overwrite of a created item is not detected, and a commit
  alone does not close the window, because reconciliation compares only the
  revisions the journal expects. `test/create-journal-asymmetry.test.js` pins
  both halves end to end. No behaviour changed.

### Fixed

- A claim-fence refusal no longer reaches the agent as
  `mutation-outcome-unknown`. Both adapter engines classified every response
  with the core envelope validator, so a fenced refusal — `namespace:
  "ledger-mutation"`, `command: "<command>-v1"`, `contract_version: 1`, `state:
  "unchanged"` — failed core validation and became "the mutation may have been
  applied; inspect current state before retrying", on every fenced refusal on a
  provisioned ledger, about a write that provably never ran. The adapter now
  dispatches on the response domain first, exactly as the mutation contract's
  section 2 rule requires, and validates a fenced refusal on the work-claim
  contract's terms: `claimed-item-write-refused` on `create`,
  `active-claim-write-refused` on `transition` and `patch`, and
  `claim-store-unavailable` on any mutation, each with its pinned message, exit,
  and permitted states, its read-back bound to the item the caller asked to
  write, and its reason plus findings and remediation forwarded verbatim. A
  `claim-store-unavailable` refusal that declares `state: "unknown"` stays an
  unknown outcome, and so does any namespaced envelope the adapter cannot
  classify. Adapter contract section 6.1 states the rule and the honest-outcome
  guarantee; five conformance vectors pin it, the differential test replays each
  through both engines, and no version moved in either domain.
- A mutation on a claim-protected ledger now reads the complete ledger twice
  instead of three times. Journal reconciliation and the mutation engine's
  pre-lock phase were separate unlocked reads of the same directory inside one
  claim-lock hold, and reconciliation writes nothing a complete load reads, so
  the pre-lock phase reuses reconciliation's snapshot. On a 1,500-item
  provisioned fixture a create fell from about 1.15 s to about 0.89 s and a
  transition from about 1.17 s to about 0.91 s, matching one full load at about
  0.29 s. The read under lock stays: it is what decides the revision
  compare-and-swap and the lock-closure stability check, and every decision
  drawn from the shared snapshot is re-made against it. A lock-closure retry
  still reads fresh. No validation rule changed, and a mutation on a plain
  directory is unaffected.
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
