---
schema_version: 1
id: wb_01KZ77NSW8YFDJXSNTQ8FBB2F7
title: "Document Kimi and OpenAI-compatible harness integration"
kind: task
status: backlog
created: 2026-08-04
updated: 2026-08-04
provenance:
  source: "repository-backlog"
  recorded_at: "2026-08-04T20:33:09Z"
depends_on:
  - wb_01KZ77NSW876B92APQN8Q8NK6X
  - wb_01KZ77NSW8CG8NMNZ726CFKWQE
related: []
parent: wb_01KZ77NSW8PNA4S48NYT26AGMH
decisions:
  - action: accept
    date: 2026-08-04
    summary: "Kimi and other OpenAI-compatible harness guidance is accepted."
    rationale: "OpenAI-compatible model transport alone does not guarantee the agent tools that Wowbagger needs."
---

Document how Kimi, including Kimi K3 where applicable, and other
OpenAI-compatible model hosts can integrate when their harness provides the
required repository filesystem and command-execution tools. Do not claim
compatibility merely from an API format.
