> **SUPERSEDED — historical record, salvaged 2026-08-07.**
>
> This handoff was never committed. It lived only as an untracked file in the
> `wowbagger-claim-contract` worktree, which has since been removed; its branch
> `feature/work-claim-contract` is merged into `main`.
>
> **Do not follow its instructions.** They are stale in several ways: the
> worktree path no longer exists, the test counts (228) predate the current
> suite, and the work-claim item's scope was later corrected — that branch
> delivered the contract and reference model only, not an implementation.
> Advisory claims shipped separately and enforce nothing; fenced claims remain
> unimplemented and are blocked on a design question recorded in
> `ledger/2026-08-06-fenced-work-claims-coordinator.md`.
>
> It is kept for two things that exist nowhere else. First, the
> **"Review history that must not be repeated"** section below names each of the
> four rejected review rounds and why each was rejected. Second, the standard
> those rejections enforced: **an expected envelope must be complete, literal,
> executable, and tamper-checked independently of the reference model — never
> derived from it.** That principle governs the adapter differential tests too,
> where `src/adapter/` is deliberately re-implemented rather than copied from
> `spec/adapter-reference.js`.

---

# Handoff — Wowbagger fenced work-claim contract (2026-08-05)

**Worktree:** `/Users/leestutzman/Documents/GitHub/wowbagger-claim-contract`
**Branch:** `feature/work-claim-contract`
**HEAD:** `9eaeb5756bbbea60b9a1e9cea6255ff1b41d02da` (`Complete work-claim protocol contract`)
**Status:** iteration-checkpoint; implementation is pushed, independent-golden review is not yet approved

> **Next agent:** read this file and `docs/work-claim-contract.md`, then construct the three remaining standalone literal-golden scenarios from the public contract operations before asking Sol to review the new exact head.

---

## Goal

Finish Wowbagger’s fenced work-claim protocol as a standalone, harness-neutral contract. The protocol must provide deterministic claim identity, idempotent retries, expiry handling, ledger-revision conflict detection, fencing, strict canonical validation, and auditable refusal envelopes.

This work is exclusively in the standalone Wowbagger repository. Do not modify or push PropertyCompass2.

## Authoritative facts

- Wowbagger `main` is currently at merged adapter commit `6f1d36f`.
- This feature branch intentionally preserves exactly three legal commits: `d4f8482` (start), `d968387` (contract), `9eaeb57` (completion). Preserve that history shape when rebuilding; use the established guarded force-with-lease/rebuild workflow.
- Remote branch is `origin/feature/work-claim-contract`; local and remote were equal and the worktree was clean at handoff creation.
- Terra owns implementation changes. Sol is the independent reviewer. The primary agent plans, dispatches, reviews, opens the PR, and merges only after Sol approval of the exact PR head.
- Do not open or merge the PR yet.

## Shipped progress

Already merged to Wowbagger `main`:

| Commit | Description |
|---|---|
| `6f1d36f` | Merge harness-neutral adapter contract |
| `6c5057b` | Merge mutation runtime |
| Earlier main history | Identity, read-only kernel, self-hosted ledger, and mutation/CAS contracts |

On this feature branch, the runtime claim/fence contract and strict canonical validation are implemented and pushed. Current verification reported by Terra/Sol:

- Node 20 and Node 26: 228/228 tests pass.
- `npm audit --omit=dev`: zero vulnerabilities.
- Generator output is deterministic.
- Base and feature ledgers validate; `git diff --check` and `git fsck --no-dangling` are clean.
- Exact incomplete publish retry message passes: `The publish-claimed retry must include its complete request.`
- Strict owner, epoch, timestamp, publication-envelope, and pre-state rejection cases pass.
- Claim-expired now has a complete literal independent golden.

## Open work

1. **Add literal idempotency-conflict golden.** Build a minimal valid sequence from the public contract operations: create a successful claim, submit a different request with the same idempotency identity, capture the actual complete refusal envelope, hand-author that exact expected envelope, compare actual output to the literal with deep equality, and tamper-test the literal artifact. Do not obtain expected values from the reference model.
2. **Add literal ledger-revision-conflict golden.** Build a valid claim at ledger revision N, advance the ledger to N+1 through normal documented operations, submit the stale request, and create the same literal/deep-equal/tamper-check structure. Existing fence-invalid fixtures cannot reach this state.
3. **Replace the fence golden’s model-derived tamper check.** Keep the four fence dimensions, but store a complete hand-authored expected envelope for each and mutate/validate the literal expected artifact—not a clone of the model-produced actual output.
4. Run the full Node 20/26 matrix, audit, deterministic generator, ledger validation, diff, and fsck checks. Preserve the three-commit history and push the exact new head.
5. Send the exact pushed hash to Sol for a fresh finite-checklist review. Only after explicit `APPROVE`: open the PR, obtain a fresh PR-head review, then merge non-squashing with head pinning.

## Blockers

- The current fixtures are insufficient for revision conflict: the available fence-invalid vectors reject before reaching a valid revision-conflict state.
- Sol’s review requirement is strict: expected envelopes must be complete, literal, executable, and tamper-checked independently of the reference model.
- No implementation changes are currently uncommitted; Terra stopped at `9eaeb57` rather than inventing model-derived artifacts.

## Review history that must not be repeated

- `063a397`: canonical nested-owner, retry-envelope, and independent-golden gaps.
- `d47bd22`: retry message and missing independent categories.
- `462194b`: retry message fixed, but only fence goldens added; fence tamper check remained model-derived.
- `9eaeb57`: claim-expired literal fixed; idempotency and revision literals still missing; fence expected envelope still incomplete/model-derived.

## References

- Contract: `docs/work-claim-contract.md`
- ADR: `docs/adr/0004-fenced-work-claim-protocol.md`
- Reference implementation/tests: `test/work-claim-reference.js`, `test/work-claim-reference-model.test.js`
- Independent goldens: `test/work-claim-independent-goldens.test.js`
- Repository README: `README.md`

## Prompt for next session

```text
Context: continue the Wowbagger fenced work-claim contract from the 2026-08-05 checkpoint.

Read these first:
1. docs/handoffs/2026-08-05-work-claim-contract.md
2. docs/work-claim-contract.md
3. docs/adr/0004-fenced-work-claim-protocol.md
4. test/work-claim-independent-goldens.test.js

Work only in /Users/leestutzman/Documents/GitHub/wowbagger-claim-contract and do not touch PropertyCompass2.

First action: inspect the public command/fixture primitives and build a minimal valid idempotency-conflict scenario, then a minimal valid ledger-revision-conflict scenario. Hand-author complete expected envelopes from those contract outputs; never derive expected values from the reference model. Also replace the fence golden’s model-derived tamper check with literal expected envelopes.

Acceptance checklist:
- complete literal executable/tamper-checked goldens for idempotency-conflict, claim-expired, ledger-revision-conflict, and claim-fence-rejected;
- exact publish-retry message remains correct;
- Node 20 and Node 26 pass;
- audit, deterministic generator, ledger validation, diff-check, and fsck pass;
- preserve exactly three legal feature commits and push with lease;
- obtain Sol APPROVE for the exact pushed hash before opening or merging a PR.
```
