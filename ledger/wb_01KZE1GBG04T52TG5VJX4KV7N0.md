---
schema_version: 1
id: wb_01KZE1GBG04T52TG5VJX4KV7N0
title: "Remove the ULID generator as a prerequisite for first use"
kind: task
status: backlog
created: 2026-08-07
updated: 2026-08-07
provenance:
  source: "consumer-dogfood/tinydancer"
  recorded_at: "2026-08-07T12:00:00.000Z"
depends_on: []
related: [ wb_01KZE1GBG03JDGJQJG1H5896VZ ]
parent: wb_01KZ77NSW8PNA4S48NYT26AGMH
decisions:
  - action: accept
    date: 2026-08-07
    summary: "Accepted: writing a ULID generator is a prerequisite for filing a first item."
    rationale: "Two independent consumers wrote the same generator before they could create anything — the tinydancer dogfood and this session. The caller-generated ID is sound design and is not in question; requiring every consumer to reimplement Crockford base32 before their first item is the cost being challenged. First-use friction is paid before a consumer has reason to trust the tool."
---

Before a consumer can create their first item, they must write a ULID
generator. The tinydancer dogfood did exactly that — "wrote a ULID generator
matching `wb_[0-7][0-9A-HJKMNP-TV-Z]{25}`, verified against the regex" — and
so did this session, independently, for the same reason.

Two consumers writing the same 20 lines before they can file anything is a
signal, not a coincidence.

The requirement is not arbitrary. `create` takes a caller-generated ID so that
publication is atomic and no-clobber, and so a caller can retry without
risking a second item; the contract is explicit that the timestamp must encode
the intended creation instant, since `created` is derived from it. That design
is sound and this item does not propose changing it.

What it proposes is that the core stop making every consumer reimplement it.
The knowledge is already in this repository — the canonical form, the
Crockford alphabet with I, L, O and U excluded, the 80-bit entropy floor, and
the rule that the encoded date must match `created`. A consumer has to
rediscover all of it from the contract prose and then get the base32 encoding
right, and a subtly wrong generator fails at publication rather than at
generation, which is a poor place to learn.

This is first-use friction specifically, which makes it disproportionate: it
is paid by every new consumer, before they have any reason to trust the tool.

Options:

- a `wowbagger mint-id` command that prints a canonical ID for a given date;
- an exported function so an adapter or plugin can mint one without shelling
  out; or
- documentation only — a correct, copyable generator in the README, which
  costs nothing and removes the archaeology even if no code is added.

The third is the cheapest and would have prevented both occurrences. The first
is the one that makes the plugin's skill able to file an item without asking
the consumer to install anything else.

Acceptance:

- a consumer can obtain a canonical, contract-valid ID without writing base32
  encoding themselves;
- whatever is provided is exercised by a test that would fail on a
  wrong-alphabet or wrong-entropy implementation; and
- the create documentation points at it, so the requirement is met where it is
  first encountered.

Surfaced 2026-08-07: both the tinydancer dogfood and this session wrote the
same generator before filing anything.
