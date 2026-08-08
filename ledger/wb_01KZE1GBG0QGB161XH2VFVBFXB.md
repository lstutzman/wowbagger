---
schema_version: 1
id: wb_01KZE1GBG0QGB161XH2VFVBFXB
number: 32
title: "Decide whether ownership returns, after priority did"
kind: task
status: done
created: 2026-08-07
updated: 2026-08-08
completed: 2026-08-08
provenance:
  source: "maintainer-dogfood/wowbagger"
  recorded_at: "2026-08-07T12:00:00.000Z"
depends_on: []
related: []
parent: wb_01KZ77NSW8PNA4S48NYT26AGMH
priority: 10
decisions:
  - action: accept
    date: 2026-08-07
    summary: "Accepted: ownership was deleted alongside priority and never re-examined."
    rationale: "Priority was restored once a consumer hit the hole. Ownership went out in the same commit, the same way, and nobody has decided whether it belongs in the ledger, belongs to the claim contract, or is deliberately absent. Any of those is a fine answer; none is recorded, which is the defect."
  - action: complete
    date: 2026-08-08
    summary: "Completed: ADR-0007 records that ownership is a claim concern and the durable field is deliberately absent."
    rationale: "The transient question — who is touching this now — is answered by the shipped claim contract with owner identity and lease renewal; a frontmatter twin would give one fact two homes. The durable question — whose responsibility is this — has no consumer demand: both dogfoods surfaced priority, numbers, patching, and minting, never responsibility. ADR-0007 records the reasoning and a reopen trigger: a consumer with more than one durable responsible party asks, and the field is then specified before it is implemented, per ADR-0006's discipline. Recorded by the maintainer agent; Lee can veto by reversing the ADR."
---

Ownership was deleted in the same commit as priority, the same way, and unlike
priority nobody has decided whether it should come back.

`3f1a5e5`, the founding project-direction commit, read:

    YAML metadata for lifecycle, priority, dependencies, and ownership.

`1058b8c`, "docs: tighten standalone ledger invariants", removed both. Priority
was restored at `b0ee411` once a consumer hit the hole. Ownership has not been
examined at all.

This item is a decision, not an implementation. Ownership may genuinely belong
elsewhere now: the work-claim contract covers who is *currently working on* an
item, with an owner identity and lease renewal, and advisory claims already
ship. If claims are the answer, ownership as a frontmatter field is redundant
and its removal was correct — but that reasoning is nowhere in the record.

The two are not the same thing. A claim is transient and answers "who is
touching this right now". Ownership is durable and answers "whose responsibility
is this". A ledger can want both, one, or neither.

Acceptance:

- a decision is recorded on whether ownership is a ledger field, a claim
  concern, or deliberately absent;
- if it is deliberately absent, the reasoning is written down so the question
  is not reopened by every consumer; and
- if it returns, it is specified before it is implemented — the failure being
  corrected here is a field that existed in prose and then vanished without an
  ADR.

Surfaced 2026-08-07 while tracing why priority disappeared.
