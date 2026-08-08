---
schema_version: 1
id: wb_01KZBT44T4EFEJH07G1AB07A1Y
priority: 40
number: 24
title: "Deliver the opencode adapter"
kind: task
status: backlog
created: 2026-08-06
updated: 2026-08-08
provenance:
  source: "repository-backlog"
  recorded_at: "2026-08-06T15:12:29Z"
depends_on: []
related: []
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
decisions:
  - action: accept
    date: 2026-08-06
    summary: "Accept into the productization epic."
    rationale: "Filed so the work is tracked in wowbagger's own ledger rather than in a session transcript."
  - action: record
    date: 2026-08-08
    summary: "Rank the opencode adapter at 40."
    rationale: "Third adapter. Same reasoning as the second, one step further out."
---

Build an opencode integration that invokes the common core contract and passes
the shared adapter conformance evidence.

opencode is a compatibility target alongside Claude Code, Codex, and
Kimi/OpenAI-compatible harnesses, and is the only one of the four with no item
of its own. The adapter contract in docs/adapter-contract.md defines the
required host capabilities and refusal rules; the conformance vectors in
spec/fixtures/adapters define what passing means.

Before building, confirm what opencode actually provides: the adapter contract
requires repository filesystem access and command execution, and a harness that
supplies only a model transport is a negative profile, not a target.
