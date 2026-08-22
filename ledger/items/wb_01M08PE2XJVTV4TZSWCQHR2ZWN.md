---
schema_version: 2
id: wb_01M08PE2XJVTV4TZSWCQHR2ZWN
number: 128
title: "Add a CAS-fenced snooze mutation for migrated items"
kind: task
status: backlog
created: 2026-08-17
updated: 2026-08-22
provenance:
  source: "consumer-dogfood/propertycompass2"
  recorded_at: "2026-08-17T20:26:01Z"
depends_on: []
related: [ wb_01KZMFG500937XD19XGFA5EJ32 ]
decisions:
  - action: accept
    date: 2026-08-22
    summary: "Accept item into backlog for maintainer triage."
    rationale: "The reported scope is recorded; backlog acceptance makes it eligible for scheduling and implementation."
---
Field feedback from PropertyCompass2 against alpha.6 / core contract 3. The legacy backlog has future `snoozed_until: 9999-12-31` on #1013, #653, and #1272. All three existing schema-2 ledger mirrors omit `snoozed_until`. Alpha.6 declares `snoozed_until` create-once. `patch` cannot set or clear it, and the CLI has no snooze/unsnooze mutation. The consumer cannot repair this migrated drift without a hand-edit or deleting and recreating immutable item identity.

This is distinct from related item #46. That item shipped deferred/undeferred lifecycle states for a human decision to park work. It did not add date-based snooze mutation or repair migrated `snoozed_until` drift.

Reproduction in the PropertyCompass2 ledger:

```sh
wowbagger inspect --ledger ledger --number 1013 --json
wowbagger inspect --ledger ledger --number 653 --json
wowbagger inspect --ledger ledger --number 1272 --json
wowbagger ready --ledger ledger --as-of 2026-08-17 --json
```

Expected from the legacy source projection:
- Each inspect result carries `snoozed_until: 9999-12-31`.
- Ready excludes #1013, #653, and #1272 on 2026-08-17.
- The ready sequence matches the filtered legacy priority rank exactly.

Actual on the existing schema-2 mirrors:
- All three inspect results have `snoozed_until` absent.
- Ready returns 401 items. Its first 400 items exactly match filtered legacy rank. Unranked #1013 appears at position 401 because it has no dependencies.
- #653 and #1272 stay out only incidentally because live dependencies block them. They would become ready when those dependencies clear, despite the legacy future snooze.

Required behavior, without prescribing whether this is a dedicated command or a widened `patch`: provide a CAS-fenced mutation that can set, replace, and clear `snoozed_until` on an existing schema-2 item. It must preserve item identity and all unrelated bytes, validate the resulting ledger, update date-based ready behavior, refuse stale revision witnesses without changing state, and follow the provisioned-ledger publication fence.

Acceptance:
- A migrated item missing `snoozed_until` can receive the source date through a sanctioned mutation; no hand-edit or recreate is required.
- An existing snooze date can be replaced and cleared through the same sanctioned behavior.
- A stale expected revision refuses deterministically and changes no item byte.
- Future-snoozed items stay out of `ready --as-of`; clearing or passing the snooze date restores normal dependency and priority evaluation.
- Migration coverage preserves valid source snooze dates on existing schema-2 mirrors, including #1013, #653, and #1272's `9999-12-31` value.
- Validation coverage pins accepted calendar dates, rejected invalid values, and unchanged-state refusals.
- Claimed items and provisioned publication use the existing claim and Git reconciliation fences; no successful mutation bypasses CAS or leaves an uncommitted ledger publication.
