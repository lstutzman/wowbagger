# Cross-worktree number allocation implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent cooperating Git worktrees from committing duplicate schema-version-2 item numbers by journal-fencing create and refusing stale allocation attempts unchanged.

**Architecture:** Provisioned create keeps the shared namespace lock for its complete operation, reconciles with no target scope, validates the complete numbered candidate, then appends a `create-v1` legacy intent before atomic publication and a committed or aborted terminal afterward. The ledger remains the number authority; stale worktrees synchronize and retry instead of consulting a second counter.

**Tech stack:** Node.js ES modules, `node:test`, Git worktrees, append-only NDJSON claim journal, filesystem atomic link publication, npm packaging.

**Spec:** `docs/superpowers/specs/2026-08-29-cross-worktree-number-allocation-design.md`

## Global constraints

- Follow strict RED-GREEN-REFACTOR: one failing behavior test, one minimal implementation, complete relevant suite, then the next behavior.
- Use `TMPDIR=/tmp` for every test command.
- Verify the complete suite on the current Node runtime and `/opt/homebrew/opt/node@20/bin/node`.
- Preserve `number = 1 + max(existing ledger numbers)`; do not add a counter, reservation database, or caller-supplied number.
- Preserve atomic no-clobber publication and exact final-byte verification.
- Core create success remains `contract_version: 5`; fenced refusals remain `ledger-mutation` `contract_version: 1`.
- `spec/adapter-reference.js` and `test/work-claim-reference.js` are independent oracles; do not import them into production or change them to match implementation.
- Alpha.13 journals must remain readable by the new binary. Alpha.13 reading the new grammar must fail closed with the observed exit 6 envelope and no item write.
- Existing duplicate ledgers remain #182; do not add manual renumbering or recovery to #181.
- Alpha.14 ships #181 together with the already-implemented reachable-unowned remediation correction.
- Before any release, upgrade guidance must tell operators to upgrade every writer in one Git coordination domain before the first alpha.14 create.

---

Before Task 1, coordinate with the repository orchestrator, raise #185 to priority 1 through Wowbagger, and transition #181 through `triage -> backlog -> in-progress` with fresh revisions, decisions, validation, claim verification, and one auto-commit per mutation.

### Task 1: Extend the journal grammar for create

**Files:**
- Modify: `src/claim-journal.js:270-312`
- Modify: `test/claim-store.test.js:154-190`

**Interfaces:**
- Consumes: existing `appendClaimEntry(journalPath, entry)` and `replayClaimJournal(journalPath, namespace)`.
- Produces: journal validation for `create-v1` intent, committed terminal, and absent abort while leaving patch/transition grammar unchanged.

- [ ] **Step 1: Write the create-intent RED**

Add one test after the future-writer compatibility test:

```js
test('journal replay accepts a create intent with an absent predecessor', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-journal-create-intent-'));
  const journalPath = claimJournalPath(root, NS);
  await appendClaimEntry(journalPath, {
    type: 'legacy-mutation-intent',
    attempt_id: 'create_intent_0001',
    ledger_namespace: NS,
    item_id: 'wb_01Q4837BM01W70T30B184GG1R6',
    command: 'create-v1',
    expected_revision: null,
    candidate_revision: `sha256:${'c'.repeat(64)}`,
    item_path: 'items/wb_01Q4837BM01W70T30B184GG1R6.md',
    observed_at: '2030-01-11T09:00:00.000Z',
  });
  assert.equal((await replayClaimJournal(journalPath, NS)).entries.length, 1);
});
```

- [ ] **Step 2: Run RED, implement only intent grammar, then GREEN**

```sh
TMPDIR=/tmp node --test --test-name-pattern='create intent with an absent predecessor' test/claim-store.test.js
```

Expected RED: `CLAIM_JOURNAL_INVALID`. In the intent branch, accept `create-v1` and require null only for its `expected_revision`; patch and transition continue to require strings. Rerun the focused test and complete claim-store file.

- [ ] **Step 3: Write the committed-terminal RED**

Add a second test that appends:

```js
{
  type: 'legacy-mutation',
  attempt_id: 'create_commit_0001',
  ledger_namespace: NS,
  item_id: 'wb_01Q4837BM01W70T30B184GG1R7',
  command: 'create-v1',
  committed_revision: `sha256:${'d'.repeat(64)}`,
  item_path: 'items/wb_01Q4837BM01W70T30B184GG1R7.md',
  observed_at: '2030-01-11T09:00:01.000Z',
}
```

Run it and require `CLAIM_JOURNAL_INVALID`, then widen only the committed-terminal command set to include `create-v1`. Keep `committed_revision` a string. Run focused and complete claim-store GREEN.

- [ ] **Step 4: Write the absent-abort RED**

Add a third test that appends:

```js
{
  type: 'legacy-mutation-abort',
  attempt_id: 'create_abort_0001',
  ledger_namespace: NS,
  item_id: 'wb_01Q4837BM01W70T30B184GG1R8',
  command: 'create-v1',
  observed_revision: null,
  observed_at: '2030-01-11T09:00:02.000Z',
}
```

Run it and require `CLAIM_JOURNAL_INVALID`. Preserve old abort entries exactly and allow only the new create form:

```js
const validAbortRevision = (
  !Object.hasOwn(entry, 'command') && typeof entry.observed_revision === 'string'
) || (
  entry.command === 'create-v1' && entry.observed_revision === null
);
```

Do not accept `command` on patch/transition aborts, and do not accept null without `command: 'create-v1'`.

- [ ] **Step 5: Run GREEN and mutation checks**

```sh
TMPDIR=/tmp node --test test/claim-store.test.js
```

Temporarily remove `create-v1` from each validator branch one at a time. Exactly its matching focused test must fail. Restore the file byte-for-byte and rerun GREEN.

- [ ] **Step 6: Commit**

```sh
git add src/claim-journal.js test/claim-store.test.js
git commit -m "Accept journal-fenced create entries"
```

---

### Task 2: Journal-fence create and block stale allocation

**Files:**
- Modify: `src/mutation.js:228-461`
- Modify: `src/claim-coordinator.js:23-209`
- Modify: `test/create-journal-asymmetry.test.js`

**Interfaces:**
- Consumes: Task 1 journal grammar; existing `withLegacyMutationFence`, `validateSerializedCandidate`, `revisionFor`, and `reconcileClaimJournal`.
- Produces: `create-v1` intent before publication, terminal/abort afterward, and repository-wide reconciliation only for create.

- [ ] **Step 1: Write the sequential stale-worktree RED**

Add `access` to the `node:fs/promises` import. Replace the old sibling-create success assertion with the new public contract while retaining the following sibling transition to prove patch/transition scope is unchanged:

```js
const siblingCreate = run(
  fixture.siblingRoot, 'create', '--ledger', fixture.siblingLedger,
  '--input', await createRequest(fixture.siblingRoot, 'create-sibling.json', SECOND_ID), '--json',
);
assert.equal(siblingCreate.exit, 6, JSON.stringify(siblingCreate.envelope));
assert.equal(siblingCreate.envelope.namespace, 'ledger-mutation');
assert.equal(siblingCreate.envelope.command, 'create-v1');
assert.equal(siblingCreate.envelope.state, 'unchanged');
assert.equal(siblingCreate.envelope.error.code, 'claim-store-unavailable');
assert.equal(
  siblingCreate.envelope.error.details.reason,
  'publication-reconciliation-required',
);
await assert.rejects(
  access(path.join(fixture.siblingLedger, `${SECOND_ID}.md`)),
  { code: 'ENOENT' },
);
const finding = siblingCreate.envelope.error.details.findings.find(
  (entry) => entry.item_id === FIRST_ID,
);
assert.equal(finding.reason, 'worktree-synchronization-required');
```

Rename the test to `a journaled create blocks stale sibling allocation but not an unrelated transition`.

- [ ] **Step 2: Run RED**

```sh
TMPDIR=/tmp node --test --test-name-pattern='journaled create blocks stale sibling allocation' test/create-journal-asymmetry.test.js
```

Expected: FAIL because sibling create exits 0 and publishes duplicate number 2.

- [ ] **Step 3: Thread authorization into create**

Change the callback and private signature:

```js
export async function createItem(ledgerDirectory, request, scenario) {
  return withLegacyMutationFence(
    ledgerDirectory,
    request.id,
    'create-v1',
    (authorize, ledgerSnapshot) => createItemUnfenced(
      ledgerDirectory, request, scenario, authorize, ledgerSnapshot,
    ),
  );
}

async function createItemUnfenced(
  ledgerDirectory, request, scenario, authorize, ledgerSnapshot,
) {
```

After candidate validation and the no-clobber-capability preflight, but before `prepareTemporary`, append the intent only when the ledger is provisioned:

```js
if (authorize) {
  await authorize(null, revisionFor(bytes), relativeFinalPath);
}
```

Unprovisioned and non-Git calls receive no callback and retain the local lock-only behavior.

- [ ] **Step 4: Make create reconciliation repository-wide**

In `withLegacyMutationFence`:

```js
const create = command === 'create-v1';
// ...
targetItemId: create ? null : itemId,
```

Use the same `create` boolean in the normal abort and pre-reserved resolution entry:

```js
const abortEntry = {
  type: 'legacy-mutation-abort',
  attempt_id: attemptId,
  ledger_namespace: namespace,
  item_id: itemId,
  ...(create ? { command } : {}),
  observed_revision: expectedRevision,
  observed_at: observedAt,
};
```

Do not change transition or patch target scoping.

- [ ] **Step 5: Run GREEN and the complete behavior file**

```sh
TMPDIR=/tmp node --test --test-name-pattern='journaled create blocks stale sibling allocation' test/create-journal-asymmetry.test.js
TMPDIR=/tmp node --test test/create-journal-asymmetry.test.js
```

Expected: stale sibling create exits 6, publishes no second item, and the unrelated seed transition still commits.

- [ ] **Step 6: Flip the fresh-create overwrite characterization**

Change the old `overwrite ... is not detected` test one assertion set at a time. First expect `claim-verify` to exit 6 with one `unauthorized-revision` finding for `FIRST_ID`; run RED against the implementation before adding any extra code. It should pass after the journal fence because create now authorizes the item from birth. Then expect the following create to refuse unchanged.

Remove the three prose-only tests that pin the superseded journal-silent decision; Task 6 replaces them with behavior and current contract documentation.

- [ ] **Step 7: Mutation proof and commit**

Temporarily change `targetItemId: create ? null : itemId` back to `targetItemId: itemId`. The stale sibling create test must fail by returning committed, while the unrelated transition remains green. Restore, rerun the file, then commit:

```sh
git add src/mutation.js src/claim-coordinator.js test/create-journal-asymmetry.test.js
git commit -m "Fence create allocation across worktrees"
```

---

### Task 3: Resolve interrupted create intents

**Files:**
- Modify: `src/claim-publication.js:432-487`
- Modify: `test/claim-git-reconciliation.test.js:323-384`

**Interfaces:**
- Consumes: Task 1 create journal grammar.
- Produces: deterministic committed, aborted, or unknown recovery for `create-v1` pending intents.

- [ ] **Step 1: Write the absent-item RED**

Append a create intent whose path does not exist, run `claim-verify`, and assert:

```js
assert.equal(verified.exit, 0, JSON.stringify(verified.envelope));
const abort = replayed.entries.find((entry) => entry.attempt_id === attemptId
  && entry.type === 'legacy-mutation-abort');
assert.equal(abort.command, 'create-v1');
assert.equal(abort.observed_revision, null);
```

Expected RED: recovery builds an abort without `command`; Task 1's strict grammar rejects it, so verification exits 6 or the terminal assertion fails.

- [ ] **Step 2: Run RED**

```sh
TMPDIR=/tmp node --test --test-name-pattern='resolves an absent create intent as aborted' test/claim-git-reconciliation.test.js
```

- [ ] **Step 3: Implement create abort recovery**

When `actualRevision === intent.expected_revision`, append:

```js
{
  type: 'legacy-mutation-abort',
  attempt_id: intent.attempt_id,
  ledger_namespace: namespace,
  item_id: intent.item_id,
  ...(intent.command === 'create-v1' ? { command: intent.command } : {}),
  observed_revision: actualRevision,
  observed_at: observedAt,
}
```

Patch and transition recovery bytes stay unchanged.

- [ ] **Step 4: Run absent-item GREEN**

Run the focused command again, then the complete file.

- [ ] **Step 5: Add candidate-present and third-revision characterizations**

These are existing generic resolver branches enabled for create by Task 1, not new branches to implement:

- Put a valid schema-version-2 candidate item at the intent's `item_path`; assert `claim-verify` appends a committed terminal carrying the same `attempt_id`, `command: 'create-v1'`, and candidate revision.
- Put different valid item bytes at `item_path`; assert exit 6, `legacy-mutation-outcome-unknown`, the attempt ID, candidate revision, and no committed/abort terminal.

Use literal item sources with unique numbers and derive only their SHA-256 digests with the existing test helper. Both tests exercise public `claim-verify`, not an internal helper.

- [ ] **Step 6: Run GREEN, mutate, and commit**

```sh
TMPDIR=/tmp node --test test/claim-git-reconciliation.test.js test/claim-store.test.js
```

Temporarily omit the create abort `command`; only the absent-item recovery test must fail. Separately mutate the candidate comparison and confirm the candidate-present characterization fails, then restore and commit:

```sh
git add src/claim-publication.js test/claim-git-reconciliation.test.js
git commit -m "Recover interrupted journaled creates"
```

---

### Task 4: Preserve candidate ordering and auto-commit ownership

**Files:**
- Modify: `test/create-journal-asymmetry.test.js`
- Modify: `test/auto-commit-cli.test.js:193-220`
- Modify if RED requires: `src/git-autocommit.js`

**Interfaces:**
- Consumes: Task 2's create intent and coordinator `changed_paths` behavior.
- Produces: no intent before candidate validation; successful auto-commit owns exactly item plus reconciliation log; foreign pre-existing log residue still refuses.

- [ ] **Step 1: Write the candidate-invalid RED**

Create a request whose `depends_on` names a valid but absent item ID. Public request parsing accepts the shape, while whole-ledger candidate validation rejects it. Snapshot the journal entries before and after and assert no `legacy-mutation-intent` for the requested ID and no item path:

```js
assert.equal(result.exit, 2, JSON.stringify(result.envelope));
assert.equal(result.envelope.error.code, 'candidate-invalid');
await assert.rejects(access(createdPath), { code: 'ENOENT' });
assert.equal(
  afterEntries.some((entry) => entry.type === 'legacy-mutation-intent'
    && entry.item_id === createdId),
  false,
);
```

Run the test before moving or adding any production statement. It should pass only when `authorize` remains after complete candidate validation.

- [ ] **Step 2: Add the create auto-commit RED**

Extend `the first auto-commit works after provisioning` to assert the literal commit set:

```js
assert.deepEqual(result.envelope.result.commit_paths, [
  `.wowbagger/reconcile-${namespace}.md`,
  `items/${id}.md`,
]);
assert.deepEqual(
  git(fixture.root, 'diff-tree', '--no-commit-id', '--name-only', '-r',
    result.envelope.result.git_commit).split('\n'),
  [
    `ledger/.wowbagger/reconcile-${namespace}.md`,
    `ledger/items/${id}.md`,
  ],
);
```

Import or expose only the existing fixture helpers needed to inspect the commit. Expected RED: current create commits only the item because it owns no journal entries.

- [ ] **Step 3: Run GREEN and preserve strict preflight**

After Task 2, `withLegacyMutationFence` should already return both changed paths. Adjust `git-autocommit.js` only if the RED shows it drops the new log path. Run:

```sh
TMPDIR=/tmp node --test test/auto-commit-cli.test.js test/auto-commit-matrix.test.js
```

The existing `create auto-commit still refuses a dirty derived log` test must remain green. Do not give create permission to absorb residue that existed before its invocation.

- [ ] **Step 4: Commit**

```sh
git add test/create-journal-asymmetry.test.js test/auto-commit-cli.test.js src/git-autocommit.js
git commit -m "Commit journaled create evidence atomically"
```

Omit `src/git-autocommit.js` from `git add` if no implementation change was required.

---

### Task 5: Prove contention, synchronization retry, and cost

**Files:**
- Modify: `test/create-journal-asymmetry.test.js`
- Create: `test/create-phase-profile.test.js`
- Reuse without production exposure: `test/mutation-runner.js`

**Interfaces:**
- Consumes: public `runCli` create path, test-only bounded checkpoint `pause-after-lock-acquired:<token>`, instrumentation counters.
- Produces: deterministic two-process contention proof, synchronized retry proof, and permanent lock/profile characterization.

- [ ] **Step 1: Write the synchronize-and-retry RED**

Use a fresh two-worktree fixture:

1. Create `FIRST_ID` in the primary worktree and commit item plus log.
2. Run `SECOND_ID` create in the stale sibling; assert exit 6 and no item.
3. Merge the primary branch into the sibling.
4. Run `claim-verify`; assert exit 0 and no findings.
5. Retry the exact same `SECOND_ID` request; assert exit 0 and `number: 3`.
6. Run `validate`; assert valid.

The RED before Task 2 commits both stale items as number 2. The GREEN proves refusal does not consume the request ID or number.

- [ ] **Step 2: Write deterministic contention coverage**

Spawn the first create through `test/mutation-runner.js` with `WOWBAGGER_TEST_SCENARIO=pause-after-lock-acquired:<token>`. Poll for the fixture's `.<token>-acquired` marker with a bounded condition loop, never a fixed sleep. Start the sibling create only after the marker exists.

The sibling must exit 6 with either `claim-store-locked` while the first owns the namespace lock or `publication-reconciliation-required` if the first finishes before observation. Then write the allow-successor marker, wait for the first child, and assert exactly one committed item and one number 2 across both worktrees.

Every polling loop uses a wall-clock deadline of at most 30 seconds and teardown kills both child process groups. No unbounded load or orphanable process is permitted.

- [ ] **Step 3: Run contention and retry GREEN**

```sh
TMPDIR=/tmp node --test --test-name-pattern='synchronize.*retry|concurrent.*create' test/create-journal-asymmetry.test.js
TMPDIR=/tmp node --test test/create-journal-asymmetry.test.js
```

Repeat the focused command at least five times to expose nondeterminism. A fixed delay or intermittent result is a failed test design.

- [ ] **Step 4: Add the create phase profile**

In `test/create-phase-profile.test.js`, provision a schema-version-2 Git ledger, snapshot `phaseCounters()`, call public create once, and assert:

```js
assert.equal(delta.namespace_lock_acquisitions, 1);
assert.equal(delta.worktree_identity_lock_acquisitions, 1);
assert.equal(delta.item_lock_acquisitions, 2); // item ID + NUMBER_INDEX_LOCK_ID
assert.equal(delta.item_lock_fsyncs, 2);
assert.equal(delta.item_lock_releases, 2);
```

Also replay the journal and assert the successful cycle adds exactly one clock, one create intent, and one create terminal. Do not assert an elapsed-time threshold in a permanent test.

- [ ] **Step 5: Record the large-ledger benchmark**

Run the same create path against the repository's existing large-ledger fixture and record item count, prior journal entries, elapsed wall time, `head_tree_entries`, and `head_blobs_read` in the task report. Compare with the parent commit using the same fixture and runtime. This is evidence, not a benchmark gate; any new Git roster/history traversal on the clean path is a defect.

- [ ] **Step 6: Run both runtimes and commit**

```sh
TMPDIR=/tmp node --test test/create-journal-asymmetry.test.js test/create-phase-profile.test.js
TMPDIR=/tmp /opt/homebrew/opt/node@20/bin/node --test test/create-journal-asymmetry.test.js test/create-phase-profile.test.js
```

```sh
git add test/create-journal-asymmetry.test.js test/create-phase-profile.test.js
git commit -m "Prove cross-worktree create contention safety"
```

---

### Task 6: Update contracts, compatibility evidence, and release guidance

**Files:**
- Modify: `docs/work-claim-contract.md:316-386,1174-1213`
- Modify: `docs/mutation-contract.md`
- Modify: `skills/wowbagger/SKILL.md`
- Modify: `CHANGELOG.md`
- Modify: `test/auto-commit-contract-docs.test.js`
- Modify: `test/release-changelog.test.js`
- Modify: `test/packaging.test.js`
- Modify only during the release cut: `package.json`, `package-lock.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`

**Interfaces:**
- Consumes: final behavior and exact alpha.13 probe envelope.
- Produces: truthful create coordination contract, searchable hard-cutover guidance, and alpha.14 distribution metadata.

- [ ] **Step 1: Write documentation behavior REDs**

Add assertions that contracts and the installed skill contain all literal old-writer evidence:

```text
claim-store-unavailable
The durable claim store is unavailable.
claim-store-unreadable
upgrade every writer
before the first alpha.14 create
```

Add behavior-oriented contract assertions for:

- create intent preceding publication;
- create abort carrying `command: create-v1` and null observed revision;
- repository-wide create reconciliation;
- item plus reconciliation-log auto-commit ownership;
- existing duplicates remaining #182 recovery work.

Run the focused documentation tests and confirm RED before editing prose.

- [ ] **Step 2: Replace the superseded journal-silent contract**

Rewrite `docs/work-claim-contract.md` section 3.1. Retain the historical reason and explicitly state #181 overturns it because sequential stale worktrees duplicate immutable numbers. Define the new ordering, refusal envelope, exact remediation routing, hard cutover, cost, and capacity.

Update mutation-contract create and auto-commit sections without claiming cross-clone or cross-machine coordination.

Update the installed skill before its create workflow: every cooperating writer must run alpha.14 before the first post-upgrade create. Map the literal alpha.13 envelope to upgrade guidance.

- [ ] **Step 3: Record executable compatibility evidence**

Run the post-fix binary against the full alpha.13 journal fixtures and require success.

Build or obtain the immutable alpha.13 package, execute its binary against an isolated valid Git ledger after the post-fix binary has emitted a real create intent, and record exactly:

```text
exit=6
error.code=claim-store-unavailable
error.message=The durable claim store is unavailable.
error.details.reason=claim-store-unreadable
state=unchanged
item_written=no
```

This command is a release proof. Do not add a network-dependent permanent test. The permanent docs tests pin the literal evidence and the upgrade instruction.

- [ ] **Step 4: Run docs, conformance, and package tests**

```sh
TMPDIR=/tmp node --test test/auto-commit-contract-docs.test.js test/release-changelog.test.js test/packaging.test.js test/claim-conformance.test.js
TMPDIR=/tmp /opt/homebrew/opt/node@20/bin/node --test test/auto-commit-contract-docs.test.js test/release-changelog.test.js test/packaging.test.js test/claim-conformance.test.js
```

- [ ] **Step 5: Commit behavior documentation**

```sh
git add docs/work-claim-contract.md docs/mutation-contract.md skills/wowbagger/SKILL.md CHANGELOG.md test/auto-commit-contract-docs.test.js test/release-changelog.test.js test/packaging.test.js
git commit -m "Document journal-fenced create allocation"
```

Do not change release versions in this commit.

---

### Task 7: Final verification, review, release, and ledger completion

**Files:**
- Review all files changed since spec commit `c947a29`.
- Modify for release: `package.json`, `package-lock.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `CHANGELOG.md`
- Modify through Wowbagger only: `ledger/items/wb_01M14Y1NTXQPMQ270VT1WH6H17.md` (#181)

**Interfaces:**
- Consumes: Tasks 1-6 and the repository release procedure.
- Produces: reviewed alpha.14, globally installed binary, completed #181, and remote publication proofs.

- [ ] **Step 1: Run the complete gate**

```sh
TMPDIR=/tmp node --test test/*.test.js
TMPDIR=/tmp /opt/homebrew/opt/node@20/bin/node --test test/*.test.js
TMPDIR=/tmp node spec/run-adapter-implementation.js
node bin/wowbagger.js validate --ledger ledger --json
node bin/wowbagger.js claim-verify --ledger ledger --json
npm audit
git diff --check
git diff --cached --check
```

Record exact test counts, exits, adapter status, audit result, and findings.

- [ ] **Step 2: Run simplification and whole-branch review**

Review the full range from `c947a29` through implementation HEAD against item #181 and both design documents. Require no Critical or Important findings. Any accepted finding starts a new TDD cycle and reruns the complete relevant suite.

Review specifically:

- intent-before-publication ordering;
- no item write on every refusal;
- absent abort and third-revision recovery;
- create-only repository scope;
- auto-commit item/log set;
- alpha.13 fail-closed evidence;
- journal capacity and large-ledger cost;
- #182 non-scope.

- [ ] **Step 3: Cut alpha.14 atomically**

Move the Unreleased entries into `0.1.0-alpha.14`, including #181, the reachable-unowned remediation correction, and literal hard-cutover guidance. Update all four distribution version sites together. Run release-site, packaging, current Node, Node 20, adapter, ledger, audit, and diff gates again.

- [ ] **Step 4: Publish and verify alpha.14**

Run `npm publish` in an interactive PTY so Lee can complete the Chrome passkey prompt. Verify registry version, shasum, integrity, and `latest`/`next` tags. Install alpha.14 globally and verify the global binary's path, version, contract 5, and absence of a checkout link.

- [ ] **Step 5: Complete #181 through its public lifecycle seam**

Inspect in-progress #181 immediately before completion. Transition only `in-progress -> done`, with a fresh expected revision and decision; acceptance and start were committed before Task 1. The completion rationale must cite:

- sequential and concurrent worktree proofs;
- candidate validation before intent/publication;
- current Node and Node 20 counts;
- alpha.13 observed fail-closed envelope;
- alpha.14 package and global-install proof;
- #182 remaining recovery work;
- #185 raised to priority 1 for general version-drift diagnosis.

After each lifecycle mutation, validate and claim-verify before the next.

- [ ] **Step 6: Push with repository coordination proofs**

Fetch `origin/main`, compare the live remote SHA by value, prove it is an ancestor of local HEAD, and require pre-push divergence `0 N`. Push fast-forward only. Verify remote and local SHA equality and post-push divergence `0 0`.

- [ ] **Step 7: Commit checkpoints**

Use atomic release and ledger commits with imperative subjects. Never combine implementation, release metadata, and lifecycle evidence into one commit.
