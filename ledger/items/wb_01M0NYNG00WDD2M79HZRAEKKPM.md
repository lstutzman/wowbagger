---
schema_version: 2
id: wb_01M0NYNG00WDD2M79HZRAEKKPM
number: 141
title: "Smoke-test Claude plugin loading"
kind: task
priority: 2
status: triage
created: 2026-08-23
updated: 2026-08-23
provenance:
  source: "claude-plugin-submission"
  recorded_at: "2026-08-23T12:00:00Z"
depends_on: [wb_01M0NYNG00QCA6E7BRDP6QHMNS]
related: []
---

Exercise the plugin as Claude Code loads it from this repository.

Acceptance criteria:
- Run claude plugin validate on the plugin manifest and marketplace manifest.
- Launch Claude Code with --plugin-dir . and confirm the wowbagger skill is discoverable under its namespace.
- Exercise the skill against this repository's ledger.
- Verify clear behavior for a missing core, wrong core version, wrong contract version, valid ledger, empty ready queue, read-only inspection, and an explicit mutation path.
- Record exact commands, observed results, and any submission-blocking defects.
