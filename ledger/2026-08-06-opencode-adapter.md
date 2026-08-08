---
schema_version: 1
id: wb_01KZBT44T4EFEJH07G1AB07A1Y
number: 24
title: "Deliver the opencode adapter"
kind: task
status: done
created: 2026-08-06
updated: 2026-08-08
completed: 2026-08-08
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
  - action: complete
    date: 2026-08-08
    summary: "Completed: the opencode adapter ships at parity, and the harness precondition was confirmed first."
    rationale: "Per this item's own precondition, opencode's host surface was confirmed from its current documentation before building: it provides shell command execution and read/edit/glob/grep filesystem tools under a permission-gated approval model — a positive profile, not a model-transport-only host. adapters/opencode rides the shared entrypoint runtime with its own identity and honest declaration; all fifteen vector manifests now list the opencode target, the roster pin in the vectors test was widened deliberately, and the runner reports opencode across 183 assertions at the same 79-evidenced Plan 1 profile as claude-code and codex. The remainder is the shared engine's Plans 2 and 3, tracked by item 13, landing for every adapter at once."
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
