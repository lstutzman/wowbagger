---
schema_version: 2
id: wb_01M086JQBQ12VQ3QER25QVJEEZ
number: 124
title: "Repair the release channels and make the cut a command"
kind: task
priority: 2
status: in-progress
created: 2026-08-17
updated: 2026-08-17
provenance:
  source: "maintainer-dogfood"
  recorded_at: "2026-08-17T15:48:55Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-17
    summary: "Accept into the backlog."
    rationale: "Ideation survivor: latest serves dead alpha.1 to every bare install today; the cut command kills a proven drift class."
---

Ideation survivor 3 of 5 (2026-08-17). Full design basis: docs/ideation/2026-08-17-open-ideation.md and the Sol enrichment at docs/ideation/enrichments/2026-08-17-release.md - the enrichment is the authoritative scope; this body is its summary.

Release-channel repair, two halves:

1. Registry policy (one-time authenticated writes + a checkable policy): DELETE the latest dist-tag while every release is 0.1.0-alpha.* (bare npm install fails loudly; @next is explicit prerelease consent - rejected alternatives and reasons in the enrichment); deprecate wowbagger@0.1.0-alpha.1 with a message naming @next; encode the policy in scripts/release-channels.js check|repair (idempotent), and post-publish verification runs check. Today latest serves dead alpha.1 to every bare install.

2. The cut command: scripts/cut-release.js (npm run release:cut -- <version> --date YYYY-MM-DD). Preflight (clean checkout, exactly one non-empty Unreleased, no existing tag/npm version, current version at every declared site) -> in-memory plan over a checked-in scripts/release-version-sites.json manifest classifying EVERY literal current-version occurrence as mutable or retained with exact counts (fail closed on any unmanifested occurrence - this is the self-verifying-coverage answer: exact-set equality, not grep-zero, because history retains old versions) -> materialize -> full release gate -> single Cut <version> commit -> tag -> scripts/verify-release-tag.js. Changelog handling recreates a fresh empty Unreleased above the new section (the previous two cuts consumed it - fixed inline 2026-08-17, and the command must make the mistake impossible). Dry-run executes the same planner+gate against a copy and proves the repo byte-unchanged. npm publish stays manual (WebAuthn passkey), as does push.

Topology decision for the maintainer (enrichment risk 1): v0.1.0-alpha.5/.6 tags point at MERGE commits, not cut commits, because cuts happen in a session worktree then merge. A one-command cut must run on the final branch tip - either cuts move to main after merge, or the command stays two-phase (cut in worktree, tag after merge). Decide before building.

Acceptance: the enrichment's criteria verbatim (section 4) - the manifest drift test (a new tracked file containing the old version without a locator refuses both dry-run and real), idempotency/resume semantics, registry post-publish state exact ({next: <published>}, no latest, alpha.1 deprecated), and the existing packaging pins intact.
