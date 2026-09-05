---
schema_version: 2
id: wb_01M1QDTV00R9NXSNV1YQMN7S5C
number: 203
title: "Resolve external item identifiers without a canonical ID"
kind: task
priority: 20
status: backlog
created: 2026-09-05
updated: 2026-09-05
provenance:
  source: "PropertyCompass2 defect digest #200 heading 16 item 14"
  recorded_at: "2026-09-05T16:59:00Z"
depends_on: []
related: [ wb_01M03F6VBR77G64N0JQNPQ9K32 ]
tags:
  - "consumer-feedback"
  - "propertycompass2"
  - "defect-digest-200"
decisions:
  - action: accept
    date: 2026-09-05
    summary: "Accept external identifier resolution."
    rationale: "A bounded declared-binding lookup closes the migration gap without weakening canonical ID or number identity."
---

## Problem

`inspect` resolves only a canonical `wb_...` ID or schema-v2 number. A consumer that stores a legacy ID or another declared external binding cannot resolve it through a supported bounded read and must scan or parse the whole ledger itself.

## Reproduction

Given only a known legacy identifier or declared consumer binding, invoke the read surface without the canonical Wowbagger ID. No command maps that value to exactly one item, even when the binding is present in item metadata.

## Acceptance criteria

- A negotiated read surface resolves one declared external binding value to a canonical item ID and revision, or returns a stable not-found or ambiguity refusal.
- The binding field must be declared by ledger configuration; callers cannot request arbitrary filesystem paths or unbounded YAML searches.
- Duplicate binding values fail closed and identify the conflicting item IDs.
- The result is snapshot-bound and does not weaken number or canonical-ID identity rules.
- Documentation includes the migration use case from a legacy consumer identifier.
