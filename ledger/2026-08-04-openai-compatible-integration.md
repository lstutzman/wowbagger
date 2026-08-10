---
schema_version: 2
id: wb_01KZ77NSW8YFDJXSNTQ8FBB2F7
number: 12
title: "Document Kimi and OpenAI-compatible harness integration"
kind: task
status: done
created: 2026-08-04
updated: 2026-08-08
completed: 2026-08-08
provenance:
  source: "repository-backlog"
  recorded_at: "2026-08-04T20:33:09Z"
depends_on: []
related:
  - wb_01KZ77NSW876B92APQN8Q8NK6X
  - wb_01KZ77NSW8CG8NMNZ726CFKWQE
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
decisions:
  - action: accept
    date: 2026-08-04
    summary: "Kimi and other OpenAI-compatible harness guidance is accepted."
    rationale: "OpenAI-compatible model transport alone does not guarantee the agent tools that Wowbagger needs."
  - action: reparent
    date: 2026-08-06
    summary: "Moved from the standalone v0 epic to the productization epic."
    rationale: "This is consumability work, not core work. Separating them lets the v0 epic close when the core is done instead of dragging distribution along with it."
  - action: complete
    date: 2026-08-08
    summary: "Completed: docs/openai-compatible-integration.md documents both honest paths and forbids the API-format claim."
    rationale: "The guide separates model transport from harness, states the host surface an integration stands on, and documents the two real paths: driving the core CLI directly today with the agent's own discipline substituting for adapter guarantees, and authoring an adapter package on the shared entrypoint runtime for a verifiable claim — the codex package is the template, the vectors already list kimi and openai-compatible-harness targets, and the runner takes --target. What may not be claimed is stated in its own section, per this item's constraint. Item 11's satisfied dependency edge moved to related."
---

Document how Kimi, including Kimi K3 where applicable, and other
OpenAI-compatible model hosts can integrate when their harness provides the
required repository filesystem and command-execution tools. Do not claim
compatibility merely from an API format.
