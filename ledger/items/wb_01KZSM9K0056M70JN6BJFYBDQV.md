---
schema_version: 2
id: wb_01KZSM9K0056M70JN6BJFYBDQV
number: 62
title: "Correct prerelease install and upgrade guidance"
kind: task
priority: 20
status: done
created: 2026-08-12
updated: 2026-08-12
completed: 2026-08-12
provenance:
  source: "propertycompass-consumer-dogfood-final"
  recorded_at: "2026-08-12T22:45:00Z"
depends_on: []
related: [ wb_01KZVSW80HMW6RM39MX90P1TSH ]
decisions:
  - action: accept
    date: 2026-08-12
    summary: "Accept consumer-dogfood finding G4."
    rationale: "The published alpha.2 artifact reproduces the finding on a clean consumer installation."
  - action: complete
    date: 2026-08-12
    summary: "Correct prerelease installation guidance."
    rationale: "README now names the package-derived immutable tag and prerelease next channel; packaging tests reject drift."
---
## Problem

The published `0.1.0-alpha.2` README calls the `v0.1.0-alpha.1` Git tag “this release” and tells prerelease consumers to upgrade with `wowbagger@latest`. The `latest` dist-tag still points to alpha.1, so both paths install an older core.

## Acceptance criteria

- The release-specific Git command is derived from the distribution version and cannot silently name an older tag.
- Prerelease upgrade guidance uses `wowbagger@next`; stable-channel guidance is not presented as the current prerelease path.
- A packaging test fails when README release guidance drifts from `package.json`.
