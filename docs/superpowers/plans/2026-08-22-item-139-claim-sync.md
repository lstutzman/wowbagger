# Item #139 committed adoption synchronization plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Import valid committed `revision-adoption` evidence from the checked-out reconciliation log into a fresh clone's local claim journal without requiring a second operator adoption.

**Architecture:** Add read-only-from-ledger-bytes plus explicit local `claim-sync`. The command reads the committed reconciliation log at `HEAD`, validates namespace, item, revisions, commit, ordering, and candidate item bytes, then appends only missing adoption entries under the claim lock. Repeated sync is idempotent; conflicts refuse without journal changes.

**Spec:** `ledger/items/wb_01M0N3KM316P7MBJTA1A5X29J4.md`

## Global Constraints

- No item bytes, refs, unrelated journal records, or new adoption rulings are synthesized.
- Import is explicit and distinguishable from `claim-adopt`.
- Use current and Node 20 test gates with `TMPDIR=/tmp`.

---

### Task 1: Define and test adoption import selection

**Files:** Create `src/claim-sync.js`; Create `test/claim-sync.test.js`.

- [ ] Write failing tests for one missing valid adoption, repeated idempotent sync, wrong namespace, conflicting target revision, and out-of-order source records.
- [ ] Implement `selectCommittedAdoptions(committedEntries, localEntries, namespace)` with bounded deterministic errors.
- [ ] Run focused tests and mutation-test namespace/conflict/order guards.

### Task 2: Wire the explicit CLI operation

**Files:** Modify `src/cli.js`, `src/claim-journal.js` only for shared pure helpers, `docs/work-claim-contract.md`, `skills/wowbagger/SKILL.md`; tests in `test/claim-sync.test.js` and `test/cli-help.test.js`.

- [ ] Add `wowbagger claim-sync --ledger <dir> --json`.
- [ ] Read the committed reconciliation log at `HEAD`, inspect candidate item bytes, acquire the claim lock, append only selected adoption entries, and rebuild the local claim snapshot.
- [ ] Return imported item IDs/count and `already_present` count; return strict bounded refusal on invalid or conflicting evidence.
- [ ] Prove repeated sync produces no duplicate journal lines or item/ref changes.

### Task 3: Verify and close item #139

- [ ] Run focused sync, claim, Git reconciliation, and full current/Node 20 tests.
- [ ] Run adapter implementation and ledger validation.
- [ ] Commit implementation, then transition ledger item #139 through `in-progress` to `done` using the fenced mutation loop.
