---
schema_version: 1
id: wb_01KZE1GBG0ZMPKHSYCGY4E5KXM
number: 30
title: "Give the ledger a way to express priority"
kind: task
priority: 1
status: done
created: 2026-08-07
updated: 2026-08-07
completed: 2026-08-07
provenance:
  source: "consumer-dogfood/tinydancer"
  recorded_at: "2026-08-07T12:00:00.000Z"
depends_on: []
related: [ wb_01KZE1GBG03JDGJQJG1H5896VZ, wb_01KZE1GBG0HA3MBWWZS6NQTW6E ]
parent: wb_01KZ77NSW8PNA4S48NYT26AGMH
decisions:
  - action: accept
    date: 2026-08-07
    summary: "Accepted: the ledger cannot express priority, which blocks acting on dogfood reports."
    rationale: "Surfaced by a request that could not be satisfied — prioritise the dogfood issues. ready sorts by created ascending, so the two friction items landed at 15 and 16 of 16, furthest from the attention they were filed to attract. A priority extension member validates clean and steers nothing, so stamping one would be decoration that reads as data. Accepting the question, not a chosen answer: refusing priority outright is a legitimate outcome provided the refusal is written down."
  - action: complete
    date: 2026-08-07
    summary: "Completed: priority is restored, and ADR 0006 records the cause as unknown."
    rationale: "Priority was restored and validated at b0ee411. The remaining work was the question the deletion never answered. Nobody knows whether 1058b8c narrowed scope deliberately or removed priority by accident, and the ADR says exactly that rather than inventing a cause, because a guess in the record would be read by a later reader as a decision. The ADR also states the discipline the incident earns: a contract field is never removed inside a documentation commit; removal needs its own ADR and its own commit."
---

Priority existed, was fully specified, and was deleted without a decision
record. **Restored at `b0ee411`.** What remains is the question the deletion
never answered.

`73245c1` specified it:

    | priority | No | Non-negative integer supplied by a consumer policy.
                  Lower values sort first; Wowbagger core does not calculate it. |

    The ready result sorts by:
    1. items with priority before items without priority;
    2. ascending priority;
    3. ascending created date;
    4. ascending immutable ID.

Four hours later `1058b8c`, "docs: tighten standalone ledger invariants",
removed it from the README, SPEC, ADR-0001, the standalone plan, and every
ready-selection fixture, replacing the ordering with creation order alone. No
ADR records it. The commit message does not mention it. The only surviving
trace is ADR-0001, where "priority positions are optional consumer views"
became "display positions".

A consumer hit the hole three days later, and it had buried every dogfood
finding at the bottom of the ready queue.

The restoration puts back the original four-step rule verbatim and adds the
validation the original never had: `priority` must be a non-negative integer.
Before that, `priority: high` validated clean, so a restored ordering would
have silently ignored it.

What is still open:

- **Ownership was deleted in the same commit, the same way.** The original
  line read "YAML metadata for lifecycle, priority, dependencies, and
  ownership". Priority is back; ownership is not, and nobody has decided
  whether it should be. It is tracked separately.
- **Why the removal happened.** It may have been deliberate — an editor
  narrowing v0 scope — or accidental. Nothing records which. That is worth
  knowing before the same tidying pass removes something else.

Acceptance:

- priority is restored and validated — **done at `b0ee411`**;
- the reason for its removal is recorded, or recorded as unknown, so the
  question is not reopened; and
- the ADR discipline that would have caught this is stated: a contract field
  is not removed in a documentation commit.

Reported from the tinydancer dogfood, 2026-08-07. Restored the same day.
