---
schema_version: 2
id: wb_01M0NYNG00QCA6E7BRDP6QHMNS
number: 140
title: "Add Claude plugin core setup guidance"
kind: task
priority: 1
status: done
created: 2026-08-23
updated: 2026-08-23
completed: 2026-08-23
provenance:
  source: "claude-plugin-submission"
  recorded_at: "2026-08-23T12:00:00Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-23
    summary: "Accept the Claude plugin setup guidance into the backlog."
    rationale: "The core setup boundary and exact alpha.8/contract 5 checks are now documented and verified."
  - action: complete
    date: 2026-08-23
    summary: "Complete the Claude plugin core setup guidance."
    rationale: "README and the installed Wowbagger skill now give exact Node.js, distribution, contract, installation, verification, and separate-core guidance. Validation passed."
---

Add explicit onboarding for the Claude plugin's separately installed Wowbagger core.

Acceptance criteria:
- State Node.js >=20, required core 0.1.0-alpha.8, and contract_version 5.
- Give exact install, upgrade, and verification commands.
- Explain that the plugin does not bundle the core and does not use MCP, hooks, remote services, or background processes.
- Describe local Git/Markdown ledger access and the explicit mutation boundary.
- Make missing or incompatible core guidance actionable without weakening version checks.
- Keep plugin metadata, skill pins, README, and release tag references synchronized.


Implementation outcome (2026-08-23):
- Added exact Node.js 20+, core 0.1.0-alpha.8, and contract_version 5 setup guidance to README.md and skills/wowbagger/SKILL.md.
- Documented separate-core operation and absence of bundled MCP, hooks, remote service, and background process.
- Verification passed: Claude marketplace validation, core version/capability check, ledger validation, and diff whitespace check.
- Commit: da7bd31.
