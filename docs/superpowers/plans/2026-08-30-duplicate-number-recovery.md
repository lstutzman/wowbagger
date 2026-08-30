# Duplicate-number recovery implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a proposal-driven, fenced, multi-item recovery operation for schema-version-2 ledgers blocked only by duplicate human-facing numbers.

**Architecture:** Add a separate `ledger-repair` response domain at contract version 1 with a read-only `number-repair-proposal` command and a mutating `number-repair` command. The apply path runs outside the ordinary valid-ledger mutation gate only after proving the complete current error set is duplicate-number, then uses a shared namespace lock, complete snapshot and per-item CAS witnesses, durable candidate staging, intent/final journal records, complete successor validation, and one auto-commit set.

**Tech Stack:** Node.js ES modules, `node:test`, YAML parser already used by the core, Git common-directory locks, append-only NDJSON journal, atomic filesystem publication, npm packaging.

**Spec:** `docs/superpowers/specs/2026-08-30-duplicate-number-recovery-design.md`

## Global constraints

- Use strict RED-GREEN-REFACTOR: one failing behavior test, one minimal implementation, complete relevant suite, then the next behavior.
- `number` remains a human-facing handle, never item identity; item identity remains the ULID.
- Do not widen ordinary `patch` and do not bless manual number edits followed by `claim-adopt`.
- The repair proposal and apply request must cover every affected duplicate group; a partial mapping is refused.
- Apply bypasses ordinary invalid-ledger mutation gating only when every current validation error is `duplicate-number`.
- Relations use ULIDs; preserve `depends_on`, `related`, and `parent` bytes and validate them again.
- Preserve all non-number item bytes, including comments, decisions, extension nodes, and the Markdown body.
- Core contract version remains 5. `ledger-repair` uses contract version 1. Existing core and work-claim envelopes remain unchanged.
- The repair domain coordinates only cooperating worktrees sharing one Git common directory. Separate clones, machines, old binaries, and noncooperating writes remain outside the guarantee.
- Candidate staging and journal files must be bounded, no-follow, namespace-scoped, and durable before item publication.
- Never retry a lost or ambiguous response blindly. Use the repair ID, durable intent, and recovery token.
- Run tests with `TMPDIR=/tmp`. Verify on Node 24.20.0 and Node 20 until #188 changes the repository floor.
- `spec/adapter-reference.js` and `test/work-claim-reference.js` remain independent and untouched.

---

### Task 1: Add strict repair request and response contracts

**Files:**
- Modify: `src/claim-request.js`
- Modify: `src/cli.js`
- Create: `src/ledger-repair.js`
- Create: `schemas/ledger-repair-proposal.json`
- Create: `schemas/ledger-repair-request.json`
- Create: `schemas/ledger-repair-response.json`
- Test: `test/ledger-repair-contract.test.js`
- Test: `test/claim-request-differential.test.js`

**Interfaces:**
- Produces `validateLedgerRepairRequest(request)`, returning sorted `{path, code, message}` issues.
- Produces `numberRepairProposal(ledgerDirectory)` and `numberRepair(request, options)` entrypoints with response domain `ledger-repair`, `contract_version: 1`.
- CLI commands are `number-repair-proposal --ledger <dir> --json` and `number-repair --ledger <dir> --input <json> --json [--auto-commit]`.

- [ ] **Step 1: Write one failing request-validation test**

Add a valid request fixture and assert that the public request validator accepts exactly:

```js
{
  repair_id: 'nr_20260830_0001',
  ledger_snapshot_revision: `sha256:${'a'.repeat(64)}`,
  date: '2026-08-30',
  changes: [{
    item_id: 'wb_01Q4837BM01W70T30B184GG1R6',
    expected_revision: `sha256:${'b'.repeat(64)}`,
    expected_number: 7,
    replacement_number: 8,
  }],
}
```

The test must use the public `validateClaimRequest('number-repair', request)` seam after command registration and assert no issues. Add negative cases one at a time for missing `repair_id`, malformed snapshot digest, empty changes, duplicate item IDs, duplicate replacement numbers, non-positive numbers, old-number mismatch types, extra members, and invalid dates.

- [ ] **Step 2: Run RED**

```sh
TMPDIR=/tmp node --test --test-name-pattern='number-repair request' test/ledger-repair-contract.test.js
```

Expected: command is unknown or validation returns the wrong issue set because no repair contract exists.

- [ ] **Step 3: Implement the narrow validator and command registration**

Add `number-repair` to the repair command's own request-member allowlist. Do not add it to the core v5 `core.commands` capability list. Implement exact members and sorted issue output. Keep proposal request-free and read-only.

Return an invalid request in the new domain:

```js
{
  exit: 2,
  stdout: {
    ok: false,
    namespace: 'ledger-repair',
    command: 'number-repair',
    contract_version: 1,
    state: 'unchanged',
    error: { code: 'invalid-request', message: 'The number-repair request is invalid.', details: { issues } },
  },
}
```

- [ ] **Step 4: Run GREEN and commit**

```sh
TMPDIR=/tmp node --test test/ledger-repair-contract.test.js test/claim-request-differential.test.js
```

```sh
git add src/claim-request.js src/cli.js src/ledger-repair.js schemas/ledger-repair-*.json test/ledger-repair-contract.test.js test/claim-request-differential.test.js
git commit -m "Add ledger-repair request contract"
```

---

### Task 2: Load invalid ledgers and generate duplicate proposals

**Files:**
- Modify: `src/ledger.js`
- Modify: `src/validate.js` only if a reusable duplicate projection is required
- Modify: `src/ledger-repair.js`
- Test: `test/ledger-repair-proposal.test.js`
- Test: `test/ledger-invalid-recovery.test.js`

**Interfaces:**
- Produces `ledgerSnapshotRevision(ledgerDirectory, options)`, a deterministic SHA-256 over sorted relevant relative paths and raw bytes.
- Produces `buildNumberRepairProposal(ledgerDirectory)`, which may inspect parseable items from an invalid ledger but never writes.
- Consumes `loadLedger` and `validateLedger` without changing their ordinary valid-ledger behavior.

- [ ] **Step 1: Write the duplicate-only proposal RED**

Construct an isolated Git ledger by creating two real items through the current core, committing them, then changing only the second item's number in the fixture copy to match the first. Run `number-repair-proposal` and assert:

- exit 0, `ok: true`, namespace `ledger-repair`, command `number-repair-proposal`, contract version 1, state `unchanged`;
- `duplicate_groups` contains one group with the duplicated number and both ULID identities;
- each affected item includes its configured path and exact source revision;
- `validation_errors` contains only `duplicate-number` errors;
- `suggested_changes` moves exactly one item to a number above the current maximum;
- `references` contains the affected item's ULID relations unchanged;
- item bytes and journal bytes are unchanged.

- [ ] **Step 2: Run RED**

```sh
TMPDIR=/tmp node --test --test-name-pattern='duplicate-only proposal' test/ledger-repair-proposal.test.js
```

Expected: ordinary ledger loading or CLI validation refuses before a proposal can be produced.

- [ ] **Step 3: Implement raw invalid-ledger proposal generation**

Use `loadLedger` to retain parseable items and validation errors. Compute the duplicate groups from parsed item data, but reject if `validation_errors.some(error => error.code !== 'duplicate-number')`. Compute `ledger_snapshot_revision` from sorted raw item/control files while excluding only derived reconciliation logs, locks, temporary files, and repair staging.

Preserve relation values as raw source-derived values and include all item revisions. Select the lexicographically smallest ULID as the preserved number owner in each group; assign new numbers above the current maximum in sorted ULID order. Do not modify the files.

- [ ] **Step 4: Add non-applicable and no-write RED/GREEN cases**

Add tests for a valid ledger and a ledger with duplicate-number plus malformed YAML or broken relation errors. Both must return `ledger-repair-not-applicable` with the complete validation errors and no file/journal changes.

Run:

```sh
TMPDIR=/tmp node --test test/ledger-repair-proposal.test.js test/ledger-invalid-recovery.test.js
```

- [ ] **Step 5: Commit**

```sh
git add src/ledger.js src/validate.js src/ledger-repair.js test/ledger-repair-proposal.test.js test/ledger-invalid-recovery.test.js
 git commit -m "Generate duplicate-number repair proposals"
```

---

### Task 3: Validate explicit multi-item repair mappings

**Files:**
- Modify: `src/ledger-repair.js`
- Test: `test/ledger-repair-apply.test.js`

**Interfaces:**
- Produces `validateNumberRepairCandidate(current, request, proposal)`, returning either `{valid: true, candidates}` or sorted repair-domain errors.
- Candidate entries have `{item_id, path, expected_revision, expected_number, replacement_number, candidate_bytes, candidate_revision}`.

- [ ] **Step 1: Write stale-witness and incomplete-mapping REDs**

Run `number-repair` against the duplicate fixture with:

- a stale `ledger_snapshot_revision`;
- a stale `expected_revision` for one item;
- a wrong `expected_number`;
- a missing change for one duplicate group;
- a replacement number already used by an unaffected item;
- duplicate replacement numbers in the request.

Assert `state: unchanged`, no item bytes changed, no repair intent, and exact distinct codes:

```text
ledger-repair-revision-conflict
ledger-repair-number-collision
```

- [ ] **Step 2: Run RED**

```sh
TMPDIR=/tmp node --test --test-name-pattern='stale|incomplete|collision' test/ledger-repair-apply.test.js
```

Expected: command is not implemented or returns a generic invalid-ledger refusal.

- [ ] **Step 3: Implement candidate validation**

Under no publication side effect:

1. Compare the request snapshot digest with the current complete snapshot.
2. Confirm every changed item exists, is a regular configured item path, and has the exact expected source revision and old number.
3. Group current duplicate errors and require the request to resolve every group.
4. Reject duplicate replacement numbers and collisions with every item not being moved.
5. Rewrite only the number scalar in each affected source while preserving every other byte.
6. Parse the complete candidate ledger and run `validateLedger`.
7. Reject any successor error as `ledger-repair-successor-invalid` with the complete errors.

Do not rewrite body text, IDs, relation values, extensions, decisions, or comments. Report number-bearing extension fields as `ledger-repair-reference-conflict` unless their declaration explicitly identifies the affected item and the proposal can validate them without guessing.

- [ ] **Step 4: Run GREEN and mutation checks**

```sh
TMPDIR=/tmp node --test test/ledger-repair-apply.test.js
```

Temporarily remove each witness comparison, collision check, duplicate-only gate, and successor validation. The corresponding focused test must fail. Restore the source byte-for-byte.

- [ ] **Step 5: Commit**

```sh
git add src/ledger-repair.js test/ledger-repair-apply.test.js
git commit -m "Validate complete duplicate-number repairs"
```

---

### Task 4: Add durable repair journal and candidate staging

**Files:**
- Modify: `src/claim-journal.js`
- Modify: `src/ledger-repair.js`
- Test: `test/claim-store.test.js`
- Test: `test/ledger-repair-recovery.test.js`

**Interfaces:**
- Adds journal entries `number-repair-intent` and `number-repair-final`.
- Produces `repairStagingPath(gitCommonDir, namespace, repairId)`, `stageNumberRepairCandidates(...)`, and `readStagedNumberRepair(...)`.
- Journal intent contains repair ID, snapshot revision, date, item witnesses, candidate revisions, and staging identifier.

- [ ] **Step 1: Write journal grammar REDs**

Add public append/replay tests for a valid intent and final pair. Add negative tests for missing candidate revision, mismatched item ID, duplicate resolution, unknown staging identifier, and an intent whose staged candidate is absent.

- [ ] **Step 2: Run RED**

```sh
TMPDIR=/tmp node --test --test-name-pattern='number-repair journal' test/claim-store.test.js test/ledger-repair-recovery.test.js
```

Expected: `CLAIM_JOURNAL_INVALID` or missing repair entry support.

- [ ] **Step 3: Implement bounded no-follow staging**

Create the staging directory under the shared Git coordination store, not the tracked ledger. Write each candidate under its relative configured item path using no-follow file creation, fsync each file, fsync parent directories, and write a manifest containing repair ID, snapshot digest, candidate paths, and digests. Reject traversal, symlinks, directories, oversized files, duplicate paths, and manifest mismatch.

Extend journal validation so repair intents and finals are paired exactly once. Preserve every existing journal entry shape and replay behavior.

- [ ] **Step 4: Run GREEN and mutation checks**

Run the complete claim-store and recovery suites. Mutate staging path validation, candidate digest comparison, and intent/final consumption; each focused recovery test must fail. Restore bytes.

- [ ] **Step 5: Commit**

```sh
git add src/claim-journal.js src/ledger-repair.js test/claim-store.test.js test/ledger-repair-recovery.test.js
git commit -m "Persist duplicate repair candidates durably"
```

---

### Task 5: Apply repair under the shared fence

**Files:**
- Modify: `src/ledger-repair.js`
- Modify: `src/claim-store.js` only if a repair-specific lock hold is required
- Modify: `src/cli.js`
- Test: `test/ledger-repair-apply.test.js`
- Test: `test/cross-worktree-coordination.test.js`

**Interfaces:**
- `numberRepair(request, {ledgerDirectory, autoCommit})` returns ledger-repair v1 envelopes.
- Uses `withClaimLock`, `resolveVerifiedGitCommonDir`, `readNamespace`, `loadLedger`, `validateLedger`, and Task 4 staging/journal functions.

- [ ] **Step 1: Write invalid-ledger bypass RED**

Against a real duplicate-number ledger produced by the current core in a temporary same-clone fixture:

1. Assert ordinary `patch` returns `ledger-invalid` and writes nothing.
2. Assert `claim-adopt` returns its existing invalid-ledger refusal and writes nothing.
3. Submit a valid full `number-repair` request and assert the new command reaches candidate validation instead of the ordinary invalid-ledger gate.

This is the required empirical proof that #182 can operate where the alpha14 fence and normal mutation gate refuse.

- [ ] **Step 2: Run RED**

```sh
TMPDIR=/tmp node --test --test-name-pattern='repair bypasses invalid-ledger mutation gate' test/ledger-repair-apply.test.js
```

Expected: `number-repair` is unknown or refuses before candidate validation.

- [ ] **Step 3: Implement shared-lock apply**

Resolve the verified Git common directory and namespace, acquire the existing namespace lock, re-read all raw bytes, and recompute the snapshot. Do not call ordinary `validatedLedger` before the duplicate-only check. After Task 3 validates candidates, stage bytes and append the repair intent. Publish each affected item with an expected-revision check and atomic temporary-file replacement. Re-read every path and compare candidate digests before appending the final terminal.

Return committed success with:

```js
{
  exit: 0,
  stdout: {
    ok: true,
    namespace: 'ledger-repair',
    command: 'number-repair',
    contract_version: 1,
    state: 'committed',
    result: { repair_id, ledger_snapshot_revision, changed_items, git_commit: null },
  },
}
```

Return unchanged refusals for stale witnesses, collisions, non-duplicate errors, and successor invalidity. A second concurrent request sees the changed snapshot or repair terminal and refuses without writing.

- [ ] **Step 4: Add two-worktree contention and synchronization RED/GREEN**

Create the duplicate in one worktree, invoke repair there, and invoke the same repair in the sibling while the namespace lock is held. The sibling must return a deterministic lock or revision refusal. After the first repair commits, synchronize the sibling and run `validate`; it must pass without rerunning the repair.

- [ ] **Step 5: Run GREEN and mutation checks**

```sh
TMPDIR=/tmp node --test test/ledger-repair-apply.test.js test/cross-worktree-coordination.test.js
```

Mutate the duplicate-only gate, lock acquisition, expected-revision check, candidate re-read, and terminal append. Restore every mutation and commit:

```sh
git add src/ledger-repair.js src/cli.js src/claim-store.js test/ledger-repair-apply.test.js test/cross-worktree-coordination.test.js
git commit -m "Apply duplicate-number repairs under the shared fence"
```

---

### Task 6: Add interrupted publication and auto-commit recovery

**Files:**
- Modify: `src/ledger-repair.js`
- Modify: `src/git-autocommit.js`
- Modify: `src/cli.js`
- Test: `test/ledger-repair-recovery.test.js`
- Test: `test/auto-commit-finalize.test.js`
- Test: `test/auto-commit-failures.test.js`

**Interfaces:**
- Repair recovery uses staged candidates and `number-repair-intent`/`number-repair-final`.
- `mutation-finalize` accepts the repair's bounded recovery token without replaying publication.

- [ ] **Step 1: Write candidate-present recovery RED**

Create a repair intent and staged candidates, publish every candidate item, then stop before the final terminal. Run public `number-repair` recovery with the same repair ID and assert it appends exactly one final terminal and returns the repaired state.

- [ ] **Step 2: Write absent/partial/third-revision REDs**

Cover these states independently:

- intent exists, no item changed: apply all staged candidates;
- some candidate paths changed, remaining paths still expected: finish only expected paths;
- one path contains third bytes: return `ledger-repair-outcome-unknown`, leave intent open, publish nothing else;
- all candidates present but Git commit absent: return a repair recovery token and let `mutation-finalize` commit exactly the repair item/log set.

- [ ] **Step 3: Run RED, then implement recovery**

```sh
TMPDIR=/tmp node --test --test-name-pattern='repair recovery|third revision|recovery token' test/ledger-repair-recovery.test.js test/auto-commit-finalize.test.js
```

Implement bounded recovery from the staged manifest. A durable final terminal is idempotent; a missing terminal after candidate publication is resolved exactly once. A third revision never gets overwritten or silently adopted.

- [ ] **Step 4: Prove auto-commit and foreign-dirt behavior**

Assert a successful repair auto-commit contains exactly all repaired item paths plus the reconciliation log, and no unrelated path. Assert a reconciliation log dirty before invocation refuses unchanged. Assert a commit failure returns `ledger-repair-commit-failed` with a token whose allowed set is exact.

- [ ] **Step 5: Run GREEN, mutation checks, and commit**

```sh
TMPDIR=/tmp node --test test/ledger-repair-recovery.test.js test/auto-commit-finalize.test.js test/auto-commit-failures.test.js
```

Mutate final-terminal idempotence, candidate digest checks, third-revision refusal, and allowed commit paths. Restore and commit:

```sh
git add src/ledger-repair.js src/git-autocommit.js src/cli.js test/ledger-repair-recovery.test.js test/auto-commit-finalize.test.js test/auto-commit-failures.test.js
git commit -m "Recover interrupted duplicate-number repairs"
```

---

### Task 7: Document and package the repair domain

**Files:**
- Modify: `docs/mutation-contract.md`
- Modify: `docs/work-claim-contract.md`
- Modify: `skills/wowbagger/SKILL.md`
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `test/packaging.test.js`
- Modify: `test/ledger-repair-contract.test.js`
- Modify: `test/release-changelog.test.js`

**Interfaces:**
- Documents exact `ledger-repair` v1 proposal/apply envelopes, hard invalid-ledger boundary, recovery, auto-commit, and sibling synchronization.
- Corrects the published warning in `docs/work-claim-contract.md`, `docs/mutation-contract.md`, `skills/wowbagger/SKILL.md`, and `CHANGELOG.md`: number-only edits preserve ULID relations; arbitrary hand edits can still damage IDs or paths.
- Makes `ledger-repair` v1 discoverable in the installed skill and README, including the relationship to core v5 and the requirement that a future core version must not silently change the repair input or repaired source shapes. A future shape change requires a new `ledger-repair` contract version and an explicit compatibility entry.
- [ ] **Step 1: Write documentation REDs**

Add behavior-oriented assertions for:

- `number-repair-proposal` and `number-repair` commands;
- `ledger-repair` contract version 1 and core version 5 relationship;
- duplicate-only invalid-ledger bypass;
- exact item ID/old number/revision/new number request fields;
- proposal-computed numbers and caller confirmation;
- no partial mapping;
- stable ULID relations and no arbitrary body rewriting;
- staged intent/final recovery and exact auto-commit paths;
- two-worktree synchronization;
- no repair for unrelated invalid-ledger faults;
- correction of the “dangling relations” warning;
- no-batch and #186 boundary.

- [ ] **Step 2: Run RED**

```sh
TMPDIR=/tmp node --test --test-name-pattern='number-repair|duplicate.*relation|ledger-repair' test/ledger-repair-contract.test.js test/packaging.test.js test/release-changelog.test.js
```

Expected: missing command and prose produce failures.

Put the recovery instructions before normal invalid-ledger dead-end guidance. State that the operation is safe for number-only changes because all structural relations use ULIDs. State that alpha14's published warning described arbitrary hand edits, not the reported number-only sequence, and replace it with the precise distinction in all four shipped surfaces: `docs/work-claim-contract.md`, `docs/mutation-contract.md`, `skills/wowbagger/SKILL.md`, and `CHANGELOG.md`.

Document the exact alpha14-compatible install requirement: `ledger-repair` v1 ships with the repair implementation, while core v5 behavior remains unchanged. Add the repair schemas and command files to npm package contents. State that a future core version that changes the repaired source or request shape requires a new `ledger-repair` contract version; it must not silently reinterpret v1 requests.

- [ ] **Step 4: Run GREEN and commit**

```sh
TMPDIR=/tmp node --test test/ledger-repair-contract.test.js test/packaging.test.js test/release-changelog.test.js
TMPDIR=/tmp /opt/homebrew/opt/node@24/bin/node --test test/ledger-repair-contract.test.js test/packaging.test.js test/release-changelog.test.js
```

```sh
git add docs/mutation-contract.md docs/work-claim-contract.md skills/wowbagger/SKILL.md CHANGELOG.md README.md schemas/ledger-repair-*.json test/ledger-repair-contract.test.js test/packaging.test.js test/release-changelog.test.js
git commit -m "Document duplicate-number recovery"
```

---

### Task 8: Final verification, release, and ledger completion

**Files:**
- Modify release metadata only for the release cut: `package.json`, `package-lock.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `CHANGELOG.md`
- Modify through Wowbagger only: `ledger/items/wb_01M14Y1YEZXNNF39P7DZ7X3WAD.md`

**Interfaces:**
- Consumes all Tasks 1–7 and the #182 acceptance criteria.
- Produces the published release, completed ledger item, and remote push proof.

- [ ] **Step 1: Run the full pre-release gate on Node 24 and Node 20**

```sh
TMPDIR=/tmp /opt/homebrew/opt/node@24/bin/node --test test/*.test.js
TMPDIR=/tmp /opt/homebrew/opt/node@20/bin/node --test test/*.test.js
TMPDIR=/tmp /opt/homebrew/opt/node@24/bin/node spec/run-adapter-implementation.js
/opt/homebrew/opt/node@24/bin/node bin/wowbagger.js validate --ledger ledger --json
/opt/homebrew/opt/node@24/bin/node bin/wowbagger.js claim-verify --ledger ledger --json
PATH=/opt/homebrew/opt/node@24/bin:$PATH npm audit
npm pack --dry-run

git diff --check
git diff --cached --check
```

Record exact runtime version strings and all counts.

- [ ] **Step 2: Run final whole-branch review**

Package the full implementation range and require no Critical or Important findings. Check proposal/apply distinction, invalid-ledger bypass, complete mapping, relations, staging security, lock/CAS, crash states, auto-commit, contract versioning, alpha14 compatibility, and published warning correction.

- [ ] **Step 3: Cut and publish the release**

Use the repository release-cut command to move Unreleased into the next alpha release. Run its complete gate, push the explicit commit and annotated tag, publish using the interactive npm passkey flow, repair `latest` and `next`, verify version/shasum/integrity/tags, and install the package globally from `/tmp`.

- [ ] **Step 4: Complete #182**

Inspect immediately before transition and move `in-progress -> done` with a decision record citing:

- real duplicate-ledger bypass proof;
- complete multi-item proposal and successor validation;
- collision and CAS refusals;
- relation preservation;
- three recovery states and idempotence;
- same-clone worktree fencing;
- Node 24 and Node 20 results;
- release and global-install proof;
- #182's boundary against unrelated invalid ledgers.

Run validate and claim-verify after the transition.

- [ ] **Step 5: Push final ledger state**

Fetch origin, prove the remote SHA is an ancestor, push the explicit completion SHA fast-forward only, compare live remote and local SHA by value, and verify divergence `0 0`.

- [ ] **Step 6: Record residual work**

Keep #185, #188, #183, #184, #187, #174, and #186 in their current order unless evidence changes. Do not close #186 because #182 ships only the safe create-then-commit loop.
