---
schema_version: 1
id: wb_01KZBT45ANXD8SX5X02F1KVKPJ
title: "Define the shared adapter packaging and release path"
kind: task
status: backlog
created: 2026-08-06
updated: 2026-08-06
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
---

Define one packaging and release path that ships a single core version to every
harness adapter, so the adapters cannot drift apart.

There will be at least four adapters — Claude Code, Codex, opencode, and
Kimi/OpenAI-compatible. Without a shared release path each acquires its own copy
of the core, its own version, and eventually its own behaviour, which is the
divergent-source failure this project exists to prevent, reproduced at the
distribution layer.

Scope: how a released core version is identified, how an adapter declares which
core versions it supports, what happens when a consumer pairs an adapter with an
unsupported core, and how the conformance vectors are run against a candidate
release before it ships.

This item constrains every adapter item; settle it before more than one adapter
is published.
