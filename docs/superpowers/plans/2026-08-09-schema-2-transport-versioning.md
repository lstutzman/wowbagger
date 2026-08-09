# Schema 2 Transport Versioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish core mutation contract version 2 and adapter contract version 2 without changing either version 1 definition.

**Architecture:** Keep bootstrap wire version 1 fixed while the shipped adapter selects only adapter contract version 2 and requires the independently probed core contract version 2. Keep mutation coordination in the top-level capability scope and advisory claim visibility in `operations.work_claim`; add `patch` to the v2 adapter surface. Re-implement the same rules independently in the oracle, then update only fixture values that the contract delta makes obsolete.

**Tech Stack:** Node.js ES modules, built-in Node test runner, strict JSON bootstrap transport, Markdown contract documents.

## Global Constraints

- Version 1 of the core mutation contract and adapter contract remains defined and unchanged.
- `transition.write_scope` remains `"single-item"`.
- `transition.cas_scope` remains `"exact-byte-sha256"`.
- `limits.multi_item_atomicity` remains `false`.
- Mutation coordination scope is `"same-working-copy-cooperative-writers"`.
- `limits.cross_worktree_coordination` is `false` for mutation.
- Git-common-directory claim visibility stays under `operations.work_claim` and does not elevate mutation coordination.
- The adapter oracle stays independent from production version and capability helpers.
- No file under `ledger/` changes, and no migration script is created.
- Every production behavior starts with one observed failing test and ends with a green full relevant suite and an atomic commit.

---

### Task 1: Publish transport version 2 and fail closed for version 1 consumers

**Files:**

- Modify: `src/cli.js`
- Modify: `src/adapter/describe.js`
- Modify: `src/adapter/core-probe.js`
- Modify: `src/adapter/entrypoint-main.js`
- Modify: `src/adapter/invoke.js`
- Modify: `src/adapter/process-outcome.js`
- Modify: `adapters/*/wowbagger-adapter.json`
- Modify: `spec/adapter-reference.js`
- Modify: `spec/run-adapter-implementation.js`
- Modify: `test/adapter-contract-fixtures.js`
- Modify: transport-version assertions in `test/*.test.js`
- Modify: root `contract_version` values in `spec/fixtures/mutations/**/expected*.json`
- Modify: adapter v2 values and artifact hashes in `spec/fixtures/adapters/`

**Interfaces:**

- Consumes: bootstrap wire request `{bootstrap_wire_version: 1, supported_adapter_contract_versions, request_id}`.
- Produces: core envelopes with `contract_version: 2`, adapter envelopes with `adapter_contract_version: 2`, and a v1-only describe refusal with `unsupported-adapter-contract-version`.

- [ ] **Step 1: Write the failing old-consumer test**

Add a shipped-entrypoint test that sends `supported_adapter_contract_versions: [1]` and expects `unsupported-adapter-contract-version`. This catches a v2 adapter that still silently negotiates v1.

- [ ] **Step 2: Run the test to verify RED**

Run: `node --test test/adapter-bootstrap-wire.test.js --test-name-pattern='version 1 consumer'`

Expected: FAIL because the current adapter selects version 1.

- [ ] **Step 3: Implement the minimum version migration**

Use local production constants for core and adapter version 2. Do not change work-claim contract version 1. Change the shipped manifest and bootstrap negotiation from singleton `[1]` to singleton `[2]`. Re-derive the same numeric rules independently in the oracle. Change only version members in normative fixtures, plus hashes that authenticate changed adapter artifacts.

- [ ] **Step 4: Run the relevant and full suites**

Run: `node --test test/adapter-bootstrap-wire.test.js test/adapter-engine-differential.test.js test/adapter-reference*.test.js test/mutation-*.test.js test/mint-id.test.js test/patch.test.js`

Run: `TMPDIR=/tmp npm test`

Expected: every test passes and no assertion is removed or weakened.

- [ ] **Step 5: Commit**

```bash
git add src adapters spec test
git commit -m "Publish transport contract version 2"
```

### Task 2: Separate mutation coordination from advisory claim visibility

**Files:**

- Modify: `src/cli.js`
- Modify: `src/adapter/core-probe.js`
- Modify: `spec/adapter-reference.js`
- Modify: `spec/fixtures/mutations/capabilities/expected.json`
- Modify: `spec/fixtures/adapters/10-capabilities-forwarding/expected-core-stdout.jsonl`
- Modify: authenticated adapter fixture manifests for changed capability artifacts
- Test: `test/mutation-cli.test.js`
- Test: `test/adapter-engine-differential.test.js`

**Interfaces:**

- Consumes: `wowbagger capabilities --json` inside a Git working copy.
- Produces: `backend.coordination_scope: "same-working-copy-cooperative-writers"`, `limits.cross_worktree_coordination: false`, and an independently derived `operations.work_claim.supported` value.

- [ ] **Step 1: Write the failing capability separation test**

Assert that the real Git-backed capability envelope reports local mutation scope and false cross-worktree mutation coordination while advisory claims remain supported.

- [ ] **Step 2: Run the test to verify RED**

Run: `node --test test/mutation-cli.test.js --test-name-pattern='separates mutation coordination'`

Expected: FAIL because the current top-level envelope derives mutation scope and cross-worktree coordination from Git presence.

- [ ] **Step 3: Implement the minimum separation**

Make only `operations.work_claim.supported` depend on Git discovery. Require the fixed local mutation scope and false cross-worktree mutation limit in both the production probe and independent oracle.

- [ ] **Step 4: Verify GREEN and mutation strength**

Run: `node --test test/mutation-cli.test.js test/adapter-engine-differential.test.js test/adapter-reference*.test.js test/adapter-vectors.test.js`

Run: `TMPDIR=/tmp npm test`

- [ ] **Step 5: Commit**

```bash
git add src spec test
git commit -m "Separate claims from mutation coordination"
```

### Task 3: Add patch to the adapter v2 surface

**Files:**

- Modify: `src/cli.js`
- Modify: `src/adapter/core-probe.js`
- Modify: `src/adapter/invoke.js`
- Modify: `src/adapter/process-outcome.js`
- Modify: `spec/adapter-reference.js`
- Modify: `spec/run-adapter-implementation.js`
- Modify: v2 capability fixtures and authenticated manifests under `spec/fixtures/adapters/`
- Test: `test/adapter-engine-differential.test.js`
- Test: `test/adapter-invoke.test.js`

**Interfaces:**

- Consumes: v2 `core_request: {command: "patch", ledger, input_base64}` plus trusted consumer approval.
- Produces: argv `patch --ledger <absolute-ledger> --input - --json`, exact decoded stdin bytes, mutation-safe outcome classification, and capability members `{supported: true, write_scope: "single-item", cas_scope: "exact-byte-sha256"}`.

- [ ] **Step 1: Write the failing patch-advertisement test**

Assert that the v2 command order contains `patch` between `inspect` and `ready`, and that the exact v2 core capability probe requires the patch operation.

- [ ] **Step 2: Run the test to verify RED**

Run: `node --test test/adapter-engine-differential.test.js --test-name-pattern='advertises patch'`

Expected: FAIL because the current command and operation lists omit patch.

- [ ] **Step 3: Implement patch advertisement and verify GREEN**

Add the exact patch operation to the core capability envelope, production probe, command order, dynamic describe result, and independent oracle.

- [ ] **Step 4: Write the failing patch-invocation test**

Drive `invokeAdapter` with an approved patch request and assert its exact argv and stdin plus mutation-safe classification. This catches treating patch as read-only or accepting an arbitrary input path.

- [ ] **Step 5: Run the test to verify RED**

Run: `node --test test/adapter-invoke.test.js --test-name-pattern='forwards approved patch'`

Expected: FAIL with `invalid-invocation` because patch is not yet mapped.

- [ ] **Step 6: Implement the minimum patch mapping**

Treat patch like create and transition for request bytes, approval, launch input, bounded observation, and unknown-outcome recovery. Re-implement patch request validation and response correlation inside the oracle instead of importing production patch helpers.

- [ ] **Step 7: Verify and commit each completed RED→GREEN cycle**

Run: `TMPDIR=/tmp npm test`

Commit the advertisement cycle, then the invocation cycle, with imperative messages.

### Task 4: Publish the versioned prose

**Files:**

- Modify: `SPEC.md`
- Modify: `docs/mutation-contract.md`
- Modify: `docs/adapter-contract.md`
- Modify: `docs/adapter-release-path.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

**Interfaces:**

- Consumes: accepted Part 3 design and the implemented v2 envelope.
- Produces: an unchanged v1 base definition plus explicit v2 deltas for schema support, versions, capability scope, patch, negotiation, and old-consumer refusal.

- [ ] **Step 1: Add explicit version tables and v2 delta sections**

Keep v1 examples and rules labelled as v1. State that the shipped v2 binary and adapters fail closed on a v1-only pairing. State that claim visibility is not mutation coordination.

- [ ] **Step 2: Self-review the prose**

Search for stale statements that call v1 current, call Git claim visibility mutation coordination, omit patch from v2, or describe a multi-item scope.

- [ ] **Step 3: Verify and commit**

Run: `TMPDIR=/tmp npm run check`

```bash
git add SPEC.md README.md CHANGELOG.md docs
git commit -m "Document transport contract version 2"
```

### Task 5: Prove the five guards and complete verification

**Files:**

- Temporarily mutate and restore only the named production/runner locations.
- Do not commit any guard mutation.

- [ ] **Step 1: For each required mutation, apply one change, run conformance, record RED, and restore immediately**

Run each time: `TMPDIR=/tmp node spec/run-adapter-implementation.js`

Required mutations: ignored awaited real child launch; disabled output-overflow count; missing bootstrap LF; one missing forwarded stdout byte; reversed protocol instruction order.

- [ ] **Step 2: Confirm restoration after every mutation**

Run: `git status --short`

Expected: only intended Phase 2 files remain changed; no temporary guard diff remains.

- [ ] **Step 3: Run fresh final verification**

Run: `TMPDIR=/tmp node spec/run-adapter-implementation.js`

Run: `TMPDIR=/tmp npm test`

Run: `PATH=/opt/homebrew/opt/node@20/bin:$PATH TMPDIR=/tmp npm test`

Run: `TMPDIR=/tmp npm run check`

Expected: conformance `pass` 15/15 and 183/183, both runtime suites green with no count regression, and check exits 0.
