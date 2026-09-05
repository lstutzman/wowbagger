# Changelog

Behaviour changes land here when they ship, not when someone remembers them.
A change to what a command accepts, refuses, emits, or writes is a behaviour
change even when the commit that carried it was labelled refactor, docs, or
consolidation. The first tagged release inherits this file.

## Unreleased

- **The report is one decision-focused workspace.** Items, Flow, and
  Dependencies sit behind accessible view navigation; only the selected section
  shows, and a reader without scripting keeps every section through anchors and
  native `details`. The duplicated Work next and Attention lists are gone: one
  canonical list carries five quick views (Work next, In progress, Blocked,
  Needs triage, All open), one canonical detail per retained item, a desktop
  list/detail split, and inline details below 1100px. Search plus facet groups
  are the shared scope for the summaries, Flow, and the graph; quick views and
  Show history change only the list. Opening a detail no longer clears the
  search or facets, and a detail opened from Flow or Dependencies returns to
  Items with the scope intact. Missing metadata is its own `Missing` chip,
  distinct from a literal `Unclassified` value, and `tags` is projected as a
  multi-value mapped field with per-field coverage counts.
- **Concentrations and blockers lead to exact items.** Scoped attention
  actions, an area/status matrix with count and blocked count per cell, and
  scoped members of the existing area-diverse batches each open a labelled
  drilldown of their contributing items. Item details state downstream reach
  and, separately, the items that become ready if done, derived once at
  generation from the complete ledger and exposed to the browser as an
  immutable `impactById`; excluded named-view items never enter it. Core
  readiness and the recommended order are unchanged.
- **Flow is scoped and interactive.** Flow recomputes in the browser from the
  scoped open and terminal population with inclusive From/To range controls
  that refuse an invalid range visibly while keeping the last valid charts.
  Weekly buckets, aging cells, completion samples, and cumulative date/band
  selections drill into exact contributing items, including now-closed items
  accepted on the selected date. Closures and done are named separately, the
  forecast is computed only when Flow first opens, and an item killed straight
  from triage no longer counts as missing acceptance history.
- **The graph follows the shared scope.** The graph-only status filter is
  removed; nodes, induced links, labels, and the roster follow the report
  scope, node and roster selections open the canonical detail, and downstream
  and ready-if-done actions drill into the same sets the detail names. The
  graph starts only when Dependencies first opens, pauses while hidden, and
  probes WebGL once. The legend, the WebGL-less roster, reduced motion, the
  vendored bundle pin, and the no-fetch content security policy are unchanged.
- `scripts/report-design-demo.js` publishes a deterministic, explicitly
  synthetic report through the real pipeline for browser verification.
- **Stable and prerelease channels are defined.** A stable release sets both
  `latest` and `next` to the stable version; a later prerelease moves only
  `next` while `latest` stays on stable. Publish stable releases with
  `npm publish --tag latest` and prereleases with `npm publish --tag next`.
- **Release tooling is version-aware.** The cut still proves exact version-site
  equality and never edits the manifest; publication and channel verification
  follow the stable-or-prerelease target state above.

The alpha.14 hard cutover remains the baseline: `claim-store-unavailable`
answers **The durable claim store is unavailable.** with
`claim-store-unreadable`; upgrade every writer before the first alpha.14 create.
There is no automatic migration or mixed-version grace period. There is no
batch mutation. The create-then-commit loop, implemented most briefly as serial
`create --auto-commit`, remains the supported bulk path. Ledger item #186 records the
permanent no-batch decision, and item #182 owns existing duplicate numbers.
The fence adds no new Git roster or history
traversal and costs two extra fsync'd journal appends within the 65,536-entry
limit.

## 0.5.0-beta.0 - 2026-08-30

- Promote Wowbagger from alpha to beta while keeping `next` as the documented
  prerelease channel and `latest` mirrored to the same newest prerelease.

- Existing ledgers can safely authorize standard `tags` corrections through
  `extensions-provision`: dry-run and publication now require a valid complete
  ledger, validate every historical occurrence against explicit
  `string-list` authority, preserve all item bytes, and publish one canonical
  no-clobber declaration.

- `claim-verify` now accepts optional `--id <item>` for target-scoped
  verification while retaining strict repository-wide behavior when omitted.
  All findings remain visible with `blocks_verification_scope`; work-claim API
  version is now 3 while the legacy envelope marker remains 1.

- Journal-capacity exhaustion now preserves the public
  `journal-capacity-exceeded` discriminator across claim, verification,
  adoption, publication, and legacy mutation paths. Pre-publication refusals
  remain exit 6 `claim-store-unavailable`, `unchanged`, with prior journal and
  item bytes intact; genuine persistence failures and post-intent unknown
  outcomes retain their existing classifications.

- Lock diagnostics now preserve valid `parent-migrate` and `snooze` owners,
  matching the five-operation mutation contract. Unknown or malformed owner
  metadata remains `owner: null` with `owner_diagnostic: "invalid-shape"`;
  mutual exclusion and refusal behavior are unchanged.

- Batch create is permanently rejected for the direct-Markdown architecture.
  `limits.multi_item_atomicity` remains `false`; serial
  `create --auto-commit` calls in request order remain the supported bulk path,
  with one invocation and one commit per item.

The alpha.14 hard cutover remains the baseline: `claim-store-unavailable`
answers **The durable claim store is unavailable.** with
`claim-store-unreadable`; upgrade every writer before the first alpha.14 create.
There is no automatic migration or mixed-version grace period. There is no
batch mutation. The create-then-commit loop, implemented most briefly as serial
`create --auto-commit`, remains the supported bulk path. Ledger item #186 records the
permanent no-batch decision, and item #182 owns existing duplicate numbers.
The fence adds no new Git roster or history
traversal and costs two extra fsync'd journal appends within the 65,536-entry
limit.

## 0.1.0-alpha.17 - 2026-08-30

- **Breaking:** raise the supported Node.js floor from 20 to 24. Node 20 and
  Node 22 no longer satisfy `engines.node`; Node 26 remains outside the
  supported matrix because of the separate Vitest incompatibility reported by
  Lee.

The alpha.14 hard cutover remains the baseline: `claim-store-unavailable`
answers **The durable claim store is unavailable.** with
`claim-store-unreadable`; upgrade every writer before the first alpha.14 create.
There is no automatic migration or mixed-version grace period. There is no
batch mutation, the create-then-commit loop remains supported, item #186 owns
batch design, and item #182 owns existing duplicate numbers. The fence adds no
new Git roster or history traversal and costs two extra fsync'd journal appends
within the 65,536-entry limit.


## 0.1.0-alpha.16 - 2026-08-30

- Added `version-drift --json` to detect stale installed skill pins, core
  contract versions, and package provenance before ledger mutation.

The alpha.14 hard cutover remains the baseline: `claim-store-unavailable`
answers **The durable claim store is unavailable.** with
`claim-store-unreadable`; upgrade every writer before the first alpha.14
create. There is no automatic migration or mixed-version grace period. There is
no batch mutation, the create-then-commit loop remains supported, item #186 owns
batch design, and item #182 owns existing duplicate numbers. The fence adds no
new Git roster or history traversal and costs two extra fsync'd journal appends
within the 65,536-entry limit.

## 0.1.0-alpha.15 - 2026-08-30

- **Duplicate-number recovery now has a separate `ledger-repair` contract
  version 1.** Use the read-only `number-repair-proposal` command to review a
  complete mapping, then apply it with `number-repair`. The repair path requires
  duplicate-number errors to be the complete validation failure, preserves ULID
  identities and relation values, uses the shared namespace fence, records
  durable intent/final entries, and supports bounded auto-commit recovery.

The alpha.14 hard cutover remains the baseline: `claim-store-unavailable`
answers **The durable claim store is unavailable.** with
`claim-store-unreadable`; upgrade every writer before the first alpha.14
create. There is no automatic migration or mixed-version grace period. There is
no batch mutation, the create-then-commit loop remains supported, item #186 owns
batch design, and item #182 owns existing duplicate numbers.
The fence adds no new Git roster or history traversal and costs two extra
fsync'd journal appends within the 65,536-entry limit.

## 0.1.0-alpha.14 - 2026-08-29

### Changed

- **Upgrading is a hard cutover: upgrade every writer in one Git coordination
  domain before the first alpha.14 create.** The journal grammar widened —
  `legacy-mutation-intent` and `legacy-mutation` accept `command: "create-v1"`,
  a create intent accepts `expected_revision: null`, and a create abort requires
  `command: "create-v1"` with `observed_revision: null` — and an alpha.13 binary
  cannot read the new create entry. Run against a ledger whose shared journal
  already carries one, alpha.13's `create` exits 6 with `error.code`
  `claim-store-unavailable`, message `The durable claim store is unavailable.`,
  and `error.details.reason` `claim-store-unreadable`, leaves state unchanged,
  and writes no item. Failing closed is the compatibility guarantee: an old
  writer cannot commit another duplicate. It is also the operational limit,
  because alpha.13 is immutable and can only emit that generic unreadable-store
  message. Read it as "this repository was written by a newer Wowbagger; upgrade
  this worktree to continue." There is no automatic migration and no
  mixed-version grace period; a partial upgrade leaves the remaining alpha.13
  worktrees unable to make claim-protected mutations until they move. Item #185
  owns general version-drift detection; nothing here can retrofit a message into
  an already-published executable. The new reader executes every journal
  alpha.13 emitted, which is the backward-compatibility direction that had to
  hold.

- **A create must be committed before the next mutation, and there is still no
  batch operation.** A created item has no earlier authorized revision, so Git
  `HEAD` is the only surface that can carry its authorized bytes; an uncommitted
  create raises the global `git-finalization-required` barrier for every later
  mutation, including the next create. It cannot occupy the authorized
  predecessor/successor window a `patch` or `transition` may occupy, and that
  window was never permission to skip a commit. The supported bulk pattern is
  the create-then-commit loop — filing ten items is ten cycles, and
  `--auto-commit` on each create is its shortest form. Safe batch design is
  item #186.

- **The measured cost of the fence is two extra fsync'd journal appends.** A
  provisioned create already took the namespace lock, replayed the journal,
  loaded the ledger, read Git `HEAD`, and reconciled, so the fence adds no new
  Git roster or history traversal to a clean create; on a 1,500-item fixture the
  captured `git` invocation sequence is identical before and after. The durable
  cost is journal growth: each successful create adds one intent and one
  committed terminal, so with no other activity the 65,536-entry limit permits
  at most 21,845 three-entry create cycles, and the 8 MiB byte limit may bind
  first. Other claim and mutation activity lowers that ceiling. Capacity is
  reserved before the intent append, so an exhausted journal refuses unchanged
  rather than stranding an attempt. Journal compaction is not part of this
  change.

### Fixed

- **Two worktrees can no longer commit two items carrying the same number.**
  Through alpha.13, `create` was journal-silent by design: it derived
  `1 + max(existing numbers)` from the items its own checkout held and recorded
  nothing in the shared claim journal. Two worktrees that had not integrated
  each other's commits therefore derived the same number and both published,
  and they did not have to race to do it — a create today and a create tomorrow
  collided just as reliably, because the loser was a stale checkout rather than
  a lost race. `number` is immutable and `patch` correctly refuses it, so the
  collision surfaced only at integration, as a global `duplicate-number`
  validation failure that stopped the whole ledger. On a provisioned ledger,
  `create` is now a journaled legacy mutation: under the shared namespace lock
  it reconciles, validates the complete candidate ledger, reserves journal
  capacity, appends a `legacy-mutation-intent` with `command: "create-v1"` and
  `expected_revision: null` before any byte reaches the item path, publishes
  atomically and no-clobber, verifies the exact bytes, and appends its terminal
  — `legacy-mutation` when the bytes landed, or an abort carrying
  `command: "create-v1"` and `observed_revision: null` when the path stayed
  absent. Allocation is fenced in front of all of that: every global finding
  blocks `create` as it blocks any write, and in addition any coordinated item
  this checkout does not hold blocks `create`, because its number cannot be
  read here. A stale revision of an item this checkout does hold stays
  nonblocking, because a number is immutable. A fenced create refuses with
  exit 6, `state: "unchanged"`, `error.code: "claim-store-unavailable"`,
  `error.details.reason: "publication-reconciliation-required"`, and no item
  file; integrate the named item, run `claim-verify` to exit 0, and resend the
  same request ID to take the next number. **What this fixes and what it does
  not:** it closes the reported PropertyCompass2 collision, so cooperating
  alpha.14 worktrees of one clone that share one Git common directory can no
  longer commit the same number, because every such create is visible through
  the shared journal before publication even without branch integration.
  Separate clones, separate machines, alpha.13 writers before the hard cutover,
  and noncooperating writes stay outside that fence and still rely on branch
  integration plus `validate`. A ledger that already carries duplicate numbers
  is not repaired here; item #182 owns that fenced recovery. Core
  `contract_version` stays `5` and the create success and refusal envelopes add,
  remove, and rename no member.

- **`create --auto-commit` commits its reconciliation log with the item.**
  Because create now owns journal entries, its commit set is exactly the created
  item and `<ledger>/.wowbagger/reconcile-<namespace>.md`, and
  `mutation-finalize` accepts that same two-path recovery token. Between the
  fence landing and this fix, `create --auto-commit` failed outright with
  `git-commit-failed`, `failure_stage: "prepare-commit-set"`, and
  `reason: "tree-changed"`, because the commit set excluded a log the mutation
  had just written. Owning that log is not absorbing what was already in it:
  `create` still refuses a reconciliation log that was dirty before the
  invocation, and every other dirty ledger path still refuses.

- **A revision Git can already reach is no longer an instruction to wait for
  it.** When the expected revision was reachable only from a tag, a
  remote-tracking ref, a branch no worktree had checked out, or a live worktree
  on a detached `HEAD`, the `worktree-synchronization-required` finding rendered
  the not-yet-reachable sentence: "wait for the owning worktree to commit, then
  synchronize this worktree and run claim-verify." The commit already existed
  and no named worktree was ever going to publish it, so that wait could not
  end. Those cases now render: "Revision <revision> of <path> is reachable in
  Git, but no active named worktree owner is established; inspect the reachable
  history, restore or explicitly adopt reviewed bytes, then run claim-verify."
  A revision no reachable commit carries keeps the not-yet-reachable sentence
  and its wait, and an item that has never existed in this checkout keeps the
  cannot-be-established sentence. **A consumer that matches on `remediation`
  text must update its patterns:** a finding that used to match "not yet
  reachable" now matches "reachable in Git" for the four reachable-unowned
  cases. Nothing else moves. The `reason` stays
  `worktree-synchronization-required`, the code stays `stale-write-detected`,
  `owner_unavailable: true` with no `owner_ref` or `owner_commit` is unchanged,
  the finding stays advisory — it blocks a mutation targeting its own item and
  lets an unrelated mutation proceed — and core `contract_version` stays `5`,
  because no field, code, reason, or scope changes and the text correction
  replaces a false instruction.

### Documentation

- **Worktree identity and its refusals are now documented.** Alpha.13 shipped an
  explicit worktree identity — an opaque random UUID a worktree creates once in
  its private Git directory — and started recording it as the optional
  `writer_worktree_id` member on `legacy-mutation-intent`, `legacy-mutation`,
  `publish-intent`, and `publish-final` journal entries. Reconciliation reads it
  to tell this worktree's own unreachable successor from a sibling's, which is
  what turns that topology into a global `unauthorized-revision` barrier instead
  of advisory `worktree-synchronization-required`. Alpha.13 also began refusing
  before it classifies anything when two live worktrees answer to one UUID, or
  when the worktree roster cannot be read to completion: exit 6
  `claim-store-unavailable`, reason `claim-store-unreadable`, plus one new
  `error.details.identity_diagnostic` carrying `duplicate-worktree-identity`
  with `worktree_id` and `live_worktree_count`, or `worktree-enumeration-failed`
  with no further member, and the same diagnostic inside
  `auto-commit-preflight-failed` with `retryable: false`. All of that shipped
  without a release note; the alpha.13 entry mentioned writer identity only in
  passing while describing which callers read it. The work-claim contract
  section 3.1, the mutation contract auto-commit preflight details, and the
  installed skill now state the journal field, its alpha.12-and-earlier
  compatibility (such entries stay valid, attribute nothing, and leave the
  writer unknown), what the identity discloses in committed history, and both
  diagnostics. Core `contract_version` stays `5` and no public request or
  success envelope changes.

- **Owner evidence names only an active named worktree, and the contract now
  says so.** Through alpha.12 the owner search was a reachability search, so a
  finding could report `owner_ref` naming a tag, a remote-tracking ref, or a
  branch no worktree had checked out — an owner that could never publish
  anything, and an instruction to wait forever. Alpha.13 replaced that with the
  live worktree roster: this checkout first, then live worktrees on a branch
  ordered by branch ref and then path, with bare and prunable records excluded.
  `owner_ref` is therefore always the branch of a live worktree. A revision
  reachable only from a tag, a remote-tracking ref, an unchecked-out branch, or
  a live worktree on a detached `HEAD` now reports `owner_unavailable: true` and
  no `owner_ref`. That narrowing shipped in alpha.13 with no release note, and
  the alpha.11 note promising that a finding "retains that `owner_ref` and
  `owner_commit`" no longer describes those cases. The contract and the
  installed skill now state the roster rule, the three distinct meanings of
  `owner_unavailable`, and which remediation sentence each one gets.

- **Repository-wide `claim-verify` and target-scoped mutation are stated as
  different questions.** The mutation contract still said a recorded write in
  one worktree "refuses every mutation in the others", which target scoping
  stopped being true before alpha.11. It now states the item scope, and both
  contracts and the installed skill now say plainly that a successful mutation
  is not proof of a globally clean claim store: `claim-verify` names no target,
  so it stays exit 6 while any item in the repository carries a blocking
  finding, including an unrelated one. Item #184 is open in triage to decide the
  supported verification surface; nothing about that behavior changed here, and
  a gate that demands a globally clean `claim-verify` on a repository with live
  sibling work is still unsatisfiable.

- **A refused reconciliation still persists the clock floor.** Reconciliation
  has written its clock entry before it classifies anything since work claims
  were implemented, so a command that then refuses with
  `publication-reconciliation-required` has already advanced the durable
  monotonic floor to `max(physical_utc, previous_floor)`. Section 4 documented
  the floor only for authoritative lease decisions, so the pre-decision advance
  and its one observable consequence were undocumented: because the floor never
  rolls back, a lease or fence observed expired at that floor can never read
  live again, and a holder on a ledger whose floor runs ahead of its own wall
  clock may find its lease expired the moment it asks after clearing a barrier.
  Behavior is unchanged; the contract now says it.

- **The reconciliation topology classifier moved without changing an answer.**
  The topology decision that was spread across owner lookup, diagnosis, and
  scope inference now lives in one pure module,
  `src/reconciliation-classifier.js`, which takes normalized evidence and
  returns a typed decision. That type is internal: scope travels beside a
  finding and no response has ever carried it, so a consumer must keep reading
  the refusal rather than the `reason` string. Every public seam — reason,
  blocking behavior, owner fields, remediation sentence, exit, state, and
  envelope domain — is byte-identical to alpha.13 on every matrix row, which is
  the whole point of the change and the only claim made for it. No behavior
  shipped with it.

## 0.1.0-alpha.13 - 2026-08-28

### Fixed

- **Every reconciling command reads the same writer evidence.** `claim-verify`
  and ordinary mutations named the worktree they spoke for when they
  classified reconciliation; `publish-claimed`, `claim-adopt`, and the
  `claim acquire`, `claim renew`, and `claim release` lifecycle commands did
  not. An unreachable successor written by the current worktree therefore read
  as advisory sibling synchronization on those surfaces, whose target scoping
  let `publish-claimed` commit a publication and `claim acquire` grant a claim
  in exactly the state a `patch` refused. `publish-claimed`, `claim acquire`,
  and `claim renew` now report `unauthorized-revision` and refuse, matching
  `claim-verify`. `claim release` stays available: it relinquishes authority
  rather than extending it, and refusing it would strand the lease in the
  worktree least able to clear the barrier, because no other worktree can take
  the item over while the claim is held. The release compare-and-swap is
  unchanged, so a wrong owner, epoch, or expiry still refuses with
  `claim-conflict`. A genuine sibling successor and an authorization written
  before writer identity existed remain advisory synchronization on every
  surface. `claim-adopt` semantics are unchanged: it reports no reconciliation
  diagnosis and stays available as the remedy. It now judges its own identity
  bytes before the worktree roster, so its own malformed identity reports as
  such instead of as a failed sibling enumeration.

### Known limitations

- **Creates in more than one worktree can commit duplicate item numbers, even
  when the creates are sequential, and no sanctioned repair exists** (items
  #181 and #182). Create is journal-silent, so nothing coordinates the number
  it derives. Any two worktrees whose checkouts have not been integrated derive
  the next schema-v2 `number` from the base each can see, and both derive the
  same one. The two creates need not overlap in time: a create in one worktree
  today and a create in another worktree tomorrow collide just as surely, so
  long as neither worktree has seen the other's commit. Each create succeeds,
  each refuses nothing, and reconciliation reports nothing. The collision only
  exists once the branches are integrated. `validate` then fails globally with
  `duplicate-number` on every colliding item, and because an invalid ledger
  blocks every mutation, the whole ledger stops accepting work. `number` is
  immutable and `patch` correctly rejects it, so Wowbagger currently offers no
  operation that repairs the collision.

  Until both items ship, serialize `create` through a single worktree, and run
  `validate` immediately after you integrate branches so a collision surfaces
  at the merge rather than at the next mutation.

  The PropertyCompass repair — editing `number` in the item source by hand,
  committing it, then running `claim-adopt` — was an emergency intervention
  taken under an outage. It is **not a supported workaround**. It bypasses the
  number-collision and reference checks every mutation performs, and it can
  leave dangling `depends_on`, `related`, and parent references that nothing
  reports. Do not adopt it as routine practice.

## 0.1.0-alpha.12 - 2026-08-28

### Fixed

- **Out-of-protocol local states remain global reconciliation barriers.**
  Alpha.11 could misclassify an unknown committed revision, an authorized
  working-tree predecessor over an unknown `HEAD`, or a working-tree deletion
  over an authorized `HEAD` as advisory sibling synchronization when another
  worktree owned the expected revision. `claim-verify` still failed, but an
  unrelated mutation could proceed through the documented global barrier.
  Alpha.12 classifies local state before owner and target scope, while genuine
  authorized sibling predecessors remain target-scoped synchronization.
- **Windows report path resolution preserves the read-failure error class.**
  Windows can report `ENOENT` where POSIX reports `ENOTDIR` when an output path
  descends through a regular file. Report generation now recognizes that
  non-directory ancestor and returns `report-read-failed` with
  `resolve-output-path` and `ENOTDIR` before publication, instead of surfacing
  `report-write-failed` with `EEXIST`.

## 0.1.0-alpha.11 - 2026-08-27

### Fixed

- **Uncommitted sibling revisions keep target-scoped reconciliation safe.**
  Previously authorized predecessor bytes now identify an in-protocol sibling
  window without turning genuine hand edits or same-branch regressions into
  nonblocking findings.
  Restoring earlier authorized bytes in the same working tree remains
  `unauthorized-revision` when the current branch owns the expected revision.
  Detached `HEAD` uses its reachable history for the same current-owner guard,
  so it cannot turn that regression into advisory sibling synchronization.
  When Git proves that a sibling ref owns the expected revision, the finding
  retains that `owner_ref` and `owner_commit` instead of reporting the owner as
  unavailable.
- **Journal-owning auto-commit rebuilds its derived reconciliation log.** Claim
  decisions may dirty that tracked projection; patch, transition,
  parent-migrate, snooze, and publish-claimed now validate and commit the rebuilt
  log while every foreign dirty ledger path and create still refuse.
- **Claim-verification failures preserve their cause.** Preflight and
  post-commit errors carry the underlying claim verification code and reason;
  claim-store lock contention is retryable while persistent reconciliation is
  not.
  `mutation-finalize` recovery now carries the identical diagnostics without
  inventing a `findings` member.
- **Auto-commit uses target scope before and after committing.** Unrelated
  synchronization findings no longer turn a successfully committed mutation
  into a reported post-commit failure; target-blocking findings remain fatal and
  visible through claim-verify.

### Changed

- **Parent migration and snooze now have complete contract guidance.** The
  contract and installed skill document their requests, CAS and date rules,
  response domains, auto-commit behavior, and legacy journal fence-family
  semantics. Parent-migrate help no longer invents a live-item restriction.
- **Parent and snooze fields are documented as dedicated mutations, not
  create-once values.** Existing items can be repointed to or from an epic with
  `parent-migrate`, and `snooze` can set or clear `snoozed_until`; `kind` and
  `provenance` remain genuinely create-once.
- **Release numbering preserves the unpublished alpha.10 cut.** Alpha.10 was
  cut and tagged but never published to npm. This release advances to alpha.11
  instead of moving that tag, so tag identity remains immutable and the
  registry history honestly skips alpha.10.

### Known limitations

- **Parent-migrate and snooze lock owners lose diagnostic detail.** Their real
  lock still refuses every concurrent mutation, but the refusal currently
  reports `owner: null` with `owner_diagnostic: "invalid-shape"`. Item #174
  tracks restoring those owner details; mutual exclusion is unaffected.
- **Ownership classification still needs one consolidated topology audit.**
  Items #173, #176, and #177 close every case identified so far. Item #178
  remains open to audit the topology as one matrix because each point fix
  revealed an adjacent gap.

## 0.1.0-alpha.10 - 2026-08-26

### Fixed

- **Cross-worktree reconciliation is target-scoped.** An unrelated item
  mutation no longer refuses because another worktree has a committed revision.
  When synchronization is required, the finding names the owning reference.
- **Fresh clones recover committed claim history.** Reconciliation hydrates an
  empty local claim journal from the committed reconciliation log, while
  lock-free claim reads project that history without writing. Invalid or
  over-capacity committed sequences fail closed.
- **Auto-commit recovery handles refusal and no-op paths.** Refused preflight
  checks no longer rewrite the tracked reconciliation log. The first
  post-provision create works, byte-identical mutations commit only their log,
  and `mutation-finalize` accepts the corresponding log-only recovery after
  `HEAD` advances.
- **Parent migration and snooze expose their guarded write contracts.**
  Both commands support auto-commit, report their own response domains, return
  a single unchanged invalid-request envelope, and report stale parent
  witnesses as conflicts.
- **Create reserves the `extensions` request container.** Item data must name
  extension members directly so patch and extension declarations can address
  them.
- **Auto-commit preflight reports retryability explicitly.** Only a held
  auto-commit mutex is retryable.
- **CLI and release metadata stay discoverable and complete.** Help describes
  claim verification and list requests, and the release-site manifest covers
  historical version records.

## 0.1.0-alpha.9 - 2026-08-23

### Added

- **A public Wowbagger brand asset.** The repository now carries an optimized
  1024px image of Bowerick Wowbagger directing robotic agent cats at consoles
  with a circuit-lit shepherd's staff. The asset is included in the npm
  package for README and GitHub presentation.

### Changed

- **Public product prose now describes the current engine.** README, npm
  metadata, Claude plugin metadata, marketplace metadata, and the installed
  skill now explain report sequencing dashboards, named views, facets, graph
  filtering, guarded CAS mutations, claims, fencing, reconciliation, and the
  separation between core and host responsibilities.
- **Agent onboarding is explicit.** The README and skill include a concise
  agent TL;DR, exact core setup checks, the separate plugin/skills installer
  routes, and the response-loss rule.

## 0.1.0-alpha.8 - 2026-08-23

### Added

- **A published launch seam for a host that cannot run a shell.** The package
  now declares `exports`, and its main entry `wowbagger` exposes
  `CORE_SCRIPT_PATH`, `MINIMUM_NODE_MAJOR`, and `resolveCoreLaunch(argv)`, which
  returns the exact process tuple a direct-core host needs: an absolute Node
  executable, an argument array whose first element is the absolute
  `bin/wowbagger.js`, and `shell: false`. A host that resolves its own runtime
  gets `resolveCoreLaunch(argv, { nodeExecutable })`, and a relative or bare
  executable name is refused rather than left for PATH to answer. The script
  path is also resolvable on its own as `wowbagger/wowbagger.js` for a host that
  wants the path without importing anything. Deep imports that already worked —
  `wowbagger/src/limits.js` and every other published path — keep resolving
  through an explicit `"./*"` subpath. No command accepts, refuses, emits, or
  writes anything different.

- **The machine contract ships as JSON Schema, not only as prose and fixtures.**
  Seventeen JSON Schema 2020-12 documents under `schemas/` are published with
  the package and resolvable as `wowbagger/schemas/<file>.json`, with
  `schemas/index.json` naming each one's response domain and that domain's
  version. They cover the core envelope and its four exact root shapes, the
  capabilities envelope with every advertised limit as a constant, the two bare
  results, the list query and its page and refusals, the default and workbench
  inspect projections, the transition request, success, and every documented
  refusal with its mutation state, the `ledger-mutation` fence refusals, report
  configuration versions 1 and 2, and the report responses including a named
  view. Every schema fixes its root members exactly and pins the version of its
  own domain, so a core envelope refuses a namespaced refusal, a version 4
  envelope, or an extra root member, and a version 1 report configuration
  refuses a version 2 one. Exactness reaches the members too: an item core must
  carry both relation lists, because the core view always emits them, and a
  refusal raised before a commit is established pins its state to `unchanged`
  rather than admitting the indeterminate state that only an interrupted write
  can report. The validator is a test-only dependency; the runtime still has
  exactly one dependency.

### Documentation

- **`docs/host-contract.md` publishes the direct-core host boundary.** One
  document now states what a UI plugin or other non-agent consumer needs and
  what it must supply itself: the package resolution seam and the four-part
  launch — Node.js 20 or later, an absolute Node executable, the absolute
  `wowbagger.js`, an argument array, and `shell: false`; bounded stdin or a
  host-created request file, never shell source and never inline unbounded argv
  JSON; captured stdout and stderr; the owning-host path rule for a worktree, a
  plain folder, direct SSH, and WSL, with no cross-runtime path guessing;
  namespace-first response dispatch and the exit table; every advertised limit
  with its exact value; the once-only dispatch sequence for a lost response; and
  the seventeen packaged JSON Schemas by domain. It states that a missing
  executable is a host-level result rather than malformed Wowbagger JSON, that
  the host owns executable discovery, working directory, timeout, cancellation,
  process-tree containment, stream caps, and routing, and that Wowbagger will
  not add automatic transitions, mirrored ledger state, operation identity,
  remote routing, or a daemon. The full `inspect` read is documented as
  deliberately unbounded, with the reason. The README, the installed skill, and
  `SPEC.md` section 10 point at it, and it ships in the npm package.
- **The public version and lifecycle vocabulary agrees with the runtime.**
  `SPEC.md` section 10 said core mutation contracts 1 and 2 were defined and
  that the runtime emitted version 2; it now says 1 through 5 and version 5. The
  mutation contract's status line said versions 1, 2, and 3 with the runtime on
  3; it now says 1 through 5 and version 5. `deferred` has been a real status
  since it shipped, but `SPEC.md` omitted it from the status field, the
  lifecycle table, the transition table, the terminal-date invariants, the
  decision-action list, and the terminal-decision table, and the mutation
  contract omitted the `deferred` date from the lossless core view; all seven
  now name it, along with the `resolve`, `defer`, and `undefer` decision actions
  the validator has always accepted. No behaviour changed: these were prose
  omissions, and the tests that guard them read the vocabularies from
  `src/lifecycle.js` and `src/validate.js` rather than retyping them.
- **Response loss is a named contract instead of folklore.** The mutation
  contract, the adapter contract, the README, and the installed skill now carry
  the same sequence for a mutation whose response never arrived: dispatch once,
  never replay, invalidate the inspected revision, reconnect, then re-read the
  ledger. The mutation contract's new section 10 table separates the outcomes a
  caller may act on — committed success, proven non-write, committed recovery,
  unknown publication — from the two that establish nothing, a signalled or
  timed-out transport and a missing envelope, and states that a later item state
  never proves that the lost dispatch caused it. Adapter contract section 6.2
  documents the `mutation_outcome: "unknown"` envelope and its per-command
  `recovery` object exactly as the adapter emits them, and states that exit 4
  `revision-conflict` is a proven non-write that is never relabelled response
  loss. There is no operation ID, durable outcome store, or replay endpoint;
  adding correlation requires a new contract decision. No command accepts,
  refuses, emits, or writes anything different. Two conformance vectors now pin
  the core's own exit-6 `write-outcome-unknown` and `post-commit-recovery-required`
  envelopes at the adapter's process-outcome seam, taking the adapter vector set
  to 212 assertions.
- **The exit tables state where `report` actually lands.** Both contracts filed
  exit 1 as a bare-result-only condition and exit 3 as every invalid ledger,
  while `report` answers an invalid ledger, an unreadable input, and a failed
  publication at exit 1. The mutation contract now carries an exit 1 row naming
  those codes, lists `report-config-invalid` and `report-view-not-found` in its
  exit 2 row, and scopes exit 3 to every command except `report`; the host
  contract's exit 1 and exit 3 conditions say the same. Two guards assert the
  rows against the codes the runtime emits.

### Changed

- **The report filters by facet groups instead of one value at a time.** The
  drill-down's single-value mapped-field selects and its All/Ready/Blocked/
  Ineligible buttons are gone. In their place is one group of checkbox chips per
  dimension of the open set — Readiness, Status, Kind, and every configured
  mapped field, so a mapped `class: bug` is a chip rather than a value hidden in
  a dropdown. Values inside a group are alternatives, groups narrow each other,
  and the search box is one more condition; every chip states the count it would
  leave, measured against the search and the other groups but never against its
  own, so two selections in one group cannot make their siblings read zero. A
  visible result count, per-chip selected state, and `Clear filters` are new, and
  opening a Work next or Attention row still clears whatever detached its card,
  facets included.
- **The ledger graph filters by lifecycle status.** One chip group above the
  stage carries the statuses the ledger holds, all selected, with `Select all`
  and `Clear`. Deselecting a status drops its nodes, every link incident to one,
  and their labels, reheats the layout in place, and takes a hidden node off the
  hover card; the roster and node count follow the same selection, and an empty
  selection draws an empty graph that says so. The legend, the WebGL-less
  roster, camera interaction, and the no-fetch contract are unchanged, and
  nothing here reads or writes the ledger.

### Fixed

- **A report failure before publication says so, and never arrives causeless.**
  An output path the filesystem cannot resolve — a `--out` under a regular
  file, an unreadable directory on the way to it — was a raw runtime error
  escaping into the command's catch-all, answered as `report-write-failed` with
  empty `details` even though nothing had been rendered or replaced. It is now
  `report-read-failed` with `details.operation` naming which resolution failed,
  `details.path` naming the path the caller configured or passed, and
  `details.cause` naming the filesystem's own code. An error no report path
  throws on purpose still answers `report-write-failed`, because nothing
  reached the output path, but it now carries `{operation, cause}` instead of
  `{}`. Every `details.cause` is a bounded token — an error code, or the
  error's kind when the runtime gave no code — so a publication failure no
  longer republishes a runtime message, and the paths, credentials, and
  run-specific values a message carries stay out of the envelope. Atomic
  publication is unchanged: a report already at the selected path survives
  every one of these refusals.
- **An empty named view stops blaming the reader.** A view whose criteria
  matched nothing rendered the drill-down's `No items match these filters.` and
  the graph's `No status is selected`, sending a reader to controls that could
  not bring an item back. A named artifact with no items now states
  `No ledger item matches this view's criteria.` and, in the graph, that it has
  nothing to draw — visibly, without waiting for scripting. A report that holds
  items keeps the filter and status copy, which is the honest answer when the
  reader is the one who narrowed it, and the base report's bytes are unchanged.
- **`core-report-response.json` named a member the report never emitted.** The
  published `ledger-invalid` refusal required `details.validation_errors`,
  which is the mutation commands' member name; `report` has always emitted
  `details.errors`. A consumer validating a real refusal against the shipped
  schema failed on the runtime's own bytes. The schema now states `errors`, and
  a live invalid-ledger report run is validated against it.

## 0.1.0-alpha.7 - 2026-08-18

### Changed

- **The item source is bounded at every candidate door, and the core contract
  moves to 4.** The published version 3 core accepted a 50-MiB `create` with
  exit `0` and state `committed` in 0.70 s: `create`, `transition`, and `patch`
  had no bound
  anywhere, and `publish-claimed` alone bounded candidates but reported an
  oversized, perfectly canonical candidate as `The candidate source is not
  canonical base64.` One shared `MAX_ITEM_SOURCE_BYTES` of 8,388,608 now bounds
  the complete serialized successor at all four doors, and every one of them
  answers the same named refusal: `item-source-too-large`, exit 2, state
  `unchanged`, details exactly `{id, size_bytes, limit_bytes}` in the core
  domain and `{item_id, size_bytes, limit_bytes}` in the ledger-publication
  domain. The measurement is serialized UTF-8 bytes, so frontmatter, decisions,
  extensions, and body all draw on the same budget; `transition` is bounded
  because its decision block can push a legal stored item past it. Core
  capabilities advertises the value at `result.limits.max_item_source_bytes`.
  This narrows accepted input against a published version, so the core contract
  moves to 4 and version 3 consumers fail closed at negotiation. A ledger
  committed before the bound does not brick: an oversized item still validates,
  still inspects, and a patch that shrinks it under the bound is accepted.

- **The work-claim API moves to 2.** The oversized-candidate response replaces
  the error `publish-claimed` version 1 pinned for that input, so
  `result.operations.work_claim.api_version` is now `2` and version 1 consumers
  fail closed. Malformed base64 keeps its version 1 `invalid-request`: without
  canonical base64 there is no item source to measure. The base64-character
  precheck is gone — the 11,534,336-byte serialized-request bound already caps
  what a candidate can decode to, and the precheck was the remaining path that
  answered a genuine size refusal with a false base64 message. That transport
  bound is unchanged and still measures a different object.
- **A claimed publication no longer takes one cooperative lock per ledger
  item.** `publish-claimed` computed its lock closure from every item in the
  loaded ledger, so publishing one item on a 1,500-item ledger created, wrote,
  fsynced, and unlinked 1,503 lock files. It runs from journal replay through
  its terminal record inside the namespace write lock, and every other
  cooperative writer of a provisioned ledger enters that same lock before it
  writes, so the per-item closure excluded nobody the namespace lock did not
  already exclude. Publication now takes no per-item locks. Newly instrumented
  phase counters measured the cost this removes: on 1,500 items the lock phase
  was 11.2 s of the 12.6 s the publication took, against 0.2 s for reading Git
  HEAD. Everything else is unchanged and proved byte-for-byte identical against
  the previous implementation across all six publication outcome classes —
  success, fence refusal, revision conflict, validation refusal, idempotent
  replay, and indeterminate publication — in envelope, claim journal, and item
  bytes. Every cooperative writer of one ledger must be upgraded together: a
  writer that honors only per-ID locks can race one that honors only the
  namespace lock.
- **The README installs with `@next` and says why.** The registry mandates a
  `latest` dist-tag, so `latest` mirrors `next`; `@next` stays the documented
  spelling and the explicit prerelease consent.
- **Cuts happen on the release branch, not in a session worktree.** Merge
  session work first, then cut; the cut command refuses to run anywhere but the
  branch tip. The previous two-phase topology is why the last two release tags
  name merge commits rather than their cut commits.
  `docs/adapter-release-path.md` records the ritual.

### Fixed

- **A live publication is no longer reported as a broken lock.** Publication
  lock files recorded `"operation": "publish-claimed"`, but the lock reader
  accepts only `create`, `transition`, and `patch`, so a concurrent writer that
  hit a live publication lock classified it `invalid-shape` — a diagnostic that
  says the lock is corrupt. Publication writes no lock files at all now, so
  there is nothing to misclassify.

- **A committed `patch` is forwarded instead of reported as an unknown
  outcome.** The shipped adapter engine still named the pre-widening patchable
  pair `number` and `priority`, so every patch a consumer actually sends — a
  body rewrite, a title correction, a relation-list replacement, a declared
  extension member — read as a non-canonical request, failed result
  correlation, and came back `mutation-outcome-unknown` with recovery guidance
  about a write that had provably committed. `number` is the immutable item
  identity and was never patchable at all. The patchable field set is now what
  mutation contract section 9 names — `title`, `priority`, `depends_on`,
  `related`, `body`, `body_append`, and `extensions` — with the two body write
  modes mutually exclusive and the extensions container judged only on its own
  shape, and correlation follows each member to the surface it is observable
  on. The independent reference model already had all of this, so the drift was
  one-sided and no differential test could see it; the new end-to-end
  core-outcome vectors found it on their first run.

- **`publish-claimed` now reconciles the journal unconditionally, like every
  other mutating command.** The work-claim contract has always said an
  uncommitted prior mutation refuses the next `create`, `transition`, `patch`,
  **or `publish-claimed`**. The code only reconciled when it happened to
  observe an unresolved `publish-intent`, and an uncommitted legacy mutation
  leaves none behind. A fixture pinned the gap: with a legacy create and
  transition sitting uncommitted, `claim-verify` returned exit 6 and a legacy
  `create` refused with `publication-reconciliation-required`, while
  `publish-claimed` on a claimed item published straight over the unreconciled
  ledger. It now reconciles before the fence decision on every publication and
  refuses with exit 6 `claim-store-unavailable`,
  `details.reason: "publication-reconciliation-required"`, and
  `details.findings` — the same envelope the legacy fence emits, so one
  `claim-verify` clears every blocked path. **A publication behind an
  unresolvable prior intent now returns that refusal instead of exit 6
  `publication-outcome-unknown`.** The old code named the refused publication's
  own outcome uncertain when it had not run at all; `state: "unchanged"` is the
  honest answer, and the blocking finding still travels in `details.findings`.
  The cost is honest about which read is new. Reconciliation adds no
  complete-ledger read: it produces the snapshot the candidate validation and
  the mutation engine's pre-lock read already share, so a claimed publication
  still reads the working-tree ledger exactly twice. It does add the Git `HEAD`
  read — `rev-parse`, one `ls-tree`, and a batched `cat-file` over every item
  blob at `HEAD` — to every publication that previously had no unresolved
  intent. That is the same read `create`, `transition`, `patch`, and every
  claim lifecycle command already perform, so `publish-claimed` now pays the
  toll its peers pay rather than a new one. Each publication persists one clock
  floor, as it did before; a publication behind a pending intent, which used to
  persist two, now persists one as well.

- **A shipped adapter no longer advertises trusted approval it cannot
  exercise.** The three shipped entrypoints declared
  `trusted_approval: {"supported": true, "sources": ["consumer"]}` while
  `runAdapterEntrypoint` passed no approval, clock, nonce store, or core
  executable identity to the invoke engine, so `create`, `transition`, and
  `patch` through every shipped adapter refused `consumer-approval-required`
  and could not succeed on any input. The declaration now reflects the runtime
  of the invocation, the way `optional_features.claims` already reflects the
  core probe: a bare entrypoint run declares no trusted approval and refuses a
  mutation `capability-unavailable` with `missing: ["trusted-approval"]`, the
  refusal section 5.1 already required for an absent declaration, and a host
  that wires an approval source declares it truthfully. The two refusals stay
  distinguishable, because they are different facts — no approval source at all
  versus a source that produced no approval for this invocation — and conformance
  case `07-mutation-approval` now pins both against the runtimes that produce
  them, adding one assertion to the conformance suite.
- **A committed `create` is forwarded instead of reported as an unknown
  outcome.** Both adapter engines required `schema_version: 1` in a create
  result and re-serialized the expected candidate with the schema 1 default, so
  every create against a real ledger — an empty ledger is schema 2 — failed the
  result correlation, was judged an invalid core envelope, and came back as
  `mutation-outcome-unknown` with recovery guidance about a write that had
  provably committed. The ledger's schema version and the number the core
  assigns under its own lock are the only two members of the answer a caller
  could not have known; both engines now read those from the result and
  re-derive the whole candidate from the request bytes, leaving every other
  member pinned by an exact byte comparison against the source the core
  returned. The defect was unreachable while every shipped mutation refused
  before launch, and surfaced the moment a host runtime carried a real approval
  through to the core.
- Adapter contract section 5's core-request table and section 5.1's approval
  rule named only `create` and `transition`. Both have accepted `patch` since
  adapter contract version 2; the prose now says so.

### Added

- **`inspect` answers a bounded per-item lifecycle affordance projection.**
  `inspect --ledger <dir> (--id <id> | --number <n>) --workbench --as-of
  YYYY-MM-DD --json` returns, from one complete validated ledger snapshot,
  `result.workbench`: the projection version, the as-of date, the ledger
  snapshot witness, an `observation` member, a bounded item summary, and one
  `transition_options` entry for every lifecycle target the native edge table
  allows out of that item's kind and status. Each option names its target
  status, its generated decision action or `null`, whether a caller-supplied
  summary and rationale are required, the minimum legal transition date
  `max(created, updated)`, its observed enabled state, and the observed
  precondition issues and multi-item blockers in the exact `transition`
  vocabulary. A workbench can now show a person which transitions an item can
  take without duplicating lifecycle logic and without submitting a mutating
  probe.

  The read is an observation, not a lease, and says so in the response:
  `observation.authority` is `observed-snapshot` and `observation.rechecked_by`
  names what a later `transition` rechecks under lock — revision, lock, claim
  fence, reconciliation, and candidate validation. It writes no item, lock,
  claim journal, reconciliation log, or Git state, and it takes no lock.
  `transition` and the projection share one lifecycle definition
  (`src/lifecycle.js`), and a differential guard dispatches every projected
  option and every unadvertised target through the real mutation, so an
  advertised affordance cannot drift from what the mutation does.

  Every variable-size field is bounded and says what it left out: the projected
  title, the relation lists, each option's issues and blockers, and the related
  IDs inside an issue. `--workbench` requires `--as-of`, an unpaired `--as-of`
  is refused rather than ignored, and an `inspect` invocation without
  `--workbench` is byte-identical to before. `capabilities` advertises
  `operations.inspect.workbench` and the three exact bounds
  `max_workbench_title_characters`, `max_workbench_collection_entries`, and
  `max_workbench_response_bytes`; the core contract version stays 5, and the
  projection is negotiated by its own `projection_version`. An invalid ledger is
  `ledger-invalid` at exit 3 with no projection attached, and a projection that
  would exceed its response bound is refused whole with
  `workbench-response-too-large` at exit 2.

- **The conformance suite now measures real core outcomes end to end.** A new
  equivalence case, `16-core-outcome-e2e`, carries nine hand-authored scenarios
  that each run the direct real core in one isolated temporary workspace and,
  separately, spawn the real shipped entrypoint over the bootstrap wire against
  the real core in a second workspace materialized from the same before state:
  `inspect` item-not-found, a committed `create`, a committed `transition`, a
  committed `patch` by body replacement and by declared extension member, the
  six-member date refusal, and all three `ledger-mutation` claim-fence refusal
  classes. Success vectors match the exact core exit, stdout bytes, decoded
  adapter streams with their digests and lengths, and the exact ledger
  post-state; refusal vectors match the exact nonzero exit and unchanged ledger
  bytes, and the fence refusals arrive as `ok: true` adapter transport results
  rather than adapter errors. Before this case, no conformance assertion and no
  bootstrap-wire test carried a mutation through a spawned entrypoint into a
  launched core, which is how two real adapter defects shipped. The suite is
  210 assertions across 16 cases.

  Determinism comes from fixed inputs and never from normalizing output: a
  caller-supplied ULID, seeded revisions on isolated temporary ledgers, literal
  dates, and — for the two real claim-fence read-backs — a fixed namespace, a
  hand-authored claim journal, and a seeded future clock floor, so the emitted
  `observed_at` is `max(physical_now, floor)` and therefore the floor. That
  makes the refusal bytes fixed without mocking the core clock, and it expires:
  both runners fail loudly and name `2031-01-15T12:01:00.000Z` once wall time
  reaches it. Goldens are authored from the adapter contract, the work-claim
  contract, and the normative `spec/fixtures/mutations/**` bytes; every byte
  reused from those fixtures carries a `derived_from` pin, so drift on either
  side stops the vector and asks for a reviewed golden change instead of
  regenerating one. Only base64, SHA-256, and byte length are derived, and only
  from an already hand-authored byte string.

  The conformance host gains a granting approval mode, without which no
  mutation can cross the spawned entrypoint at all. **Adapter contract section
  10 previously said no conformance fixture could manufacture authority; that
  is no longer true, and the claim is withdrawn rather than quietly narrowed.**
  What replaces it is narrower and checkable: the granting mode is reachable
  only from a fixture's own runtime configuration, which no shipped adapter
  package reads and no wire this contract defines carries; every granting
  scenario runs against a throwaway temporary ledger; the approval is minted
  from the binding the engine resolved and canonicalized by the independent
  reference model. The evidence label is the production adapter engine under a
  conformance host approval provider, not a live consumer approval mechanism.

- **A host process can wire consumer approval into a shipped adapter
  entrypoint.** `runAdapterEntrypoint` now accepts an optional `hostRuntime`
  carrying the approval source, the current time, the redeemed-nonce store, and
  the core executable identity the host attests. It is a code-level parameter of
  the embedding process and is deliberately absent from every wire: the
  bootstrap request root schema is exact and has no approval member, so an
  approval a model places on the request is an `invalid-invocation` that never
  reaches the gate, exactly as adapter contract section 5.1 requires. The
  approval may be a finished event or a resolver the adapter calls with the
  exact binding it has just resolved — the argument vector, absolute workspace
  paths, and instruction and handoff digests an approval covers do not exist
  until the adapter has built them, so an interactive consumer prompt cannot
  mint the approval any earlier. A resolver that fails produced no approval and
  the mutation refuses; it never proceeds unapproved. The default is unchanged
  and remains no approval. `test/adapter-host-approval-wire.test.js` carries the
  first approved mutation in this repository to cross a spawned entrypoint into
  a launched core and change a ledger, with its binding digest canonicalized by
  the independent reference model rather than by the engine under test. No
  version moved in any domain: `host.trusted_approval` has been optional since
  version 1, the approval object and binding are untouched, and the mechanism is
  invisible on every wire the contract defines. Adapter contract sections 3.2,
  3.3, 5.1, 10, and 12 state the seam, the honesty rule, the two-runtime
  evidence, and the version argument.

- **The cut is one command, and version drift now fails the cut instead of
  shipping.** `npm run release:cut -- <version> --date YYYY-MM-DD` runs on the
  tip of the release branch, proves every version site is accounted for, plans
  the new bytes in memory, runs the full release gate over them, and leaves one
  `Cut <version>` commit and one annotated `v<version>` tag. It stops there:
  push, `npm publish --tag next`, and the registry check stay separate named
  steps, because no local command can undo any of them. Coverage is proved by
  exact-set equality against a hand-maintained
  `scripts/release-version-sites.json`, not by a global grep — the changelog and
  the dated design records must keep naming old versions, so "grep finds
  nothing" would be the wrong test. A release site added next month is
  unmanifested and refuses the cut. `--dry-run` runs the same planner and the
  same gate against a copy of HEAD and then proves the repository unchanged.
  Reruns converge rather than repair: a cut tag at a clean HEAD reports
  `already cut`, a complete cut commit without its tag resumes at tagging, and a
  tag pointing elsewhere refuses.
- **The changelog can no longer lose its Unreleased section.** A cut opens a
  fresh empty `## Unreleased` and files the released notes beneath it. The two
  previous cuts renamed the heading instead, which left later changes landing
  under an already published release.
- **The prerelease channel policy is stated and checkable.**
  `npm run release:channels -- check|repair <version>` encodes it: `latest`
  mirroring `next` at the published version and the first published alpha
  deprecated. The first-choice policy — no `latest` at all, so a bare install
  fails loudly — was refused by the registry itself: npm rejects deleting the
  `latest` tag with E400 (verified live), so the current prerelease replaces
  the dead first alpha as the forced default. `check` is read-only and is the
  post-publish verification step; `repair` is idempotent and never unpublishes.

- **`--auto-commit` folds the commit-per-mutation ceremony into the mutation.**
  The invariant is correct and the ceremony around it was the consumer's most
  frequent daily cost: mutate, `git add`, `git commit`, `claim-verify`, repeat,
  ten times for ten items. On a provisioned merge-coordinated ledger the new
  opt-in bare flag on `create`, `transition`, `patch`, and `publish-claimed`
  does that loop inside one invocation. It takes a per-working-tree mutex,
  refuses any staged path anywhere and any dirty path under the ledger, checks
  Git identity, runs an internal pre-mutation `claim-verify`, runs the mutation
  unchanged, then commits **exactly** the changed item plus at most one
  `.wowbagger/reconcile-<namespace>.md` under a fixed subject
  (`wowbagger: transition item #7`; the canonical item ID for a schema-1 item
  with no number). It verifies the resulting commit's parent, subject,
  changed-path set, and every blob, then runs `claim-verify` again before it
  answers. Success adds `git_commit`, `commit_paths`, and `claim_verified` to
  `result`.

  There is no configuration file setting, environment default, or repository
  default, because a hidden default would make existing mutation automation
  create Git commits unexpectedly. An invocation without the flag is
  byte-identical to before, so the core contract stays 3 and the work-claim API
  stays 1. The flag is direct-CLI only in this release; no adapter advertises or
  constructs it.

  What it will not do: commit anything on `state: "unchanged"` or
  `state: "unknown"`, including the documented reconcile-log residue a refused
  `publish-claimed` leaves behind; stage a path outside the ledger; broad-add,
  amend, squash, reset, clean, stash, or unstage; pass `--no-verify` or disable
  signing; fabricate an author; customize a commit message; or push, fetch,
  pull, merge, or rebase. Hooks through `core.hooksPath`, `commit.gpgSign`, and
  signing programs are honoured, and a hook that rewrites the subject or the
  tree is reported rather than accepted.

- **An honest commit-failed contract, and one idempotent recovery verb.** A
  post-publication Git failure that proves the commit is absent is exit 6
  `git-commit-failed` with `state: "committed"` — the state still describes item
  publication, not Git finalization — carrying the published revision, the exact
  ledger-relative commit set with digests, `failure_stage`, `reason`, and a
  bounded `recovery_token`. `create`, `transition`, and `patch` keep the core
  domain; `publish-claimed` keeps `ledger-publication` and its top-level
  `operation_id`. An **ambiguous** Git outcome is `git-commit-outcome-unknown`,
  never `git-commit-failed`, and a commit that stands while reconciliation then
  refuses is `post-commit-reconciliation-failed`. No failure envelope carries
  hook output, signing output, absolute paths, or environment values.

  New command: `wowbagger mutation-finalize --ledger <dir> --recovery-token
  <token> --json`, answering in the work-claim domain because it changes Git
  reconciliation state and no item byte. It re-derives every path from the
  ledger and the provisioned namespace — the token is a witness, never authority
  to select a path — re-checks the current bytes and the foreign-change rules,
  creates the exact commit if it is absent, then runs `claim-verify`. When
  `HEAD` already holds that exact commit it verifies and returns it without
  creating a second one, so a lost response and a failed commit recover through
  the same command, and repeating it is safe.

  A failed attempt leaves its own commit set staged, because the design forbids
  unstaging. Recovery tolerates exactly that residue and refuses anything else
  staged; until it runs, the next `--auto-commit` invocation refuses on
  `staged-paths-present`, which is the intended signal.

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
  on such a ledger, refuting an earlier consumer report that a
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
