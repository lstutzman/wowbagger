---
schema_version: 2
id: wb_01M058NVN7MCXVS61V9JKQMQV6
number: 94
title: "Document layout.json as the create items-directory mechanism"
kind: task
priority: 2
status: backlog
created: 2026-08-16
updated: 2026-08-16
provenance:
  source: "consumer-field-feedback"
  recorded_at: "2026-08-16T00:00:00.000Z"
depends_on: []
related: [ wb_01M057QAGHFK9Y7KYXJNWTFBMG ]
decisions:
  - action: accept
    date: 2026-08-16
    summary: "Accept the corrected/new PropertyCompass2 field finding."
    rationale: "Field issue 7 corrected: creates land at ledger root because layout.json is undocumented, not unsupported. Replaces killed #93."
---
Field issue 7 as CORRECTED on 2026-08-16 (report: .PropertyCompass2/worktrees/260815-212735/docs/wowbagger-feedback.md): all 22 of the consumer session creates published to the ledger ROOT per the contract default; the misplacement is silent (identity is frontmatter, validate passes either way) and surfaced only when a path lookup failed. They then relocated 22 files by hand with git mv, and asked for a per-ledger items_dir config or a create --dir flag.

The capability they asked for ALREADY EXISTS and is test-proven: `.wowbagger/layout.json` `{"layout_version":1,"items_directory":"items"}` makes create publish directly to the configured subdirectory (src/mutation.js createItemUnfenced resolves ledger.layout.items_directory; test: create derives the item path from a nested committed items-directory layout). The defect is pure discoverability: the mutation contract never mentions layout.json and instead prescribes a rename-after-create ritual, so a real consumer performed 22 manual git mv operations to work around a shipped feature.

Scope (documentation plus one verification):
1. Verify the published alpha.4 artifact honors layout.json exactly as this source tree does; record the result.
2. Rewrite the mutation-contract create section: default path is `<items_directory>/<id>.md` when layout.json configures one, `<ledger>/<id>.md` otherwise; delete the rename-after-create ritual text.
3. Add layout.json to the README ledger-setup section and the installed skill (one line each: where the file lives, the two keys, that create honors it atomically).
4. Replaces killed item #93, which was filed on the consumer’s original incorrect evidence.

Acceptance:
- A consumer following only shipped docs configures items_directory before their first create and never needs git mv.
- The contract, README, and skill agree; packaging tests pin the shipped docs.
- The alpha.4 verification result is recorded in this item’s closing decision.