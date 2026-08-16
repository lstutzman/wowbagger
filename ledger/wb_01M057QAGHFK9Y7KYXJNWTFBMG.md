---
schema_version: 2
id: wb_01M057QAGHFK9Y7KYXJNWTFBMG
number: 93
title: "Correct stale default-path text in the mutation contract"
kind: task
status: backlog
created: 2026-08-16
updated: 2026-08-16
provenance:
  source: "consumer-field-feedback"
  recorded_at: "2026-08-16T00:00:00.000Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-16
    summary: "Accept the PropertyCompass2 field finding into the backlog."
    rationale: "First real production session (21 creates, 27 transitions, alpha.4) recorded this in docs/wowbagger-feedback.md (PR #2196). Verified against this repo source before filing."
---
Field paper-cut 7 (PropertyCompass2 report, PR #2196): the contract says create publishes to `<ledger>/<id>.md` and repos 'rename the file in Git after create', but the runtime already honors `.wowbagger/layout.json` `items_directory` and publishes directly to the configured subdirectory (verified: createItemUnfenced resolves layout; the consumer's creates landed correctly under ledger/items/ with no rename). The stale prose cost the consumer a pre-flight investigation.

Scope: correct the mutation-contract and any README/skill text to describe the layout.json-aware default path; state that no post-create rename is needed for configured layouts. Documentation only - no behavior change.

Acceptance: the contract's create section describes the items_directory resolution; a docs grep finds no remaining 'rename after create' guidance; the packaging test that pins shipped docs still passes.