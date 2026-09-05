---
schema_version: 2
id: wb_01M1RWN4BWJZX6RCCZ9Z6HKYXA
number: 190
title: "Deliver a decision-focused report workspace"
kind: epic
priority: 20
status: done
created: 2026-09-05
updated: 2026-09-05
completed: 2026-09-05
provenance:
  source: "maintainer-dogfood"
  recorded_at: "2026-09-05T13:39:01.432Z"
depends_on: []
related: [ wb_01M056Z54S740925V6AFVXWV22 ]
decisions:
  - action: accept
    date: 2026-09-05
    summary: "Accept the approved report redesign work."
    rationale: "Lee approved the report design and requested independently specified, dependency-linked ledger work on 2026-09-05. Scope, ownership, interfaces, acceptance criteria, and verification are recorded in this item; start only when ready and assigned."
  - action: complete
    date: 2026-09-05
    summary: "Complete the decision-focused Wowbagger report redesign."
    rationale: "All nine direct children, items #191-#199, are done. The shipped report now provides one shared selection scope, one canonical item workspace, decision evidence and concentration views, interactive Flow drill-downs, a shared dependency graph, responsive controls, and deterministic offline output. Synthetic browser verification over 1,744 items met the usable-view and filter latency budgets; the complete Node 24 test and deprecation suites, adapter implementation proof, and ledger validation passed."
    rollup:
      - id: wb_01M1RWN4EHW20BP63XB2J8M03J
        status: done
      - id: wb_01M1RWN4GWEWBEPTPM9HF2EV77
        status: done
      - id: wb_01M1RWN4KMHYBBZPR1930Q271K
        status: done
      - id: wb_01M1RWN4P3CVAAEHP6T7B2WRE7
        status: done
      - id: wb_01M1RWN4RGC6D4JZWD8SFGFQ4F
        status: done
      - id: wb_01M1RWN4TXN0MAE4C6EFHEGKN0
        status: done
      - id: wb_01M1RWN4XSQ4YWBD5GRZDDQKWF
        status: done
      - id: wb_01M1RWN50G4QW1ZKV1R08KBEWK
        status: done
      - id: wb_01M1RWN53S9QGNE8S0W2S4PZK9
        status: done
---

## Outcome

Deliver the approved decision-focused, standalone wowbagger report: persistent controls, one item browser, explicit metadata, scoped Flow, and connected Dependencies. Lee approved this work and requested independently dispatchable children on 2026-09-05.

This is new work related to completed report task #85, not a reopening of it. The ledger has no previous report epic; done items have no reopen edge. Preserve #85's history.

## Approved design

Build one report with three main sections, presented as accessible view navigation:

1. **Items**, the default, containing compact summaries, an area/status matrix, quick views, one item list, and item details.
2. **Flow**, containing scoped cumulative flow, arrivals, completions, closures, age distribution, acceptance-to-completion durations, and the existing forecast with honest closure terminology.
3. **Dependencies**, containing the existing ledger graph and roster, connected to the shared selection and item details.

Put search and controls at the top, before any long content. Keep them available during scrolling on desktop and mobile. Preserve grouping, sorting, Basic/Standard/Detailed modes, Show history, Expand all, and Collapse all. Offer long facet lists through accessible expandable controls rather than a permanently expanded wall of chips.

Replace the separate Work next list with a quick view of the canonical list. Other quick views are In progress, Blocked, Needs triage, and All open. Recommendation reasons remain next to the item. Use a desktop list/detail split and narrow-screen inline details. Inspecting an item must not clear the user's search, filters, or list position.

Expose status and readiness independently. Expose configured metadata, including area and multi-value tags. Missing metadata must be visible as missing or invalid, not guessed from titles. Area/status concentrations describe recorded work, not measured customer pain.

Every summary and chart must state its scope and offer a route to its contributing items when the displayed value has item-level contributors. Forecast probabilities have no individual contributing-item set and must not pretend otherwise.

### Explicit exclusions

- No Beads or Jira API integration and no copying their implementation code or branding.
- No new ranking algorithm, opaque importance score, automatic reprioritization, or ledger mutation.
- No invented historical in-progress, blocked-duration, ownership, or feature-area transitions.
- No new lifecycle event storage. Full historical workflow bands require a separate approved change.
- No cross-repository edits, release, npm publication, or deployment in this plan.
- No general dashboard builder, saved browser views, account system, or framework migration.
- No prerequisite to run `/design`; the design is already approved. A generated browser artifact is still a required execution deliverable.

## Child work and dependency graph

| Plan task | Deliverable | Required predecessors |
| --- | --- | --- |
| T1 | Preserve report tags and expose metadata coverage | None |
| T3 | Scope report flow evidence and distinguish closures from completions | None |
| T5A | Derive report dependency impact independently of the UI | None |
| T2 | Share typed report filters and quick-view selection | T1 |
| T4 | Replace duplicated report lists with one item workspace | T2, T3 |
| T5B | Connect report area concentrations and blocker drilldowns | T4, T5A |
| T6 | Connect scoped Flow charts to their contributing report items | T5B |
| T7 | Connect Dependencies graph and roster to shared report scope | T5B |
| T8 | Verify report redesign with reproducible offline browser artifacts | T6, T7 |

T1, T3, and T5A can start concurrently. T2 starts as soon as T1 is done. T6 and T7 can run concurrently after T5B. T5A is split from the original T5 UI work so dependency analysis has an independent owner. Every child includes its own brief, interfaces, file boundaries, tests, and acceptance criteria; opening this epic or the source plan is not required to understand a child's assignment.

## Coordination

One worker per assigned worktree. Do not dispatch by claim exclusivity: this ledger is merge-coordinated and safe_exclusive_dispatch is false. The repository Orchestration Agent owns integration and shared-resource validation. Each child must honor its declared write set; do not introduce same-file concurrency. Serialize shared validation and preserve one behavioral RED/GREEN/REFACTOR cycle at a time. Child dependencies are recorded as real depends_on relations, not only prose.

## Completion acceptance

| ID | Required observable result | Owning tasks |
| --- | --- | --- |
| A01 | Search and access to all controls are available before scrolling and remain reachable at all three target widths | T4, T8 |
| A02 | Work next uses the canonical list; no second full backlog precedes search | T4 |
| A03 | Work next reasons and deterministic order remain unchanged apart from corrected leverage wording | T4, T5 |
| A04 | In-progress status and readiness are separately visible and filterable | T1, T2, T4 |
| A05 | Area and tags render, search, filter, and support named-view selection; missing/invalid data is explicit | T1, T2, T4 |
| A06 | Grouping, sorting, detail modes, Show history, Expand all, and Collapse all remain usable | T4 |
| A07 | Desktop split and mobile inline details preserve scope, selection, scroll context, and keyboard return | T4, T8 |
| A08 | Area/status and attention summaries open the correct item sets | T5 |
| A09 | Downstream reach and ready-if-done are distinct, correct, and do not alter core readiness/ranking | T5 |
| A10 | Flow cohorts share scope, including terminal history, without being silently limited to Work next | T3, T6 |
| A11 | Date boundaries, closures versus done, gap disclosures, and acceptance-to-completion labels are honest | T3, T6 |
| A12 | Chart drilldowns reproduce exact contributing IDs and can be cleared without resetting scope | T6 |
| A13 | Graph and roster share scope and open canonical details; no WebGL is still useful | T7 |
| A14 | Named reports never expose excluded bodies, metadata, nodes, or impact IDs | T1, T5, T7, T8 |
| A15 | Keyboard, focus, reduced motion, no-script reading, and print alternatives work | T4, T6, T7, T8 |
| A16 | Offline, CSP, safe Markdown/JSON, deterministic output, and atomic publication remain protected | T8 |
| A17 | Small and 1,744-item synthetic artifacts are reproducible, with measured browser performance | T8 |
| A18 | Existing forecast, attention facts, area-diverse batches, graph, and history remain available in the new navigation | T4, T5, T6, T7 |

Area-diverse batches stay in Items as a compact expandable planning summary. Intersect each existing batch with the scoped ready IDs and omit empty batches; do not introduce a new packing algorithm or recompute rankings. Label them Scoped members of existing batches. They must not become another full item-detail list. Preserve existing area/complexity eligibility and explain when mappings are missing. T4 owns placement and T5 owns scoped membership and its behavioral check.

The epic remains backlog while children execute. Complete it only after every direct child is done or deliberately killed with a recorded rationale, and all accepted end-to-end behavior is demonstrated. Browser proof, named-view exclusion, offline security, and the Node 24 gate are required. No production implementation, release, or consumer configuration is authorized by filing alone.

## Consumer boundary

The supplied PropertyCompass2 report had no mapped fields. Wowbagger can expose this gap but cannot reconstruct missing consumer metadata. Regeneration in that repository needs its own authorized worker and actual mapping inputs; do not access it under this epic's authority.

## Source

`docs/superpowers/plans/2026-09-05-decision-focused-report.md` (committed in `7dd4d90`). The original eight task areas are now nine standalone children, with unchanged feature scope.


## Numbered dispatch map

| Item | Deliverable | Required predecessors |
| --- | --- | --- |
| #191 | Preserve report tags and expose metadata coverage | None |
| #192 | Scope report flow evidence and distinguish closures from completions | None |
| #193 | Derive report dependency impact independently of the UI | None |
| #194 | Share typed report filters and quick-view selection | #191 |
| #195 | Replace duplicated report lists with one item workspace | #194, #192 |
| #196 | Connect report area concentrations and blocker drilldowns | #195, #193 |
| #197 | Connect scoped Flow charts to their contributing report items | #196 |
| #198 | Connect Dependencies graph and roster to shared report scope | #196 |
| #199 | Verify report redesign with reproducible offline browser artifacts | #197, #198 |

Initial parallel work: #191 metadata, #192 evidence, and #193 impact. #194 needs only #191. #195 needs #194 and #192; #196 needs #195 and #193. Then #197 Flow and #198 Dependencies can run concurrently. #199 performs final acceptance after both are done.

All nine children are accepted backlog items. No worker claim, production edit, release, push, or cross-repository mutation was performed while filing. The declared write sets were checked pairwise across every dependency-incomparable item pair; none overlap.
