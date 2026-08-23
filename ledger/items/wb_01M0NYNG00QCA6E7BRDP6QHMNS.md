---
schema_version: 2
id: wb_01M0NYNG00QCA6E7BRDP6QHMNS
number: 140
title: "Add Claude plugin core setup guidance"
kind: task
priority: 1
status: triage
created: 2026-08-23
updated: 2026-08-23
provenance:
  source: "claude-plugin-submission"
  recorded_at: "2026-08-23T12:00:00Z"
depends_on: []
related: []
---

Add explicit onboarding for the Claude plugin's separately installed Wowbagger core.

Acceptance criteria:
- State Node.js >=20, required core 0.1.0-alpha.8, and contract_version 5.
- Give exact install, upgrade, and verification commands.
- Explain that the plugin does not bundle the core and does not use MCP, hooks, remote services, or background processes.
- Describe local Git/Markdown ledger access and the explicit mutation boundary.
- Make missing or incompatible core guidance actionable without weakening version checks.
- Keep plugin metadata, skill pins, README, and release tag references synchronized.
