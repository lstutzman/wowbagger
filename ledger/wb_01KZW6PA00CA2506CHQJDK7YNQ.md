---
schema_version: 2
id: wb_01KZW6PA00CA2506CHQJDK7YNQ
number: 70
title: "Fix seven verified mutation and claim defects"
kind: task
priority: 1
status: in-progress
created: 2026-08-13
updated: 2026-08-14
provenance:
  source: "standard-code-review"
  recorded_at: "2026-08-13T12:40:29.000Z"
depends_on: []
related: [ wb_01KZ77NSW8P89118K6D6FSBFX2, wb_01KZBMBEZKPE7D15HKW9Q3GSZV ]
decisions:
  - action: accept
    date: 2026-08-14
    summary: "Accept the seven verified mutation and claim defects into backlog."
    rationale: "Each defect has a public reproduction and bounded acceptance criteria. Several can invalidate a ledger or bypass an active claim, so priority 1 is justified and no unresolved design dependency blocks implementation."
---
# Problem

A standard code review on 2026-08-13 confirmed seven defects in normal `wowbagger` use. They affect ledger validity, claim coordination, lifecycle reliability, source preservation, and structured CLI behavior.

The defects share one delivery requirement: each fix must preserve the documented contracts and independent oracles while adding a behavioral regression test before production code changes.

# Confirmed evidence

## 1. Concurrent number assignment can invalidate the ledger

Affected code:

- `src/mutation.js:280-315` validates a create candidate against one loaded ledger snapshot and then publishes it.
- `src/mutation.js:734-740` gives patch only the target item lock.
- `src/mutation.js:1202-1206` gives create only the new item and existing reference locks.

The `number` field is unique across the complete ledger, but independent item locks do not serialize that ledger-wide invariant.

Observed reproduction:

- Start two public `create` commands concurrently.
- Use different canonical item IDs and `number: 42` in both requests.
- Both commands exited `0` with committed results.
- The next public `validate --json` exited nonzero and reported `duplicate-number` for both items.

Required result: two concurrent creates or patches that assign the same number must not both commit. The completed ledger must remain valid.

## 2. Git verification failure disables the active-claim legacy-write guard

Affected code:

- `src/claim-store.js:42-62` maps all Git resolution and verification failures to `null`.
- `src/claim-coordinator.js:9-13` treats `null` as an unprotected backend and executes the legacy write.

Observed reproduction:

- Provision a Git-backed ledger and acquire an active claim.
- A public transition with normal `PATH` exited `4` with `active-claim-write-refused`.
- Run the same transition through the absolute Node executable with `PATH=/definitely-missing`.
- The transition exited `0` and changed the item to `backlog` while the claim was active.

Required result: distinguish a confirmed non-Git ledger from a Git command or verification failure. A verification failure must return a structured operational refusal and leave item bytes unchanged.

## 3. Patch and transition widen item file permissions

Affected code:

- `src/mutation.js:573-592` renames a new temporary inode over the existing item.
- `src/mutation.js:1873-1885` creates the temporary with process-default permissions.
- `src/schema-migration.js:198-200` already shows the required mode-preservation pattern.

Observed reproduction:

- Create a valid item with mode `0600` under a normal `0022` umask.
- Run a successful public transition.
- The command exited `0`.
- The final item mode was `0644`.

Required result: patch and transition must preserve the source item's permission bits. Temporary replacement files must not use wider permissions during preparation.

## 4. Removing an anchored controlled field escapes the CLI JSON contract

Affected code:

- `src/mutation.js:781-793` deletes an absent successor field from the YAML document.
- Lifecycle serialization also removes terminal date fields before writing the new lifecycle shape.

Observed reproduction:

- Start with a valid item that has `number: &handle 7` and extension field `external_handle: *handle`.
- Public `validate --json` returned `{"valid":true,"errors":[]}`.
- Patch `number` to `null`.
- The process exited `1`, wrote no JSON envelope, and wrote `Unresolved alias (the anchor must be set before the alias): handle` to stderr.

The same deletion risk applies when a lifecycle transition removes an anchored terminal date that an extension alias retains.

Required result: permitted extension aliases must retain the prior scalar value when their controlled anchor is removed. Serialization failures must return the standard structured command envelope instead of escaping as raw stderr.

## 5. Claim reads durably advance the clock floor

Affected code:

- `src/claim-operations.js:64-68` clones state and calls `advanceClockFloor` during `claimRead`.
- `src/claim-journal.js:48-55` replays the read as a state-changing operation.

Observed reproduction:

- Acquire a five-minute lease at `2030-01-01T00:00:00.000Z`.
- Read at `2031-01-01T00:00:00.000Z` during simulated forward clock skew.
- The read state retained `2031-01-01T00:00:00.000Z` as its clock floor.
- Renew at `2030-01-01T00:01:00.000Z` after clock recovery.
- Renew exited `4` with `claim-expired`, although only one minute of the original lease had elapsed.

This differs from the protected reference behavior and the response-loss read fixture, which treat read as evidence rather than an authoritative lease decision.

Required result: read computes `observed_at` without changing the durable authoritative clock floor. Restart and replay must preserve that behavior.

## 6. An authorized post-release legacy mutation breaks reconciliation

Affected code:

- `src/claim-coordinator.js:29-34` permits a legacy transition or patch when no unexpired active claim exists.
- `src/claim-publication.js:408-438` classifies a later revision after claimed publication finalization as stale, with no record of the authorized legacy write.

Observed public sequence:

1. Acquire a claim: exit `0`.
2. Publish claimed bytes: exit `0`.
3. Commit and run `claim-verify`: exit `0`.
4. Release the claim: exit `0`.
5. Run a valid legacy patch: exit `0`.
6. Commit the patch.
7. Run `claim-verify` again: exit `6`.

Required result: a legacy transition or patch that the coordinator permits after claim release must remain reconcilable. The next claim operation or verification must not classify that authorized revision as an unexplained stale write.

## 7. Patch and transition remove a UTF-8 BOM

Affected code:

- `src/ledger.js:7` decodes item bytes with a `TextDecoder` that consumes a leading UTF-8 BOM.
- `src/mutation.js:759` and the transition serializer rebuild bytes from the decoded source.
- `src/schema-migration.js:240-245` already restores a BOM for migration output.

Observed reproduction:

- Prefix a valid item with bytes `EF BB BF`.
- Run a successful public transition.
- The command exited `0`.
- The final first three bytes were `2D 2D 2D` (`---`) instead of `EF BB BF`.

Required result: patch and transition must preserve the original BOM exactly.

# Required implementation

Use one Red-Green-Refactor cycle for each observable behavior. Do not combine the work into a broad mutation or claim refactor.

1. Add ledger-wide coordination for mutations that assign or change `number`. Revalidate the complete candidate under that coordination immediately before publication.
2. Represent Git verification failure separately from a confirmed non-Git ledger. Fail closed with a stable structured error when verification cannot complete.
3. Copy the existing item's permission bits to the replacement temporary before publication.
4. Materialize or detach retained aliases before deleting a controlled anchor. Convert serialization exceptions to the command's structured error envelope.
5. Make `claimRead` observational. Do not journal or replay a read as an authoritative clock-floor advance.
6. Record or otherwise recognize authorized post-release legacy mutations inside the existing serialized coordinator path so reconciliation accepts them.
7. Preserve a leading UTF-8 BOM when patch or transition publishes replacement bytes.

# Acceptance criteria

1. A real-process test races two creates with different IDs and the same number. Both cannot commit. Final ledger validation succeeds.
2. The equivalent concurrent patch case cannot commit duplicate numbers and leaves the ledger valid.
3. With an active claim, forced Git verification failure returns a structured nonzero result and leaves the item unchanged.
4. Public patch and transition each preserve `0600` on a `0600` item under umask `0022`.
5. Patch removal of an anchored `number` succeeds. The retained extension alias resolves to the prior scalar value.
6. A restore or undefer transition that removes an anchored terminal date succeeds and preserves the retained extension alias value.
7. Any YAML serialization failure returns valid JSON in `--json` mode and follows the documented exit and state semantics.
8. A read during forward clock skew does not change the durable clock floor. A valid renew after clock recovery succeeds before the original lease expiry.
9. Restart replay after that read produces the same authoritative state as the protected reference behavior.
10. The full acquire → publish → commit → verify → release → legacy patch or transition → commit → verify sequence succeeds without a stale-write finding.
11. Public patch and transition each preserve a leading UTF-8 BOM byte-for-byte.
12. Existing mutation fixtures and `test/work-claim-reference.js` remain independent oracles. Do not import them into `src/` or change them to match production behavior.
13. The complete release gate passes on the current Node runtime and Node 20:

```sh
TMPDIR=/tmp node --test test/*.test.js
TMPDIR=/tmp /opt/homebrew/opt/node@20/bin/node --test test/*.test.js
TMPDIR=/tmp node spec/run-adapter-implementation.js
node bin/wowbagger.js validate --ledger ledger --json
```

# Scope constraints

- Fix the seven confirmed behaviors only.
- Preserve exact-byte compare-and-set behavior and atomic publication guarantees.
- Preserve existing JSON envelope shapes unless the documented contract requires the corrected error classification.
- Do not weaken candidate validation, claim fencing, reconciliation, or filesystem no-follow checks.
- Update contract text only where the implementation correction exposes missing or inaccurate normative wording.
- Keep tests at public seams or independent reference seams. Do not test private implementation details.
