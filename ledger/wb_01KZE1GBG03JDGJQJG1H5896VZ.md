---
schema_version: 1
id: wb_01KZE1GBG03JDGJQJG1H5896VZ
title: "Tell the caller that a created item lands in triage"
kind: task
status: backlog
created: 2026-08-07
updated: 2026-08-07
provenance:
  source: "consumer-dogfood/tinydancer"
  recorded_at: "2026-08-07T12:00:00.000Z"
depends_on: []
related: []
parent: wb_01KZ77NSW8PNA4S48NYT26AGMH
decisions:
  - action: accept
    date: 2026-08-07
    summary: "Accepted from the tinydancer dogfood: create should tell the caller it assigned triage."
    rationale: "A consumer created nine items and found an empty ready queue, because create assigns triage and says so nowhere in its result. The rule is correct and documented in the mutation contract, but a consumer meets it only after the queue comes back empty. Confirmed firsthand while filing this item: the assigned status is only recoverable by base64-decoding source_base64. This is an information gap, not a behaviour change."
---

A consumer created an epic and eight tasks through `create`, then found none
of them in `ready`. Every item had landed in `triage`, and nothing in the
create path said so.

The rule is documented — the mutation contract states that create inserts
`status triage` — but the consumer meets it only after the queue comes back
empty and they go looking. Create also refuses a caller-supplied `status`,
so there is no way to discover the rule by trying.

The fix is a hint, not a behaviour change. Creating in `triage` is correct:
an item should be accepted deliberately rather than by being filed. What is
missing is that the create result never mentions the status it just assigned,
or that a triage item is excluded from `ready` until a transition accepts it.

Acceptance:

- the create result reports the status it assigned, so a caller reading only
  the JSON learns the item is in `triage`;
- the documented next step from `triage` to `backlog` is discoverable from
  that result or from the refusal a caller gets when supplying `status`; and
- creating in `triage` is unchanged — this adds information, it does not move
  the item.

Reported from the tinydancer dogfood, 2026-08-07.
