# Item #133 claim availability implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent one private worktree publication from blocking unrelated mutations while preserving same-item CAS fencing and durable Git publication checks.

**Architecture:** Keep the shared Git-common-directory journal and commit-per-mutation invariant. Make reconciliation findings item-scoped for mutating commands: a mutation refuses only when its target item has an unresolved publication or stale revision, while `claim-verify` still reports every finding. Enrich stale findings with ownership evidence discovered from repository refs without copying peer bytes or merging branches.

**Tech Stack:** Node.js 20+ ESM, built-in `node:test`, real temporary Git worktrees, JSON CLI envelopes, Markdown ledger and NDJSON claim journal.

**Spec:** `ledger/items/wb_01M0MR2Y8GKNCTTVS9V5ZX8Q0N.md`

## Global Constraints

- Preserve claim fencing, exact-byte CAS, commit-per-mutation durability, and `safe_exclusive_dispatch: false`.
- An unrelated private branch publication must not block every other item mutation.
- A same-item concurrent write must still refuse deterministically.
- Never copy peer working-tree bytes, auto-merge unrelated branches, or adopt revisions without explicit operator authority.
- Findings must name owner ref/commit when established, otherwise state that ownership cannot be established and give safe recovery only.
- `claim-verify` remains repository-wide diagnostic; mutation fences use target-item scope.
- `spec/adapter-reference.js` and `test/work-claim-reference.js` remain independent oracles.
- Every test command uses `TMPDIR=/tmp`; run current Node and Node 20 gates before completion.

---

### Task 1: Add failing item-scoped reconciliation tests

**Files:**
- Modify: `test/cross-worktree-coordination.test.js`
- Modify: `test/claim-git-reconciliation.test.js`
- Modify: `test/claim-capabilities.test.js`

**Interfaces:**
- Consumes: existing two-worktree fixture, `create`, `transition`, `claim-verify`, and exact refusal assertions.
- Produces: normative tests proving private unrelated work no longer blocks, same-item work still blocks, later synchronization clears the finding, and capability output names item-scoped serialization.

- [ ] **Step 1: Add one failing test for an unrelated private publication**

Extend the existing two-worktree fixture so branch A transitions item A, commits it on a branch not merged into branch B, then branch B creates or transitions unrelated item B. Assert the B mutation succeeds and item A remains reported by an explicit `claim-verify` as unresolved.

- [ ] **Step 2: Run the focused test and confirm the expected red failure**

Run:

```sh
TMPDIR=/tmp node --test test/cross-worktree-coordination.test.js
```

Expected failure: the new unrelated mutation currently returns exit 6 with `publication-reconciliation-required` because reconciliation treats every finding as a global barrier.

- [ ] **Step 3: Add one failing test for same-item protection**

Use the same fixture but target item A from branch B. Assert exit 6, `stale-write-detected`, `reason: worktree-synchronization-required` or its enriched replacement, and no item bytes changed.

- [ ] **Step 4: Run the focused test and confirm only the intended behavior is red**

Run the same command. Existing visible-peer and own-uncommitted-write tests must remain green; only the new item-scoping assertion may fail.

---

### Task 2: Scope mutation reconciliation to the target item

**Files:**
- Modify: `src/claim-publication.js:274-625,651-681`
- Modify: `src/claim-coordinator.js:18-46`
- Modify: `src/cli.js:1267-1298`
- Modify: `src/claim-publication.js:160-202,739-767`
- Test: `test/cross-worktree-coordination.test.js`, `test/claim-git-reconciliation.test.js`

**Interfaces:**
- Consumes: `reconcileClaimJournal({ ledgerDirectory, gitCommonDir, namespace, replayed, physicalNow })`.
- Produces: `reconcileClaimJournal` accepts optional `targetItemId`; it still returns all `findings`, but returns `unsafe: true` for mutations only when an unresolved finding applies to `targetItemId`. `claim-verify` omits `targetItemId` and remains global. Legacy mutation, claimed publication, claim lifecycle, and adoption paths pass their requested item ID where a target exists.

- [ ] **Step 1: Add the target-item assertion to the failing test seam**

Keep tests at CLI seams. Do not test a private helper. The new test must exercise a real branch-A commit and branch-B mutation.

- [ ] **Step 2: Implement the smallest filtering change**

Compute `unsafeFindings` from findings with `finding.item_id === targetItemId` when a target is supplied. Preserve all findings in the returned result for diagnostics. For a missing target, keep current global `unsafe` behavior.

Pass `itemId` from `withLegacyMutationFence`, `request.item_id` from `publishClaimed`, claim operation requests, and adoption where the operation is item-specific. Do not scope `claim-verify`.

- [ ] **Step 3: Run focused tests and verify green**

Run:

```sh
TMPDIR=/tmp node --test test/cross-worktree-coordination.test.js test/claim-git-reconciliation.test.js
```

Expected: unrelated private mutation succeeds; same-item mutation remains refused; global `claim-verify` still reports the private finding.

- [ ] **Step 4: Refactor only after green**

Centralize the target-scope predicate in one named helper if call sites duplicate it. Re-run the focused tests after refactoring.

---

### Task 3: Enrich stale findings with ownership facts

**Files:**
- Modify: `src/git-reconciliation.js:18-58`
- Modify: `src/claim-publication.js:651-681`
- Test-only journal fixtures remain unchanged; no journal schema change is planned for ownership lookup.
- Test: `test/claim-git-reconciliation.test.js`
- Test: `test/cross-worktree-coordination.test.js`

**Interfaces:**
- Produces: Git reconciliation helper returning current `HEAD`, symbolic branch/ref, and a bounded ownership lookup for an expected item revision. Ownership result is `{ owner_ref, owner_commit }` when a local Git ref and commit can be proven, otherwise `{ owner_unavailable: true }`.
- `stale-write-detected` findings include only established ownership members; they never guess a branch from a filename.

- [ ] **Step 1: Add a failing assertion for owner ref and commit**

Create a branch-A commit containing the expected item revision and assert branch-B refusal includes the owning ref and commit. Add an abandoned/deleted branch case asserting the finding explicitly says ownership cannot be established and does not recommend merging an unrelated branch.

- [ ] **Step 2: Run the focused test and confirm red**

Run:

```sh
TMPDIR=/tmp node --test test/claim-git-reconciliation.test.js
```

Expected failure: current findings have only `actual_revision`, `expected_revision`, path, and generic remediation.

- [ ] **Step 3: Implement bounded Git ownership lookup**

Use Git metadata and object reads only. Resolve candidate commits from repository refs for the item path, verify exact Wowbagger revision from committed bytes, and return branch/ref plus commit only after byte equality. If no reachable candidate exists, return an explicit unavailable marker. Never copy files or change refs.

- [ ] **Step 4: Replace unsafe remediation text**

For a live owner, say to wait for that owner to publish or synchronize through the owner’s normal Git workflow. For unavailable ownership, name the expected revision/path and direct the operator to inspect reachable or dangling commits and use explicit restore/adopt authority. Do not direct a sibling to merge unrelated live work.

- [ ] **Step 5: Run green focused tests**

Run both claim reconciliation test files. Mutation-test each new guard by removing owner verification and remediation selection; the tests must fail.

---

### Task 4: Advertise repaired coordination semantics

**Files:**
- Modify: `src/claim-capabilities.js:38-57`
- Modify: `docs/work-claim-contract.md` capability section
- Modify: `test/claim-capabilities.test.js`
- Modify: `test/claim-cli.test.js`
- Modify: `test/claim-conformance.test.js`
- Modify: `test/work-claim-reference-model.test.js`

**Interfaces:**
- `write_serialization.scope` names item-scoped reconciliation rather than all-worktree global blocking.
- `write_serialization.blocks_until` names the target item’s owner publication/recovery condition.
- `safe_exclusive_dispatch` remains `false`; no capability claims hostile-writer or cross-clone exclusion.

- [ ] **Step 3: Update capability output, contract prose, and independent reference expectations**
- [ ] **Step 4: Run capability, CLI, conformance, and reference-model tests**

---

### Task 5: Complete item #133 verification and commit

**Files:**
- Modify: `src/claim-publication.js`
- Modify: `src/claim-coordinator.js`
- Modify: `src/claim-capabilities.js`
- Modify: `src/git-reconciliation.js`
- Modify: `src/cli.js`
- Modify: `test/cross-worktree-coordination.test.js`
- Modify: `test/claim-git-reconciliation.test.js`
- Modify: `test/claim-capabilities.test.js`
- Modify: `test/claim-cli.test.js`
- Modify: `test/claim-conformance.test.js`
- Modify: `test/work-claim-reference-model.test.js`
- Modify: `docs/work-claim-contract.md`

- [ ] **Step 1: Run focused current-Node tests**

```sh
TMPDIR=/tmp node --test test/cross-worktree-coordination.test.js test/claim-git-reconciliation.test.js test/claim-capabilities.test.js
```

- [ ] **Step 2: Run full gates on current Node and Node 20**

```sh
TMPDIR=/tmp node --test test/*.test.js
TMPDIR=/tmp /opt/homebrew/opt/node@20/bin/node --test test/*.test.js
TMPDIR=/tmp node spec/run-adapter-implementation.js
node bin/wowbagger.js validate --ledger ledger --json
```

- [ ] **Step 3: Review diff and commit one logical change**

```sh
git diff --check
git add src test schemas docs
 git commit -m "fix: scope claim reconciliation to target items"
```

- [ ] **Step 4: Regenerate the ledger report and record item completion separately**

The implementation commit must not transition the ledger item by hand. Use the Wowbagger transition protocol after the code commit, then run `claim-verify` and validation.

---

## Priority order after #133

Implement next in ready-queue order, re-inspecting each item after #133 changes the claim surface:

1. **#138** — Validate prospective claim-journal semantics before merge.
2. **#139** — Synchronize committed adoption rulings into fresh claim clones.
3. **#135** — Return every tracked path changed by a managed mutation.
4. **#136** — Preserve exact leading LF bytes in patch body replacement.
5. **#137** — Provision declarations for existing consumer extension fields.
6. **#134** — Guard unchanged mutation refusals against reconcile-log residue regression.
7. **#127** — Add a CAS-fenced parent relation migration.
8. **#128** — Add a CAS-fenced snooze mutation for migrated items.

Each item gets its own plan file and its own RED-GREEN-REFACTOR cycles. Do not start a lower-priority item while a higher-priority item has an open implementation or verification failure.
