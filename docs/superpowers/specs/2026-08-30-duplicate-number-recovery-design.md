# Duplicate-number recovery design

## Goal

Provide a sanctioned, reviewable recovery path for a schema-version-2 ledger that is blocked only by duplicate human-facing item numbers.

The recovery must repair the complete duplicate set in one operation, validate the resulting ledger before publication, preserve every item field other than the explicitly reassigned `number`, and remain recoverable after a lost response or process interruption.

## Verified starting point

A duplicate number is recoverable because each item still has a distinct ULID. The current validator reports `duplicate-number` on every colliding item, but an invalid ledger blocks ordinary `create`, `transition`, and `patch` before mutation. `number` is immutable through `patch`. `claim-adopt` is not sufficient: it is designed to re-baseline one already-valid committed revision, and its adoption precondition validates the complete ledger after the proposed adoption. It cannot repair a duplicate-number ledger as a normal mutation.
The emergency PropertyCompass2 repair edited only human-facing `number` values, committed the files, and used `claim-adopt`, according to the field report. Relations in this ledger are ULID IDs, not numbers, so that number-only sequence does not strand `depends_on`, `related`, or `parent` references. The published alpha14 warning that unsupported hand edits “can leave dangling” references describes the broader danger of arbitrary manual source edits — for example changing IDs or paths — not an observed consequence of the reported number-only repair. This operation makes that distinction explicit: it preserves stable ID relations and refuses any number-bearing foreign reference it cannot inspect safely.

## Scope

This design covers:

- a read-only duplicate-number proposal;
- one explicit multi-item number-reassignment operation;
- operation-level compare-and-swap, shared-worktree fencing, and no-clobber publication;
- durable interruption and response-loss recovery;
- auto-commit of the complete repair set;
- exact current-Node and Node 24 public regressions.

This design does not widen ordinary `patch`, repair malformed YAML, repair invalid IDs or relations, provision missing extension declarations, or coordinate separate clones or machines. Those states refuse unchanged and remain separate work.

## Public interface

Add two commands in a separate `ledger-repair` response domain, contract version 1:

```text
wowbagger number-repair-proposal --ledger <dir> --json
wowbagger number-repair --ledger <dir> --input <repair.json> --json [--auto-commit]
```

This keeps core contract version 5 and the existing mutation contract unchanged. The repair domain is explicitly allowed to inspect an invalid ledger, but it never silently becomes a general invalid-ledger bypass.

### Proposal

`number-repair-proposal` is read-only. It returns `state: "unchanged"` and a result containing:

- `ledger_snapshot_revision`: SHA-256 over sorted relative ledger paths and their exact raw bytes, excluding only derived reconciliation logs, lock files, temporary files, and the repair staging directory;
- `duplicate_groups[]`, each with the duplicated number and every affected item ID, configured item path, current number, and exact item revision;
- `suggested_changes[]`, one change for every item the deterministic proposal would move;
- `preserved_items[]`, the item IDs the proposal leaves on their current number;
- `references[]`, every `depends_on`, `related`, and `parent` relation involving an affected item, represented by ULID and path, proving that relations use stable IDs rather than human numbers;
- `validation_errors[]`, the complete current validator output.

The proposal refuses with `ledger-repair-not-applicable` when the ledger is valid, has no duplicate-number errors, or has any blocking error besides `duplicate-number`. It returns the complete blocking error list so the caller does not mistake an unrelated invalid ledger for repairable work.

The deterministic suggestion preserves the item with the lexicographically smallest ULID in each duplicate group at the old number. It assigns replacement numbers monotonically above the current maximum, sorting moved items by ULID. This is a suggestion, not an authority: the caller may submit different positive replacement numbers, but it must submit one change for every moved item and the apply operation validates the complete mapping under the fence.

The proposal never writes a repair intent, changes the claim journal, edits an item, or changes the derived reconciliation log.

### Apply request

`number-repair` accepts exactly:

```json
{
  "repair_id": "nr_opaque_unique_id",
  "ledger_snapshot_revision": "sha256:...",
  "date": "YYYY-MM-DD",
  "changes": [
    {
      "item_id": "wb_...",
      "expected_revision": "sha256:...",
      "expected_number": 1685,
      "replacement_number": 1693
    }
  ]
}
```

`repair_id` is an opaque caller-generated idempotency key. `changes` is non-empty, has one entry per moved item, contains no duplicate IDs or replacement numbers, and names every item whose number differs from the proposal's preserved state. The request cannot omit an affected duplicate group. The old number and item revision are both compare-and-swap witnesses.

## Fencing and data flow

One worktree performs the repair. Other worktrees synchronize the resulting commit and then rerun `validate`; they do not repeat the repair from stale bytes. Two apply attempts in one Git coordination domain serialize on the existing shared namespace lock. The second attempt fails `ledger-repair-revision-conflict` when its snapshot or per-item witnesses no longer match. It never silently reapplies a different repair.

The operation ordering is normative:

1. Resolve and verify the Git common directory, namespace, and current worktree identity.
2. Acquire the shared namespace lock.
3. Read the raw ledger, including parseable items from an invalid ledger, and compute the current snapshot revision.
4. Confirm the request snapshot revision and every item revision, ID, path, and expected old number.
5. Confirm every current validation error is `duplicate-number`; otherwise refuse unchanged with no repair journal entry.
6. Apply the requested numbers in memory and verify that every positive integer is unique across the complete successor ledger.
7. Serialize only the affected item frontmatter number nodes. Preserve all other frontmatter bytes, decisions, extension nodes, comments, and bodies byte-for-byte.
8. Validate the complete successor ledger, including relations, parent rules, extension declarations, schema uniformity, and every unaffected item.
9. Create and fsync durable candidate staging bytes in the shared Git coordination store.
10. Reserve journal capacity and append a `number-repair-intent` before changing any item path.
11. Publish every affected item with expected-revision checks and atomic replacement. A changed path is never overwritten when its bytes no longer equal the request witness.
12. Re-read every affected path and verify its exact candidate revision.
13. Append one `number-repair-final` terminal naming all candidate revisions and the repair ID.
14. Rebuild the derived reconciliation log and either return the committed result or let `--auto-commit` commit the complete repair set.

A repair never guesses a replacement number from current bytes after the witnesses fail. It returns unchanged and asks for a fresh proposal.

## Existing invalid-ledger fence interaction

The normal mutation gate is intentionally bypassed only after the repair command proves that every current validation error is `duplicate-number`. The alpha14 create fence is not invoked as a prerequisite, because its purpose is to prevent new allocations while this command repairs the already-invalid state.

The repair command takes the same namespace lock as alpha14 create. It therefore cannot race a cooperating create in the same Git common directory. A create waiting on the lock observes the repaired, valid ledger after the repair terminal and commit. A repair waiting on a create observes either the create's committed number or a durable create intent; it refuses stale witnesses rather than allocating over them.

Separate clones, machines, alpha13 writers, and noncooperating edits remain outside this coordination domain. They still require integration and `validate` as the backstop.

## References and projections

Relations are stored as ULIDs in `depends_on`, `related`, and `parent`; they do not contain human-facing numbers. The repair MUST preserve those relation values byte-for-byte and MUST validate them again on the successor ledger.

The operation MUST inspect all declared extension values and projection inputs that carry or derive an item number. It MUST NOT rewrite arbitrary Markdown body text or consumer-owned extension values merely because they happen to contain a decimal string. Derived reports and handles recompute from the repaired item number after the ledger validates. If a consumer-owned extension declares a number-based foreign key, the proposal reports it as an affected reference and refuses until a dedicated reference-aware repair is designed; it never silently rewrites it.

## Durable recovery

The repair journal adds these internal entry types:

- `number-repair-intent`: repair ID, namespace, snapshot revision, date, every item witness, every candidate revision, and the staging-store identifier;
- `number-repair-final`: repair ID, namespace, every candidate revision, and the committed Git result when known.

The intent is written and fsynced before item publication. Candidate bytes live in a bounded, no-follow staging directory under the shared Git coordination store and are deleted only after terminal and Git finalization are durable.

If the process stops:

- before the intent: no repair is visible and the next proposal is safe;
- after the intent but before item publication: the next `number-repair` recovery reads the staged candidates and publishes them, or records a refusal if any witness changed;
- after some item paths publish: recovery completes only paths still carrying their expected witness; a third revision yields `number-repair-outcome-unknown` and leaves the intent open for explicit inspection;
- after all candidate bytes publish but before the final journal terminal: recovery verifies all candidate revisions and appends exactly one final terminal;
- after the final terminal but before Git commit: `--auto-commit` returns a recovery token binding the full repair commit set, and `mutation-finalize` completes that Git commit without replaying the item publication;
- after Git commit: replay sees the final terminal and returns the durable result without a second repair.

A lost response never authorizes a blind retry. The caller reads the repair outcome or runs proposal/verify recovery with the same `repair_id`; a repeated final terminal is rejected by idempotency, not appended twice.

## Failure and refusal contract

Apply refusals use the `ledger-repair` domain, `contract_version: 1`, `state: "unchanged"`, and no item changes. The important codes are:

- `ledger-repair-not-applicable`: the ledger is valid or has a non-duplicate blocking error;
- `ledger-repair-revision-conflict`: snapshot, item revision, or expected old number changed;
- `ledger-repair-number-collision`: replacement number exists outside the requested mapping or is duplicated in it;
- `ledger-repair-reference-conflict`: an affected number-bearing reference cannot be safely preserved;
- `ledger-repair-successor-invalid`: complete successor validation still fails;
- `ledger-repair-outcome-unknown`: a third revision prevents proving the publication state;
- `ledger-repair-commit-failed`: all item bytes and journal terminal are durable, but Git finalization still needs its recovery token.

Every refusal includes the current snapshot revision and bounded diagnostics where those values are safe to derive. No refusal changes an item, number, relation, journal terminal, or Git `HEAD` except the explicitly documented durable clock entry and an intent's own crash-recovery evidence.

## Compatibility

Core contract version 5 remains unchanged. `ledger-repair` contract version 1 is new and is not advertised as a normal `core.commands` operation to older adapters. Alpha14 can read old claim journals; older binaries do not need to understand the new repair journal because they are not allowed to perform recovery. An alpha14 writer encountering a new repair journal must refuse claim-protected work rather than ignore an in-flight repair.

The package must ship the new repair command, its contract, and its recovery documentation together. Adapter correlation for normal core mutations remains unchanged; a future adapter contract can explicitly add `ledger-repair` after this command's independent contract is stable.

## TDD and verification

Each behavior is one RED-GREEN-REFACTOR cycle:

1. Proposal on a duplicate-only invalid ledger; proposal refusal on an unrelated invalid ledger.
2. Stale snapshot, stale item revision, old-number mismatch, replacement collision, duplicate mapping, and missing duplicate-group change.
3. Complete successor validation, relation preservation, extension/projection inspection, and no body rewriting.
4. Single-worktree successful repair with deterministic and caller-selected replacements.
5. Same-clone concurrent repair contention and alpha14 create contention.
6. Partial publication and lost-response recovery for intent, final, and Git finalization states.
7. Auto-commit exact commit set and foreign dirt refusal.
8. Idempotent repeated proposal/apply/finalization and synchronized sibling verification.
9. Current Node 24.20.0 and Node 20 public suites, then adapter/package/ledger gates.

The test oracle must construct duplicate ledgers independently from production serialization. Mutation proofs must show that removing the duplicate-only gate, any witness comparison, replacement collision check, complete successor validation, intent-before-write, or terminal idempotency allows a focused test to fail.

The final gate runs:

```sh
TMPDIR=/tmp /opt/homebrew/opt/node@24/bin/node --test test/*.test.js
TMPDIR=/tmp /opt/homebrew/opt/node@20/bin/node --test test/*.test.js
TMPDIR=/tmp /opt/homebrew/opt/node@24/bin/node spec/run-adapter-implementation.js
/opt/homebrew/opt/node@24/bin/node bin/wowbagger.js validate --ledger ledger --json
/opt/homebrew/opt/node@24/bin/node bin/wowbagger.js claim-verify --ledger ledger --json
PATH=/opt/homebrew/opt/node@24/bin:$PATH npm audit
```

The release gate must record exact runtime versions, not a generic “current Node” label.
