---
schema_version: 2
id: wb_01M1AHV80082SWNMNQBEEMYR4X
number: 189
title: "Design GitHub canonical intake integration"
kind: task
priority: 1
status: triage
created: 2026-08-31
updated: 2026-08-31
provenance:
  source: "github-issues-concurrency-evaluation"
  recorded_at: "2026-08-31T12:00:00Z"
depends_on: []
related: []
---

Design and implement a GitHub Issues intake integration that prevents duplicate work requests while preserving Wowbagger's agent-native execution guarantees.

Problem:
- Multiple agents can independently create semantically duplicate work requests because local ledgers are not a centralized intake store.
- GitHub Issues provides repository-scoped identity, shared visibility, discussion, and cross-machine access, but search-before-create alone still has a race.

Initial direction:
- GitHub Issues is canonical for public intake, discussion, issue identity, assignees, labels, and project planning.
- Only accepted agent-executable work is projected into Wowbagger.
- Wowbagger remains authoritative for readiness, local ledger validation, CAS-guarded mutations, claims, fencing, publication, and reconciliation.
- Avoid bidirectional automatic synchronization and duplicate mutable sources of truth.

Acceptance criteria:
- Define the canonical GitHub issue identity and deterministic deduplication key.
- Define a serialized or idempotent intake writer; search-before-create without a race-safe writer is insufficient.
- Define the GitHub-to-Wowbagger projection and the reverse execution-outcome link.
- Define field ownership, edits, closure, deletion, retries, response loss, and drift handling.
- Preserve current Wowbagger scope and fail-closed guarantees; do not claim cross-machine coordination that the core does not provide.
- Verify the design against GitHub Issues/Projects APIs and current Wowbagger contract 5.
