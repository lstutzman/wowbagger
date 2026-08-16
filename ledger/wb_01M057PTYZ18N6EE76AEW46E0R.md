---
schema_version: 2
id: wb_01M057PTYZ18N6EE76AEW46E0R
number: 88
title: "Document and message the commit-per-mutation invariant"
kind: task
priority: 1
status: in-progress
created: 2026-08-16
updated: 2026-08-16
provenance:
  source: "consumer-field-feedback"
  recorded_at: "2026-08-16T00:00:00.000Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-16
    summary: "Accept the PropertyCompass2 field finding into the backlog."
    rationale: "First real production session (21 creates, 27 transitions, alpha.4) recorded this in docs/wowbagger-feedback.md (PR #2196). Verified against this repo source before filing."
---
Field blocker 1 from PropertyCompass2 dual-run (21 creates/27 transitions, alpha.4; report: .PropertyCompass2/worktrees/260815-212735/docs/wowbagger-feedback.md, PR #2196; independently reproduced in this repo on 2026-08-16 filing items #86/#87). On a provisioned ledger the durable claim store validates each prior mutation at git HEAD, so an uncommitted prior item makes every next create fail exit 6 `claim-store-unavailable` / `publication-reconciliation-required` / `stale-write-detected` with `actual_revision: null`. The invariant - every mutation must be Git-committed before the next mutating command - is documented NOWHERE (not SPEC.md, not mutation-contract.md, not the skill). The consumer burned four failed cycles and an aborted 20-item batch discovering it.

The remedy verb already exists (`claim-verify`) and current source emits `remediation` strings naming it (claim-publication.js), but the alpha.4 envelope the consumer saw carried no remediation, and discoverability failed: `reason: publication-reconciliation-required` names a procedure the CLI surface never mentions.

Scope:
1. Document the commit-per-mutation invariant loudly: mutation contract, work-claim contract, README workflow, and the installed skill's claimed and unclaimed loops (write -> commit -> claim-verify -> next write).
2. Audit every `claim-store-unavailable` refusal path - especially the legacy-fence create/transition path - so each finding carries the `remediation` string naming the exact file to commit and `claim-verify`.
3. Document `claim-verify` as THE reconciliation procedure next to every mention of `publication-reconciliation-required` (field issue 3: consumers looked for a reconcile verb and could not find one).
4. Record the considered-and-rejected alternative: validating against working-tree bytes instead of HEAD would erase the durability guarantee the journal exists for; the invariant stays, it just becomes visible.

Acceptance:
- A fixture-driven test asserts the create-path refusal envelope carries findings[].remediation naming the uncommitted path and claim-verify.
- Mutation contract and skill state the invariant; the skill loops include the commit step explicitly.
- Field report issues 1 and 3 are answerable from shipped docs alone.