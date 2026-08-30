---
schema_version: 2
id: wb_01M0NYNG00BPDH11YY02RY0Q7V
number: 142
title: "Submit Wowbagger to Claude plugin directory"
kind: task
priority: 3
status: in-progress
created: 2026-08-23
updated: 2026-08-30
provenance:
  source: "claude-plugin-submission"
  recorded_at: "2026-08-23T12:00:00Z"
depends_on: [ wb_01M0NYNG00WDD2M79HZRAEKKPM ]
related: []
decisions:
  - action: accept
    date: 2026-08-23
    summary: "Accept the submitted Claude plugin directory work for review."
    rationale: "The public repository was submitted through Claude Console with Claude Code selected. The form confirmed submission for review; marketplace acceptance remains pending."
---
Submit the public Wowbagger GitHub repository to Anthropic's Claude plugin directory after setup guidance and smoke testing pass.

Acceptance criteria:
- Use the official Claude.ai or Console plugin submission form.
- Submit the public repository URL and current release metadata.
- Record the submission date, destination, and review status without exposing credentials.
- If accepted, verify the plugin appears in the official marketplace.
- If rejected or returned for changes, capture the exact findings as follow-up ledger work.

Installer contract:
- Claude Code's managed route is `claude plugins install wowbagger` or `/plugin install wowbagger` after official marketplace acceptance.
- Direct repository marketplace installation remains the fallback for forks, unreleased revisions, and pre-acceptance testing.
- Codex and other agents use `npx skills@latest add lstutzman/wowbagger --skill wowbagger`.
- The managed plugin and editable skill routes are exclusive; documentation must warn users not to install both.

Submission outcome (2026-08-23):
- Submitted the public repository through Claude Console's plugin-directory form: https://platform.claude.com/plugins/submit
- Repository submitted: https://github.com/lstutzman/wowbagger
- Plugin name: Wowbagger; platform selected: Claude Code; license: MIT.
- Console confirmation: "Plugin submitted for review." The submissions page shows a new submission from just now.
- Current state: awaiting Anthropic review and marketplace inclusion. Do not mark complete until acceptance is confirmed or returned findings are recorded.

Triage review (2026-08-30):
- Priority: 3.
- State: external review pending; no repository implementation is currently unblocked.
- Next evidence: marketplace acceptance or exact returned findings, then verify the managed install route or file a corrective follow-up item.