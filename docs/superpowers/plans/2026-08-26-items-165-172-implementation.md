# Items 165–172 implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix reconciliation classification, derived-log recovery, refusal diagnostics, retryability, and auto-commit finding scope for ledger items #165–#172, then document the resulting behavior.

**Architecture:** Preserve per-worktree auto-commit parallelism and the authoritative claim journal. Thread existing revision authorization evidence into classification, rebuild only the command-owned derived reconciliation log, preserve underlying claim-verification errors, and apply target scoping consistently before and after commit. Keep root envelopes and core contract version 5 unchanged.

**Tech stack:** Node.js 20+, ES modules, `node:test`, Git worktrees, Wowbagger core contract 5.

**Spec:** `docs/superpowers/specs/2026-08-26-items-165-172-design.md`

## Global constraints

- Use strict RED-GREEN-REFACTOR. No production edit before the relevant test fails for the expected missing behavior.
- Run every test command with `TMPDIR=/tmp`.
- Never change `spec/adapter-reference.js` or `test/work-claim-reference.js` to match implementation.
- Keep `state: committed` authoritative and preserve the no-replay rule.
- Keep genuine file-present unauthorized revisions blocking.
- Keep auto-commit mutex per working tree; do not bump core contract version.
- Never suppress authoritative journal or projected reconciliation-log evidence.
- Never tolerate any dirty ledger path except the current namespace derived log for a journal-owning auto-commit command.
- Commit each logical TDD cut atomically where practical.

---

### Task 1: Classify uncommitted sibling predecessors safely (#165)

**Files:**
- Modify: `test/cross-worktree-coordination.test.js`
- Modify: `src/claim-publication.js`

**Interfaces:**
- Consumes: `reconcileClaimJournal({ targetItemId })`, the existing `authorizedRevisions` set, and `reconciliationDiagnosis(...)`.
- Produces: `reconciliationDiagnosis({ ..., authorizedRevisions })`; a stale actual revision previously authorized for the item becomes `worktree-synchronization-required` without requiring a reachable owner ref.

- [ ] **Step 1: Write the failing uncommitted-sibling regression**

Add a test after `an existing stale sibling revision does not block an unrelated patch`:

```js
test('an uncommitted in-protocol sibling revision does not block an unrelated patch', async () => {
  const fixture = await twoWorktreeRepository();
  const seedId = 'wb_01KZBMBEZKPE7D15HKW9Q3GSZV';
  const secondId = 'wb_01M01BFR000TXV22D7KZ6TQYH2';
  await writeItem(fixture.root, fixture.ledger, 'second', secondId);
  git(fixture.root, 'add', 'ledger');
  git(fixture.root, 'commit', '-qm', 'Add the unrelated item');
  git(fixture.siblingRoot, 'merge', '-q', fixture.branch);

  const first = run(fixture.root, 'inspect', '--ledger', fixture.ledger, '--id', seedId, '--json');
  const privatePatch = run(
    fixture.root,
    'patch', '--ledger', fixture.ledger,
    '--input', await patchRequest(fixture.root, 'uncommitted-private.json', seedId, first.envelope.result.item.revision),
    '--json',
  );
  assert.equal(privatePatch.exit, 0, JSON.stringify(privatePatch.envelope));

  const second = run(fixture.siblingRoot, 'inspect', '--ledger', fixture.siblingLedger, '--id', secondId, '--json');
  const unrelated = run(
    fixture.siblingRoot,
    'patch', '--ledger', fixture.siblingLedger,
    '--input', await patchRequest(fixture.siblingRoot, 'unrelated.json', secondId, second.envelope.result.item.revision),
    '--json',
  );

  assert.equal(unrelated.exit, 0, JSON.stringify(unrelated.envelope));
  const verified = run(fixture.siblingRoot, 'claim-verify', '--ledger', fixture.siblingLedger, '--json');
  const finding = verified.envelope.result.findings.find((entry) => entry.item_id === seedId);
  assert.equal(finding.reason, 'worktree-synchronization-required');
  assert.equal(finding.owner_unavailable, true);
});
```

- [ ] **Step 2: Run RED**

Run:

```sh
TMPDIR=/tmp node --test --test-name-pattern="uncommitted in-protocol sibling" test/cross-worktree-coordination.test.js
```

Expected: FAIL because the unrelated patch exits 6 with `unauthorized-revision` for the seed item.

- [ ] **Step 3: Write the companion unauthorized-edit regression**

Add a test that hand-edits the seed bytes in the sibling to a revision never present in `authorizedRevisions`, then patches the unrelated item. Assert exit 6 and `finding.reason === 'unauthorized-revision'`. Run it before production changes and confirm it already passes; retain it as the safety guard.

- [ ] **Step 4: Implement the minimal classifier data flow**

In the reconciliation loop, pass `authorizedRevisions` into `reconciliationDiagnosis`. Extend the function parameter object. Before the final unauthorized fallthrough, add the narrow condition:

```js
if (authorizedRevisions.has(actualRevision)) {
  return {
    reason: 'worktree-synchronization-required',
    ...(expectedPath ? { expected_path: expectedPath } : {}),
    owner_unavailable: true,
    remediation: `Ownership of ${pathLabel} revision ${expectedRevision} is not yet reachable; wait for the owning worktree to commit, then synchronize this worktree and run claim-verify.`,
  };
}
```

Do not alter the owner-ref branch or the `actualRevision === null` branch.

- [ ] **Step 5: Run GREEN**

```sh
TMPDIR=/tmp node --test test/cross-worktree-coordination.test.js test/claim-adoption.test.js test/claim-git-reconciliation.test.js
```

Expected: all pass, including both directions.

- [ ] **Step 6: Refactor and commit**

Keep the new condition beside the unauthorized fallthrough. Run the same suite again, then commit:

```sh
git add src/claim-publication.js test/cross-worktree-coordination.test.js
git commit -m "Fix uncommitted sibling reconciliation"
```

---

### Task 2: Rebuild command-owned reconciliation-log dirt (#169)

**Files:**
- Modify: `test/auto-commit-matrix.test.js`
- Modify: `src/git-autocommit.js`
- Modify: `docs/mutation-contract.md`

**Interfaces:**
- Consumes: `finalize(...)`, `inspectWorktree(...)`, `journalOwned`, and `logPath`.
- Produces: initial preflight that ignores only `logPath` when `journalOwned === true`; internal `verifyClaimJournal` remains responsible for rebuilding the derived log.

- [ ] **Step 1: Write the failing claim-log recovery test**

Use `twoItems()`. Run a real claim acquire that dirties `fixture.logPath`, then run a valid `patch --auto-commit` on the other item without restoring or committing the log:

```js
test('journal-owning auto-commit rebuilds prior claim-generated log dirt', async () => {
  const fixture = await twoItems();
  const acquire = await requestFile(fixture, 'acquire-dirty-log.json', {
    ledger_namespace: fixture.namespace,
    item_id: ITEM_ID,
    owner_id: 'agent-a',
    lease_duration_ms: 300000,
    expected: { last_epoch: '0', active: null },
  });
  const acquired = run(fixture.root, 'claim', 'acquire', '--ledger', fixture.ledger, '--input', acquire, '--json');
  assert.equal(acquired.exit, 0, acquired.stdout);
  assert.equal(git(fixture.root, 'status', '--porcelain', '--', `ledger/${fixture.logPath}`), ` M ledger/${fixture.logPath}`);

  const request = await requestFile(fixture, 'patch-after-claim.json', patchRequest(fixture, SECOND_ITEM_ID));
  const result = run(fixture.root, 'patch', '--ledger', fixture.ledger, '--input', request, '--json', '--auto-commit');

  assert.equal(result.exit, 0, result.stdout);
  assert.deepEqual(result.envelope.result.commit_paths, [fixture.logPath, `items/${SECOND_ITEM_ID}.md`]);
  assert.equal(git(fixture.root, 'status', '--porcelain', '--', 'ledger'), '');
});
```

- [ ] **Step 2: Run RED**

```sh
TMPDIR=/tmp node --test --test-name-pattern="rebuilds prior claim-generated log dirt" test/auto-commit-matrix.test.js
```

Expected: FAIL with preflight `ledger-not-clean` naming only the reconciliation log.

- [ ] **Step 3: Add safety regressions before implementation**

Add and run:

- A journal-owning patch with any second dirty ledger item still refuses `ledger-not-clean` and names that item.
- `create --auto-commit` with a dirty reconciliation log still refuses because create does not own the log.

Both should pass before implementation and remain unchanged afterward.

- [ ] **Step 4: Implement the minimal preflight allowance**

Replace the first unconditional `before.dirtyLedger.length` refusal with:

```js
const foreignDirtyBefore = before.dirtyLedger.filter(
  (entry) => !(journalOwned && entry === logPath),
);
if (foreignDirtyBefore.length > 0) {
  return shape.preflightFailed('ledger-not-clean', { dirty_paths: bounded(foreignDirtyBefore) });
}
```

Do not add the log to the commit set before `verifyClaimJournal` rebuilds it. Keep staged-path refusal unchanged.

- [ ] **Step 5: Run GREEN**

```sh
TMPDIR=/tmp node --test test/auto-commit-matrix.test.js test/auto-commit-success.test.js test/auto-commit-commands.test.js test/claim-cli.test.js
```

Expected: all pass.

- [ ] **Step 6: Update the contract and commit**

Document that claim decisions may dirty the derived log and that a journal-owning auto-commit validates, rebuilds, and commits it. State that create and every foreign dirty path still refuse, and that evidence writes are never suppressed.

```sh
git add src/git-autocommit.js test/auto-commit-matrix.test.js docs/mutation-contract.md
git commit -m "Recover auto-commit from derived claim log dirt"
```

---

### Task 3: Preserve post-commit claim-verification diagnostics (#170)

**Files:**
- Modify: `test/auto-commit-failures.test.js`
- Modify: `src/git-autocommit.js`
- Modify: `docs/mutation-contract.md`

**Interfaces:**
- Consumes: `verifyClaimJournal` envelope and `reconciliationFailureReason(...)`.
- Produces: reconciliation failure object with `reason`, `claim_verify_code`, `claim_verify_reason`, and bounded `findings` when present.

- [ ] **Step 1: Write a failing post-commit lock-refusal regression**

Extend the existing paused auto-commit fixture. After `paused.published`, create the real claim-store lock before releasing the paused mutation so the commit lands and the post-commit `verifyClaimJournal` returns `claim-store-unavailable` / `claim-store-locked`. Assert:

```js
assert.equal(result.exit, 6);
assert.equal(result.envelope.state, 'committed');
assert.equal(result.envelope.error.code, 'post-commit-reconciliation-failed');
assert.equal(result.envelope.error.details.reason, 'claim-verify-refused');
assert.equal(result.envelope.error.details.claim_verify_code, 'claim-store-unavailable');
assert.equal(result.envelope.error.details.claim_verify_reason, 'claim-store-locked');
assert.equal(Object.hasOwn(result.envelope.error.details, 'findings'), false);
```

Use the same lock-file shape as existing claim-store contention tests and remove it in fixture cleanup only after the response is captured.

- [ ] **Step 2: Run RED**

```sh
TMPDIR=/tmp node --test --test-name-pattern="preserves post-commit claim verification refusal" test/auto-commit-failures.test.js
```

Expected: FAIL because the error carries only `reason: claim-verify-refused` and an invented empty findings array.

- [ ] **Step 3: Preserve the existing findings path**

Tighten `a post-commit reconciliation failure names the commit it already created` to assert actual findings remain present for a result-domain refusal. This should pass before implementation.

- [ ] **Step 4: Implement diagnostic extraction**

Add a helper:

```js
function claimVerificationFailureDetails(verified) {
  const error = verified.stdout.error;
  return {
    claim_verify_code: error?.code ?? null,
    ...(error?.details?.reason ? { claim_verify_reason: error.details.reason } : {}),
    ...(error?.details?.findings ? { findings: error.details.findings } : {}),
  };
}
```

Use it in both preflight and `reconciliationFailureReason`. For a result-domain failure, preserve `verified.stdout.result.findings`. Do not emit `findings` when neither domain supplied them.

Spread the complete reconciliation object into `shape.reconciliationFailed(...)` instead of selecting only `reason` and `findings`.

- [ ] **Step 5: Run GREEN**

```sh
TMPDIR=/tmp node --test test/auto-commit-failures.test.js test/auto-commit-matrix.test.js test/envelope-dispatch.test.js
```

Expected: all pass.

- [ ] **Step 6: Document and commit**

Document optional `claim_verify_code`, `claim_verify_reason`, and findings; keep committed state and no-replay instructions explicit.

```sh
git add src/git-autocommit.js test/auto-commit-failures.test.js docs/mutation-contract.md
git commit -m "Preserve post-commit claim diagnostics"
```

---

### Task 4: Signal cross-worktree claim-store retryability (#171)

**Files:**
- Modify: `test/auto-commit-matrix.test.js`
- Modify: `src/git-autocommit.js`
- Modify: `docs/mutation-contract.md`

**Interfaces:**
- Consumes: `claimVerificationFailureDetails(verified)` from Task 3.
- Produces: preflight `claim_verify_reason`; retryable true only for `claim-store-locked` or existing `mutex-held`.

- [ ] **Step 1: Write the failing retryability regression**

Create a real claim-store lock in a provisioned fixture, then run an otherwise valid auto-commit patch. Assert:

```js
assert.equal(result.envelope.error.details.reason, 'claim-state-unreconciled');
assert.equal(result.envelope.error.details.claim_verify_code, 'claim-store-unavailable');
assert.equal(result.envelope.error.details.claim_verify_reason, 'claim-store-locked');
assert.equal(result.envelope.error.details.retryable, true);
```

- [ ] **Step 2: Run RED**

```sh
TMPDIR=/tmp node --test --test-name-pattern="claim store lock is retryable" test/auto-commit-matrix.test.js
```

Expected: FAIL because `retryable` is false and no underlying reason is exposed.

- [ ] **Step 3: Add persistent-state safety regression**

Use the existing reverted-mutation fixture and assert `claim_verify_reason` is absent or names the persistent reason, while `retryable` remains false.

- [ ] **Step 4: Implement minimal retryability override**

In the claim-state preflight branch:

```js
const verification = claimVerificationFailureDetails(verified);
return shape.preflightFailed('claim-state-unreconciled', {
  ...verification,
  retryable: verification.claim_verify_reason === 'claim-store-locked',
});
```

`preflightDetails` already spreads supplied details after its default, so this explicit boolean safely overrides only this branch.

- [ ] **Step 5: Run GREEN and commit**

```sh
TMPDIR=/tmp node --test test/auto-commit-matrix.test.js test/auto-commit-failures.test.js
```

Update retryability prose to distinguish per-worktree `mutex-held` from shared claim-store locking and contract the optional reason.

```sh
git add src/git-autocommit.js test/auto-commit-matrix.test.js docs/mutation-contract.md
git commit -m "Expose claim-store retryability"
```

---

### Task 5: Align post-commit finding scope (#172)

**Files:**
- Modify: `test/cross-worktree-coordination.test.js`
- Modify: `test/auto-commit-failures.test.js`
- Modify: `src/git-autocommit.js`
- Modify: `docs/mutation-contract.md`
- Modify: `docs/work-claim-contract.md`

**Interfaces:**
- Consumes: target-scoped `verifyClaimJournal({ targetItemId })` whose exit and `ok` already encode whether findings block the target.
- Produces: post-commit success when verification is `ok:true`, ledger valid, and only nonblocking findings remain; target-blocking verification still fails.

- [ ] **Step 1: Write the failing unrelated-finding post-commit regression**

Extend the two-worktree fixture with two items. Commit an authorized private revision on item A in one branch so sibling verification reports `worktree-synchronization-required`. In the sibling, run `patch --auto-commit` on item B. Assert success, a real commit, and `claim_verified: true` despite the unrelated finding.

- [ ] **Step 2: Run RED**

```sh
TMPDIR=/tmp node --test --test-name-pattern="post-commit ignores unrelated synchronization finding" test/cross-worktree-coordination.test.js
```

Expected: FAIL with `post-commit-reconciliation-failed`, reason `claim-findings-present`, after the item-B commit lands.

- [ ] **Step 3: Pin target-finding failure**

Add a companion case where the finding belongs to item B. Assert committed-but-unverified or preflight refusal remains non-success, with complete diagnostics.

- [ ] **Step 4: Implement minimal scope alignment**

In `reconciliationFailureReason`, remove the unconditional:

```js
if (result.findings.length > 0) ...
```

Rely on `verified.exit !== 0 || verified.stdout.ok !== true` for blocking findings. Keep ledger validity and publication finalization checks unchanged. Do not add a success-envelope warnings member.

- [ ] **Step 5: Run GREEN**

```sh
TMPDIR=/tmp node --test test/cross-worktree-coordination.test.js test/auto-commit-failures.test.js test/auto-commit-success.test.js
```

Expected: unrelated synchronization succeeds; target findings and invalid ledger still fail.

- [ ] **Step 6: Update contracts and commit**

Change success wording from “no findings” to “no findings blocking the target item.” Explain that preflight and post-commit share target scope, nonblocking findings remain internal, and success envelope stays unchanged.

```sh
git add src/git-autocommit.js test/cross-worktree-coordination.test.js test/auto-commit-failures.test.js docs/mutation-contract.md docs/work-claim-contract.md
git commit -m "Align auto-commit finding scope"
```

---

### Task 6: Document terminal dates and correct parent help (#166, #167)

**Files:**
- Modify: `test/cli-help.test.js`
- Modify: `test/frontmatter-ownership-docs.test.js`
- Modify: `src/cli.js`
- Modify: `docs/mutation-contract.md`
- Modify: `skills/wowbagger/SKILL.md`

**Interfaces:**
- Produces: exact help wording without a liveness restriction; documentation of the equality-only request date for lifecycle-dated items.

- [ ] **Step 1: Write failing help assertion**

Add:

```js
test('parent-migrate help permits historical items without inventing liveness', () => {
  const result = runCli('parent-migrate', '--help');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Move one item to or from an epic with CAS fencing/);
  assert.doesNotMatch(result.stdout, /live item/);
});
```

- [ ] **Step 2: Run RED**

```sh
TMPDIR=/tmp node --test --test-name-pattern="permits historical items" test/cli-help.test.js
```

Expected: FAIL because help contains `live item`.

- [ ] **Step 3: Write failing documentation assertions**

In `frontmatter-ownership-docs.test.js`, assert the mutation contract names:

- `patch`, `snooze`, and `parent-migrate`,
- `done`, `killed`, `archived`, and `deferred`,
- request date must equal existing `updated`,
- cross-reference to the terminal-date invariant.

Run and confirm RED because this composed rule is absent.

- [ ] **Step 4: Implement docs and help**

Change command summary to:

```js
'parent-migrate': 'Move one item to or from an epic with CAS fencing.',
```

Add the terminal-date equality explanation beside the patch date rule and in the parent/snooze sections. Update the skill with inspect-current-updated guidance. Do not add a runtime status guard.

- [ ] **Step 5: Run GREEN and commit**

```sh
TMPDIR=/tmp node --test test/cli-help.test.js test/frontmatter-ownership-docs.test.js test/parent-migration.test.js test/snooze.test.js
```

```sh
git add src/cli.js docs/mutation-contract.md skills/wowbagger/SKILL.md test/cli-help.test.js test/frontmatter-ownership-docs.test.js
git commit -m "Document terminal mutation dates"
```

---

### Task 7: Add parent-migrate and snooze contract sections (#168)

**Files:**
- Create: `test/parent-snooze-contract-docs.test.js`
- Modify: `docs/mutation-contract.md`
- Modify: `skills/wowbagger/SKILL.md`

**Interfaces:**
- Produces: dedicated prose contracts for both verbs and explicit journal fence-family semantics.

- [ ] **Step 1: Write the failing docs test**

Create a test that reads and flattens the mutation contract, then asserts it contains for both verbs:

```js
for (const phrase of [
  'parent-migrate accepts exactly',
  'expected_parent',
  'parent-revision-conflict',
  'snooze accepts exactly',
  'snoozed_until',
  'patch-v1 fence family',
  'responseCommand',
]) {
  assert.match(flatContract, phrase(pattern));
}
```

Also assert the skill names the exact requests and auto-commit support.

- [ ] **Step 2: Run RED**

```sh
TMPDIR=/tmp node --test test/parent-snooze-contract-docs.test.js
```

Expected: FAIL because dedicated sections and fence-family explanation do not exist.

- [ ] **Step 3: Write exact contract sections**

Document:

- parent-migrate request: `id`, `expected_revision`, `expected_parent`, `parent`, `date`;
- snooze request: `id`, `expected_revision`, `snoozed_until`, `date`;
- date floors and lifecycle-dated equality;
- response domains and exit classes;
- auto-commit commit sets;
- `command: patch-v1` as legacy fence family and response command as operation identity.

Avoid changing journal format or runtime solely for attribution.

- [ ] **Step 4: Run GREEN and commit**

```sh
TMPDIR=/tmp node --test test/parent-snooze-contract-docs.test.js test/parent-migration.test.js test/snooze.test.js test/auto-commit-commands.test.js
```

```sh
git add docs/mutation-contract.md skills/wowbagger/SKILL.md test/parent-snooze-contract-docs.test.js
git commit -m "Document parent and snooze contracts"
```

---

### Task 8: Simplify, review, and run final gates

**Files:**
- Review all files changed by Tasks 1–7.

- [ ] **Step 1: Run code simplifier on changed production code**

Limit simplification to `src/claim-publication.js`, `src/git-autocommit.js`, and `src/cli.js`. Preserve behavior and run focused suites after any edit.

- [ ] **Step 2: Run focused aggregate suite**

```sh
TMPDIR=/tmp node --test \
  test/cross-worktree-coordination.test.js \
  test/claim-adoption.test.js \
  test/claim-git-reconciliation.test.js \
  test/auto-commit-matrix.test.js \
  test/auto-commit-failures.test.js \
  test/auto-commit-success.test.js \
  test/auto-commit-commands.test.js \
  test/envelope-dispatch.test.js \
  test/cli-help.test.js \
  test/frontmatter-ownership-docs.test.js \
  test/parent-migration.test.js \
  test/snooze.test.js \
  test/parent-snooze-contract-docs.test.js
```

- [ ] **Step 3: Run repository gates**

```sh
TMPDIR=/tmp node --test test/*.test.js
TMPDIR=/tmp /opt/homebrew/opt/node@20/bin/node --test test/*.test.js
TMPDIR=/tmp node spec/run-adapter-implementation.js
node bin/wowbagger.js validate --ledger ledger --json
git diff --check
```

- [ ] **Step 4: Run read-only code review**

Review current branch against the pre-implementation base. Fix accepted findings only through new RED-GREEN-REFACTOR cycles and rerun affected gates.

- [ ] **Step 5: Transition actual ledger items**

For each #165–#172:

1. inspect immediately before transition;
2. transition `triage -> backlog` with an accept decision if still triage;
3. transition task `backlog -> in-progress` without decision;
4. transition `in-progress -> done` with complete decision referencing tests and behavior;
5. use `--auto-commit` for every transition.

Run actual-ledger validation after all eight. Keep one commit per mutation.

- [ ] **Step 6: Confirm clean delivery**

```sh
git status --short --branch
git log -1 --oneline
```

Do not push unless explicitly requested.
