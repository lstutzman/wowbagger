---
schema_version: 2
id: wb_01M1QDTV004DNM4M62W5PDS683
number: 206
title: "Detect version drift from a direct skill path"
kind: task
priority: 10
status: triage
created: 2026-09-05
updated: 2026-09-05
provenance:
  source: "PropertyCompass2 defect digest #200 heading 24 item 31"
  recorded_at: "2026-09-05T16:59:00Z"
depends_on: []
related: [wb_01M14Y2VZW2ASKHYE42BGZ1PPK]
tags:
  - "consumer-feedback"
  - "propertycompass2"
  - "defect-digest-200"
---

## Problem

`version-drift --skill <path>` can report `installed_distribution: null` and `source.kind: unknown` even when the supplied `SKILL.md` belongs to a valid installed or checked-out Wowbagger distribution. That makes the direct-path mode useless for the exact consumer cache and linked-checkout diagnosis introduced by item #185.

## Reproduction

Invoke `version-drift` with `--skill` pointing directly at a Wowbagger `SKILL.md` inside a package checkout or plugin cache. Observe that distribution version and source provenance remain unknown although nearby package metadata identifies them.

## Acceptance criteria

- Direct `SKILL.md` paths resolve the owning Wowbagger distribution and version when package or Git provenance is available.
- Results distinguish registry package, Git tag, direct checkout, plugin cache, global link, and genuinely unknown ownership.
- Resolution stays within bounded ancestors of the supplied skill path and follows the existing no-unsafe-path rules.
- Unknown paths remain explicit and never guess a distribution version.
- Fixtures cover a package checkout, a plugin cache layout, a symlinked global install, and an unrelated standalone file.
