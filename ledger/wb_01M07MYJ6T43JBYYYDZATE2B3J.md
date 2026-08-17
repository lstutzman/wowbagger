---
schema_version: 2
id: wb_01M07MYJ6T43JBYYYDZATE2B3J
number: 115
title: "Document epic progress as derived from children"
kind: task
priority: 2
status: backlog
created: 2026-08-17
updated: 2026-08-17
provenance:
  source: "maintainer-dogfood"
  recorded_at: "2026-08-17T10:40:49Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-17
    summary: "Accept into the backlog."
    rationale: "Dual-run drift audits report a permanent false positive on active epics; the consumer prefers the derivation model stated over the edge opened."
---

Field design conflict from PropertyCompass2's dual-run drift audit on alpha.5 (their worktree 260816-191701; 1,572 legacy vs 1,574 ledger items): exactly one status disagreement, and it is structural, not drift. Legacy epic #1075 is in-progress since 2026-06-16; the ledger mirror (wb_01KTSZN100WNMQHWN8EEECR29X) is backlog and cannot follow - "Epics never enter in-progress" is a deliberate contract rule (allowed-edges table has task backlog->in-progress and no epic equivalent). Consequence: an epic under active work is UNREPRESENTABLE, so any drift audit against a store that models epic activity reports a permanent false positive, and whitelisting epics blinds the audit to genuine epic-status errors.

Consumer's explicit preference, adopted as this item's binding direction: do NOT open the edge. State the derivation model in the contract instead, so a mirror compares derived-vs-derived.

Scope:
1. The contract (mutation contract, beside the allowed-edges table where the prohibition lives) states the model: an epic stores no progress; its progress is DERIVED from its direct children. Define the derivation precisely so two independent implementations agree:
   - terminal ratio: children with status done or killed over all direct children (the same ratio the report's epic-enablement factor and the epic complete rollup already use - cite both so the contract, report layer, and rollup provably share one definition);
   - activity: an epic is "active" exactly when at least one direct child is in-progress or holds an active work claim; "untouched" when no child has left backlog/triage; otherwise "in progress by derivation".
2. State the mirror guidance explicitly: a consumer mirroring a store that models epic activity compares its stored epic status against the DERIVED state, never against the ledger's stored status field. One worked example (the #1075 shape: legacy in-progress vs derived-active) in the contract or the skill.
3. Cross-reference from the edge table so the prohibition reads as the model it is, not an omission: one sentence pointing at the derivation section.
4. Decide whether any machine surface should expose the derived value (report model already carries epic enablement; inspect does not). Bias: documenting the computation over ledger bytes is enough - a consumer audit already loads items; adding a derived member to inspect is a wire change needing its own justification. Record the decision either way.
5. Docs guard test pinning the derivation definition and the cross-reference.

Acceptance:
- The contract defines epic derived progress and activity precisely enough that the consumer's audit can compute it from item bytes alone; the worked example covers the in-progress-epic mirror case.
- The edge-table prohibition cross-references the model; docs guard red when either half is removed.
- No lifecycle edge added or changed; no wire change (or the recorded decision to add one, with its own argument).
- Gate green on both runtimes.
