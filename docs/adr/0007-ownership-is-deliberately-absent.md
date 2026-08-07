# ADR 0007: Ownership is deliberately absent from the ledger

Status: accepted for standalone v0; claims meet the practical need

## Context

Ownership and priority were named in the same line of the founding
project-direction commit, `3f1a5e5` (4 August 2026, 14:17):

    YAML metadata for lifecycle, priority, dependencies, and ownership.

Unlike priority, ownership never reached SPEC.md. It existed in prose in the
README and nowhere else.

`1058b8c` (4 August 2026, 18:35), titled "docs: tighten standalone ledger
invariants", deleted both words in the same edit to the same line. No ADR
records either deletion. The commit message mentions neither.

`b0ee411` (7 August 2026) restored priority, after a consumer hit the hole it
left. That commit rewrote the README line as "lifecycle, priority,
dependencies, and structured provenance". Ownership was not restored, and it
was not examined. Nobody had decided whether it belonged in the ledger,
belonged to the claim contract, or was correctly absent. Any of those three is
a defensible answer. None of them was in the record, and that was the defect.

Meanwhile the work-claim contract shipped. [ADR
0004](0004-fenced-work-claim-protocol.md) and [the fenced work-claim
contract](../work-claim-contract.md) define a separate versioned `work-claim`
backend namespace with an `owner_id` for one worker run, epochs, leases,
renewal, and expiry takeover. The current implementation is advisory:
`mode: "advisory"` and `safe_exclusive_dispatch: false`. Advisory claims
enforce nothing, but they do report who is working on an item.

## Decision

**Ownership is deliberately absent from the ledger. Claims are enough.**

### The distinction this sets aside

A claim and ownership answer different questions. Writing this down is the
whole point of the record.

| | Claim | Ownership |
|---|---|---|
| Lifetime | Transient. A lease with an expiry. | Durable. It outlives any run. |
| Question | "Who is touching this right now?" | "Whose responsibility is this?" |
| Holder | One worker run, with a fresh `owner_id` each run. | A person or a team. |
| Where it lives | The `work-claim` backend namespace. | Nowhere in Wowbagger today. |

These are not the same thing, and a ledger can legitimately want both, one, or
neither. This decision is not that the durable question is unimportant. It is
that the durable question does not need a ledger field today, and that the
practical need in front of us — knowing whether somebody else is already on an
item — is met by claims.

### Why no field today

A durable ownership field costs more than it returns at this stage:

- It is a contract field, so every backend, adapter, and validator must agree
  on its syntax, its liveness, and what an unknown owner means.
- It has no defined semantics for ready selection. An item owned by an absent
  person is either ready or not ready, and the answer is consumer policy, not
  core semantics. Wowbagger core does not hold policy.
- It invites readers to treat it as a lock. It is not one. Advisory claims are
  already honest that they enforce nothing; a frontmatter owner name would be
  weaker still and look stronger.
- Structured provenance already records where an item came from, which covers
  the common reason people reach for an owner field.

### If ownership ever returns

It MUST be specified before it is implemented. The failure this ADR corrects is
exactly a field that existed in prose and then vanished without an ADR.
A returning ownership field needs, at minimum: its syntax and validation rules
in SPEC.md section 4, its relationship to `owner_id` in the work-claim
contract, its effect on ready selection or an explicit statement that it has
none, and its own ADR superseding this one.

## Alternatives considered

### Add an owner field to schema version 1 frontmatter now

Rejected, but not dismissed. The maintainer raised ownership directly and
believed it was required. It was rejected after the claim/ownership distinction
above was stated in plain terms, because the practical need behind the request —
knowing whether somebody else is already on an item — is met by claims today,
and no consumer has yet hit a case that claims cannot answer. It is a contract
field with undefined ready-selection semantics. It would also duplicate the
claim contract's `owner_id` at a
different lifetime, and readers would conflate the two — which is the confusion
this ADR exists to prevent.

### Declare ownership a claim concern and close the question

Rejected as written. It is nearly the accepted answer, but it is not honest.
Claims answer the transient question only. Saying claims *are* ownership would
bury a real distinction and guarantee the question reopens the first time
somebody wants to know who is responsible for a backlog item nobody is
currently working on.

### Restore ownership because priority was restored

Rejected. Priority was restored because it was fully specified, its removal
broke a consumer, and the restoration put back an existing design. Ownership
has none of those properties: it was never specified, no consumer has hit a
hole, and there is nothing to restore. Symmetry with priority is not a reason.

### Leave the question unrecorded

Rejected. That is the state this ADR corrects. An unrecorded question is
reopened by every consumer who notices the gap, and each one pays the cost of
tracing the history again.

## Consequences

- Schema version 1 has no ownership field, and no adapter or consumer may
  invent one and expect the core to honour it.
- The transient question is answered by the work-claim contract, within its
  advertised advisory limits. A claim is not proof of responsibility, and an
  expired claim reassigns nothing.
- Consumers that need durable ownership keep it in their own system and map to
  Wowbagger items by immutable ID.
- The question is closed for standalone v0. Reopening it needs new evidence — a
  consumer need that claims genuinely cannot meet — and a superseding ADR.
