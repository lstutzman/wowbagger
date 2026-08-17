---
schema_version: 2
id: wb_01KZV3X9SFJ1MDNKN1VTJGK6EW
number: 49
title: "Document reversible cleanup for local plugin installs"
kind: task
status: killed
created: 2026-08-12
updated: 2026-08-12
killed: 2026-08-12
provenance:
  source: "propertycompass-dogfood-pilot"
  recorded_at: "2026-08-12T13:52:27Z"
depends_on: []
related: [ wb_01KZBT43RZSKMG8Z19RQQ43DDR, wb_01KZBT447HVZ9798DXV1NTT515 ]
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
decisions:
  - action: kill
    date: 2026-08-12
    summary: "Reject the local-scope cleanup finding after observing automatic cleanup."
    rationale: "After the pilot worktree was deleted, Claude Code reported no installed wowbagger plugin and no wowbagger marketplace. The residual cache is marked orphaned and has no live process markers. The local-scope configuration did not survive, so the recorded discard-guarantee defect is false."
---

The pilot installed the marketplace and plugin with `--scope local` from a disposable worktree. Claude Code wrote no configuration inside that worktree. It persisted the plugin record in `~/.claude/plugins/installed_plugins.json`, including the worktree `projectPath`, and persisted the marketplace in `~/.claude/plugins/known_marketplaces.json`. Removing the worktree would leave those records behind.

This persistence is Claude Code behaviour, but it is part of Wowbagger's documented installation path. The pilot's discard guarantee was therefore false unless cleanup explicitly ran before worktree removal.

Done means the install and dogfood instructions state that local scope is project-addressed user state, provide verified `claude plugin uninstall wowbagger@wowbagger --scope local` and marketplace-removal steps, put those steps before worktree deletion, and no longer imply that deleting a worktree uninstalls the plugin.
