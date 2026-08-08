# ADR 0007: Ownership stays with claims; no durable ownership field

Status: accepted 2026-08-08

## Context

The founding direction (`3f1a5e5`) listed "YAML metadata for lifecycle,
priority, dependencies, and ownership". `1058b8c` removed ownership together
with priority, without a recorded reason (see ADR-0006). Priority was restored
at `b0ee411` after a consumer hit the hole. Ownership was never re-examined;
item wb_01KZE1GBG0QGB161XH2VFVBFXB exists because no decision was on record.

Two different questions hide under one word:

- **Transient**: who is touching this item right now. Answered by the
  work-claim contract — owner identity, lease, renewal, expiry — which has
  shipped as advisory claims.
- **Durable**: whose responsibility is this item. Not answered anywhere.

The `1058b8c` diff itself leaned this way: it added "The claim envelope,
ownership model, expiry, and renewal behaviour" to ADR-0001's deferred list
and stated that provenance "is not a claim of current worker ownership".

## Decision

Ownership is a claim concern. A durable `ownership` frontmatter field is
deliberately absent from schema version 1.

Reasons:

1. The transient question is already answered by the claim contract. Adding a
   frontmatter twin would create two places for one fact, and they would
   drift.
2. No consumer has asked the durable question. Both dogfoods surfaced
   priority, numbers, frontmatter patching, and ID minting — none surfaced
   responsibility. Priority returned because a consumer hit the hole;
   ownership earns its return the same way, not by symmetry with priority.
3. For the current consumers — single-maintainer ledgers — a responsibility
   field is decoration that reads as data, which is exactly what the priority
   decision record refused to stamp.

## Reopen trigger

A consumer with more than one durable responsible party asks for it. Then the
field is specified — SPEC table row, validation, ready/claim interaction, and
an ADR — before any implementation, per the discipline in ADR-0006. This
record is the starting point, not an obstacle: it exists so the next person
asks "has the trigger fired?" instead of re-deriving the question.

## Consequences

- Schema version 1 stays without an ownership field; validation does not
  reserve the name, so a consumer may carry one as an extension member at
  their own risk.
- Anyone needing "who is working on this" reads the claim store, not the
  frontmatter.
