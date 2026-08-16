---
schema_version: 2
id: wb_01KZYS3100VKDMXK03R5MFNS6M
number: 83
title: "Publish Darwin-supported Claude Code adapter"
kind: task
priority: 1
status: deferred
created: 2026-08-14
updated: 2026-08-16
deferred: 2026-08-16
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
---

Property Compass adapter onboarding reproduced `adapter-platform-mismatch` on Darwin. The Claude Code manifest still declared Darwin `unverified` even though the native common-vector runner passes all 183 assertions across all 15 cases.

## Acceptance criteria

- The Claude Code adapter declares Darwin `supported`.
- Native adapter conformance and both supported Node release gates pass.
- The package, plugin, marketplace, README, skill, and changelog name the new prerelease.
- A configured Property Compass workspace completes a read-only adapter invocation through the source release candidate.
- npm `next` serves the new immutable release before consumer onboarding is called complete.
