---
schema_version: 1
id: wb_01KZBT45ANXD8SX5X02F1KVKPJ
number: 25
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
  - action: record
    date: 2026-08-06
    summary: "Three of the four scope points are already satisfied by the merged adapter work; only release identification remains open."
    rationale: "Version declaration is required_core_contract_version in the section 3.1 manifest. Unsupported pairing is verifyCoreProbe returning core-contract-version-mismatch, which is mutation-verified. Candidate-release conformance is spec/run-adapter-implementation.js. All three shipped at ae3dcb4. Restating them here as unbuilt work would duplicate the adapter item."
  - action: record
    date: 2026-08-06
    summary: "Adapters depend on an installed core; they do not bundle one."
    rationale: "Bundling puts a second copy of the core on a consumer's machine, so every core fix needs a republish of every adapter and two copies can disagree about ledger schema — the divergent-source failure this item exists to prevent, moved to the distribution layer. Depending makes skew detectable rather than silent: the adapter declares required_core_contract_version and the core probe refuses a mismatch, which is machinery that already exists. The cost is an install prerequisite, acceptable for a tool whose consumers already have Node and a git checkout."
  - action: record
    date: 2026-08-06
    summary: "Distribution does not need marketplace approval. A Claude Code marketplace is any git repository carrying .claude-plugin/marketplace.json."
    rationale: "Verified against the installed marketplaces on the development machine: seven of the nine registered are third-party repositories, including obra/superpowers-marketplace. The approval period gates listing in the official Anthropic catalogue, which is discovery, not distribution. A self-hosted marketplace is a real distribution channel and satisfies the dogfood item's requirement to install from one rather than from a local path, so the dogfood is not blocked on any approval."
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
