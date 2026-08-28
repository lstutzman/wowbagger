# Reconciliation ownership topology

## Status

Approved design for item #178. Lee selected generated per-worktree UUIDs on 2026-08-28.

## Problem

Reconciliation currently determines safety through ordered conditionals spread across `findRevisionOwner`, `reconciliationDiagnosis`, and `blocksTarget`. Those conditionals mix five separate facts:

- whether working-tree bytes are expected, authorized, unknown, or absent;
- whether `HEAD` bytes are expected, authorized, unknown, or absent;
- whether the expected revision belongs to this checkout, another active worktree, or no identifiable worktree;
- whether an unreachable expected revision was written here or in another worktree;
- whether the caller verifies the whole repository, targets the affected item, or targets an unrelated item.

The alpha.11 and alpha.12 release gates found five adjacent defects in this path. Four were ownership-classification defects, and two were regressions caused by the preceding point fix. Branch order is acting as an undocumented topology model.

## Decision

Create a deep reconciliation-classifier module with one normalized input and one typed output. Gather Git and journal evidence before classification. Render public findings after classification. Apply target scope from the classifier's barrier class, never from the human-facing `reason` string.

Record an opaque random UUID for each Git worktree in that worktree's private Git directory. New journal entries carry the writer UUID as optional evidence. Existing entries without it remain valid and safely ambiguous.

## Goals

- Express every supported topology as data rather than branch order.
- Keep out-of-protocol local states as global barriers.
- Keep genuine sibling synchronization target-scoped.
- Distinguish this worktree's unreachable successor from another worktree's unreachable successor for newly written journal entries.
- Preserve current public request and envelope shapes.
- Preserve alpha.12 journal readability in both directions.
- Name a sibling ref only when an active Git worktree supplies that ownership evidence.
- Test behavior through public CLI seams.

## Non-goals

- Exclusive coordination against hostile writers or independent clones.
- A new public worktree-management command.
- Exposing worktree UUIDs in public findings.
- Reclassifying claim ownership, lease, or epoch semantics.
- Repairing historical journal entries that lack writer identity.
- Implementing item #174.

## Normalized topology

Use these revision classes:

- `expected`: byte revision equals the journal's latest expected revision.
- `authorized`: revision appears in the item's authorized revision set but is not latest.
- `unknown`: non-null revision is outside the authorized set.
- `absent`: the item path is absent on that surface.

Use these expected-owner classes:

- `current`: expected bytes are reachable from this worktree's named or detached `HEAD` history.
- `sibling`: an active sibling worktree's `HEAD` history reaches the expected commit. A named sibling may provide `owner_ref` and `owner_commit`.
- `reachable-unowned`: Git reaches the expected commit only through a tag, remote-tracking ref, or another ref not attached to a live worktree.
- `unreachable`: no reachable commit carries the expected bytes.

Use these expected-writer classes from optional journal evidence:

- `current`: latest authorizing entry carries this worktree's UUID.
- `other`: latest authorizing entry carries another UUID.
- `unknown`: entry predates writer UUIDs or its recorded worktree no longer exists.

## Required topology matrix

`verify` means repository-wide `claim-verify`. `target` means a mutation of the affected item. `unrelated` means a mutation of another item.

| Row | Working tree | HEAD | Expected evidence | Required result | Blocks verify / target / unrelated |
|---|---|---|---|---|---|
| 0 | expected | expected | current | no finding | no / no / no |
| 1 | expected | authorized | writer current | `git-finalization-required` | yes / yes / yes |
| 2 | authorized | expected | owner current named | `unauthorized-revision` | yes / yes / yes |
| 3 | authorized | expected | owner current detached | `unauthorized-revision` | yes / yes / yes |
| 4 | authorized | authorized | owner sibling named | synchronization with `owner_ref` and `owner_commit` | yes / yes / no |
| 5 | older authorized | authorized | owner sibling named | synchronization with `owner_ref` and `owner_commit` | yes / yes / no |
| 6a | authorized | authorized | unreachable, writer current | `unauthorized-revision` | yes / yes / yes |
| 6b | authorized | authorized | unreachable, writer other | synchronization with unavailable owner | yes / yes / no |
| 6c | authorized | authorized | unreachable, writer unknown | synchronization with unavailable owner, preserving alpha.12 behavior | yes / yes / no |
| 7 | unknown | authorized | any | `unauthorized-revision` | yes / yes / yes |
| 8 | unknown | same unknown | sibling named | `unauthorized-revision` | yes / yes / yes |
| 9 | authorized | unknown | sibling named | `unauthorized-revision` | yes / yes / yes |
| 10 | absent | authorized | sibling named | `unauthorized-revision` | yes / yes / yes |
| 11 | absent | expected | owner current | `unauthorized-revision` | yes / yes / yes |
| 12 | absent | absent | sibling or unreachable writer other/unknown | synchronization with unavailable owner | yes / yes / no |
| 13 | authorized | authorized | reachable only by tag or remote ref | synchronization with unavailable owner; never name that ref as a worktree owner | yes / yes / no |
| 14 | authorized | authorized | live detached sibling | synchronization with unavailable owner; no invented `owner_ref` | yes / yes / no |

Rows 6a and 6b are the identity mechanism's new value. Row 6c is required backward compatibility. Rows 13 and 14 tighten ownership evidence without changing the public envelope shape.

## Classifier module

Create `src/reconciliation-classifier.js` with a small internal interface:

```js
classifyReconciliation({
  workingTree,
  head,
  expectedOwner,
  expectedWriter,
})
```

The result is one of:

```js
{ kind: 'none', scope: 'none' }

{
  kind: 'finding',
  scope: 'global' | 'target',
  reason: 'git-finalization-required'
    | 'worktree-synchronization-required'
    | 'unauthorized-revision',
  owner: { kind: 'named-sibling', ref, commit }
    | { kind: 'unavailable', reachability: 'reachable' | 'unreachable' }
    | { kind: 'current' }
    | null,
  remediation: 'commit'
    | 'wait-named-owner'
    | 'wait-unreachable-writer'
    | 'inspect-reachable-history'
    | 'restore-or-adopt',
}
```

The classifier performs no filesystem or Git operations and emits no public prose. It owns classification invariants only.

A sibling synchronization result has `scope: 'target'`. Every out-of-protocol or local-finalization result has `scope: 'global'`. The reconciliation caller decides whether a finding blocks by comparing scope with the requested target. It never checks the `reason` string to decide safety.

## Evidence adapter

`src/git-reconciliation.js` remains the Git evidence adapter. Replace arbitrary `for-each-ref --contains` ownership with active-worktree evidence:

1. Find a commit whose item bytes match the expected revision, under the existing output bound.
2. Give current named or detached `HEAD` first priority.
3. Read `git worktree list --porcelain -z`.
4. Determine which live sibling worktree `HEAD` histories contain that commit.
5. Return a named sibling only when the selected live worktree has a branch ref.
6. Return reachable-but-unowned for tags, remote-tracking refs, prunable worktrees, and detached siblings without a branch ref.
7. Return unreachable when no reachable commit carries the bytes.

Selection among multiple named live siblings is deterministic: sort by branch ref, then absolute worktree path.

## Worktree UUID

### Location and format

Resolve the current worktree's private Git directory through Git, not by parsing `.git` manually. Store `wowbagger-worktree-id` inside that private directory. For a linked worktree this is beneath `$GIT_COMMON_DIR/worktrees/<id>/`; for the main worktree it is inside its Git directory. The file is untracked by construction.

The file contains a lowercase random UUID version 4 followed by one newline. It contains no hostname, username, repository path, or branch name.

### Creation

Identity creation runs while the existing claim-store lock is held, so cooperating mutations cannot create two identities concurrently.

1. Read and validate an existing identity.
2. If absent, generate a UUID with `crypto.randomUUID()`.
3. Create a unique temporary file in the same private Git directory with mode `0600` and exclusive creation.
4. Write the complete UUID plus newline, sync, and close the temporary file.
5. Rename the temporary file to `wowbagger-worktree-id` on the same filesystem.
6. Read back and validate the final file.
7. Remove an abandoned temporary file on failure.

Never open the final identity file with truncate semantics.

### Duplicate detection

Before trusting a current UUID, enumerate live registered worktrees through `git worktree list --porcelain -z`. Resolve each live worktree's private Git directory through Git and read any identity file present. If two live worktrees in the same Git common directory carry one UUID, reconciliation fails before it classifies or publishes an item.

The observable behavior reuses existing failure surfaces:

- `claim-verify` exits `6` in the `work-claim` domain with `state: "unchanged"`, `error.code: "claim-store-unavailable"`, and `error.details.reason: "claim-store-unreadable"`;
- an ordinary claim-protected mutation exits `6` in its existing domain with `state: "unchanged"`, `error.code: "claim-store-unavailable"`, and `error.details.reason: "claim-store-unreadable"`;
- auto-commit refuses with exit `4`, `error.code: "auto-commit-preflight-failed"`, `error.details.reason: "claim-state-unreconciled"`, `claim_verify_code: "claim-store-unavailable"`, `claim_verify_reason: "claim-store-unreadable"`, and `retryable: false`;
- `publish-claimed` and `claim-adopt` map the identity failure to their existing claim-store-unavailable form instead of reporting an unknown mutation outcome.

No item, journal, reconciliation log, identity file, Git index, or commit changes after duplicate detection. Claim reads and lease decisions that do not reconcile item bytes continue to use their existing claim-store rules. Do not add a new public error code or reason in this change.

A copied independent clone may carry the same UUID, but clones do not share a Git common directory or journal, so the identity cannot collide within the coordination domain.

When a worktree is removed, its private identity file disappears with its Git administrative directory. A recreated worktree receives a new random UUID. Historical journal entries retain the removed UUID; readers classify that writer as `unknown`, never as the new worktree.

## Journal evidence

Add optional `writer_worktree_id` to new entries that authorize or can resolve a written item revision:

- `legacy-mutation-intent`;
- `legacy-mutation`;
- `publish-intent`;
- `publish-final`.

Resolution entries copied from an intent preserve its writer UUID. Existing entries and revision-adoption entries may omit it. Reconciliation reads the latest authorizing entry's value when present.

The committed reconciliation projection may show this opaque UUID. It contains no machine-derived information.

## Contract-version decision

Core `contract_version` remains `5`.

Reasons:

- Public requests, success envelopes, refusal envelopes, error codes, reason values, and fields remain unchanged.
- `writer_worktree_id` is optional internal journal evidence.
- The alpha.12 journal validator accepts extra members and ignores fields it does not understand.
- The new reader accepts entries without the field and preserves alpha.12's ambiguous unreachable-writer behavior.
- Tags and remote refs stop being mislabeled as active worktree owners, but the public finding still uses the existing synchronization reason and `owner_unavailable: true` shape.

Published-binary compatibility was executed before implementation. The globally installed registry binary reported `0.1.0-alpha.12`. In a temporary provisioned Git ledger, a valid `legacy-mutation-intent` and matching `legacy-mutation` were appended with an extra random `writer_worktree_id` while preserving the journal hash chain. Running the published alpha.12 `claim-verify` against that journal exited `0`, returned `ok: true`, reported `findings: []`, and validated the ledger. This is execution evidence, not parser inspection.

Before implementation changes journal parsing, add the same case as a permanent characterization test and run it while the implementation still matches alpha.12. After implementation, keep it green. Add a new-reader test showing a missing field produces `expectedWriter: 'unknown'` and row 6c behavior.

A contract-version bump becomes necessary only if implementation needs a new public member, error code, reason value, or incompatible journal requirement. Stop and ask Lee before making such a change.

## Public-envelope rendering

`claim-publication.js` converts typed diagnoses into the existing finding shape:

- `git-finalization-required`: commit remediation, no owner fields.
- named sibling synchronization: `owner_ref`, `owner_commit`, and wait/synchronize remediation.
- unavailable synchronization: `owner_unavailable: true` and reachable-history or unreachable-writer remediation.
- `unauthorized-revision`: destructive restore and non-destructive adoption remedies.

No worktree UUID appears in a finding. No public member is added or removed.

## Compatibility and failure behavior

- Alpha.12 reader plus new journal field: published alpha.12 execution exits `0`, ignores the field, reports no findings, and validates the ledger.
- New reader plus alpha.12 journal: treats writer identity as unknown.
- Missing identity file: creates one only under the claim lock before a new journal write.
- Malformed identity file: every item-reconciling write and `claim-verify` refuses through the existing claim-store-unreadable surface; the file is never replaced silently.
- Duplicate live identity: every item-reconciling write and `claim-verify` refuses before mutation through the concrete envelopes defined above.
- Git worktree enumeration failure: ownership evidence is unavailable; safety does not downgrade.
- Identity write outcome unknown: re-read the final path before deciding; never generate and append a second UUID blindly.

## Testing strategy

All contract tests use public CLI seams. Internal pure-function tests are optional diagnostics and do not substitute for them.

TDD order:

1. Characterize alpha.12 reading an entry with a future optional writer UUID; it must pass before implementation.
2. RED row 6a: this worktree writes an unreachable successor, restores an authorized predecessor, and an unrelated mutation must block as unauthorized.
3. GREEN identity creation, journal recording, and the minimum classifier path for row 6a.
4. RED row 6b: another worktree writes the unreachable successor; unrelated work must remain allowed and claim verification must report unavailable-owner synchronization.
5. Add row 6c as backward-compatibility characterization and prove it detects a deliberate fallback change.
6. RED duplicate UUID detection through a public mutation refusal.
7. RED identity removal/recreation so an old UUID never aliases the new worktree.
8. RED tag-only and remote-only reachability so neither is exposed as `owner_ref`.
9. RED detached sibling reachability so no branch owner is invented.
10. Run every existing row and companion in one public topology suite.
11. Refactor into the pure classifier only after public behavior is pinned.
12. Mutation-test every distinct matrix outcome by changing one classifier result and observing a public test fail.

Each new behavior gets one RED-GREEN-REFACTOR cycle. A row already covered by an earlier fix is characterization, not a manufactured RED; prove non-tautology with one deliberate mutation.

## Files and sequence

Expected production files:

- `src/reconciliation-classifier.js` — pure topology classification and scope.
- `src/worktree-identity.js` — private identity lifecycle and duplicate detection.
- `src/git-reconciliation.js` — active-worktree ownership evidence.
- `src/claim-publication.js` — evidence normalization and public rendering.
- `src/claim-coordinator.js` and claimed-publication journal writers — record writer identity.
- `src/claim-journal.js` — accept and preserve optional identity evidence.

Expected tests extend existing claim-journal, cross-worktree coordination, and reconciliation suites. Do not add test-only production interfaces.

Implementation order:

1. Commit the alpha.12 compatibility characterization before production changes.
2. Add UUID lifecycle through public mutation behavior.
3. Add unreachable writer distinction.
4. Restrict worktree owner evidence.
5. Extract the pure classifier and move scope decisions onto its typed result.
6. Run focused topology tests after every cycle.
7. Run current Node, Node 20, adapter conformance, ledger validation, npm audit, and no-mistakes before completion.

## Release impact

No release is authorized by item #178 itself. When this work ships, release notes must state:

- new mutations record an opaque worktree identity;
- old journals remain compatible and safely ambiguous;
- current-versus-sibling unreachable successors are distinguished for new evidence;
- tags and remote refs no longer masquerade as active sibling owners;
- public envelope shapes and core contract version remain unchanged.
