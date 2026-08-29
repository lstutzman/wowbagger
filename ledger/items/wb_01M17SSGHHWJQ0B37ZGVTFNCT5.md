---
schema_version: 2
id: wb_01M17SSGHHWJQ0B37ZGVTFNCT5
number: 187
title: "Align journal capacity refusal reason with contract"
kind: task
priority: 2
status: triage
created: 2026-08-29
updated: 2026-08-29
provenance:
  source: "item #181 final review"
  recorded_at: "2026-08-29T22:25:00Z"
depends_on: []
related: [wb_01M14Y2VZW2ASKHYE42BGZ1PPK]
---
## Problem

The final #181 review confirmed a pre-existing contract/runtime disagreement. `docs/design/2026-08-10-fenced-work-claims-merge-coordinated.md` promises `error.details.reason: journal-capacity-exceeded` when the shared claim journal cannot reserve capacity. `withLegacyMutationFence` catches the same `CLAIM_JOURNAL_CAPACITY` failure through its generic non-lock path and returns `claim-store-unavailable` with `details.reason: claim-store-unreadable`. The mismatch applies to existing patch and transition writers and now to journal-fenced create.

This is not a #181 regression, but it is another case where contract text and running behavior diverge.

## Acceptance criteria

- Reproduce capacity exhaustion through a public claim-protected mutation without publishing item bytes.
- Decide whether runtime should emit the documented `journal-capacity-exceeded` reason or the design should adopt `claim-store-unreadable`; record the compatibility trade-off.
- If runtime changes, preserve exit 6, `state: unchanged`, exact command/domain, no item write, and durable prior journal bytes.
- Audit every caller that maps `CLAIM_JOURNAL_CAPACITY` so claim, legacy mutation, publication, adoption, and verification surfaces agree deliberately.
- Update contracts, installed skill guidance, adapter correlation, and release notes together where applicable.
- Add current Node and Node 20 public regressions at both the entry-count and byte limits.
