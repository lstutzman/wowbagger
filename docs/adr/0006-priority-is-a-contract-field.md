# ADR 0006: Priority is a contract field, and a contract field is not removed in a documentation commit

Status: accepted; priority is restored and validated by the core

## Context

Priority was part of Wowbagger from the first day. `3f1a5e5`
(4 August 2026, 14:17), the founding project-direction commit, read:

    YAML metadata for lifecycle, priority, dependencies, and ownership.

`73245c1` (4 August 2026, 18:14) specified it fully. `priority` is an optional
non-negative integer. A consumer policy supplies it. Lower values sort first.
Wowbagger core reports the supplied value. The core never invents,
recalculates, or persists one. The same commit defined a four-step ready
ordering:

1. items with priority before items without priority;
2. ascending priority;
3. ascending created date;
4. ascending immutable ID.

It also gave the ready-selection fixtures worked priorities at 1, 5, 10, and
20.

Four hours later `1058b8c` (4 August 2026, 18:35), titled "docs: tighten
standalone ledger invariants", removed priority from the README, SPEC,
ADR-0001, the standalone plan, and every ready-selection fixture. It replaced
the four-step ordering with two steps: ascending created date, then ascending
immutable ID. No ADR records that removal. The commit message does not mention
it. The only surviving trace is in ADR-0001, where "priority positions are
optional consumer views" became "display positions".

A consumer hit the resulting hole three days later. Ready sorted by creation
date alone, so it had buried every dogfood finding at the bottom of the ready
queue — the position furthest from the attention the findings were filed to
attract.

`b0ee411` (7 August 2026) restored the original four-step rule verbatim. It
also added validation the original never had: `priority` MUST be a non-negative
integer. Before that validation, `priority: high` validated clean. A restored
ordering would have read that value, found it was not a number, and silently
ignored it.

## Decision

### The cause of the removal is unknown, and is recorded as unknown

Nobody knows why `1058b8c` removed priority. It may have been a deliberate
narrowing of version 0 scope. It may have been accidental collateral in a
tidying pass. The commit message, the diff, and the surrounding history give no
evidence either way. This ADR records the cause as unknown rather than
inventing one. A guessed cause in the record is worse than an honest gap,
because a later reader would treat the guess as a decision.

### Priority is a contract field. It is restored, and it stays

`priority` is part of the version 1 item schema and part of deterministic ready
semantics, as SPEC.md sections 4 and 8 now state. Its removal requires a new
ADR, not another edit.

### A contract field is never removed inside a documentation commit

This is the discipline rule the incident establishes. Removing a contract field
requires its own ADR and its own commit. A commit that removes a contract field
does one thing, says so in its subject line, and points at the ADR that decided
it.

The rule is not style. Wowbagger's own ledger has a `decisions:` field, and
SPEC.md section 7 requires an action, a date, a summary, and a rationale on
every record. That field exists precisely to make a removal visible and
attributable. Wowbagger would have caught this about itself if the removal had
gone through its own ledger. It did not, so nothing caught it for three days,
and a consumer paid the cost.

## Alternatives considered

### Leave priority absent and record the removal as intentional

Rejected. It assumes a cause nobody can evidence. It also leaves the consumer
problem unsolved: without priority, ready cannot express what to do first, and
creation order is the wrong answer for a queue.

### Design a new priority mechanism

Rejected. The original specification was complete, tested against worked
fixtures, and correct. A new design would have to justify itself against a
specification that already worked, and would invalidate the existing fixtures
for no gain.

### Let the core calculate priority

Rejected, and it was rejected in `73245c1` for the same reason. Ranking is
consumer policy. A core that calculates priority becomes a policy engine, and
two consumers with different policies then disagree about the same ledger.

### Restore priority without validation

Rejected. `priority: high` used to validate clean. A restored ordering would
have read a non-numeric value and ignored it, so the ledger would look ordered
and behave unordered. That failure is quieter than the one this ADR corrects.

## Consequences

- `priority` is an optional non-negative integer on every version 1 item. An
  invalid value is a validation error, not a silently ignored one.
- Ready output uses the four-step ordering. Steps three and four are the
  creation-order behaviour that existed between `1058b8c` and `b0ee411`, so
  ledgers with no priority at all sort exactly as before.
- Removing `priority`, or any other contract field, needs an ADR and a
  dedicated commit.
- The cause of the original removal stays unknown in the record. A later reader
  who finds evidence may add it; nobody should reconstruct it from inference.

## Deferred decisions

- Whether ownership returns. It was deleted in the same commit, the same way.
  [ADR 0007](0007-ownership-is-deliberately-absent.md) records that decision.
- Any consumer's policy for choosing priority values. The core reports the
  supplied value and calculates nothing.
