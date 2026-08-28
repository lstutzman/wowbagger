---
schema_version: 2
id: wb_01M12GT91WYNWHTYRBV7Y5R9E3
number: 178
title: "Audit reconciliation ownership classification as one topology matrix"
kind: task
priority: 2
status: triage
created: 2026-08-27
updated: 2026-08-28
provenance:
  source: "no-mistakes/01M12F0YXS2QA72BQTTFABB5M6/review"
  recorded_at: "2026-08-27T21:05:00Z"
depends_on: []
related: []
---
## Problem

The alpha.11 release phase found #173, #176, and #177 in the same ownership-determination path. Each point fix closed one topology and exposed the adjacent gap. The classifier needs one explicit topology matrix rather than more local inference.

## Acceptance criteria

- Design one matrix covering named current owner, detached current owner, sibling ref, unreachable expected revision, authorized predecessors, unknown bytes, and target versus unrelated mutation scope.
- Map each cell to reason, blocking status, owner evidence, remediation, and public envelope.
- Add public-seam tests that cover every distinct outcome and fail if one topology silently aliases another.
- Review `findRevisionOwner`, `reconciliationDiagnosis`, and target-scope handling as one module boundary before changing implementation.
- Preserve the #173/#176/#177 decisions and explain any deliberate consolidation.

## Worktree identity constraint

The matrix must include the cell where an expected revision is uncommitted and unreachable while the working tree holds an authorized predecessor. Committed Git evidence alone cannot distinguish this worktree's own uncommitted successor from another worktree's successor. Resolving self-versus-sibling attribution likely requires an explicit worktree identity mechanism; do not infer it from item path, journal order, or absence from refs. Pin target, unrelated, and bare claim-verify behavior plus the not-yet-reachable remediation before proposing such a mechanism.

## Research inventory — 2026-08-28

Use E for the journal's latest expected revision, P/P2 for authorized predecessors, U for an unknown out-of-protocol revision, and Ø for an absent path. `claim-verify` always treats a finding as blocking because it names no target. A target mutation blocks on its own finding. An unrelated mutation may proceed only for a genuine `worktree-synchronization-required` finding.

| Row | Working tree | HEAD | Expected owner | Required diagnosis and evidence | Blocking: verify / target / unrelated | Current coverage or finding |
|---|---|---|---|---|---|---|
| 0 | E | E | current checkout | no finding | pass / pass / pass | baseline |
| 1 | E | P | not yet committed | `git-finalization-required`; commit here | block / block / block | existing own-uncommitted vector |
| 2 | P | E | current named ref | `unauthorized-revision`; restore or adopt | block / block / block | #173 |
| 3 | P | E | current detached HEAD | `unauthorized-revision`; restore or adopt | block / block / block | #177 |
| 4 | P | P | named sibling E | synchronization with `owner_ref` and `owner_commit` | block / block / pass | existing sibling vector |
| 5 | P2 | P | named sibling E | synchronization with `owner_ref` and `owner_commit` | block / block / pass | #176 |
| 6 | P | P | E unreachable | synchronization with `owner_unavailable: true` and not-yet-reachable remediation | block / block / pass | existing vector; self-versus-sibling ambiguous |
| 7 | U | P | sibling or unreachable E | `unauthorized-revision`; restore or adopt | block / block / block | unknown-working-tree companion exists for unreachable E; named-owner cell needs an explicit pin |
| 8 | U | U | named sibling E | `unauthorized-revision`; sibling evidence must not downgrade the barrier | block / block / block | alpha.11 reports synchronization and lets unrelated work pass; #179 row 1 |
| 9 | P | U | named sibling E | `unauthorized-revision`; unknown HEAD is a global barrier | block / block / block | alpha.11 reports synchronization and lets unrelated work pass; #179 row 2 |
| 10 | Ø | P | named sibling E | `unauthorized-revision`; deletion over an existing HEAD item is a global barrier | block / block / block | alpha.11 reports synchronization and lets unrelated work pass; #179 row 3 |
| 11 | Ø | E | current checkout | `unauthorized-revision`; restore or adopt | block / block / block | existing deletion vector |
| 12 | Ø | Ø | named sibling or unreachable E | synchronization; path absence is legitimate when this checkout never carried the item | block / block / pass | existing foreign-new-item vector |

Rows 8–10 were reproduced against the public alpha.11 CLI during this research. `claim-verify` exited 6, but each finding was labeled synchronization and an unrelated patch exited 0. They are one root defect: barrier class is evaluated after owner and scope classification. #179 owns the hotfix.

### Classifier seam

Current implementation spreads one decision across `findRevisionOwner`, `reconciliationDiagnosis`, and `blocksTarget`:

- `findRevisionOwner` gathers reachability evidence and internally distinguishes current named or detached ownership from a foreign ref.
- `reconciliationDiagnosis` mixes local-state authorization, owner attribution, reason selection, remediation text, and public field shaping.
- `blocksTarget` infers global-versus-target scope from the reason string: only synchronization is advisory for unrelated mutations.

That is a shallow cluster: changing one topology requires knowing branch order, evidence shape, remediation text, and scope semantics together. The proposed deep module should accept one normalized observation and return one typed diagnosis. Its interface needs, at minimum, working-tree class (`expected`, `authorized`, `unknown`, `absent`), HEAD class, expected-owner class (`current-named`, `current-detached`, `sibling`, `unreachable`), and target relationship (`verify`, `target`, `unrelated`). Its result should carry barrier class (`none`, `global`, `target`), reason, owner evidence, and remediation kind. Public envelope rendering then consumes the result; scope must not be inferred from a human-facing reason string.

Tests stay at public seams: `claim-verify --json`, an ordinary guarded mutation, and auto-commit preflight. Do not replace them with tests of the internal classifier. Each matrix row must assert reason, blocking behavior, owner fields, remediation, exit/state, and the correct work-claim or ledger-mutation envelope.

### Worktree identity constraint

Row 6 is intentionally unresolved. The same Git snapshot can represent a sibling's uncommitted successor or this worktree's own successor followed by a local restore to P. Reachable commits, item paths, and journal order cannot distinguish them. Git's documented machine surface is `git worktree list --porcelain -z`; per-worktree HEAD storage is available through `git rev-parse --git-path HEAD`, while refs under `refs/` are shared. Research source: https://git-scm.com/docs/git-worktree.

Before proposing a mechanism, compare explicit identities: the normalized per-worktree Git directory token, the porcelain worktree path, or a generated worktree UUID recorded in mutation journal entries. Evaluate move/repair behavior, pruning and token reuse, the main-worktree special case, detached HEAD, old journal compatibility, and an unavailable sibling. Do not infer identity from branch names: refs are shared, one commit may be contained by several refs, and the current `for-each-ref --contains` search can return a tag or remote-tracking ref that is not an active sibling worktree.

### Open characterization cells

- E in the working tree over unknown U at HEAD currently reports Git finalization. It blocks globally but may misstate who authored the bytes; decide whether safety or diagnostic fidelity governs that cell.
- P in the working tree over U at HEAD is now #179 row 2 and must remain global even when a sibling owns E.
- A deleted working-tree path with Ø at HEAD is legitimate foreign absence; deletion over non-Ø HEAD is unauthorized. Keep those cells separate.
- Define which refs qualify as public `owner_ref` evidence. A ref containing E proves reachability but does not prove an active worktree owner.

### Build order

1. Land #179's minimal barrier predicate without restructuring the short-circuits.
2. Turn this inventory into one executable public-seam matrix and prove every row detects a deliberate classifier mutation.
3. Define the typed diagnosis interface and public rendering rules before moving code.
4. Resolve explicit worktree identity for row 6, including journal compatibility.
5. Replace local inference only after the matrix is green; preserve the #173, #176, #177, and #179 decisions explicitly.
