---
schema_version: 2
id: wb_01M057Q7ATYMR2DD5V62KHRNA0
number: 92
title: "Unify mutation envelope shape across refusal paths"
kind: task
status: backlog
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
Field paper-cut 6 (PropertyCompass2 report, PR #2196), verified in source: claim-fence refusals emit `namespace: ledger-mutation`, `command: create-v1`, `contract_version: 1` (src/claim-coordinator.js) while the same command's success and non-fence refusals emit `command: create`, `contract_version: 2`; `validate --json` emits a bare `{valid,errors}` with no envelope at all. A generic JSON consumer cannot dispatch by the documented rule (command namespace + version field) because shapes disagree within one runtime and with the mutation-contract doc.

Scope: one documented envelope rule, then make every surface follow it. The claim-fence refusal keeps its legacy-claim-envelope semantics only if the contract documents that split explicitly; otherwise re-wrap fence refusals in the core v2 envelope with the claim detail nested. Decide `validate`'s shape (bare object is load-bearing for scripts and pinned by fixtures - if it stays bare, the contract must say so). Any change here is contract-sensitive: consumers parse these bytes, so the decision needs the same care as a schema gate - document, version-note, and pin with fixtures either way.

Acceptance:
- The mutation contract states the exact envelope for every command's success and every refusal class, including the fence path and validate.
- Fixtures pin each documented shape; the oracle rejects drift in either direction.
- The consumer's dispatch rule (by command + version field) works against every emitted envelope, demonstrated by a test that walks all refusal classes.