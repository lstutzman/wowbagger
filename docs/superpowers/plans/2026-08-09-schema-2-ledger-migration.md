# Schema 2 Ledger Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dry-run-first maintenance tool that converts one valid, quiesced schema-version-1 ledger to schema version 2 and proves every refusal.

**Architecture:** Put the operator entrypoint at `scripts/migrate-schema-2.js` so it stays outside the core mutation and adapter contracts. Put the testable migration workflow in `src/schema-migration.js`; it reuses the real ledger loader and validator, changes only each parsed `schema_version` scalar, writes each item atomically, and validates the complete on-disk schema-2 result. Test the command through temporary ledgers, with one module-level progress seam for deterministic write-failure and post-validation race tests.

**Tech Stack:** Node.js 20+ ES modules, `yaml`, built-in `node:test`, Markdown ledgers, Git for recovery.

## Global Constraints

- Dry run is the default. Only `--apply` permits writes.
- Never run the tool against this repository's `ledger/` during implementation or verification.
- A non-empty ledger must validate completely under schema version 1 before any write.
- Mixed schema versions and an already-schema-2 ledger are distinct refusals.
- Any item lock below `<ledger>/.wowbagger-locks/` blocks the migration.
- The complete candidate and the complete on-disk result must validate under schema version 2.
- Schema-1 dependency cleanup history cannot be recovered or inferred.
- A schema-1 done item with any retained dependency is invalid and is refused, not repaired.
- This is a quiesced maintenance operation. It is outside the mutation contract.
- Recovery uses the operator's backup and Git. Do not add a journal or transaction coordinator.
- Each production behavior starts with one observed failing test and ends with a green relevant suite and a commit.
- Every command uses `TMPDIR=/tmp`; verify with `node` and `/opt/homebrew/opt/node@20/bin/node`.

---

### Task 1: Dry-run plan and exact scalar rewrite

**Files:**

- Create: `test/schema-migration.test.js`
- Create: `src/schema-migration.js`
- Create: `scripts/migrate-schema-2.js`

**Interfaces:**

- Consumes: `node scripts/migrate-schema-2.js --ledger <dir>`.
- Produces: one `WOULD CHANGE` line per item, a zero-write summary, the maintenance warning, and the unrecoverable-history warning.

- [ ] **Step 1: Write one failing black-box dry-run test**

Create two valid schema-1 items in a temporary ledger. Spawn the script without `--apply`. Assert exit 0, unchanged exact bytes, both literal per-item changes, the two warnings, and `Summary: 2 items would change; 0 files written (dry run).`

- [ ] **Step 2: Verify RED**

Run: `TMPDIR=/tmp node --test test/schema-migration.test.js --test-name-pattern='dry run'`

Expected: FAIL because `scripts/migrate-schema-2.js` does not exist.

- [ ] **Step 3: Implement the minimum dry-run path**

Parse only `--ledger <dir>` and optional `--apply`. Load and validate the ledger. Build each successor by replacing the parsed top-level `schema_version` scalar range with `2`; do not reserialize other YAML. Validate the in-memory candidate as schema 2 before printing success.

- [ ] **Step 4: Verify GREEN and commit**

Run: `TMPDIR=/tmp node --test test/schema-migration.test.js`

Commit: `Add schema 2 migration dry run`

### Task 2: Explicit apply and on-disk result validation

**Files:**

- Modify: `test/schema-migration.test.js`
- Modify: `src/schema-migration.js`

**Interfaces:**

- Consumes: the dry-run command plus `--apply`.
- Produces: exact item bytes with only the schema scalar changed, one durable progress line after each item, and a schema-2 validation summary.

- [ ] **Step 1: Write one failing apply test**

Use CRLF, YAML comments, Markdown bodies, and extension data. Assert that no write happens without `--apply`, then invoke with `--apply` and compare every final byte to a hand-written expected source that differs only at the scalar.

- [ ] **Step 2: Verify RED**

Run: `TMPDIR=/tmp node --test test/schema-migration.test.js --test-name-pattern='applies'`

Expected: FAIL because `--apply` does not write.

- [ ] **Step 3: Implement minimum per-item publication**

Before each item, compare its current bytes with the validated snapshot. Write and sync a same-directory non-Markdown temporary file, rename it over the original item, then emit `CHANGED`. After all writes, reload the ledger and require a valid uniform schema-2 result.

- [ ] **Step 4: Verify GREEN and commit**

Run: `TMPDIR=/tmp node --test test/schema-migration.test.js`

Commit: `Apply schema 2 migration explicitly`

### Task 3: Validate schema version 1 before migration

**Files:**

- Modify: `test/schema-migration.test.js`
- Modify: `src/schema-migration.js`

**Interfaces:**

- Refuses: an invalid all-v1 ledger before any write, with the validator's diagnostics.

- [ ] **Step 1: Write one failing validate-first test**

Create a schema-1 done item that depends on a done target. This would become valid if stamps changed first. Assert refusal, exact unchanged bytes, and a `done-item-has-dependencies` diagnostic.

- [ ] **Step 2: Verify RED, implement the preflight gate, verify GREEN, and commit**

Run: `TMPDIR=/tmp node --test test/schema-migration.test.js --test-name-pattern='validates schema version 1'`

Commit: `Refuse invalid schema 1 migration input`

### Task 4: Refuse partial and completed version states

**Files:**

- Modify: `test/schema-migration.test.js`
- Modify: `src/schema-migration.js`

**Interfaces:**

- Refuses: a v1/v2 mixture with restore-from-backup-or-Git instructions.
- Refuses: a uniform v2 ledger as already migrated.

- [ ] **Step 1: Write one failing mixed-state test, verify RED, implement, verify GREEN, and commit**

Run: `TMPDIR=/tmp node --test test/schema-migration.test.js --test-name-pattern='mixed schema'`

Commit: `Refuse partially migrated ledgers`

- [ ] **Step 2: Write one failing already-migrated test, verify RED, implement, verify GREEN, and commit**

Run: `TMPDIR=/tmp node --test test/schema-migration.test.js --test-name-pattern='already schema version 2'`

Commit: `Refuse already migrated ledgers`

### Task 5: Refuse live writer locks

**Files:**

- Modify: `test/schema-migration.test.js`
- Modify: `src/schema-migration.js`

**Interfaces:**

- Refuses: any `.lock` occupant under `.wowbagger-locks`, with sorted relative paths and no writes.

- [ ] **Step 1: Write one failing held-lock test**

Create a valid item plus a malformed lock file. Assert that malformed metadata still counts as held and the item bytes do not change.

- [ ] **Step 2: Verify RED, implement fail-closed lock discovery, verify GREEN, and commit**

Run: `TMPDIR=/tmp node --test test/schema-migration.test.js --test-name-pattern='item lock'`

Commit: `Refuse schema migration while locks are held`

### Task 6: Report post-write validation and partial failure

**Files:**

- Modify: `test/schema-migration.test.js`
- Modify: `src/schema-migration.js`

**Interfaces:**

- Produces: a nonzero post-validation failure after a deterministic test race corrupts the temporary ledger.
- Produces: a nonzero partial-write report with the completed count and restore instructions.

- [ ] **Step 1: Write one failing post-validation test**

Call the exported migration workflow with `--apply` semantics. In its awaited per-item progress callback, corrupt the migrated temporary fixture after the last write. Assert `post-validation-failed` and no success summary.

- [ ] **Step 2: Verify RED, implement the post-read validation gate, verify GREEN, and commit**

Run: `TMPDIR=/tmp node --test test/schema-migration.test.js --test-name-pattern='post-migration ledger'`

Commit: `Fail when migrated ledger does not validate`

- [ ] **Step 3: Write one failing partial-write test**

Inject an I/O-boundary writer that delegates the first write and fails the second. Assert one `CHANGED` record and a message that says `1 of 2`, identifies the next item, and requires restoring the backup or Git before rerun.

- [ ] **Step 4: Verify RED, implement loud progress accounting, verify GREEN, and commit**

Run: `TMPDIR=/tmp node --test test/schema-migration.test.js --test-name-pattern='partial write'`

Commit: `Report partial schema migration failures`

### Task 7: Document the maintenance workflow

**Files:**

- Create: `docs/schema-2-migration.md`
- Modify: `README.md`
- Modify: `CONTEXT.md`

**Interfaces:**

- Documents: dry run, backup, quiescence, `--apply`, validation, partial recovery, no journal, and no historical dependency reconstruction.

- [ ] **Step 1: Add concise operator documentation and glossary terms**

Use these commands:

```sh
TMPDIR=/tmp node scripts/migrate-schema-2.js --ledger ledger
TMPDIR=/tmp node scripts/migrate-schema-2.js --ledger ledger --apply
```

- [ ] **Step 2: Review wording against Part 3 and commit**

Commit: `Document schema 2 ledger migration`

### Task 8: Mutation proof and final verification

**Files:**

- Temporarily mutate and restore only `src/schema-migration.js`.
- Do not commit mutation changes.

- [ ] **Step 1: Mutate each refusal separately**

Remove or invert, one at a time: schema-1 pre-validation, mixed-state refusal, held-lock refusal, and post-migration validation. Run the named focused test after each mutation. Each test must fail for the missing gate. Restore immediately and verify the test passes.

- [ ] **Step 2: Run final checks**

```sh
TMPDIR=/tmp node --test test/*.test.js
TMPDIR=/tmp /opt/homebrew/opt/node@20/bin/node --test test/*.test.js
TMPDIR=/tmp npm run check
TMPDIR=/tmp node spec/run-adapter-implementation.js
git diff --check
git status --short --branch
```

- [ ] **Step 3: Review commits and leave the branch local**

Do not run the migration against `ledger/`. Do not push, open a PR, merge, or stash.
