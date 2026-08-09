# Multi-item atomic transition — design and adversarial review

**Status: rejected as written.** Five blocking findings, recorded below. Item 44
chose to build multi-item atomic write scope; this is the first design attempt and
the review that stopped it. Both are kept because the skeleton is sound and the
findings are the specification for the next attempt.

Produced 2026-08-09 by two independent agents: one designing, one attacking.

---

## Part 1 — the design

# Design: atomic dependent cleanup

## 1. The commit protocol

- Store transaction state under one shared coordinator, keyed by a stable ledger namespace.
- When Git is present, the coordinator lives under the Git common directory. Otherwise, it lives under the ledger root.
- Every cooperative command reads one atomic `STATE` file. It contains a generation, phase, transaction ID, and manifest hash.
- A writer prepares one transaction directory with a manifest, exact before and after bytes, paths, hashes, and revisions for all N items.
- It syncs every staged file before publication. It attempts directory sync, but does not depend on its success.
- The writer atomically replaces `STATE: clean` with `STATE: prepared`. It then replaces the N item files one at a time and verifies all after bytes.
- The exact commit step is one same-directory atomic replacement of `STATE: prepared` with `STATE: committed`.
- Before `prepared`, a reader sees the old ledger.
- While state is `prepared`, a reader never returns item data. It waits, retries, or returns `transaction-recovery-required`.
- After `committed`, a reader sees the new ledger. The writer already verified all N paths before this step.
- Each reader reads `STATE`, loads the complete ledger, then reads `STATE` again. It accepts the snapshot only when both state bytes match.
- After commit or rollback verification, recovery replaces `STATE` with `clean` at the next generation. It then retires the transaction directory atomically and removes it best effort.
- Direct filesystem and Git readers can observe intermediate replacements. This remains outside the advertised cooperative-writer boundary.

## 2. Crash recovery

- Before the transaction manifest is complete: item files are unchanged. An unreferenced staging directory is garbage.
- After the manifest but before `prepared`: item files are unchanged. Recovery verifies that `STATE` does not name the transaction, then retires it.
- After `prepared` but before the first item replacement: no commit exists. Recovery verifies or restores every before image, then rolls back.
- Between item replacements: no commit exists. Recovery restores every before image with atomic same-path replacement and verifies the complete set.
- After all replacements but before `committed`: recovery still rolls back. Complete after bytes do not imply commit.
- During the atomic `committed` replacement: recovery sees either the valid old `prepared` state or the valid new `committed` state. It never guesses.
- After `committed` but before response or cleanup: recovery rolls forward from the after images, verifies all N paths, and preserves state `committed`.
- During recovery: the phase remains `prepared` or `committed`. A later recovery repeats the same rollback or roll-forward operation idempotently.
- After `clean` but before transaction-directory removal: the item set was already verified. The remaining directory is garbage.
- Recovery may replace a member only when its current hash equals that member’s recorded before or after hash. Any third value means non-cooperative interference; recovery returns `write-outcome-unknown` and preserves evidence.
- A process crash releases the coordinator’s kernel advisory mutex. Recovery does not break locks by age.
- Power loss remains explicitly unsupported. Missing, reordered, or incoherent `STATE`, manifest, or item entries after power loss produce an unknown outcome and require audited manual recovery.

## 3. Compare-and-set across N items

- Keep `expected_revision` for the target.
- Add optional `atomic_scope`:
  `{"mode":"dependent-cleanup","expected_revisions":{"wb_dependent":"sha256:..."}}`.
- The map must contain exactly every non-target item that the backend will mutate. The target plus this map form the CAS set.
- Under the locks, the backend recomputes all dependents and reads every member from validated file handles.
- A missing or extra supplied ID returns `atomic-set-mismatch`, exit 4, state `unchanged`, with sorted `required_ids` and `supplied_ids`.
- Any hash mismatch returns `revision-set-conflict`, exit 4, state `unchanged`, with every conflict sorted by ID.
- One conflict prevents staging and publication for all N items.
- The backend derives dependent edits. The caller cannot supply replacement Markdown or arbitrary relation changes.

## 4. Locking

- All mutation and recovery commands first take the ledger transaction mutex.
- They then take target, dependency, dependent, parent, and child locks in ascending immutable-ID order.
- The transaction mutex and ID locks use process-scoped kernel advisory locks in the shared coordinator. Metadata remains diagnostic only.
- Readers do not lock. The double-read `STATE` protocol detects every concurrent transaction boundary.
- The global-first, then ascending-ID order is universal. No writer can hold an ID lock while waiting for the global mutex, so overlapping sets cannot deadlock.
- The global mutex serializes writes. That is an acceptable first-cut cost for a Markdown backlog.
- Work claims take no part in this protocol and remain advisory.

## 5. The contract delta

- Publish core mutation contract version 2. Version 1 remains unchanged.
- Set `limits.multi_item_atomicity` to `true`.
- Set transition `write_scope` to `"atomic-dependent-cleanup-set"`.
- Set transition `cas_scope` to `"exact-byte-sha256-set"`.
- Keep durability values unchanged: staged-file sync required, directory sync best effort, exact post-publication verification required, and no power-loss guarantee.
- Add `atomic_scope` to the transition request. Only mode `"dependent-cleanup"` exists in version 2.
- Add exit-4 errors `atomic-set-mismatch` and `revision-set-conflict`.
- Add exit-6 `transaction-recovery-required`.
- Extend `post-commit-recovery-required` and `write-outcome-unknown` details with `transaction_id` and sorted member revisions.
- Extend operation phases with `prepare-journal`, `publish-intent`, `publish-members`, `publish-commit`, and `recover`.
- Keep `atomic-scope-required` for omitted atomic scope and unsupported multi-item blockers.
- The current adapter requires core contract version 1 and exact capability members. It sees version 2 as `core-contract-version-mismatch` and refuses before mutation. It cannot silently treat the new capability as version 1.

## 6. Scope of the first cut

- Ship only terminal transition to `done` plus backend-derived removal of the target from every dependent’s `depends_on`.
- Keep killed or archived dependent disposition and epic child disposition refused with `atomic-scope-required`.
- Do not expose general multi-item transition or caller-authored item replacements.
- General batching needs new lifecycle semantics, authorization boundaries, relation editing rules, and error precedence. None is needed to unblock item 13 or future normal completion.

## Options

1. **Undo journal, commit after member publication.** Readers refuse during `prepared`; absence of the commit marker means rollback. It preserves canonical item paths and avoids committing an update that cannot be materialized. It needs before images and serializes writes. It fits the current durability language.
2. **Redo journal, commit before member publication.** The commit marker selects staged after images, then recovery rolls forward. It removes rollback but can commit before discovering a permanent path failure. Readers must use an overlay or remain blocked until materialization. It requires a broader definition of `committed`.
3. **Immutable ledger generations with an atomic `CURRENT` pointer.** Pointer replacement gives clean snapshot visibility. It makes generation storage authoritative while working-tree Markdown becomes a cache. That conflicts with canonical Markdown and Git-based review, so it cannot meet the current storage contract without a larger redesign.

## Recommendation

Use option 1. It adds one explicit transaction boundary while retaining Markdown item files as the authoritative steady state. It also gives a deterministic rule: no marker means rollback; a valid marker means roll forward. The cost is global write serialization and journal storage, both reasonable for this backend.

## What I am unsure about

- The contract advertises cross-worktree coordination, but ADR 0003 and current item-lock paths describe one ledger directory in one working copy. A stable cross-worktree ledger namespace and physical-ledger identity are not defined.
- The supported platform set for reliable process-scoped advisory file locks is not stated.
- I assume all contract readers can be changed to use `STATE`; direct Markdown and Git readers remain non-cooperating.
- No maximum transaction item count or journal-byte limit is specified. Version 2 should advertise and enforce finite values selected from implementation tests.

[DONE] Produced the atomic multi-item transition design without repository changes.

---

## Part 2 — the adversarial review

107,232
No — this design is not safe to implement as written.

## Findings

### 1. The shared `STATE` can identify the wrong physical ledger

The design keys one coordinator by a stable ledger namespace. That namespace deliberately spans worktrees, but each worktree has separate Markdown files.

Concrete failure:

1. Worktrees A and B share namespace `wbns_X`.
2. A writes common `STATE: prepared`, publishes its files, then writes `STATE: committed`.
3. A reader in B reads that committed state.
4. It loads B’s unchanged ledger.
5. It reads the same committed state again and accepts B’s old bytes as the committed snapshot.

Recovery is worse. The design does not say whether manifest paths resolve against A, B, or stored absolute paths. Resolving against B can roll A’s transaction into the wrong worktree.

The current mutation contract says the backend “does not coordinate … worktrees” and has one-item scope ([mutation-contract.md, lines 36–39](/Users/leestutzman/Documents/GitHub/wowbagger/.claude/worktrees/critic-44/docs/mutation-contract.md:36)). The adapter also “MUST NOT turn a local mutation capability into cross-worktree” support ([adapter-contract.md, lines 121–123](/Users/leestutzman/Documents/GitHub/wowbagger/.claude/worktrees/critic-44/docs/adapter-contract.md:121)).

A logical namespace is explicitly not a physical identity and survives moving or cloning ([work-claim-contract.md, lines 42–48](/Users/leestutzman/Documents/GitHub/wowbagger/.claude/worktrees/critic-44/docs/work-claim-contract.md:42)). Option 1 depends on solving this.

### 2. Version 1 and version 2 writers do not contend on the same locks

Version 1 locks `<ledger>/.wowbagger-locks/<id>.lock` ([mutation-contract.md, lines 357–366](/Users/leestutzman/Documents/GitHub/wowbagger/.claude/worktrees/critic-44/docs/mutation-contract.md:357)). The design moves ID locks into the shared coordinator.

A reproducible race is:

1. A version 1 `patch` locks target T at the ledger-local path and stages `T1`.
2. A version 2 transition takes its different shared lock.
3. Version 2 publishes target `T2` and all dependent edits, then verifies them.
4. Version 1 replaces T with `T1`.
5. Version 2 replaces `STATE: prepared` with `STATE: committed`.

The commit marker now says the transaction committed, but T does not contain its after image. The resulting ledger can still validate, so a reader can accept it. Version 1 patch is expressly defined to use the existing per-ID protocol ([mutation-contract.md, lines 782–786](/Users/leestutzman/Documents/GitHub/wowbagger/.claude/worktrees/critic-44/docs/mutation-contract.md:782)).

Old-adapter refusal does not stop an already installed version 1 core process. Version 2 needs dual locking or an explicit incompatible-protocol fence.

### 3. The power-loss classification is impossible

The design says reordered state after power loss produces an unknown outcome. It cannot always detect that condition.

For example, after all rename calls, power loss can preserve:

- a dependent’s after image;
- the target’s before image; and
- the old `STATE: clean`.

That ledger can be valid: the live target remains, while the dependent has moved it from `depends_on` to `related`. No surviving state identifies a transaction. The next process accepts a legitimate-looking clean ledger.

The contract explicitly says directory sync is best effort and `power_loss_guarantee` is `none` ([mutation-contract.md, lines 246–250](/Users/leestutzman/Documents/GitHub/wowbagger/.claude/worktrees/critic-44/docs/mutation-contract.md:246)). Therefore the design must say power-loss corruption can be undetectable. It cannot promise `write-outcome-unknown` or audited recovery in every such case.

### 4. The successful mutation drops required history

The proposed first cut only removes the target from each dependent’s `depends_on`. The schema requires it also to append the target to `related` when absent:

> “MUST remove that ID … and append it to related if absent.”

([SPEC.md, lines 203–208](/Users/leestutzman/Documents/GitHub/wowbagger/.claude/worktrees/critic-44/SPEC.md:203))

The mutation contract supplements SPEC and “does not relax schema version 1 lifecycle invariants” ([mutation-contract.md, lines 5–8](/Users/leestutzman/Documents/GitHub/wowbagger/.claude/worktrees/critic-44/docs/mutation-contract.md:5)). This fails even without concurrency or a crash.

### 5. The contract delta does not define honest recovery results

The current state `unchanged` means the invocation did not byte-modify any Markdown item ([mutation-contract.md, lines 138–144](/Users/leestutzman/Documents/GitHub/wowbagger/.claude/worktrees/critic-44/docs/mutation-contract.md:138)).

The design does not define a recovery command. If a later transition first rolls back an earlier transaction and then returns `revision-set-conflict` with `state: unchanged`, that state is false: this invocation changed multiple files during recovery.

The delta must define a separate recovery operation or define envelopes that distinguish recovery effects from the requested mutation.

## Sound as designed

- Within one physical ledger, with only version 2 participants, the prepared/committed `STATE` replacement is one clear commit point.
- The double-read protocol rejects a concurrent transaction if generations never repeat.
- Global-first locking followed by immutable-ID order is a total order. Superset lock sets do not deadlock.
- N-item CAS conflicts occur before staging or publication, so the proposed conflict failure is atomic.
- Work claims do not participate in correctness. That is honest.
- Option 2 is incompatible with the current meaning of committed, which requires verified final bytes ([mutation-contract.md, lines 140–144](/Users/leestutzman/Documents/GitHub/wowbagger/.claude/worktrees/critic-44/docs/mutation-contract.md:140)). The recommendation does not depend on it.

## What I could not evaluate

- How `STATE` binds a transaction to one physical ledger root and survives moves, deleted worktrees, or reused paths.
- The exact `STATE` format, initialization rule, integrity checks, generation width, and no-reuse rule.
- Which command performs recovery and how its mutation state and exit code are reported.
- Whether the complete proposed N-item ledger is validated before publication. The contract requires complete candidate validation ([mutation-contract.md, lines 741–773](/Users/leestutzman/Documents/GitHub/wowbagger/.claude/worktrees/critic-44/docs/mutation-contract.md:741)).
- How coordinator artifacts fit the existing ledger-relative artifact paths and closed artifact kinds ([mutation-contract.md, lines 871–891](/Users/leestutzman/Documents/GitHub/wowbagger/.claude/worktrees/critic-44/docs/mutation-contract.md:871)).
- Which platforms and filesystems provide the required kernel-lock and atomic-replacement semantics.
- Whether `multi_item_atomicity: true` means storage-level visibility or only visibility to version 2 cooperative readers. Direct Markdown and Git readers do observe partial publication.

[DONE] Completed the read-only adversarial review.
