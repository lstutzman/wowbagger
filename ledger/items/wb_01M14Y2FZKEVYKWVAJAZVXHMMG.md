---
schema_version: 2
id: wb_01M14Y2FZKEVYKWVAJAZVXHMMG
number: 184
title: "Scope claim verification away from unrelated active work"
kind: task
priority: 1
status: triage
created: 2026-08-28
updated: 2026-08-29
provenance:
  source: "PropertyCompass2 field failures"
  recorded_at: "2026-08-28T19:38:40Z"
depends_on: []
related: [ wb_01M0XNVN00ABNA2SZ7WHM0FRX7, wb_01M12GT91WYNWHTYRBV7Y5R9E3, wb_01M13SBJHZABPX0QTNCFEGYMWM ]
---
## Problem

PropertyCompass2 reports `claim-verify` globally `ok: false` because unrelated active or unpublished work on `wb_01M0A87PW9619RB39QGNE0HP0W` / #1638, owner `feature/1638-governed-content-editor`, is visible from every worktree. Unrelated create, transition, and patch operations committed correctly, but the installed skill's required verify-exit-0 gate could not be satisfied.

This is target-scoping lineage: #172 established unrelated synchronization as nonblocking for mutations, #179 corrected a global barrier incorrectly downgraded to advisory, and #178 maps target versus unrelated scope across the complete matrix. This field failure may be a new cell, a consumer-visible manifestation already covered by #178, or evidence that mutation scoping is correct while repository-wide verification needs a different success model. Closing this item as already covered by #178 is legitimate if public behavior and skill guidance become usable.

Determine whether current behavior is a Wowbagger defect reachable through ordinary cooperating use or an intended repository-wide diagnostic misapplied by the consumer skill.

## Acceptance criteria

- Reproduce the reported active/unpublished foreign-work state through public claim and mutation commands.
- Separate target-blocking findings from unrelated or foreign active work without hiding either.
- Choose a supported surface: item-scoped `claim-verify`, target-aware verification input, or repository-wide `ok: true` with structured `foreign_claims` warnings.
- Preserve a strict repository-wide mode for operators who need every unresolved publication and claim.
- Update auto-commit, claimed publication, and installed skill gates to consume the correct scope rather than requiring an impossible globally empty result.
- Public tests prove unrelated work remains visible, target work still blocks, and a consumer can reach a successful required gate.

## Assessment after #178 — 2026-08-29

#178 does not close this item. It preserved `claim-verify` as a repository-wide diagnostic: any blocking finding anywhere still makes verification exit nonzero. #178 made every item-reconciling mutation caller consume the same worktree evidence and preserved target-scoped mutation and auto-commit availability for genuine unrelated synchronization, but that does not make the consumer's required global verify-exit-0 gate attainable while unrelated findings remain.

The hypothesis that this field failure was already covered by #178 was tested and rejected. This item remains triage for a dedicated design: item-scoped verification, target-aware input, or repository-wide success with structured foreign warnings, while retaining a strict whole-repository mode. Task 9 of #178 documents the current distinction so consumers do not confuse successful target-scoped mutation proof with a globally clean claim store.
