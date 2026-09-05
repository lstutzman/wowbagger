---
schema_version: 2
id: wb_01M1QDTV002BGJXGT2JFKF5Y3D
number: 201
title: "Diagnose incompatible claim-journal writer versions"
kind: task
priority: 10
status: backlog
created: 2026-09-05
updated: 2026-09-05
provenance:
  source: "PropertyCompass2 defect digest #200 heading 3 item 27"
  recorded_at: "2026-09-05T16:59:00Z"
depends_on: []
related: [ wb_01M14Y2VZW2ASKHYE42BGZ1PPK ]
tags:
  - "consumer-feedback"
  - "propertycompass2"
  - "defect-digest-200"
decisions:
  - action: accept
    date: 2026-09-05
    summary: "Accept incompatible journal diagnosis."
    rationale: "The consumer reproduction shows a generic unreadable-store refusal where version-specific remediation is actionable and separate from local skill drift."
---

## Problem

When one worktree reads claim-journal or reconciliation data written by an incompatible Wowbagger core, mutation can fail as generic `claim-store-unavailable` with reason `claim-store-unreadable`. The response does not distinguish a newer writer from corrupt persistence and gives no version-specific recovery. Item #185 detects local skill/core drift but does not identify foreign journal grammar.

## Reproduction

1. Let one writer in a shared Git coordination domain append a claim-journal entry with a newer unsupported grammar.
2. Run a claim-protected mutation from an older or otherwise incompatible reader.
3. Observe generic `claim-store-unreadable` instead of a protocol diagnosis.

## Acceptance criteria

- Unsupported claim-journal grammar has a stable protocol-specific code or reason distinct from damaged persistence.
- Diagnostics name the observed entry version or type, the reader's supported version, and the shared journal path role without exposing unsafe absolute paths.
- Remediation tells the operator to upgrade every writer in the Git coordination domain before retrying; it never recommends truncating or hand-editing the journal.
- Corrupt JSON and real persistence failures keep their existing distinct safety behavior.
- Mixed-version fixtures prove unchanged bytes and no journal append on refusal.
