---
schema_version: 1
id: wb_01KZE1GBG0ZMPKHSYCGY4E5KXM
number: 30
title: "Give the ledger a way to express priority"
kind: task
priority: 1
status: backlog
created: 2026-08-07
updated: 2026-08-07
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
---

Wowbagger has no concept of priority, and the gap is not cosmetic: it blocks
the workflow the tool exists to serve.

The request that surfaced it was ordinary — "issues filed from dogfooding
should get high priority". It cannot be satisfied. `ready` sorts by `created`
ascending, then by `id`:

    .sort((left, right) => {
      const created = compareText(left.data.created, right.data.created);
      return created === 0 ? compareText(left.data.id, right.data.id) : created;
    })

So the newest item is always last. The two friction items filed from the
tinydancer dogfood landed at positions 15 and 16 of 16 — the furthest possible
from the attention they were filed to attract. Every future consumer report
will do the same, and the more responsive the project is about filing them,
the deeper they sink.

An extension member does not solve it. `priority: high` in the frontmatter
validates clean — verified — and changes nothing, because no code reads it.
Stamping it would produce data that looks authoritative and steers nothing,
which is worse than the absence.

The honest workarounds are both wrong. `depends_on` can starve the queue until
chosen work is done, but a dependency is a statement about order of
possibility, not importance, and overloading it corrupts the one signal
`ready` currently computes correctly. Backdating is impossible: `created` is
derived from the ULID timestamp and `date` cannot move `updated` backwards.

This is a core question, not a packaging one, which is why it sits in the
standalone epic. It also runs straight into design principle 3 — derived state
stays derived. Priority is not derivable; it is a human judgement that must be
stored. That does not make it wrong to add, but it does mean the contract has
to say what priority is, who may set it, and whether `ready` orders by it or
merely reports it.

Options, deliberately not chosen here:

- an ordered enum in the frontmatter that `ready` sorts by before `created`;
- an explicit rank the consumer maintains, with `ready` reporting it and
  leaving the ordering to the reader; or
- no priority at all, stated as a deliberate refusal, with the project
  accepting that a queue is chronological and importance lives elsewhere.

The third is a legitimate answer. What is not legitimate is the current state,
where the concept is absent, undiscussed, and silently defaulted to "oldest
first".

Acceptance:

- the contract states whether Wowbagger has a priority concept, and if it does,
  what values it takes and who may set it;
- if priority exists, `ready` either orders by it or documents why it does not;
- if priority is refused, the refusal is written down with its reasoning so the
  question is not reopened by every consumer; and
- either way, a consumer can tell from the documentation what happens to an
  urgent item, without reading `src/ready.js`.

Surfaced 2026-08-07 while trying to prioritise the tinydancer dogfood items.
