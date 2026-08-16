---
schema_version: 2
id: wb_01M05FJJZXJZ5TGWKAKHQPPBK8
number: 104
title: "Stop a root-misplaced item from poisoning the claim fence"
kind: task
priority: 2
status: backlog
created: 2026-08-16
updated: 2026-08-16
provenance:
  source: "maintainer-dogfood"
  recorded_at: "2026-08-16T14:28:25Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-16
    summary: "Accept into the backlog."
    rationale: "Field trap 7a with a fence-poisoning damage claim (PropertyCompass2 PR 2184); needs repro and an honest refusal."
---

Field trap 7a from PropertyCompass2 (docs/wowbagger-feedback.md, commits 0f1243821/badcd6bf2; extends corrected entry 7; cost the consumer a second PR on 2026-08-16). The relocation ritual itself is already dead in source — layout.json is documented (#94) and the missing-directory refusal is filed (#102) — but 7a adds two claims that need their own work:

1. TRAP, alpha.4-only but documentable now: `git mv ledger/<id>.md ledger/items/` fails on a freshly created item because create writes an untracked file; in an unchecked batch the follow-up `git add -A` silently commits the item at the ledger root, and validate passes (identity is frontmatter, not path). Four of five consumer creates landed misplaced.

2. DAMAGE CLAIM to verify and fix: per PropertyCompass2 PR #2184, a single root-misplaced committed item makes the work-claim fence report `stale-write-detected` with `actual_revision: null` and blocks every guarded mutation in every worktree sharing the claim store. Plausible mechanism: the claim journal records the item's committed revision at its expected path; the git-HEAD surface read keys by parsed item ID from the layout-filtered listing, and a path mismatch between journal expectation and HEAD location reads as a revision regression. Do not guess — reproduce it.

Scope:
1. Fixture-reproduce the misplaced-item block: provisioned ledger with layout.json items_directory, item committed at the ledger ROOT instead, next guarded mutation. Pin the actual refusal.
2. If reproduced: the finding must name the real problem (item at wrong path, expected vs actual path) with a remediation naming the relocation + claim-verify — not a bare stale-write with actual_revision null. Decide whether the fence should tolerate a valid item found at a non-layout path (validate currently accepts it, so the claim layer disagreeing with validate is the contradiction to resolve).
3. Document the untracked-file trap wherever the pre-layout relocation ritual could still be attempted (the alpha.4 boundary paragraph from #94 is the natural home): plain mv + git add, check exit codes.

Acceptance:
- A fixture pins the misplaced-item refusal (or proves the claim wrong; record which in the closing decision).
- The refusal names the path mismatch and remedy, mutation-guarded.
- The alpha.4 trap documented in the #94 boundary text; packaging tests pin it.
- Gate green on both runtimes.
