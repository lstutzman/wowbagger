---
schema_version: 2
id: wb_01M14Y2VZW2ASKHYE42BGZ1PPK
number: 185
title: "Detect stale installed skill and core version drift"
kind: task
priority: 1
status: in-progress
created: 2026-08-28
updated: 2026-08-30
provenance:
  source: "PropertyCompass2 field failures"
  recorded_at: "2026-08-28T19:38:40Z"
depends_on: []
related: [ wb_01M14Y1NTXQPMQ270VT1WH6H17, wb_01M1986V8VYPCBTGVDDM7QCVPZ ]
decisions:
  - action: accept
    date: 2026-08-30
    summary: "Accept version-drift diagnosis as priority-one backlog work."
    rationale: "The hard cutover is now deployed and its old-writer error is generic. #188 will introduce another deliberate version boundary, making early diagnosis time-sensitive."
---
## Problem

PropertyCompass2 runs the published alpha.12 core with `contract_version: 5`, while its installed Wowbagger skill still states alpha.6 and contract 3. The consumer therefore follows stale mutation and verification guidance even though the binary is current. Existing PropertyCompass worktree feedback already covers unrelated refs poisoning the claim store and fresh-clone reconciliation projection truncation.

This is the same class as the globally linked alpha.10 checkout on this machine serving stale skill text after alpha.11 shipped. It is consumer-side staleness today, not evidence that the current alpha.12 core or shipped skill advertises the wrong versions. The product gap is that consumers can run mismatched instructions and binary without an early, actionable drift signal.

## Acceptance criteria

- Detect installed skill distribution pin and required contract version independently from the running core.
- Fail or warn before ledger mutation when skill and core versions disagree; name installed, required, and running values.
- Identify the installation source when possible: registry package, Git tag, direct checkout, plugin cache, or global link.
- Provide exact remediation for stale plugin/skill caches and linked checkouts without modifying another repository automatically.
- Cover both directions: stale skill with newer core and newer skill with incompatible older core.
- Reuse the alpha.10 global-link incident and PropertyCompass alpha.6/contract3 drift as public onboarding/update tests, not one-off project checks.
- Keep current strict distribution and contract pins; do not soften them to make drift pass.

## Priority escalation — 2026-08-29

Raised from priority 2 to priority 1 before the #181 alpha.14 hard cutover. Once one upgraded worktree writes the new create journal grammar, an alpha.13 worktree fails closed with generic `claim-store-unavailable` / `claim-store-unreadable` output and no hint that version drift caused it. The cutover therefore makes early, actionable skill/core version diagnosis materially more urgent.

## Triage decision — 2026-08-30

Accepted into backlog at priority 1. The alpha.14 hard cutover is live: an alpha.13 worktree encountering the new create grammar emits generic `claim-store-unavailable` / `claim-store-unreadable` output with no version hint. The Node 24 floor move in #188 will add another intentional compatibility boundary.

First design slice: define one read-only preflight that compares installed skill distribution pin, required core contract, running core version, and installation provenance before mutation. It must produce exact upgrade or unlink/cache remediation without changing another repository. Do not soften version pins to turn drift into success.
