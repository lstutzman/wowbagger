---
schema_version: 2
id: wb_01M05FCM9KQTY7BDW9ABZDD41K
number: 103
title: "Bump the core contract version for the widened refusal envelope"
kind: task
priority: 2
status: done
created: 2026-08-16
updated: 2026-08-16
completed: 2026-08-16
provenance:
  source: "maintainer-dogfood"
  recorded_at: "2026-08-16T14:25:09Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-16
    summary: "Accept into the backlog."
    rationale: "Lee decided on 2026-08-16: strict envelope-versioning discipline; the #95 widening carries the bump."
  - action: complete
    date: 2026-08-16
    summary: "Core contract version bumped to 3 across every core-domain surface."
    rationale: "Lee's strict-versioning call on the #95 widening. Source constant, oracle mirror (independent, mutation-guarded both directions), 3 adapter manifests, 48 fixtures, 13 test files, docs, and the skill all moved; the v1 legacy domains and the adapter contract 2 stayed, proven by the envelope-dispatch suite. The contract's Version 3 note enumerates the full delta over published v2 (#95 widened date refusals, #90 patch field set, #84 number identity, #94 layout paths). Gate green on three runtimes. Consequence recorded: the next release is now a hard gate - shipped skill and adapter manifests refuse every published core until it lands."
---

Lee's call on 2026-08-16, resolving item #95's open question: the widened date-refusal envelope (item_created/item_updated on date-before-created and date-before-updated) breaks the contract's own version-2 compatibility argument ("no envelope member changes, so existing exact-member consumers remain compatible"). Strict envelope-versioning discipline applies: bump CORE_CONTRACT_VERSION 2 to 3.

Scope:
1. Bump the CORE_CONTRACT_VERSION constant (source and its oracle mirror in spec/adapter-reference.js, each side independent) and sweep every fixture, test, doc, and skill reference that pins contract_version: 2 on the CORE domain. The work-claim/publication/mutation legacy envelopes (contract_version: 1) and the work_claim api_version are separate version domains — they do NOT move.
2. The mutation contract's "Contract versions" section records the bump and its reason: version 3 = version 2 plus the widened date-refusal issue shape from item #95 (and names any other v2-era refinements it inherits, e.g. the patch field-set widening from #90, so the version note is a complete diff summary against published v2).
3. The installed skill's version check text and the adapter core-probe must gate on the new version; version-1 and version-2 consumers keep failing closed.
4. The envelope-domains fixture (spec/fixtures/envelope-domains/manifest.json) and its dispatch test move to 3 for the core domain.

Acceptance:
- CORE_CONTRACT_VERSION is 3 in core and oracle, mirrored independently, mutation-guarded both directions (bump one side alone: red).
- No contract_version: 2 remains on any core-domain surface (fixtures, tests, docs, skill); a repo-wide sweep proves it and is stated in the report.
- The legacy v1 domains are untouched, proven by the envelope-dispatch suite staying green with contract_version: 1 pins intact.
- The mutation contract version note enumerates what v3 adds over published v2.
- Four-command gate green on both runtimes.
