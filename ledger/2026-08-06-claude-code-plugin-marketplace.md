---
schema_version: 2
id: wb_01KZBT43RZSKMG8Z19RQQ43DDR
number: 22
title: "Publish wowbagger as a Claude Code plugin on the marketplace"
kind: task
status: done
created: 2026-08-06
updated: 2026-08-13
completed: 2026-08-13
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
  - action: defer
    date: 2026-08-11
    summary: "Defer marketplace publication until the standalone release and installed-skill dogfood evidence exist."
    rationale: "Publishing the plugin before a versioned distribution channel and consumer dogfood would advertise an install path that has not been proven end to end."
  - action: undefer
    date: 2026-08-13
    summary: "Restore marketplace publication after release proof."
    rationale: "Version 0.1.0-alpha.3 now ships through npm and immutable Git marketplace metadata, and clean PropertyCompass dogfood proved the consumer installation path."
  - action: complete
    date: 2026-08-13
    summary: "Complete marketplace publication."
    rationale: "The self-hosted Git marketplace, immutable v0.1.0-alpha.3 source, exact core and plugin version gate, and clean consumer dogfood satisfy the distribution and compatibility scope."
---

Publish wowbagger as an installable Claude Code plugin so a consumer can add it
without cloning this repository.

This is distribution, not integration. The Claude Code adapter makes wowbagger
usable from that harness; this item makes it obtainable. They fail
independently — a correct adapter nobody can install is still unusable, and a
published plugin wrapping a broken adapter is worse.

Scope: the plugin manifest and skill definition, what the skill exposes to a
session (which core commands, with what guardrails), versioning and the update
path for consumers already on an older version, install and uninstall
behaviour, and the marketplace submission itself.

Open questions to settle before building: does the plugin bundle the core CLI
or depend on a separately installed one; what happens when a consumer's
installed plugin is newer or older than the ledger schema in their repository;
and how a consumer discovers that their wowbagger is out of date.
