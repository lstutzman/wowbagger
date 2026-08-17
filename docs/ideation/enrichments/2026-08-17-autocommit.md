## 1. Sharpened design

Current constraints:

- A provisioned ledger uses the `merge-coordinated` profile. Git `HEAD`, not working-tree bytes, finalizes a recorded mutation. The required loop is mutate, commit, `claim-verify`, next mutation (`docs/mutation-contract.md:1854-1883`; `docs/work-claim-contract.md:61-81`).
- Response dispatch is namespace-first. Core mutation success uses the core domain. A claim-fence refusal uses `ledger-mutation` because the coordinator refused before the core mutation ran (`docs/mutation-contract.md:260-344`).
- `transition` and `patch` append a legacy intent before item publication, append a terminal after the item outcome, and then project the tracked reconcile log (`src/claim-coordinator.js:withLegacyMutationFence`, lines 59-169; `src/mutation.js:mutateExistingItem`, lines 623-629). A successful commit set is therefore the changed item plus `.wowbagger/reconcile-<namespace>.md` (`docs/work-claim-contract.md:735-751`).
- `create` does not call the legacy authorization callback and is intentionally journal-silent (`src/mutation.js:createItem`, lines 216-223; `docs/work-claim-contract.md:278-301`). Its normal commit set is the created item only.
- `publish-claimed` appends `publish-final` and projects it before returning (`src/claim-publication.js:publishClaimed`, lines 238-257; `persistTerminal`, lines 979-999). Its successful commit set is the changed item plus the reconcile log.
- `claim-verify` compares successful publications with `HEAD`, appends an idempotent `publish-finalization`, and reports the Git commit. Clock and finalization entries do not project into the tracked log (`src/claim-publication.js:reconcileClaimJournal`, lines 429-466; `verifyClaimJournal`, lines 734-785; `src/claim-journal.js:UNPROJECTED_ENTRY_TYPES`, lines 23-26).

Proposed surface and scope:

- Add one bare CLI flag: `--auto-commit`. Accept it only on `create`, `transition`, `patch`, and `publish-claimed`. Repetition is `invalid-request`. Do not add an input member, environment default, or config-file setting. Existing invocations remain byte-for-byte compatible. [PROPOSED]
- Include `publish-claimed` in the first release. Otherwise the claimed loop in `skills/wowbagger/SKILL.md:445-474` keeps the ceremony that this feature claims to remove. [PROPOSED]
- Gate the flag on ledger-specific `claim capabilities`: `mode: "merge-coordinated"` and `claim_protected_publication: true`. A flagged advisory or non-provisioned ledger refuses before the core mutation with `capability-unavailable`, `state: "unchanged"`. [PROPOSED]
- Advertise the opt-in under the ledger-specific work-claim capability, not the unbound core capability (`src/cli.js:runCli`, lines 480-497; `src/claim-capabilities.js:resolveWorkClaimCapability`). [PROPOSED]

Exact Git policy:

- Before mutation, take a per-working-tree auto-commit mutex. Record `HEAD`, the index, the target item state, and the reconcile-log digest. Refuse if any path is staged anywhere, or if any tracked, untracked, or partially staged path under the ledger is dirty. Allow unstaged and untracked files outside the ledger; never stage them. [PROPOSED]
- Recheck the same facts after item publication. A late foreign change becomes a post-publication commit failure, not permission to absorb it. Do not hold the namespace claim lock across `git commit`; hooks can re-enter Wowbagger. Bind safety with the before/after snapshots instead. [PROPOSED]
- Stage only the item path and the exact log required above: no log for `create`; one namespace log for `transition`, `patch`, and `publish-claimed`. Require that log to contain this invocation's terminal before staging. The legacy coordinator currently treats a log-write failure as rebuildable and still returns the item outcome (`src/claim-coordinator.js:withLegacyMutationFence`, lines 159-168); auto mode must surface that case as `git-commit-failed`, not make an item-only commit. Pass NUL-delimited literal pathspecs. Verify the cached path set before commit. Never run `git add <ledger>`, `git add -A`, or a pathless `git commit`. [PROPOSED]
- Use fixed subjects: `wowbagger: create item #N`, `wowbagger: transition item #N`, `wowbagger: patch item #N`, and `wowbagger: publish claimed item #N`. Use the canonical item ID only for schema-1 items without a number. Do not include title, body, decision text, or caller-supplied message text. [PROPOSED]
- Use Git's normal author and committer resolution. Do not invent identity. Honor `core.hooksPath`, `commit.gpgSign`, signing programs, and all hooks. Never pass `--no-verify` or disable signing. Check author and committer identity before mutation where Git can do so without committing. [PROPOSED]

Ordering and state machine:

1. Parse arguments and request with existing precedence. Resolve the provisioned capability. Run the clean-index, clean-ledger, identity, and mutex preflight. Then run an internal pre-mutation `claim-verify` and require clean claim state plus a valid ledger. Any failure here returns `state: "unchanged"`; no core mutation, staging, or commit occurs. This also closes the current `publishClaimed` gap where reconciliation runs only when an unresolved `publish-intent` exists (`src/claim-publication.js:publishClaimed`, lines 177-200), although the contract says an unreconciled prior mutation must refuse the next `publish-claimed` (`docs/work-claim-contract.md:68-76`). [PROPOSED]
2. Run the existing mutation unchanged. Its coordinator writes journal intent/terminal entries and the reconcile log before control reaches the Git layer (`src/claim-coordinator.js:withLegacyMutationFence`, lines 94-169; `src/claim-publication.js:persistTerminal`, lines 979-999).
3. If the returned mutation state is `unchanged`, return that envelope unchanged and perform no Git action. This includes a claim-fence refusal and a reconciliation refusal. If `publish-claimed` recorded a refusal terminal, its log can be dirty, but auto-commit still must not commit it (`docs/work-claim-contract.md:743-751`; `test/claim-reconcile-residue.test.js`, lines 183-219). [PROPOSED]
4. If the returned state is `unknown`, return it unchanged and perform no Git action. A caller must inspect; auto-commit must not guess which bytes to commit (`docs/mutation-contract.md:412-421`, 1802-1823). [PROPOSED]
5. If the returned state is `committed`, continue even when `ok` is false, because current core semantics prove the published item bytes in that state (`docs/mutation-contract.md:412-421`, 1807-1818). Preserve any original `post-commit-recovery-required` error after Git finalization. [PROPOSED]
6. Derive the exact commit set and content digests. Require the item bytes to equal the published revision, require `HEAD` to equal the preflight value, and require no foreign ledger or index change. A failure returns `git-commit-failed` with the published revision; it does not roll back the item. [PROPOSED]
7. Stage the exact set and invoke normal `git commit`. On a nonzero Git exit, inspect `HEAD`: unchanged `HEAD` is `git-commit-failed`; an exact expected commit is treated as committed; any other result is `git-commit-outcome-unknown`. Never retry a Git commit blindly. [PROPOSED]
8. After a Git commit, verify its parent, exact changed-path set, item blob revision, and reconcile-log digest. A mismatch is `git-commit-outcome-unknown`; do not rewrite history automatically. [PROPOSED]
9. Run `claim-verify` inside the same invocation. Require exit 0, no findings, and `ledger_validation.valid: true`. For `publish-claimed`, also require its publication row to have `git_finalized: true` and `git_commit` equal the new commit (`docs/work-claim-contract.md:735-782`, 824-829). A failure is `post-commit-reconciliation-failed` and carries the already-created Git commit plus the findings. [PROPOSED]
10. On success, return the original response domain and add `result.git_commit`, `result.commit_paths`, and `result.claim_verified: true`. If the original mutation had `ok: false, state: "committed"`, keep its error and exit, but add the same Git evidence inside its error details. [PROPOSED]

## 2. The commit-failed contract

Use exit 6, `state: "committed"`, code `git-commit-failed`, and message `The item was published, but its Git commit was not established.` The state still describes item publication, as section 2 currently defines it; it does not claim Git finalization (`docs/mutation-contract.md:412-421`). [PROPOSED]

For `create`, `transition`, and `patch`, keep the core domain: no `namespace`, the original command name, and core `contract_version`. Do not use `ledger-mutation`; that domain currently means the fence refused before the core mutation ran (`docs/mutation-contract.md:332-348`). For `publish-claimed`, keep `namespace: "ledger-publication"`, `command: "publish-claimed"`, its legacy envelope marker, and `operation_id` (`docs/mutation-contract.md:271-320`). [PROPOSED]

Core-domain example:

```json
{"ok":false,"command":"transition","contract_version":3,"state":"committed","error":{"code":"git-commit-failed","message":"The item was published, but its Git commit was not established.","details":{"id":"wb_...","published_revision":"sha256:...","expected_path":"items/wb_....md","commit_set":[{"path":"items/wb_....md","sha256":"sha256:..."},{"path":".wowbagger/reconcile-wbns_....md","sha256":"sha256:..."}],"pre_commit_head":"<git-oid>","failure_stage":"prepare-commit-set|stage|commit","reason":"log-unavailable|index-unavailable|head-changed|commit-command-failed|tree-changed","recovery_token":"<bounded-base64url>"}}}
```

The publication-domain form replaces `id` with `ledger_namespace` and `item_id`, and retains top-level `operation_id`. Do not include raw hook output, signing output, absolute paths, environment values, or platform exception text. A bounded human diagnostic can use standard error under the existing transport rule (`docs/mutation-contract.md:245-258`). [PROPOSED]

One-step recovery is:

```sh
wowbagger mutation-finalize --ledger <dir> --recovery-token <token> --json
```

The token is not authority to select paths. It binds command, item, published revision, pre-commit `HEAD`, ordered ledger-relative commit set, content digests, and fixed message. `mutation-finalize` re-derives every path from the ledger and namespace, checks the current bytes and foreign-change rules, creates the exact commit if absent, then runs `claim-verify`. If `HEAD` already contains the exact commit, it only verifies and returns that commit. Thus response loss and a normal failed commit use one idempotent recovery command. The command answers in the `work-claim` domain because it changes Git reconciliation state, not item bytes. [PROPOSED]

## 3. Hidden risks

1. **Critical — false atomicity.** Item publication, Git commit, and journal finalization cannot be one transaction in this profile (`docs/work-claim-contract.md:50-59`, 720-728). A crash or `SIGKILL` after item publication can still prevent the named envelope. Auto-commit reduces ceremony; it does not make `safe_exclusive_dispatch` true. [INFERRED: handled child-process failures can be named, but process death cannot always emit JSON.]
2. **Critical — foreign uncommitted ledger changes.** Current reconciliation excludes `.wowbagger/` from the Git item surface (`src/git-reconciliation.js:readGitHeadLedger`, lines 31-40), and a dirty reconcile log does not itself refuse a mutation (`test/claim-reconcile-residue.test.js`, lines 221-297). A broad add would silently commit foreign ledger work. The design must refuse all pre-existing ledger dirt and all staged changes before mutation, then repeat the check before staging.
3. **High — index and ref races.** Another process can hold the worktree index lock or move `HEAD` after preflight. [INFERRED] The per-working-tree mutex covers cooperating auto-commit calls only. The post-publication branch must return the published revision and must not reset, clean, unstage, amend, or force-update a ref.
4. **High — identity, hooks, and signing.** Missing `user.name`/`user.email` can be detected before mutation, but a configured `core.hooksPath`, signing agent, `commit.gpgSign`, `pre-commit`, or `commit-msg` hook can fail only after publication. [INFERRED] A hook can also modify the index or working tree. Honor it, report failure, and verify the resulting commit set; never bypass it.
5. **High — refusal-side reconcile-log writes.** Ordinary refused legacy mutations are byte-identical (`ledger/items/wb_01M058P3KQDSD269YXN5B4KSAK.md`, lines 22-36; `test/claim-reconcile-residue.test.js`, lines 100-153). Two exceptions matter: a foreign-worktree refusal can materialize an untracked log (`docs/work-claim-contract.md:319-337`; `test/cross-worktree-coordination.test.js`, lines 137-164), and a durable `publish-claimed` refusal terminal changes it (`docs/work-claim-contract.md:743-751`). Neither may trigger a commit.
6. **Medium — create has no journal witness.** Create is journal-silent until a later `transition` or `patch`, with a documented exposure window (`docs/work-claim-contract.md:278-301`). The recovery token must bind the untracked create path and revision; `mutation-finalize` must not become a generic “commit any valid item” command.
7. **Medium — contract and adapter strictness.** Adapter outcome validation accepts exact error codes, states, and result members (`src/adapter/process-outcome.js:validCoreMutationEnvelope`, lines 579-597; `validLedgerMutationRefusalEnvelope`, lines 768-789). The shipped adapter also constructs mutation argv without this flag (`src/adapter/invoke.js:argumentVector`, lines 50-59). Keep auto-commit direct-CLI-only initially, or budget an adapter contract/version change.
8. **Medium — claimed-publication preflight gap.** Current `publishClaimed` reconciles only when it sees an unresolved `publish-intent` (`src/claim-publication.js:publishClaimed`, lines 177-200), while the invariant names `publish-claimed` among commands blocked by any unreconciled prior mutation (`docs/work-claim-contract.md:68-76`). Auto mode needs the explicit pre-mutation `claim-verify`; broader contract parity should be fixed or separately recorded.
9. **Medium — long or interactive commit work.** Signing and hooks can prompt or hang after publication. [INFERRED] Cancellation must terminate the Git child, inspect `HEAD`, and emit the named outcome when the parent remains alive. No timeout can make an unresponsive external signer safe by itself.

## 4. What NOT to build

- **No auto-push, fetch, pull, merge, rebase, or remote check.** A local commit satisfies the current `HEAD` surface. Network publication has different credentials, conflict, and history-rewrite failure modes (`docs/work-claim-contract.md:63-76`).
- **No config-file, environment-default, or repository-default mode.** Git writes must remain explicit per invocation. A hidden default would make existing mutation automation create commits unexpectedly. [PROPOSED]
- **No auto-commit on non-provisioned or advisory ledgers.** Those ledgers have no namespace reconciliation contract (`src/claim-capabilities.js:resolveWorkClaimCapability`, lines 1-28). Refuse the flag before mutation rather than silently falling back to manual mode.
- **No commit on `state: "unchanged"` or `state: "unknown"`.** This includes reconcile-log side effects from refused operations. Item #96's default stays intact (`ledger/items/wb_01M058P3KQDSD269YXN5B4KSAK.md`, lines 22-36).
- **No broad staging, batch commit, squash, amend, stash, reset, clean, or automatic repair/adoption.** Each invocation owns one item and at most one reconcile log. Foreign work stays untouched.
- **No hook/signing bypass, author fabrication, commit-message customization, auto claim release, or auto claim renewal.** These are separate policy and authorization decisions.
- **No adapter-side implicit commit.** Adapter handoff resume currently forbids automatic Git commits (`docs/adapter-contract.md:1166-1169`; `src/adapter/handoff.js:buildResumePlan`, lines 88-96).

## 5. Acceptance criteria

- Exact CLI fixtures prove `--auto-commit` is accepted once on the four named commands, refused everywhere else, and absent invocations retain exact stdout, exit, files, index, and `HEAD`.
- A provisioned success creates one commit with the fixed message. Commit diff is item-only for `create`; item-plus-one-log for `transition`, `patch`, and `publish-claimed`. No other staged, unstaged, untracked, or ignored ledger path enters it.
- Success does not return until internal `claim-verify` exits 0. Claimed publication reports the same `git_commit` in its finalization row. Break either verification check and prove the test goes red.
- Dirty-state matrix covers staged outside ledger, staged inside ledger, unstaged inside ledger, untracked inside ledger, dirty reconcile log, unstaged outside ledger, and a late change after publication. Only unstaged/untracked outside-ledger changes are allowed, and they remain byte-identical.
- Refusal matrix covers invalid request, invalid ledger, revision conflict, active-claim refusal, prior-publication reconciliation refusal, and refused `publish-claimed`. No case creates a commit or changes `HEAD`/index. Ordinary refusals keep ledger bytes identical; documented log exceptions remain uncommitted.
- Failure fixtures cover missing identity before publication, missing/failed reconcile-log projection after publication, held index at stage time, hook refusal through configured `core.hooksPath`, signing failure with `commit.gpgSign`, `HEAD` movement, Git nonzero with unchanged `HEAD`, response loss after commit, and commit-scope mismatch.
- Every proven post-publication Git failure returns exit 6 `git-commit-failed`, `state: "committed"`, the published revision, exact commit set, and one recovery token in the original response domain. Ambiguous Git outcomes use `git-commit-outcome-unknown`, not `git-commit-failed`.
- One `mutation-finalize` invocation completes commit plus `claim-verify`. Repeating it is idempotent and creates no second commit. A changed item, log, `HEAD`, token, or foreign path refuses without Git mutation.
- A successful auto-commit of an original `ok: false, state: "committed"` outcome preserves the original error and its recovery artifacts while reporting Git evidence.
- Normative envelope-domain, mutation, work-claim, and independent-reference fixtures pin every new envelope. Mutation testing must prove the no-commit-on-refusal, exact-path, published-revision, hook/signing, and internal-verification guards.
- Current Node and Node 20 full suites, adapter conformance, adapter implementation runner, and ledger validation pass under the repository's required commands (`AGENTS.md`, Project workflow).

## 6. Effort and blast radius

**L.** The happy path is small. The honest failure contract, recovery idempotency, Git process control, and two response domains make the change large.

Subsystems: CLI option/help/dispatch and envelopes (`src/cli.js`); a new Git finalization module and recovery-token parser; item/reconcile-log commit-set exposure (`src/claim-coordinator.js`, `src/claim-publication.js`, `src/claim-journal.js`); Git `HEAD` and path helpers (`src/git-reconciliation.js`); capability reporting (`src/claim-capabilities.js`); core and work-claim contracts; README and both loops in `skills/wowbagger/SKILL.md`; envelope/mutation/work-claim fixtures; independent `test/work-claim-reference.js`; hook/signing/index/concurrency tests. Adapter code remains unchanged only if the feature stays direct-CLI-only and its current capability probe remains compatible.

## 7. Open questions for the maintainer

1. Confirm `publish-claimed` is in version one. Excluding it makes the claimed loop only half automated.
2. Accept the strict preflight rule: any staged path anywhere and any dirty path under the ledger refuses. Or require a temporary-index design that preserves foreign staged work at higher complexity?
3. Should the optional flag and additive outcomes keep core contract 3/work-claim API 1, or require new negotiated versions despite unchanged behavior without the flag?
4. Is `mutation-finalize --recovery-token` an acceptable one-step recovery surface, and should it answer in the `work-claim` domain?
5. Confirm fixed commit subjects and normal Git identity. Should schema-1 fallback use the canonical item ID or the item path?
6. Must auto-commit handle `ok: false, state: "committed"` as proposed, or stop before Git and preserve the current recovery ceremony?
7. Are detached `HEAD` and unborn `HEAD` supported, or should the flag require a named branch?
8. Should direct CLI capability advertise auto-commit if the adapter's exact capability probe then needs a coordinated contract update?
9. Resolve the documentation tension: item #96 states refused mutations are byte-identical, while foreign-worktree refusal intentionally materializes a reconcile log (`docs/work-claim-contract.md:319-337`). The auto-commit rule is clear either way: refusal never commits.
