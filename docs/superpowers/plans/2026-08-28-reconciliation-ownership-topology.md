# Reconciliation Ownership Topology Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace branch-order ownership inference with a typed reconciliation classifier and explicit per-worktree identity while preserving public envelopes and alpha.12 journal compatibility.

**Architecture:** Gather local revision classes, active-worktree Git evidence, and optional journal writer identity before classification. A pure `reconciliation-classifier` module returns reason, barrier scope, owner evidence, and remediation kind; `claim-publication` renders existing public findings and applies target scope. A private random UUID in each worktree's Git directory distinguishes unreachable local successors from sibling successors without exposing machine identity.

**Tech Stack:** Node.js ESM, built-in `node:test`, Git CLI plumbing, JSON-lines claim journal, filesystem atomic write/rename, Wowbagger public CLI.

**Spec:** `docs/design/2026-08-28-reconciliation-ownership-topology.md`

## Global Constraints

- Keep core `contract_version: 5`; the approved additive `identity_diagnostic` is the only new public detail. Stop and ask Lee before changing any outer field, code, reason, required member, or journal requirement incompatibly.
- Public requests, outer envelope shapes, codes, and reasons remain unchanged.
- `writer_worktree_id` is optional journal evidence; alpha.12 readers ignore it, and new readers treat absence as unknown.
- Worktree IDs are random UUID v4 values; never derive them from path, branch, host, or user.
- Store `wowbagger-worktree-id` inside the current worktree's private Git directory with mode `0600`.
- Create identity through exclusive same-directory temporary write, file sync, close, same-filesystem rename, and read-back while the claim lock is held.
- Duplicate UUIDs among live registered worktrees fail closed through existing claim-store-unreadable envelopes before mutation.
- Tags, remote-tracking refs, and detached sibling worktrees never become a named `owner_ref`.
- Tests use public CLI seams for observable classification and blocking; internal tests supplement but never replace them.
- Add one behavior per RED-GREEN-REFACTOR cycle. Characterization rows must be mutation-proven, not presented as fabricated REDs.
- Use `TMPDIR=/tmp` for every test command.
- Do not modify `spec/adapter-reference.js` or `test/work-claim-reference.js` to match implementation.
- Do not push code or docs without the repository Orchestration Agent's fresh gate.

---

## File map

- Create `src/worktree-identity.js`: resolve, create, validate, and duplicate-check private worktree UUIDs.
- Create `src/git-worktrees.js`: parse the NUL-delimited registered-worktree roster and resolve private Git directories for both identity and owner evidence.
- Create `src/reconciliation-classifier.js`: pure normalized topology classification and barrier scope.
- Modify `src/claim-journal.js`: accept and preserve optional `writer_worktree_id` on authorizing entries.
- Modify `src/claim-coordinator.js`: ensure identity under the claim lock, pass it into reconciliation, and record it on legacy intents/terminals.
- Modify `src/claim-publication.js`: normalize evidence, record claimed-publication identity, render typed diagnoses, and map identity failures to existing envelopes.
- Modify `src/git-reconciliation.js`: enumerate active worktrees and distinguish current, named sibling, detached sibling, reachable-unowned, and unreachable evidence.
- Modify `src/git-autocommit.js` only if required to preserve the exact existing preflight envelope fields in the spec; no new reason value.
- Modify `test/claim-store.test.js`: alpha.12 future-field characterization and journal evidence preservation.
- Modify `test/cross-worktree-coordination.test.js`: rows 6a, 6b, 6c, tag-only, remote-only, detached sibling, duplicate identity, and recreation behavior.
- Modify claimed-publication tests where authorizing journal entries are asserted.
- Modify `docs/work-claim-contract.md`, `docs/mutation-contract.md`, `skills/wowbagger/SKILL.md`, and `CHANGELOG.md` only after runtime behavior is final.

---

### Task 1: Pin alpha.12 journal forward compatibility

**Files:**
- Modify: `test/claim-store.test.js`

**Interfaces:**
- Consumes: `appendClaimEntry(journalPath, entry)` and `replayClaimJournal(journalPath, namespace)` from `src/claim-journal.js`.
- Produces: Permanent proof that alpha.12-valid journal entries may carry `writer_worktree_id` without invalidation.

- [ ] **Step 1: Add the compatibility characterization**

Add one test beside the existing append/replay tests:

```js
test('alpha12 journal entries ignore an optional future writer worktree id', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-journal-future-field-'));
  const journalPath = claimJournalPath(root, NS);
  const writerWorktreeId = '06d0814b-4e22-4e67-9edd-2915f0d38f29';

  const attemptId = 'alpha12_future_writer_0001';
  const revision = `sha256:${'a'.repeat(64)}`;
  await appendClaimEntry(journalPath, {
    type: 'legacy-mutation-intent',
    attempt_id: attemptId,
    ledger_namespace: NS,
    item_id: 'wb_01Q4837BM01W70T30B184GG1R6',
    command: 'patch-v1',
    expected_revision: revision,
    candidate_revision: revision,
    item_path: 'item.md',
    observed_at: '2030-01-11T09:00:00.000Z',
    writer_worktree_id: writerWorktreeId,
  });
  await appendClaimEntry(journalPath, {
    type: 'legacy-mutation',
    attempt_id: attemptId,
    ledger_namespace: NS,
    item_id: 'wb_01Q4837BM01W70T30B184GG1R6',
    command: 'patch-v1',
    committed_revision: revision,
    item_path: 'item.md',
    observed_at: '2030-01-11T09:00:00.000Z',
    writer_worktree_id: writerWorktreeId,
  });

  const replayed = await replayClaimJournal(journalPath, NS);
  assert.equal(replayed.entries.length, 2);
  assert.equal(replayed.entries[0].writer_worktree_id, writerWorktreeId);
  assert.equal(replayed.entries[1].writer_worktree_id, writerWorktreeId);
});
```

Use `t.after(() => rm(root, { recursive: true, force: true }))` if this file's surrounding tests use test cleanup hooks.

- [ ] **Step 2: Run it before production changes**

Run:

```bash
TMPDIR=/tmp node --test --test-name-pattern='alpha12 journal entries ignore an optional future writer worktree id' test/claim-store.test.js
```

Expected: PASS on the unchanged alpha.12 implementation. Record this as characterization, not RED.

- [ ] **Step 3: Prove the characterization is load-bearing**

Temporarily reject `writer_worktree_id` in the `legacy-mutation` validator, rerun the focused command, and require failure with `CLAIM_JOURNAL_INVALID` / `invalid-entry`. Restore the validator immediately and rerun to PASS.

- [ ] **Step 4: Commit the characterization**

```bash
git add test/claim-store.test.js
git commit -m "Characterize alpha12 journal field compatibility"
```

---

### Task 2: Create private worktree UUIDs safely

**Files:**
- Create: `src/git-worktrees.js`
- Create: `src/worktree-identity.js`
- Modify: `test/cross-worktree-coordination.test.js`

**Interfaces:**
- `src/git-worktrees.js` produces:
  - `resolvePrivateGitDir(directory): Promise<string>`
- `src/worktree-identity.js` produces:
  - `readWorktreeIdentity({ ledgerDirectory, gitCommonDir }): Promise<string | null>`
  - `ensureWorktreeIdentity({ ledgerDirectory, gitCommonDir }): Promise<string>`
- Identity errors use internal code `CLAIM_WORKTREE_IDENTITY_INVALID`; callers map them to existing public outer errors plus the approved nested diagnostic.

- [ ] **Step 1: Write RED for identity creation through public patch**

Add a public CLI test that provisions a temporary Git ledger, runs `patch --json`, resolves the private Git directory with `git rev-parse --absolute-git-dir`, and asserts:

```js
const gitDir = git(root, 'rev-parse', '--absolute-git-dir');
const identityPath = path.join(gitDir, 'wowbagger-worktree-id');
const beforeStatus = git(root, 'status', '--porcelain');
const identity = await readFile(identityPath, 'utf8');
assert.match(identity, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\n$/);
assert.equal((await stat(identityPath)).mode & 0o777, 0o600);
assert.equal(path.dirname(identityPath), gitDir);
assert.equal(git(root, 'status', '--porcelain'), beforeStatus);
```

- [ ] **Step 2: Run RED**

Run the focused test. Expected: FAIL with `ENOENT` for `wowbagger-worktree-id`.

- [ ] **Step 3: Implement read/create lifecycle**

Create `src/worktree-identity.js` with these constants and validators:

```js
const IDENTITY_FILE = 'wowbagger-worktree-id';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function invalidIdentity(reason) {
  const error = new Error('worktree identity is invalid');
  error.code = 'CLAIM_WORKTREE_IDENTITY_INVALID';
  error.reason = reason;
  return error;
}
```

Use `resolvePrivateGitDir` from `git-worktrees.js`; never parse `.git` manually. `readWorktreeIdentity` returns `null` on `ENOENT`, validates exactly one lowercase UUID v4 plus newline, and throws on malformed bytes. `ensureWorktreeIdentity` writes `${randomUUID()}\n` to a `wx` temporary file in that directory, calls `sync()`, closes it, renames it to the final path, then reads it back. Remove the temporary path in `finally`. Never truncate the final path.

- [ ] **Step 4: Call identity creation only under claim lock before a journal write**

In `withLegacyMutationFence`, call `ensureWorktreeIdentity` inside `withClaimLock` before reconciliation and before appending an intent. Pass the returned ID into later tasks without writing it to journal yet.

- [ ] **Step 5: Run GREEN and focused regressions**

Run the identity test and the complete `test/cross-worktree-coordination.test.js`. Expected: identity test PASS; all existing topology tests PASS.

- [ ] **Step 6: Refactor and commit**

Task 2 implements only private-Git-directory resolution in `git-worktrees.js`. Task 5 adds the NUL-safe roster parser alongside its first public consumers and duplicate tests; Task 7 must reuse that parser.

```bash
git add src/git-worktrees.js src/worktree-identity.js src/claim-coordinator.js test/cross-worktree-coordination.test.js
git commit -m "Create private worktree identities"
```

---

### Task 3: Record writer identity on legacy mutations and fix row 6a

**Files:**
- Modify: `src/claim-journal.js`
- Modify: `src/claim-coordinator.js`
- Modify: `src/claim-publication.js`
- Modify: `test/cross-worktree-coordination.test.js`
- Modify: `test/claim-store.test.js`

**Interfaces:**
- Journal entries optionally carry `writer_worktree_id: string`.
- `reconcileClaimJournal` receives `currentWorktreeId: string | null`.
- `expectedWriterFor(entries, latestAuthorized, currentWorktreeId)` returns `'current' | 'other' | 'unknown'`.

- [ ] **Step 1: Write row 6a RED**

Create a public scenario in one worktree:

1. Patch item P to successor E without committing.
2. Restore the item bytes to authorized predecessor P while `HEAD` remains P.
3. Run `claim-verify` and an unrelated patch.

Assert `claim-verify` exits `6`, finding reason is `unauthorized-revision`, and unrelated patch exits `6` with the same finding.

- [ ] **Step 2: Run RED**

Expected: current alpha.12 behavior reports `worktree-synchronization-required`, `owner_unavailable: true`, and lets unrelated patch exit `0`.

- [ ] **Step 3: Accept and preserve optional journal evidence**

For `legacy-mutation-intent` and `legacy-mutation`, extend validation with:

```js
&& (!Object.hasOwn(entry, 'writer_worktree_id')
  || typeof entry.writer_worktree_id === 'string')
```

Do not require the field. When pending intents resolve into terminal entries, copy it only when present:

```js
...(intent.writer_worktree_id
  ? { writer_worktree_id: intent.writer_worktree_id }
  : {}),
```

- [ ] **Step 4: Record identity on legacy intent and terminal**

Add `writer_worktree_id: currentWorktreeId` to `intentEntry`, `terminalEntry`, and response-loss resolution entries in `claim-coordinator.js`.

- [ ] **Step 5: Add expected-writer normalization**

Before calling the classifier, derive:

```js
const recordedWriter = latestAuthorized.writer_worktree_id ?? null;
const expectedWriter = recordedWriter === null || currentWorktreeId === null
  ? 'unknown'
  : recordedWriter === currentWorktreeId ? 'current' : 'other';
```

For row 6a, return the existing unauthorized finding before sibling synchronization.

- [ ] **Step 6: Run GREEN**

Run the row 6a test. Require `claim-verify` exit `6` and unrelated patch exit `6`.

- [ ] **Step 7: Run compatibility and companion suites**

Run `test/claim-store.test.js` and `test/cross-worktree-coordination.test.js`. All alpha.12 entries without identity must still replay and existing unreachable behavior must remain unchanged.

- [ ] **Step 8: Commit**

```bash
git add src/claim-journal.js src/claim-coordinator.js src/claim-publication.js test/claim-store.test.js test/cross-worktree-coordination.test.js
git commit -m "Record legacy mutation worktree identity"
```

---

### Task 4: Distinguish sibling and legacy unreachable writers

**Files:**
- Modify: `test/cross-worktree-coordination.test.js`
- Modify: `src/claim-publication.js`

**Interfaces:**
- Consumes `expectedWriter: 'current' | 'other' | 'unknown'`.
- Produces rows 6b and 6c without public field changes.

- [ ] **Step 1: Write row 6b RED**

First perform and commit an unrelated observer mutation so both observer and writer have distinct worktree UUIDs. Then, in the sibling worktree, write E without committing. In the observer, keep P in working tree and `HEAD`. Assert:

```js
assert.equal(finding.reason, 'worktree-synchronization-required');
assert.equal(finding.owner_unavailable, true);
assert.match(finding.remediation, /not yet reachable/);
assert.equal(unrelated.exit, 0);
```

Because Task 3 may already make this pass, classify it as characterization if so.

- [ ] **Step 2: Prove row 6b non-tautology**

Temporarily classify `expectedWriter: 'other'` as global unauthorized. Require the row 6b test to fail on reason or unrelated exit. Restore and rerun PASS.

- [ ] **Step 3: Pin row 6c for old journal entries**

Create the same unreachable topology after removing `writer_worktree_id` from the latest authorizing entry while preserving journal hashes. Assert unavailable-owner synchronization and unrelated success.

- [ ] **Step 4: Prove row 6c fallback is load-bearing**

Temporarily map `unknown` writer to `current`, require failure as unauthorized, restore, and rerun PASS.

- [ ] **Step 5: Run all topology companions and commit**

```bash
TMPDIR=/tmp node --test test/cross-worktree-coordination.test.js
git add src/claim-publication.js test/cross-worktree-coordination.test.js
git commit -m "Distinguish unreachable worktree writers"
```

---

### Task 5: Fail closed on duplicate or stale worktree identity

**Files:**
- Modify: `src/worktree-identity.js`
- Modify: `src/claim-publication.js`
- Modify: `src/claim-coordinator.js`
- Modify: `src/git-autocommit.js` only if envelope propagation needs correction
- Modify: `test/cross-worktree-coordination.test.js`

**Interfaces:**
- `assertUniqueWorktreeIdentity` enumerates live registered worktrees and throws `CLAIM_WORKTREE_IDENTITY_INVALID` on duplicates, carrying `identityDiagnostic: { code: 'duplicate-worktree-identity', worktree_id, live_worktree_count }`.
- Public callers keep existing outer codes and reasons while copying that value to `error.details.identity_diagnostic`.

- [ ] **Step 1: Write duplicate UUID RED through `claim-verify` and patch**

Create two registered worktrees, write the same canonical UUID to both private Git directories, and run public commands. Assert:

```js
const identityDiagnostic = {
  code: 'duplicate-worktree-identity',
  worktree_id: duplicateId,
  live_worktree_count: 2,
};
assert.equal(verified.exit, 6);
assert.equal(verified.envelope.error.code, 'claim-store-unavailable');
assert.equal(verified.envelope.error.details.reason, 'claim-store-unreadable');
assert.deepEqual(verified.envelope.error.details.identity_diagnostic, identityDiagnostic);
assert.equal(blocked.exit, 6);
assert.equal(blocked.envelope.state, 'unchanged');
assert.deepEqual(blocked.envelope.error.details.identity_diagnostic, identityDiagnostic);
```

Also snapshot item bytes, journal bytes, reconciliation log, `HEAD`, and index before the commands; assert every snapshot remains identical.

- [ ] **Step 2: Run RED**

Expected: commands proceed or classify ordinary synchronization because duplicate detection does not exist.

- [ ] **Step 3: Implement live-worktree enumeration and duplicate detection**

Parse `git worktree list --porcelain -z` into records with path, `HEAD`, branch, detached, bare, locked, and prunable flags. Resolve each Git-marked-live path's private Git directory through `git -C <path> rev-parse --absolute-git-dir`. Exclude only `bare` and Git-marked `prunable` records. A process/parse error, ENOENT race on a record marked live, private-Git-directory resolution failure, or malformed live sibling identity throws before reconciliation with `identityDiagnostic: { code: 'worktree-enumeration-failed' }`; never substitute an empty roster.

- [ ] **Step 4: Map identity failure to existing public envelopes**

Ensure `verifyClaimJournal`, legacy mutation fence, `publish-claimed`, and `claim-adopt` map `CLAIM_WORKTREE_IDENTITY_INVALID` to `claim-store-unavailable` / `claim-store-unreadable`, `state: 'unchanged'`, exit `6`, and preserve `identity_diagnostic`. Auto-commit must expose:

```js
{
  reason: 'claim-state-unreconciled',
  claim_verify_code: 'claim-store-unavailable',
  claim_verify_reason: 'claim-store-unreadable',
  identity_diagnostic: {
    code: 'duplicate-worktree-identity',
    worktree_id: duplicateId,
    live_worktree_count: 2,
  },
  retryable: false,
}
```

- [ ] **Step 5: Run GREEN across every public failure surface**

Require duplicate `claim-verify` and ordinary mutation tests to pass with exact `identity_diagnostic` values. Require auto-commit to refuse at exit `4` with `auto-commit-preflight-failed` and the exact nested claim verification fields above. Add focused public tests proving `publish-claimed` and `claim-adopt` exit `6`, return their existing `claim-store-unavailable` / `claim-store-unreadable` form plus the same diagnostic with unchanged state, and leave journal, item bytes, identity files, index, and `HEAD` unchanged.

- [ ] **Step 6: Pin enumeration failure and liveness limitation**

Add a public failure injection that makes `git worktree list` fail and assert the same outer claim-store-unavailable / claim-store-unreadable operation mappings and no-write snapshots as duplicate detection, with exact `identity_diagnostic: { code: 'worktree-enumeration-failed' }`. Prove malformed identity bytes and a path disappearing after Git marks the record live fail the same way. Add contract text stating duplicate detection evaluates only worktrees Git currently reports live; bare/prunable records are excluded, so an unavailable or unmounted worktree marked prunable is not checked until Git reports it live again.

- [ ] **Step 7: Write removal/recreation RED**

Record writer UUID A in a journal, remove that worktree through Git, recreate a worktree at the same path, and require new UUID B where `A !== B`. The old authorizing entry must normalize to writer `unknown`, never current.

- [ ] **Step 8: Implement and verify recreation behavior**

Do not copy or restore identity files when Git recreates a worktree. The new private Git directory receives a fresh UUID on first write. Run the recreation test and duplicate suite.

- [ ] **Step 9: Commit**

```bash
git add src/git-worktrees.js src/worktree-identity.js src/claim-publication.js src/claim-coordinator.js src/git-autocommit.js docs/work-claim-contract.md test/cross-worktree-coordination.test.js
git commit -m "Reject ambiguous worktree identities"
```

Omit `src/git-autocommit.js` from `git add` when its bytes remain unchanged.

---

### Task 6: Record identity on claimed publications

**Files:**
- Modify: `src/claim-publication.js`
- Modify: `src/claim-journal.js`
- Modify: claimed-publication test files that already inspect `publish-intent` and `publish-final`

**Interfaces:**
- `publish-intent` and `publish-final` optionally carry `writer_worktree_id`.
- Response-loss terminal reconstruction preserves the intent's identity.

- [ ] **Step 1: Write RED for claimed-publication journal evidence**

Extend an existing public `publish-claimed` success test. Replay the journal and assert both entries carry the private UUID read from the writer's Git directory:

```js
assert.equal(intent.writer_worktree_id, worktreeId);
assert.equal(final.writer_worktree_id, worktreeId);
```

- [ ] **Step 2: Run RED**

Expected: both values are `undefined`.

- [ ] **Step 3: Validate optional fields and record them**

Extend `validJournalEntry` for `publish-intent` and `publish-final`. Ensure identity once under the existing claim lock. Add it to the intent and pass it into `persistTerminal`; response-loss recovery copies from the intent.

- [ ] **Step 4: Run GREEN and response-loss tests**

Run the focused claimed-publication success and recovery tests. Require exact prior public envelopes.

- [ ] **Step 5: Commit**

```bash
git add src/claim-publication.js src/claim-journal.js test
git commit -m "Record claimed publication worktree identity"
```

Before committing, replace broad `git add test` with the exact changed test paths shown by `git status --short`.

---

### Task 7: Restrict owner evidence to active worktrees

**Files:**
- Modify: `src/git-reconciliation.js`
- Modify: `src/claim-publication.js`
- Modify: `test/cross-worktree-coordination.test.js`

**Interfaces:**
- Replace `findRevisionOwner` return shape with internal evidence:

```js
{
  kind: 'current' | 'named-sibling' | 'reachable-unowned' | 'unreachable',
  ref?: string,
  commit?: string,
}
```

- Current named and detached ownership retain first priority.

- [ ] **Step 1: Write tag-only RED**

Create expected E, commit it, make only a tag contain E, reset/delete the branch ref, and observe P. Assert synchronization remains target-scoped but reports `owner_unavailable: true` and no `owner_ref`.

Expected pre-fix failure: `owner_ref` names `refs/tags/<tag>`.

- [ ] **Step 2: Implement active-worktree ownership selection**

After finding the matching commit, enumerate active worktrees. For each live worktree, check whether its `HEAD` history contains the matching commit. Give current worktree first priority. For named sibling records, sort by branch ref then path. A detached sibling returns `reachable-unowned`; arbitrary refs never become owners.

- [ ] **Step 3: Run tag-only GREEN**

Require target mutation blocked, unrelated mutation allowed, `owner_unavailable: true`, no `owner_ref`.

- [ ] **Step 4: Add remote-only and detached-sibling rows one at a time**

Remote-only must fail before implementation if it exposes `refs/remotes/...` as owner. Detached sibling may already pass after Step 2; if so, mutation-prove its characterization by temporarily naming detached evidence.

- [ ] **Step 5: Run #176/#177 companions**

Require named sibling `owner_ref`/`owner_commit`, current named regression, and current detached regression to remain exact.

- [ ] **Step 6: Commit**

```bash
git add src/git-reconciliation.js src/claim-publication.js test/cross-worktree-coordination.test.js
git commit -m "Name only active worktree owners"
```

---

### Task 8: Wire every reconciliation caller, then extract the classifier

**Files:**
- Create: `src/reconciliation-classifier.js`
- Modify: `src/claim-publication.js`
- Modify: any existing reconciliation caller identified by the audit, only when it omits current identity
- Modify: `test/cross-worktree-coordination.test.js`
- Modify: focused publish/adopt/claim lifecycle tests that exercise the corrected callers

**Interfaces:**
- 8a produces command-independent `currentWorktreeId` evidence for every `reconcileClaimJournal` caller.
- 8b exports `classifyReconciliation({ workingTree, head, expectedOwner, expectedWriter })`.
- 8b exports `findingBlocksTarget(scope, findingItemId, targetItemId)` or keeps it private in the same module; scope, never reason, decides.
- The classifier returns exactly the result union in the spec.

#### Task 8a: Wire current identity into every reconciliation caller

- [ ] **Step 1: Audit every caller before editing**

List every `reconcileClaimJournal` call site with file, enclosing command, lock context, and whether it currently passes `currentWorktreeId`. Record the complete table in the task report. Every caller that classifies item reconciliation must pass identity; if one legitimately must not, record the reason before implementation.

- [ ] **Step 2: Write public publish row 6a RED**

Construct the current-writer unreachable-successor topology, invoke `publish-claimed`, and assert the reconciliation refusal reports `unauthorized-revision`, blocks publication, and leaves item, journal, reconcile log, identity, index, and `HEAD` unchanged. Run before production edits and require the existing unavailable-synchronization diagnosis.

- [ ] **Step 3: Implement publish wiring and run GREEN**

Reuse the identity already ensured and uniqueness-checked inside the publication lock:

```js
reconciled = await reconcileClaimJournal({
  ledgerDirectory,
  gitCommonDir,
  namespace,
  replayed,
  physicalNow: new Date().toISOString(),
  targetItemId: request.item_id,
  currentWorktreeId,
  writeLogOnUnsafe: false,
});
```

Run the focused publish test and genuine-sibling/unreachable companions. Public codes and fields stay unchanged; only the reason/remediation corrects for current writer evidence.

- [ ] **Step 4: Pin adoption semantics and fix own-identity diagnostic order**

First characterize row 6a through `claim-adopt`: adoption deliberately ignores reconciliation unsafe/findings because clearing that state is its purpose, so a valid adoption must succeed, clear the state, and leave later claim-verify clean. Do not manufacture an unauthorized-refusal RED. Then add the real public RED: malformed current-worktree identity must match claim-verify's existing unreadable result without sibling `worktree-enumeration-failed` diagnostic. Read current identity before roster uniqueness inside the adoption lock, run GREEN, and pin genuine sibling/legacy-unknown adoption behavior.

- [ ] **Step 5: Cover every remaining caller from the audit**

For each omitted caller, add one public behavior test before wiring it. Do not change a caller that has a documented reason to remain identity-free, such as adoption's deliberate unsafe-state recovery. Run one focused set proving every caller that classifies barriers agrees on row 6a and preserves rows 6b/6c; adoption must preserve its documented recovery behavior while matching identity-error diagnostics.

- [ ] **Step 6: Add release-note evidence and commit 8a separately**

Record in `CHANGELOG.md` under Unreleased that `publish-claimed` and every claim lifecycle caller changed by the audit now report unauthorized rather than synchronization for an unreachable successor written by the current worktree. Record adoption's corrected own-identity diagnostic order separately if user-visible. Do not claim adoption now refuses row 6a, and do not add a version heading.

```bash
git add src/claim-publication.js src/claim-coordinator.js src/cli.js test/cross-worktree-coordination.test.js test/claim-publish-refusal.test.js test/claim-adoption.test.js CHANGELOG.md
git commit -m "Align reconciliation callers on worktree identity"
```

Stage only files that actually changed.

#### Task 8b: Extract the typed classifier without behavior changes

- [ ] **Step 7: Capture the post-8a public matrix baseline**

Run the complete cross-worktree suite and every focused caller test. Save counts in the report. No source changes yet.


- [ ] **Step 8: Create normalized revision classification**

In `claim-publication.js`, convert revisions before calling the new module:

```js
function revisionClass(revision, expectedRevision, authorizedRevisions) {
  if (revision === null) return 'absent';
  if (revision === expectedRevision) return 'expected';
  return authorizedRevisions.has(revision) ? 'authorized' : 'unknown';
}
```

Move expected-writer normalization into the classifier input construction or a named helper only if more than one caller uses it. This resolves the deferred inline-normalization Minor without creating a speculative export.

- [ ] **Step 9: Move one topology at a time**

Start with global unknown/deletion barriers, run their public tests, then move Git finalization, current-owner unauthorized, named sibling synchronization, unavailable synchronization, and final unauthorized fallback. After each move, run the matching public test before deleting the old branch.

- [ ] **Step 10: Replace reason-based target scope**

Replace:

```js
return finding.reason !== 'worktree-synchronization-required';
```

with the classifier's scope result. Store internal scope alongside the finding during reconciliation, strip it before returning public `findings`, and assert no new public member appears.

- [ ] **Step 11: Run full public topology and caller suites**

Every matrix row, existing companion, publish/adopt caller, and malformed-identity test must pass with exact public envelopes.

- [ ] **Step 12: Mutation-test distinct outcomes**

Change each result class once—global to target, target to global, current owner to sibling, unknown writer to current, named sibling to unavailable—and require a public test failure. Restore after each mutation.

- [ ] **Step 13: Simplify without new public seams**

Remove obsolete `reconciliationDiagnosis`, `blocksTarget`, and duplicate remediation construction only after all public tests pass. Keep filesystem and Git evidence outside the pure module. Review the deferred `GIT_ENVIRONMENT` duplication Minor; fix it only if an existing shared internal interface can be reused without widening public or test seams, otherwise keep it ledgered for final review.

- [ ] **Step 14: Commit 8b separately**

```bash
git add src/reconciliation-classifier.js src/claim-publication.js test/cross-worktree-coordination.test.js
git commit -m "Centralize reconciliation topology classification"
```

The 8b diff contains no intended public behavior change. If a public fixture or expected reason changes, stop and treat it as a missing 8a behavior task rather than folding it into extraction.

---

### Task 9: Document final contract and verify completion

**Files:**
- Modify: `docs/work-claim-contract.md`
- Modify: `docs/mutation-contract.md`
- Modify: `skills/wowbagger/SKILL.md`
- Modify: `CHANGELOG.md`
- Modify: `ledger/items/wb_01M12GT91WYNWHTYRBV7Y5R9E3.md` only through Wowbagger CLI

**Interfaces:**
- Documents only behavior proven by Tasks 1–8.
- Keeps `contract_version: 5` and existing public envelope fields.

- [ ] **Step 1: Update contract text**

Document optional writer identity, old-entry ambiguity, current-versus-sibling unreachable behavior, duplicate fail-closed envelopes, and active-worktree-only owner evidence. Do not expose private identity paths as a public integration interface.

- [ ] **Step 2: Update installed skill**

Teach agents that `owner_ref` names an active named worktree only; `owner_unavailable` may mean unreachable writer, detached sibling, or commit reachable only outside active worktrees. Keep existing recovery actions exact.

- [ ] **Step 3: Add Unreleased note**

Add distinct bullets for worktree identity/topology classification and for corrected owner evidence from tags/remotes. Do not create a version heading; release tooling owns it.

- [ ] **Step 4: Run focused suites**

Run every changed test file individually under current Node and Node 20.

- [ ] **Step 5: Run full repository gate**

```bash
/usr/bin/time -p node -e ''
TMPDIR=/tmp node --test test/*.test.js
TMPDIR=/tmp /opt/homebrew/opt/node@20/bin/node --test test/*.test.js
TMPDIR=/tmp node spec/run-adapter-implementation.js
node bin/wowbagger.js validate --ledger ledger --json
npm audit
git diff --check
git diff --cached --check
```

Expected: both suites zero failures/skips, claude-code implementation status pass, ledger valid, zero audit vulnerabilities, whitespace checks clean.

- [ ] **Step 6: Run simplification and review gates**

Run the required code-simplifier on changed production/test files. Then run no-mistakes with complete item #178 intent; require review and test clean with no skipped steps. If a PR exists, run `/code-review` before merge.

- [ ] **Step 7: Complete item #178 through the ledger CLI**

Inspect immediately before transition. The decision must cite every commit, the alpha.12 compatibility execution, row-by-row RED/GREEN or characterization proof, duplicate/recreation behavior, owner-evidence tightening, full gate counts, and no-mistakes result. Use `--auto-commit`, then run ledger validation and `claim-verify`.

- [ ] **Step 8: Request integration gate**

Send exact commits, files, tests, contract-version decision, public envelope proof, and ledger revision to the Orchestration Agent. Push only under a fresh fast-forward authorization; no force.
