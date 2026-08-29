# Cross-worktree number allocation design

## Goal

Prevent two cooperating worktrees in one Git coordination domain from committing different schema-version-2 items with the same human-facing `number`.

A create must either:

- publish one item whose number is unique against the complete synchronized ledger state observed under the shared namespace lock; or
- refuse unchanged before publishing any item byte.

The fix preserves atomic no-clobber item publication, core-assigned immutable numbering, and the existing `number = 1 + max(existing numbers)` rule.

The guarantee is bounded. It closes the reported PropertyCompass2 collision: cooperating alpha.14 worktrees of one clone that share one Git common directory can no longer commit two items carrying the same number. Separate clones, separate machines, alpha.13 writers before the hard cutover, and noncooperating writes stay outside the fence and still rely on branch integration plus `validate`.

## Verified root cause

Schema-version-2 create currently derives the next number from the invoking worktree's ledger. `NUMBER_INDEX_LOCK_ID` serializes concurrent creates only inside that working copy because its lock file lives below the checkout's ledger directory.

Provisioned ledgers also run create under the namespace lock in the Git common directory, so cooperating worktrees cannot execute the protected section simultaneously. That temporal exclusion is insufficient: after the first process exits, a stale sibling still derives the same next number from its own checkout.

Create then publishes no authorization entry to the shared claim journal. Reconciliation therefore has no evidence that another worktree created an item. Sequential creates from divergent worktrees collide as reliably as simultaneous creates.

## Scope

This design covers item #181:

- journal-fence successful and ambiguous creates in provisioned Git ledgers;
- make create fence allocation on global findings plus coordinated items absent from the creating worktree;
- validate the complete candidate ledger under the allocation fence immediately before publication;
- refuse stale and concurrent creates unchanged;
- preserve the existing local number-index lock for unprovisioned and non-Git ledgers;
- publish the fix with the already-completed reachable-unowned remediation correction.

This design does not repair a ledger that already contains duplicate numbers. Item #182 owns fenced recovery. Item #185 owns general installed-skill and core-version drift detection.

## Architecture decisions

### Create joins the existing legacy mutation journal family

A provisioned create uses the existing intent-then-terminal protocol rather than adding a number database or a second journal.

`createItem` passes the coordinator's `authorize` callback into `createItemUnfenced`. After create has reloaded the ledger under its local lock closure, assigned the number, serialized the candidate, and validated the complete candidate ledger, it calls:

```text
authorize(null, candidate_revision, item_path)
```

The coordinator appends `legacy-mutation-intent` with `command: "create-v1"` before any temporary file can become the final item path. The namespace lock remains held through intent persistence, atomic no-clobber publication, exact byte verification, and terminal persistence.

The terminal is:

- `legacy-mutation` with `command: "create-v1"` when exact candidate bytes were published;
- `legacy-mutation-abort` with `command: "create-v1"` and `observed_revision: null` when the item path remains absent and create reports unchanged; or
- an unresolved intent with an unknown response when publication may have happened but exact state cannot be proven.

No `assigned_number` field is needed in the journal. The candidate revision binds the complete item bytes, including the assigned number. The journal's purpose is to make the created item visible to reconciliation, not to become a second number authority.

Because the intent and terminal are projected journal entries, a successful create now owns the current namespace reconciliation-log change. Its `changed_paths` and auto-commit commit set contain both the item and that log. Preflight remains strict: a reconciliation log already dirty before this invocation is foreign residue and still refuses create.

### Repository-wide reconciliation fences allocation

Existing transition and patch operations ask whether findings block their
target item. Create is different: its output depends on the number carried by
every item in the ledger. It reconciles with its own item as the target, like
every other mutation, and then reads one extra barrier before allocating a
number or publishing an item.

The implemented predicate is global findings plus coordinated items absent from
the creating worktree:

- a prior create in this worktree that is not committed reports the global
  `git-finalization-required` and blocks the next create;
- unknown or out-of-protocol bytes remain a global `unauthorized-revision`
  barrier;
- a coordinated item the shared journal records and this checkout does not hold
  blocks create, because its immutable number cannot be read here, so the next
  allocation may already be taken — this covers a create committed only in a
  sibling worktree, whose own finding is `worktree-synchronization-required`;
- a stale revision of an item this checkout does hold stays nonblocking, keeping
  its ordinary target scope: a number is immutable, so the local maximum is
  already correct;
- a clean, synchronized ledger proceeds.

The second worktree does not silently choose another number from coordinator
state. It synchronizes the actual ledger, then retries. The ledger remains the
one number authority.

### Candidate validation remains inside both fences

Create already reloads the ledger after acquiring its local lock closure and runs `validateSerializedCandidate` before publication. The fixed ordering is normative:

1. Acquire the shared namespace lock.
2. Reconcile the complete repository state for create.
3. Load the current worktree ledger.
4. Acquire the local item, relation, and number-index lock closure.
5. Reload and validate the ledger under those locks.
6. Derive `1 + max(existing numbers)`.
7. Serialize the candidate item.
8. Validate the complete candidate ledger.
9. Reserve journal capacity and append the create intent.
10. Publish with atomic no-clobber semantics.
11. Verify the final path contains the exact candidate bytes.
12. Append the committed or aborted terminal.

A cooperating create cannot interleave between steps 1 and 12. A local noncooperating write can still occur, but the second ledger load, candidate validation, no-clobber publication, and exact byte verification retain the existing fail-closed behavior.

### Crash recovery reuses the existing intent resolver

A crash after intent persistence leaves one of three observable states for the next invocation:

- The item path contains the candidate revision: append the committed create terminal.
- The item path is absent: append the create abort terminal.
- The item path contains different bytes: report `legacy-mutation-outcome-unknown` as a global barrier.

The resolver must understand that `expected_revision: null` is valid only for `command: "create-v1"`. Existing patch and transition intents continue to require a string revision. Recovery never guesses a number and never publishes an item.

Journal-capacity reservation happens before the intent append and before publication. Capacity failure therefore refuses unchanged.

### User-visible refusal and recovery

A stale create returns the existing claim-store refusal surface:

```text
exit: 6
ok: false
namespace: "ledger-mutation"
command: "create-v1"
contract_version: 1
state: "unchanged"
error.code: "claim-store-unavailable"
error.details.reason: "publication-reconciliation-required"
```

`error.details.findings` identifies the item whose authorized create is missing from or unfinished in this checkout. The finding's existing topology-specific remediation remains authoritative:

- Commit this worktree's authorized bytes for `git-finalization-required`.
- Synchronize the named sibling revision when a named owner is available.
- For locally absent or reachable-unowned revisions, inspect the reachable or dangling history, restore or explicitly adopt reviewed bytes, and run `claim-verify`.
- For unauthorized bytes, restore the authorized revision or explicitly adopt reviewed committed bytes.

The reproduced stale-sibling case is locally absent on both surfaces, so its exact remediation remains:

```text
Ownership of <expected_path> revision <expected_revision> cannot be established from reachable refs; inspect reachable or dangling commits, restore or explicitly adopt reviewed bytes, then run claim-verify.
```

That is not an instruction to wait. The operator inspects the creator worktree or its Git history, integrates the reviewed item bytes, validates, and retries. If the creator revision is gone, the operator resolves the finding through the same explicit restore or adoption path before any new create can proceed.

After the ledger validates and `claim-verify` reports no findings, retry create with the same request ID. Because no item byte was published by the refusal, the retry remains a normal no-clobber create.

The fence does not trap recovery operations. `claim-verify` remains read/reconcile-only, `claim-adopt` retains its explicit reconciliation override, and claim release remains available under barriers. Git synchronization remains outside Wowbagger and cannot be blocked by this command.

### Existing duplicate ledgers remain #182 recovery work

The fixed create starts by loading a valid ledger. A ledger already carrying duplicate numbers still fails validation and refuses every mutation before allocation. #181 neither renumbers those items nor makes the invalid ledger worse.

#181 is independently useful because it prevents new collisions in every valid ledger after deployment. #182 can ship later as the only supported path for ledgers already damaged by alpha.12 or alpha.13 behavior.

### Cost on the create hot path

Provisioned create already acquires the namespace lock, replays the journal, loads the ledger, reads Git `HEAD`, and reconciles before writing. The allocation fence changes which existing findings refuse; it does not add another Git roster or history walk to a clean create.

The durable cost is journal growth. Each successful post-fix create adds one intent and one committed terminal; the reconciliation clock already existed. With no other entries, the 65,536-entry journal limit permits at most 21,845 three-entry create cycles, and the 8 MiB byte limit may bind first. Other claim and mutation activity lowers that ceiling. Capacity is checked before publication and fails closed.

Replay and reconciliation remain linear in journal entries and ledger items. Owner history walks occur only when a revision differs, not on a clean synchronized create. Implementation verification must record phase counters and elapsed time for a representative large ledger so this accepted cost is measured rather than hidden.

Journal compaction is not part of #181. If measured growth makes the existing capacity materially inadequate, that is a separate design decision; silently adding compaction to this safety fix would mix two recovery protocols.

## Contract and compatibility

Core create success remains at `contract_version: 5`; the fenced refusal remains in the `ledger-mutation` namespace at `contract_version: 1`. The create success and refusal envelopes add, remove, or rename no member. `claim-store-unavailable` with `publication-reconciliation-required` and `state: unchanged` already exists. The change is stricter safety behavior on a command that previously returned a false committed result.

The internal journal grammar widens deliberately:

- `legacy-mutation-intent.command` and `legacy-mutation.command` accept `create-v1`;
- a create intent accepts `expected_revision: null`;
- a create abort requires `command: "create-v1"` and `observed_revision: null`, while existing abort entries remain valid without `command` and continue to require a string revision.

The new reader must execute every journal emitted by alpha.13. That is the required backward-compatibility proof.

Alpha.13 cannot understand a post-fix `create-v1` legacy intent under its current validator. The published alpha.13 binary was executed on 2026-08-29 against an isolated valid Git ledger whose shared journal contained one such intent. Its create exited 6 with:

```json
{"ok":false,"namespace":"ledger-mutation","command":"create-v1","contract_version":1,"state":"unchanged","error":{"code":"claim-store-unavailable","message":"The durable claim store is unavailable.","details":{"reason":"claim-store-unreadable"}}}
```

The requested item path remained absent. This proves alpha.13 fails closed; it cannot commit another duplicate after the new grammar appears.

It also proves the operational limitation: alpha.13 emits a generic unreadable-store message, not upgrade guidance. Alpha.13 is immutable, so alpha.14 cannot improve that old binary's text. #181 therefore uses a hard cutover with no automatic migration or mixed-version grace period. Upgrade every writer in one Git coordination domain before the first alpha.14 create. If a partial upgrade writes the new grammar, remaining alpha.13 worktrees stop making claim-protected mutations until upgraded.

Alpha.14's release notes and installed skill must state that coordination requirement before the create instructions. They must map the observed alpha.13 exit 6 `claim-store-unreadable` refusal to “this repository was written by a newer Wowbagger; upgrade this worktree to continue.” The general ability for a running old binary to diagnose its own version drift remains #185; #181 cannot retrofit an actionable message into an already-published executable.

## Rejected alternatives

### Shared monotonic counter

A counter in the Git common directory could allocate unique numbers without synchronizing worktrees. It would become a second number authority and require reservation, rollback, burned-number, crash, and rebuild semantics. It also changes `number = 1 + max(existing ledger numbers)`. Reject it.

### Scan all Git refs and worktrees

Scanning every ref for the highest number avoids durable allocator state but makes stale and unrelated branches authoritative, misses some uncommitted or dangling states, and adds an unbounded Git traversal to the hottest command. Reject it.

### Keep create journal-silent and broaden only the local lock

A filesystem lock can serialize processes but cannot make one checkout observe another checkout's committed item. The reproduced failure is sequential, so a wider mutex without durable evidence does not fix it. Reject it.

## TDD sequence

Each numbered behavior is one RED-GREEN-REFACTOR cycle. A later cycle starts only after the complete relevant suite passes.

1. Public sequential regression: two stale cooperating worktrees start from one numbered ledger; the first create commits, and the second refuses unchanged without an item file.
2. Journal contract: a create appends an intent before publication and a committed terminal afterward; mutation proof removing the authorize call reproduces the duplicate.
3. Auto-commit ownership: a successful create commits exactly its item and reconciliation log; pre-existing log residue still refuses before publication.
4. Create allocation fence: removing the missing-coordinated-item barrier makes the sequential regression fail while unrelated transition and patch scope tests remain green.
5. Crash recovery: candidate present resolves committed, item absent resolves aborted, and different bytes remain unknown and globally blocking.
6. Candidate validation ordering: a candidate ledger that becomes invalid under the allocation fence refuses before intent or item publication.
7. Contention: two public create processes in sibling worktrees produce at most one committed item from the stale base; the loser is unchanged, never committed with the same number.
8. Synchronize and retry: after integrating the first create, the same refused request commits with the next number.
9. Compatibility: the post-fix binary executes the alpha.13 journal corpus; the packed alpha.13 binary executed against a post-fix create journal refuses unchanged and writes nothing.
10. Performance characterization: record namespace-lock count, Git enumeration/history counters, journal growth, and elapsed create time on the repository's existing large-ledger fixture.
11. Documentation and release: replace the journal-silent decision, document the refusal and mixed-version rule, and ship the previously unreleased reachable-unowned remediation correction in the same alpha.14 hotfix.

Every public regression runs on the current Node runtime and Node 20. Test expectations use literal numbers and observable item files, ledger validity, exit codes, and envelopes; they do not assert implementation call counts except in the dedicated phase-profile characterization.

## Verification

Run focused create, number, claim journal, reconciliation, auto-commit, adapter-correlation, packaging, and contract suites after each GREEN. Then run:

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

The final review must compare implementation behavior with item #181, this design, the number-identity design, the mutation contract, and the work-claim contract. #181 transitions to done only after the two-worktree reproduction no longer produces duplicate numbers and every acceptance criterion has direct evidence.

## Delivery

Commit the reviewed design, the implementation plan, each complete TDD behavior where practical, contract documentation, release metadata, and the final ledger transition atomically by concern.

Publish alpha.14 only after the full release gate. Alpha.14 includes both #181 and the reachable-unowned remediation correction already present on `main`. Upgrade guidance must require every cooperating writer in one Git coordination domain to move off alpha.13 before create resumes.
