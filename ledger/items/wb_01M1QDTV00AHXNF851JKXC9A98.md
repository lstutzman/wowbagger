---
schema_version: 2
id: wb_01M1QDTV00AHXNF851JKXC9A98
number: 210
title: "Separate byte verification from adoption-history sync"
kind: task
priority: 20
status: backlog
created: 2026-09-05
updated: 2026-09-05
provenance:
  source: "PropertyCompass2 defect digest #200 heading 25 item 1476 contract clarification"
  recorded_at: "2026-09-05T16:59:00Z"
depends_on: []
related: [ wb_01M0N3KM316P7MBJTA1A5X29J4, wb_01M0Z48K7N8F12SY8AE2GW3XHE ]
tags:
  - "consumer-feedback"
  - "propertycompass2"
  - "defect-digest-200"
  - "documentation"
decisions:
  - action: accept
    date: 2026-09-05
    summary: "Accept verification and sync clarification."
    rationale: "Current-byte verification and adoption-history synchronization are distinct gates and consumer guidance must state that explicitly."
---

## Problem

Consumer guidance does not state clearly that passing `claim-verify` does not imply `claim-sync` will pass. Verification judges current ledger bytes and coordination evidence; sync validates adoption history. Operators can therefore treat a byte-level success as proof that histories are mergeable.

## Accepted evidence boundary

Property Compass item #1476 has current in-protocol bytes at later revision `094c3fc3` while earlier adoption rows conflict. Its bytes and historical rows are accepted as-is and must not be repaired by this documentation item.

## Acceptance criteria

- The work-claim contract and installed skill state that `claim-verify` success does not imply `claim-sync` success.
- Guidance defines verification as current-byte and coordination-state analysis, and adoption sync as history-level merge analysis.
- One worked example shows current bytes verifying while sync refuses a conflicting or cyclic adoption history.
- Recovery instructions keep byte repair and history audit separate and never prescribe re-adoption solely to make sync pass.
- Contract fixtures or documentation tests pin the distinction without changing response envelopes.
