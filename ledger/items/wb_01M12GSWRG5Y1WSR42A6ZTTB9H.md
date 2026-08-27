---
schema_version: 2
id: wb_01M12GSWRG5Y1WSR42A6ZTTB9H
number: 177
title: "Keep detached HEAD ownership regressions blocking"
kind: task
priority: 1
status: triage
created: 2026-08-27
updated: 2026-08-27
provenance:
  source: "no-mistakes/01M12F0YXS2QA72BQTTFABB5M6/review"
  recorded_at: "2026-08-27T21:00:00Z"
depends_on: []
related: []
---
## Problem

`findRevisionOwner` marks current ownership only through `git symbolic-ref HEAD`. A detached checkout has no symbolic ref, so if it contains the expected revision and its working tree is restored to an earlier authorized revision, reconciliation can misclassify the local regression as nonblocking sibling synchronization instead of `unauthorized-revision`.

## Acceptance criteria

- A public `claim-verify --json` RED uses detached HEAD containing the expected revision plus restored authorized predecessor bytes.
- Claim verification exits 6 with `unauthorized-revision`, and an unrelated mutation is refused.
- A named-branch current owner has the same classification.
- A true sibling expected revision still reports named `owner_ref` and `owner_commit`.
- An expected revision not yet committed remains `owner_unavailable: true`.
- Documented detached-HEAD support remains true.
- Full current Node, Node 20, adapter, and ledger gates pass.
