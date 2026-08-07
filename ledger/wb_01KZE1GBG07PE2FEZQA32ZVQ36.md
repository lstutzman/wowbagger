---
schema_version: 1
id: wb_01KZE1GBG07PE2FEZQA32ZVQ36
number: 28
title: "Give every item a short human-readable handle"
kind: task
priority: 20
status: backlog
created: 2026-08-07
updated: 2026-08-07
provenance:
  source: "maintainer-dogfood/wowbagger"
  recorded_at: "2026-08-07T12:00:00.000Z"
depends_on: []
related: [ wb_01KZE1GBG04T52TG5VJX4KV7N0 ]
parent: wb_01KZ77NSW8PNA4S48NYT26AGMH
decisions:
  - action: accept
    date: 2026-08-07
    summary: "Accepted: a 26-character ULID is unusable as a conversational handle."
    rationale: "Raised while reading a ready queue printed as sixteen bare ULIDs, which is the tool's primary human-facing surface. The canonical ULID stays; what is missing is a short handle beside it. Integers were requested but cannot be allocated without the coordination the ULID exists to avoid, so the item recommends a Git-style resolved short prefix and says plainly that this is not what was asked for."
---

Nobody will say "let's do item wb_01KZ77NSW81FXZVAWQ8WT4KDCJ". A 26-character
ULID is unspeakable, unmemorable, and impossible to type without copying. It is
the right identifier for a file and the wrong one for a conversation.

This was raised while reading a `ready` queue printed as sixteen ULIDs. That
output is the tool's primary human-facing surface and it is unreadable — a
maintainer cannot point at a row without copying twenty-six characters, and an
agent relaying the queue produces a wall of noise.

The ULID must stay canonical. It is what `create` requires, what `inspect`
keys on, what the filename encodes, and what makes atomic no-clobber
publication work without coordination. Nothing here proposes replacing it.

What is proposed is a second, shorter handle for humans, and the design
question is what it is derived from — because design principle 3 says derived
state stays derived, and a stored sequence number is not derived.

Options:

- A stored per-ledger sequence (`#1`, `#2`). Reads best and is what the
  request asked for. But it must be allocated, which reintroduces exactly the
  coordination the ULID exists to avoid: two worktrees filing concurrently
  both take the next integer and collide, and the ledger has no transactional
  coordinator to arbitrate. This is the same wall the fenced-claims item hits.
- A short prefix of the ULID, resolved like a Git short hash — `wb_01KZE1G`,
  lengthened only when ambiguous. Derived, needs no allocation, no collision
  risk, and every developer already understands the idiom. Loses the
  "integer" quality of the request.
- A slug from the title (`give-every-item-a-short-handle`). Readable and
  memorable, but not stable — retitling changes it, so it cannot be an
  identifier, only a display aid.

The short-prefix option is the only one that is both derived and
collision-free without coordination, so it is the recommendation. It is worth
stating plainly that it does not give the integers that were asked for, and
that integers cannot be had cheaply while concurrent worktrees can file items.

Whichever is chosen, the surface that matters most is `ready`: a queue a human
reads should show the handle and the title, not a bare ULID list.

Acceptance:

- an item can be referred to by a short handle in conversation and on the
  command line, wherever an ID is accepted;
- the handle resolves to exactly one item or fails loudly, never silently
  picking one;
- the canonical ULID is unchanged and remains what the file and the contract
  use; and
- `ready` output is legible to a human without copying identifiers.

Raised 2026-08-07 by the maintainer while reading a sixteen-ULID ready queue.
