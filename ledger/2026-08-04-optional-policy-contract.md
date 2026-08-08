---
schema_version: 1
id: wb_01KZ77NSW8A25Q593G7RTX7TAH
number: 5
title: "Define the optional policy-input contract"
kind: task
status: done
created: 2026-08-04
updated: 2026-08-08
completed: 2026-08-08
provenance:
  source: "repository-backlog"
  recorded_at: "2026-08-04T20:33:09Z"
depends_on: []
related:
  - wb_01KZ77NSW876B92APQN8Q8NK6X
parent: wb_01KZ77NSW8PNA4S48NYT26AGMH
decisions:
  - action: accept
    date: 2026-08-04
    summary: "Optional policy-input work is accepted."
    rationale: "The standalone v0 plan keeps consumer ranking and enrichment separate from core readiness."
  - action: record
    date: 2026-08-05
    summary: "The mechanism and policy seam from PropertyCompass2 backlog item 1421 is folded into this item."
    rationale: "1421 held the concrete seam this item described abstractly; recording it here avoids a second overlapping item."
  - action: complete
    date: 2026-08-08
    summary: "Completed: docs/policy-input-contract.md defines the mechanism-policy seam."
    rationale: "The contract states the one core-steering input — priority, written through create and patch under the guarded mutation surface — and the decoration channel — extension members the core preserves losslessly and never interprets. It names what policy must never do: change validity or readiness membership, impersonate the byte-normative ready result, or write around the mutation surface. Consumer vocabulary (rubrics, anchors, tiers, globs — the PropertyCompass 1421 seam recorded on this item) stays consumer-side by construction. The version 1 adapter surface keeps optional_features.policy false; advertising a policy feature is an adapter contract version change, following the path recorded for patch."
---

Specify how optional consumer policy may rank or decorate valid core readiness
without changing ledger validity or core selection. This is not a place to add
consumer-specific policy.

The seam separates mechanism from policy:

- Mechanism belongs to the core: the weighted three-factor rubric, bonus and
  partition ordering, confidence signals, tie-breaks, mode workflows, and
  per-type templates.
- Policy belongs to the consuming repository: scoring anchors naming that
  consumer's own features, its area and tier vocabularies, and its source
  globs.

A consuming repository's specific vocabulary is never absorbed into the core.
