---
schema_version: 1
id: wb_01KZE1GBG0HA3MBWWZS6NQTW6E
number: 29
title: "Make inspect consistent about which fields are promoted onto item"
kind: task
priority: 10
status: done
created: 2026-08-07
updated: 2026-08-07
completed: 2026-08-07
provenance:
  source: "consumer-dogfood/tinydancer"
  recorded_at: "2026-08-07T12:00:00.000Z"
depends_on: []
related: []
parent: wb_01KZ77NSW8PNA4S48NYT26AGMH
decisions:
  - action: accept
    date: 2026-08-07
    summary: "Accepted from the tinydancer dogfood: inspect promotes id onto item but not title."
    rationale: "Reported as a documentation gap; it is not. Verified against this repository's ledger that id appears both at item.id and item.core.id while title appears only at item.core.title, so a caller who has just used item.id will reasonably expect item.title to work. One field is promoted and the rest are not, with nothing marking the difference. Which fields are promoted is a contract decision, so the item states the options rather than presuming the fix."
  - action: complete
    date: 2026-08-07
    summary: "Completed: no frontmatter field is promoted onto item, and item.id is removed."
    rationale: "The maintainer chose the smaller and more honest option of the two the item stated. item.id duplicated item.core.id and earned nothing, while making a caller reasonably expect item.title to work. The contract now states the rule and a test pins the member set. The oracle was updated to describe the new contract and remains exact, so an implementation that kept item.id still fails. A limit found while closing this: item.core is a fixed view that does not carry priority or number, so the rule holds only for the fields core carries. The contract now says so and item 37 tracks the fix."
---

A consumer read `inspect` output, reached for `item.title`, and got a
`KeyError`. The frontmatter is under `item.core`.

The report framed this as a documentation gap. It is not — the shape is
inconsistent, and the guess was reasonable. Verified against this
repository's own ledger:

    result.item keys: body, core, id, path, revision, source_base64,
                      source_encoding, source_media_type
    result.item.core keys: created, decisions, depends_on, id, kind, parent,
                           provenance, related, schema_version, status, title,
                           updated

`id` appears in BOTH places. So `item.id` works, and a caller who has just
used it will expect `item.title` to work too. It does not. One frontmatter
field is promoted to the item level and the rest are not, with nothing
marking the difference.

This is a contract decision, not a rename. Options, and the choice belongs to
the contract rather than to whoever picks up the item:

- promote nothing: remove `item.id`, so the boundary is unambiguous and
  every frontmatter read goes through `item.core`; or
- promote deliberately: state which fields are lifted and why, so a caller
  can predict the shape instead of discovering it.

The first is the smaller change and the more honest one — `item.id`
duplicates `item.core.id` and earns nothing.

Whichever is chosen, `docs/mutation-contract.md` must say it, and the
adapter conformance vectors must pin it, because a consumer reading the JSON
is the whole interface.

Acceptance:

- the rule for which frontmatter fields appear at the item level is stated in
  the mutation contract;
- `inspect` matches that rule with no unexplained exceptions; and
- a test pins the shape, so a future change to it is a deliberate contract
  change rather than an accident.

Reported from the tinydancer dogfood, 2026-08-07.
