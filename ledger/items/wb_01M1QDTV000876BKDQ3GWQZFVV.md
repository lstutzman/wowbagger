---
schema_version: 2
id: wb_01M1QDTV000876BKDQ3GWQZFVV
number: 207
title: "Define who records adopted-by identity"
kind: task
priority: 20
status: triage
created: 2026-09-05
updated: 2026-09-05
provenance:
  source: "PropertyCompass2 defect digest #200 heading 24 item 32"
  recorded_at: "2026-09-05T16:59:00Z"
depends_on: []
related: [wb_01M07J8W5TS6PVKFZ1T4RTN184]
tags:
  - "consumer-feedback"
  - "propertycompass2"
  - "defect-digest-200"
  - "documentation"
---

## Problem

The adoption record requires `adopted_by`, but consumer guidance does not say whether it names the acting agent session, the supervising human, or another durable actor identity. Different callers therefore write incomparable values into shared history.

## Reproduction

Ask two cooperating agents to adopt the same class of authorized revision without an explicit local convention. One can stamp its session identity while another stamps the human operator; both satisfy the string shape but the audit trail has no stable meaning.

## Acceptance criteria

- The work-claim contract and installed skill define the actor represented by `adopted_by`.
- Guidance covers autonomous agent sessions, a human directly invoking the CLI, and an agent acting under human approval.
- The convention separates the actor that executed the adoption from approval evidence instead of overloading one string.
- Existing adoption rows remain valid; any wire change is additive and versioned according to the contract.
- Examples use stable non-secret identifiers and forbid credentials, email addresses unless intentionally public, and free-form approval claims.
