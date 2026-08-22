# Item #138 prospective merge verification implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate the exact conflict-free prospective Git merge tree before publication and refuse semantic claim-journal/item-revision disagreement without mutating either parent or the candidate.

**Architecture:** Add a read-only `claim-merge-verify` CLI command accepting two parent refs and a ledger path. Git computes a temporary merge tree; Wowbagger reads candidate ledger blobs and the tracked reconciliation log directly from that tree, validates deterministic sequence/duplicate rules, and compares the last authorized revision per item with candidate bytes. The command never writes ledger files, journals, claims, refs, or worktree state.

**Tech Stack:** Node.js 20+ ESM, built-in `node:test`, `git merge-tree --write-tree`, existing ledger parser and SHA-256 revision helpers, strict JSON envelopes.

**Spec:** `ledger/items/wb_01M0MY9NE61SATX6EHFZS99WH0.md`

## Global Constraints

- Parent branches may each pass `claim-verify` while the merged candidate fails.
- Candidate output must be bounded, deterministic, and strict JSON.
- No adoption, restoration, record reordering, journal append, lock, snapshot, or ref update occurs.
- Duplicate sequence numbers with different records and ambiguous authorization order fail closed.
- Recovery remains explicit through existing `claim-adopt` or restoration plus `claim-verify`.
- Every test command uses `TMPDIR=/tmp`; run current Node and Node 20 gates.

---

### Task 1: Define the pure prospective semantic checker

**Files:**
- Create: `src/claim-prospective.js`
- Modify: `src/claim-journal.js`
- Test: `test/claim-prospective.test.js`

**Interfaces:**
- `parseReconcileLog(bytes, namespace)` returns validated ordered entries or a bounded refusal.
- `checkProspectiveLedger({ itemEntries, journalEntries, parentIdentities, candidateIdentity })` returns `{ ok: true }` or a bounded `unauthorized-revision`/`ambiguous-journal` finding with item ID, actual revision, expected revision, decisive records, and identities.
- `src/claim-journal.js` exposes a side-effect-free `replayClaimEntries(entries, namespace)` used by both disk replay and candidate replay.

- [ ] Write one failing test for R1 item bytes plus later R0 adoption in the candidate log.
- [ ] Run `TMPDIR=/tmp node --test test/claim-prospective.test.js` and confirm failure because no checker exists.
- [ ] Implement strict fenced-code-block extraction, JSON line parsing, namespace validation, sequence monotonicity, duplicate identity handling, and last-authorizing-entry resolution.
- [ ] Run the focused test and add the compatible candidate case.
- [ ] Add tests for duplicate/conflicting sequences and unchanged candidate bytes.

---

### Task 2: Read an exact prospective Git merge tree

**Files:**
- Modify: `src/git-reconciliation.js`
- Modify: `src/claim-prospective.js`
- Test: `test/claim-prospective.test.js`

**Interfaces:**
- `readGitLedgerTree(ledgerDirectory, treeish)` returns candidate item bytes and tracked reconciliation-log bytes without changing the working tree.
- `mergeProspectiveTree(ledgerDirectory, baseRef, headRef)` returns candidate tree identity plus parent identities or a bounded merge-conflict refusal.

- [ ] Add a failing real-Git test where each parent is individually clean and the merge is conflict-free.
- [ ] Run the focused test and confirm candidate-tree reading is missing.
- [ ] Implement `git merge-tree --write-tree` parsing and exact blob reads through Git object APIs.
- [ ] Assert parent refs, candidate tree, working tree bytes, refs, and claim files are byte-identical before and after.

---

### Task 3: Add the read-only CLI contract

**Files:**
- Modify: `src/cli.js`
- Modify: `bin/wowbagger.js` only if command dispatch requires it
- Modify: `docs/work-claim-contract.md`
- Modify: `skills/wowbagger/SKILL.md`
- Test: `test/claim-prospective.test.js`
- Test: `test/cli-help.test.js`

**Interfaces:**
- Command: `wowbagger claim-merge-verify --ledger <dir> --base <ref> --head <ref> --json`.
- Success envelope: `{ok:true, namespace:"work-claim", command:"claim-merge-verify", contract_version:1, state:"committed", result:{base_ref,head_ref,candidate_tree,findings:[]}}`.
- Failure envelope: same command domain with `state:"unchanged"`, bounded `error.code`, parent/candidate identities, and decisive item/journal records.

- [ ] Add failing CLI success and semantic-refusal tests.
- [ ] Run focused CLI tests and confirm unknown-command/dispatch failure.
- [ ] Wire argument validation and pure checker; preserve one JSON object on every path.
- [ ] Document that this command is required before merge/push publication and never auto-recovers.

---

### Task 4: Normative merge gate and final verification

**Files:**
- Modify: `test/claim-prospective.test.js`
- Modify: `docs/work-claim-contract.md`
- Modify: `skills/wowbagger/SKILL.md`

- [ ] Add the #648 recurrence fixture with R0, reviewed R1, later R0 adoption, conflict-free merge, and unchanged item bytes.
- [ ] Add a compatible merge fixture that passes.
- [ ] Add explicit adoption/restoration recovery tests proving only fenced authority clears the finding.
- [ ] Run current Node and Node 20 full gates, adapter implementation, validation, and diff checks.
- [ ] Commit with `feat: verify prospective claim merge semantics`.
