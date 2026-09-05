---
schema_version: 2
id: wb_01M1QDTV00PR7QAF41XVT8Q10K
number: 202
title: "Document lossless parsing of inspect source bytes"
kind: task
priority: 20
status: triage
created: 2026-09-05
updated: 2026-09-05
provenance:
  source: "PropertyCompass2 defect digest #200 heading 9"
  recorded_at: "2026-09-05T16:59:00Z"
depends_on: []
related: [wb_01M07V3M3AHKRPAYYNBV8V7DTF]
tags:
  - "consumer-feedback"
  - "propertycompass2"
  - "defect-digest-200"
  - "documentation"
---

## Problem

`inspect` exposes normalized core fields and exact `source_base64`, but consumer-owned extension values can require decoding and parsing the Markdown frontmatter. The contract says those values are recoverable but gives no supported helper or copyable parsing recipe, so consumers risk inconsistent YAML and byte handling.

## Reproduction

Inspect an item containing consumer-owned extension fields that are omitted from `core`. A consumer can recover them only by choosing its own Base64, UTF-8, frontmatter-boundary, and YAML parsing behavior.

## Acceptance criteria

- Public consumer guidance includes one supported helper or complete documented Node.js recipe that decodes canonical `source_base64` and parses frontmatter without changing bytes.
- The guidance distinguishes normalized `core`, exact `body`, and extension data recoverable only from source.
- The recipe rejects malformed UTF-8 or frontmatter using the same accepted language subset as Wowbagger instead of silently normalizing it.
- A documentation fixture or executable example covers an extension value not present in `core`.
