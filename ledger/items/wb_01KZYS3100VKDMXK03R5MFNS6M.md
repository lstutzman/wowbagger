---
schema_version: 2
id: wb_01KZYS3100VKDMXK03R5MFNS6M
number: 83
title: "Publish Darwin-supported Claude Code adapter"
kind: task
priority: 1
status: done
created: 2026-08-14
updated: 2026-08-17
completed: 2026-08-17
provenance:
  source: "consumer-dogfood/propertycompass"
  recorded_at: "2026-08-14T21:00:00.000Z"
depends_on: []
related: [ wb_01KZ77NSW8ZP1289HFMN2ECNXD ]
decisions:
  - action: accept
    date: 2026-08-14
    summary: "Accept the Darwin adapter release fix."
    rationale: "Property Compass onboarding cannot use the published adapter read path until the native-evidenced Darwin platform declaration ships."
  - action: defer
    date: 2026-08-16
    summary: "Defer the adapter release."
    rationale: "Lee deferred the release step on 2026-08-16; the queue focuses on field-feedback and report work first. Release remains Lee-gated."
  - action: undefer
    date: 2026-08-16
    summary: "Undefer the release."
    rationale: "Lee opened the release gate on 2026-08-16: contract v3, the adapter EPIPE fix, layout.json, the body verb, and the latency work all sit unpublished behind it."
  - action: complete
    date: 2026-08-17
    summary: "0.1.0-alpha.5 published; npm next serves it; Darwin supported."
    rationale: "Claude Code adapter declares Darwin supported; native conformance passes
      (196 assertions, 15 cases); both Node release gates green at 1044/1044. Package,
      plugin, marketplace, README, skill, and changelog name 0.1.0-alpha.5. A configured
      PropertyCompass workspace completed a read-only ready invocation through the source
      release candidate (ok true, exit 0). npm next serves 0.1.0-alpha.5, verified by
      dist-tags and a clean registry install reporting contract_version 3 and honoring
      layout.json. Git tag v0.1.0-alpha.5 pushed. This decision was repaired through the
      claimed publication path after a probe transition landed placeholder text."
---

Property Compass adapter onboarding reproduced `adapter-platform-mismatch` on Darwin. The Claude Code manifest still declared Darwin `unverified` even though the native common-vector runner passes all 183 assertions across all 15 cases.

## Acceptance criteria

- The Claude Code adapter declares Darwin `supported`.
- Native adapter conformance and both supported Node release gates pass.
- The package, plugin, marketplace, README, skill, and changelog name the new prerelease.
- A configured Property Compass workspace completes a read-only adapter invocation through the source release candidate.
- npm `next` serves the new immutable release before consumer onboarding is called complete.
