# ADR 0006: Record the removal and restoration of priority

Status: accepted 2026-08-08

## Context

`priority` was specified, deleted, and restored, and until this record the
middle step had no explanation anywhere:

- `3f1a5e5` (4 Aug) set the founding direction: "YAML metadata for lifecycle,
  priority, dependencies, and ownership".
- `73245c1` (4 Aug) fully specified priority: a non-negative integer supplied
  by a consumer policy, lower values first, core never calculates it, a
  four-step ready ordering, and worked fixtures at 1/5/10/20.
- `1058b8c` (4 Aug, "docs: tighten standalone ledger invariants") removed
  priority from the README, SPEC.md, ADR-0001, the standalone plan, and every
  ready-selection fixture. Ownership left the founding metadata line in the
  same commit. No ADR records either removal and the commit message mentions
  neither.
- Three days later the tinydancer dogfood filed friction items and found them
  sorted to positions 15 and 16 of 16 — creation order had buried exactly the
  findings the queue existed to surface.
- `b0ee411` (7 Aug) restored the original four-step ordering verbatim and
  added the validation the original never had (`priority` must be a
  non-negative integer; before that, `priority: high` validated clean).

## What the evidence shows

The removal was deliberate in execution. Three separate hunks of `1058b8c`
each *replace* the removed concern with a reassignment rather than merely
deleting text:

- SPEC.md: the four-step ordering became "A later consumer policy MAY rank or
  decorate the returned set".
- ADR-0001: "priority positions are optional consumer views" became "display
  positions", and the out-of-scope list gained "policy ranking".
- The founding line became "YAML metadata for lifecycle, dependencies, and
  structured provenance", and the deferred list gained "The claim envelope,
  ownership model, expiry, and renewal behaviour".

Every ready-selection fixture was rewritten in the same commit. That is not
an editing accident; it is a scope-narrowing pass that moved ranking out of
core and ownership toward the claim contract.

What the evidence does not show is the rationale. Nothing records why a
member that was fully specified four hours earlier — with worked fixtures —
stopped being core. The reason is recorded here as unknown, and the question
is closed: re-deriving intent from the diff is as far as the record goes.

## Decision

1. The removal is recorded as deliberate but unjustified: intent is evidenced
   by the replacement prose, the rationale was never written down, and the
   restoration at `b0ee411` stands. Priority is core: the four-step ordering
   and integer validation are the contract.
2. Ownership is a separate decision and is tracked as its own ledger item
   (wb_01KZE1GBG0QGB161XH2VFVBFXB); this ADR does not settle it.
3. Discipline, stated so the same failure cannot recur unnoticed: a contract
   member is never removed in a documentation commit. Removing or weakening
   anything SPEC.md specifies requires its own commit whose message names the
   change, and an ADR or a ledger decision record. A tidying pass that finds
   itself deleting a specified member stops and files an item instead.

## Consequences

- The three-day detection gap is the argument for the discipline: the
  ledger's `decisions:` field exists to catch exactly this, and Wowbagger
  would have caught it about itself had the removal gone through its own
  ledger.
- Any future proposal to remove priority starts from this record, not from a
  clean slate.
