---
schema_version: 2
id: wb_01M0XNVN00TRMBY86QXZV6EH3D
number: 166
title: "Document terminal-item date equality for patch, snooze, and parent-migrate"
kind: task
priority: 3
status: done
created: 2026-08-26
updated: 2026-08-26
completed: 2026-08-26
provenance:
  source: "exploratory-stress/2026-08-26/phase2-terminal-date"
  recorded_at: "2026-08-26T22:52:00.000Z"
depends_on: []
related: [ wb_01M0XNVN002WFNRD85Q1SSF5FK ]
tags:
  - "stress-run-2026-08-26-alpha10"
  - "documentation"
decisions:
  - action: accept
    date: 2026-08-26
    summary: "Accept the terminal-date documentation gap."
    rationale: "The campaign proved patch, snooze, and parent-migrate share an undocumented equality-only date constraint on lifecycle-dated items."
  - action: complete
    date: 2026-08-26
    summary: "Documented terminal-item date equality for patch, snooze, and parent-migrate."
    rationale: "The contract and installed skill changes landed in 0a85483. Documentation contract tests passed within the complete 1726-test suite on current Node and Node 20."
---
## Documentation gap — code is correct

The mutation contract's patch section says `date` may be any ISO date not earlier than existing `created` or `updated`, and its ownership table lists title, priority, depends_on, related, and body as patchable with no terminal-status carve-out. However, composed invariants make patch, snooze, and parent-migrate legal on done, killed, archived, or deferred items only when request `date` exactly equals the item's existing `updated`. The equality invariant is documented for transitions in `SPEC.md:201-207`, but its consequence for these three non-transition verbs is stated nowhere.

## Version and evidence provenance

- Distribution: `0.1.0-alpha.10`.
- Binary: `/Users/leestutzman/.nvm/versions/node/v20.20.2/bin/wowbagger`, resolving to `/Users/leestutzman/Documents/GitHub/wowbagger/bin/wowbagger.js`.
- Source HEAD: `b06db85c42d3795a82ad0b57b400e1c7b9a7025b`, clean, local `main` ahead of `origin/main` by two metadata-only commits.
- Recovery ref: local annotated tag `v0.1.0-alpha.10`, unpushed.
- Ahead commits: `b06db85` Cut 0.1.0-alpha.10; `e6c012f` Prepare alpha10 release notes. Neither changes behavior.
- Reproducibility: exact pinned tree is local-only; tested behavior is present on published `origin/main`, which reports alpha.9.
- Evidence came post-reinitialization from an on-disk driver and direct CLI in an independent `--no-local` clone. No shared eval-kernel evidence supports this item.

## Inline evidence

Item #107 (`wb_01M0XNVN00DDFRQE66C5NN1XK8`) was `done` with `updated: 2026-09-03` and `completed: 2026-09-03`. A fresh-revision patch setting priority 2 with `date: 2026-09-05` returned exit 2, state unchanged, code `candidate-invalid`, and this complete-ledger validation error:

```json
{"field":"completed","code":"terminal-date-must-match-updated","message":"Field completed must equal updated for status done."}
```

Zero item bytes changed and the ledger remained valid. The identical patch with `date: 2026-09-03` succeeded and auto-committed. Independent done item #11 also accepted patch, snooze, and parent-migrate when each request used `date == updated`.

## Derived rule and source

`SPEC.md:201-207` requires transition `updated` and the active lifecycle date (`completed`, `killed`, `archived`, or `deferred`) to equal the transition date. `src/validate.js:906-915` enforces that equality as a standing whole-ledger invariant regardless of the verb producing candidate bytes. Patch sets `updated = request.date` (`docs/mutation-contract.md:2150`) while lifecycle dates are transition-owned (`:2151`); §9's date floor (`:1911`) rejects earlier dates. `src/mutation.js:1067` for snooze and `:1001` for parent-migrate likewise set `updated = request.date` without moving lifecycle dates. Later dates invalidate the candidate, earlier dates fail the request floor, so equality is the only legal value.

This response is through the contracted candidate-validation channel: section 8 precedence at `docs/mutation-contract.md:1822-1830` makes the complete-ledger validator the final authority, and section 10 at `:2290` defines `candidate-invalid` details as `id` plus `validation_errors`. Exit 2 and the error shape are correct. The diagnostic pointing at `completed` instead of request `date` is a recoverability/diagnosability gap, not a contract violation.

## Impact

A caller making a sanctioned title, priority, relation, body, parent, or snooze correction on a historical item must reuse the item's stale `updated` date, while current patch prose says later dates are allowed. The complete-ledger refusal does not explain that equality is the only recovery.

## Acceptance criteria

- Document the effective equality constraint for patch, snooze, and parent-migrate across done, killed, archived, and deferred items.
- Cross-reference `SPEC.md:201-207` and show an inspect-current-updated request example.
- Cross-link the parent-migrate help-text defect from this campaign so replacement help says any item may migrate, but a terminal item only at its current `updated`.
- Pin documentation tests.
- Do not remove the whole-ledger invariant, weaken terminal-date validation, or change the code-correct exit-2 candidate-invalid channel.

## Relation

#165 came from the same alpha10 exploratory campaign and shares the source/evidence pin; its root cause is different.

No fix is included. No production code was edited during this campaign. Implementation requires separate user-approved work.
