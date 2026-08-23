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
depends_on: [ wb_01M0NYNG00QCA6E7BRDP6QHMNS ]
related: []
---

Exercise the plugin as Claude Code loads it from this repository.

Acceptance criteria:
- Run claude plugin validate on the plugin manifest and marketplace manifest.
- Launch Claude Code with --plugin-dir . and confirm the wowbagger skill is discoverable under its namespace.
- Exercise the skill against this repository's ledger.
- Verify clear behavior for a missing core, wrong core version, wrong contract version, valid ledger, empty ready queue, read-only inspection, and an explicit mutation path.
- Record exact commands, observed results, and any submission-blocking defects.


Implementation outcome (2026-08-23):
- `claude plugin validate .` passed the marketplace manifest; the plugin manifest passed with the existing root CLAUDE.md warning.
- Valid local Claude smoke test returned version 0.1.0-alpha.8, contract 5, valid true, and ready count 0 with no repository mutation.
- Missing-core guidance stopped before ledger commands and gave the exact install/remediation path.
- Wrong distribution version and wrong contract version each stopped before ledger commands and reported the installed and required pins.
- Explicit mutation smoke test created and validated an isolated temporary item, then the scratch ledger was removed.
- Skills installer discovery found exactly one `wowbagger` skill.
