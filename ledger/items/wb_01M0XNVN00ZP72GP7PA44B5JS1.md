---
schema_version: 2
id: wb_01M0XNVN00ZP72GP7PA44B5JS1
number: 168
title: "Document parent-migrate and snooze request and journal fence-family semantics"
kind: task
priority: 3
status: backlog
created: 2026-08-26
updated: 2026-08-26
provenance:
  source: "exploratory-stress/2026-08-26/phase2-journal"
  recorded_at: "2026-08-26T22:54:00.000Z"
depends_on: []
related: [ wb_01M0XNVN00TRMBY86QXZV6EH3D, wb_01M0XNVN00X4ZRSGEZ9DWH3D0A ]
tags:
  - "stress-run-2026-08-26-alpha10"
  - "documentation"
decisions:
  - action: accept
    date: 2026-08-26
    summary: "Accept the parent-migrate and snooze contract coverage gap."
    rationale: "Two public mutation verbs lack dedicated request, response, date, CAS, auto-commit, and durable journal documentation."
---
## Documentation gap — observed behavior is defensible

The mutation contract has no dedicated request and response sections for `parent-migrate` or `snooze`. They appear only in the response-domain table at pinned lines 403-404, ownership table 2163-2164, auto-commit set 2639-2640, and commit subjects 2661-2662. Thin coverage leaves request contracts and durable journal `command` semantics unexplained.

## Version and evidence provenance

- Distribution: `0.1.0-alpha.10`.
- Binary: `/Users/leestutzman/.nvm/versions/node/v20.20.2/bin/wowbagger`, resolving to `/Users/leestutzman/Documents/GitHub/wowbagger/bin/wowbagger.js`.
- Source HEAD: `b06db85c42d3795a82ad0b57b400e1c7b9a7025b`, clean, local `main` ahead of `origin/main` by two metadata-only commits.
- Recovery ref: local annotated tag `v0.1.0-alpha.10`, unpushed.
- Ahead commits: `b06db85` Cut 0.1.0-alpha.10; `e6c012f` Prepare alpha10 release notes. Neither changes behavior.
- Reproducibility: exact pinned tree is local-only; tested behavior is present on published `origin/main`, which reports alpha.9.
- Evidence came post-reinitialization from an on-disk driver and direct CLI. No shared eval-kernel evidence supports this item.

## Inline evidence

On a provisioned alpha10 ledger, the holder ran patch, snooze, and parent-migrate on done item #11. The reconciliation log carried intent and terminal pairs at sequences 19/20, 22/23, and 25/26. Every pair recorded `command: "patch-v1"`, while live refusal and success envelopes correctly named `patch`, `snooze-v1`, or `parent-migrate-v1`. Revision ordering and recovery remained correct; this is not ledger corruption.

## Source adjudication

Pinned `src/claim-coordinator.js:18-23` accepts `command` and `responseCommand`. Journal intent and terminal records store `command` at lines 68-89 and 141-151; envelopes use `responseCommand` at lines 29, 52, 66, 119, 136, 153, 169, and 193. `src/mutation.js:514-533` invokes snooze and parent migration with fence command `patch-v1` plus response command `parent-migrate-v1` or `snooze-v1`.

Work-claim contract section 7 requires attempt and revision evidence for recovery but never defines journal `command` as a public operation name. Section 9 keys recovery on `attempt_id` plus revisions. Mutation contract lines 2027-2028 designate Git history as the audit trail for consumer-field changes. The current split is coherent as fence-family versus response-operation identity, and alpha.10's own-response-domain claim is satisfied literally.

## Impact

Readers can mistake journal `command` for the user operation and infer lost attribution. Analytics or audit tooling reading that field will mislabel snooze and reparent as patch. More importantly, two public verbs lack one place documenting exact request members, date and CAS rules, response domains, refusal exits, and durable evidence.

## Acceptance criteria

- Add dedicated contract sections for parent-migrate and snooze with exact JSON requests, date/CAS/status behavior, error and exit shapes, response domains, and auto-commit behavior.
- Cross-link terminal-date item #166 and help-text item #167.
- Define legacy journal `command` as a fence family or recovery classifier, not the public operation name. Define `responseCommand` as envelope identity.
- Pin documentation tests.
- Do not change runtime or journal bytes solely to make labels prettier.

No fix is included. No production code was edited during this campaign. Implementation requires separate user-approved work.
