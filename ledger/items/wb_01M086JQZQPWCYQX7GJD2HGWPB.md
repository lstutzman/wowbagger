---
schema_version: 2
id: wb_01M086JQZQPWCYQX7GJD2HGWPB
number: 125
title: "Author end-to-end core-outcome vectors for the adapters"
kind: task
priority: 10
status: done
created: 2026-08-17
updated: 2026-08-17
completed: 2026-08-17
provenance:
  source: "maintainer-dogfood"
  recorded_at: "2026-08-17T00:00:00.000Z"
depends_on: [ wb_01M086JMQNGZM5WFGB9PM3M2P6 ]
related: []
decisions:
  - action: accept
    date: 2026-08-17
    summary: "Accept into the backlog."
    rationale: "Ideation survivor: the conformance gap that let two real adapter defects ship; depends on #120's approval plumbing."
  - action: complete
    date: 2026-08-17
    summary: "Nine real-core e2e vectors shipped; third shipped adapter defect fixed."
    rationale: "Case 16-core-outcome-e2e: nine hand-authored scenarios spawn the real entrypoint against the real core with dual isolated workspaces, derived_from pins, and a granting conformance host; all three enrichment regression shapes proven red. Found and fixed the shipped patch grammar never widening past number+priority - every real consumer patch returned mutation-outcome-unknown on a committed write. Also surfaced that item #120's branch had never merged to main (orchestrator merge-loop error-swallowing); carried in here. 210 conformance assertions, both runtimes 1398/1398."
---

Ideation survivor 4 of 5 (2026-08-17). Full design basis: docs/ideation/2026-08-17-open-ideation.md and the Sol enrichment at docs/ideation/enrichments/2026-08-17-vectors.md - the enrichment is the authoritative scope; this body is its summary. DEPENDS on the adapter approval-plumbing defect item: real mutations cannot cross the shipped entrypoint until a host approval provider exists.

End-to-end core-outcome vectors: one new equivalence case in the adapter conformance suite (~9 hand-authored core-baseline scenarios) that spawns the REAL adapter entrypoint over the bootstrap wire against the REAL core:

- Scenarios: inspect item-not-found; create/transition committed; patch committed (body replacement + declared extension); the six-member date refusal; all three ledger-mutation claim-fence refusal classes (the correct name for what the raw idea called publish-claimed refusals - publish-claimed is not an adapter command). state:unknown stays synthetic in case 11.
- Determinism by fixed INPUTS, never output normalization: caller-supplied ULIDs (fixes created), seeded revisions/numbers on isolated temp ledgers, literal dates, fixed namespace + hand-authored journal + seeded future clock floor for fence refusals (advanceClockFloor makes observed_at deterministic), dual isolated workspaces per assertion (baseline and adapter must not share), hand-authored canonical expected bytes with only base64/sha/length mechanically derived.
- The tautology bright line (binding): implementation code may EXECUTE a vector, never AUTHOR its expectation. Goldens come from the contract, the independent oracle, and existing normative mutation fixtures (with derived_from hashes so drift is a review, not a regeneration). Forbidden: importing process-outcome/invoke/serializers to produce expectations, recording passing runs as goldens, auto-refresh, field masking.
- Regression proofs required in acceptance: temporarily reintroduce each of the three known defect shapes (the pre-643ff88 read-command gate; the four-member issue set; removal of namespace-first fence dispatch) and show the new vectors go red.
- Prerequisite prose fix folded in: docs/adapter-contract.md's command/approval tables omit patch (lines ~228, ~526) while the v2 table includes it - correct before authoring from the prose.

History corrections the enrichment established (keep the record honest): the inspect-refusal defect lived about a week, not months; the widened-date shape never shipped broken; the third real shipped defect was fence dispatch.

Acceptance: the enrichment's criteria verbatim (section 5), including the child-process audit (no process_observation injection), approval bound to actual temp paths, two-consecutive-run byte determinism on both runtimes, and the measured runtime delta reported (~27 extra core spawns expected).
