---
schema_version: 1
id: wb_01KZFAPQ0031YF18ZBBSDSGC4X
title: "The duplicate-number race moved from create to patch, it did not go away"
kind: task
status: backlog
created: 2026-08-08
updated: 2026-08-08
provenance:
  source: "maintainer-dogfood/wowbagger"
  recorded_at: "2026-08-08T11:00:00.000Z"
depends_on: []
related: []
parent: wb_01KZ77NSW8PNA4S48NYT26AGMH
priority: 10
number: 44
decisions:
  - action: accept
    date: 2026-08-08
    summary: "Accepted: the duplicate-number race was relocated from create to patch."
    rationale: "lockIdsForPatch locks the target, its parent and its dependencies, and nothing else, while duplicate-number is a ledger-wide constraint. Two patches setting the same number on different items hold disjoint locks and can both publish. Refusing number at create removed the symptom from one command and left the cause under another. Reasoned from the lock set rather than reproduced, which the item says plainly."
  - action: record
    date: 2026-08-08
    summary: "Rank at 10 and allocate handle 44."
    rationale: "Filed by patching after create, which is the flow these two items are about — the second operation nothing prompts."
---

A review round found that two concurrent `create` calls could each publish the
same `number`, because `lockIdsForCreate` locks only the new item's ID and
`duplicate-number` is a ledger-wide constraint. The fix made `create` refuse
`number` outright.

That removed the symptom from `create` and left the cause in place. `patch` now
owns `number`, and `lockIdsForPatch` (`src/mutation.js`) locks:

    the target item, its parent, and its depends_on entries

It does not lock any other item. Two patches setting `number: 7` on **different**
items therefore hold disjoint locks, take independent ledger snapshots, each
validate a candidate in which 7 is unique, and each publish. The result is two
items with number 7, which `validate` then rejects as `duplicate-number` — so
every later `create`, `patch` and `transition` returns `ledger-invalid` at exit 3
until a human edits a file by hand.

This is the same race, the same window, and the same recovery cost as the one
that was reported against `create`. The remedy relocated it.

**Stated honestly about method:** this is reasoned from the lock set and the
validator, not reproduced by running two writers concurrently. The decisive
facts are checked — `lockIdsForPatch` returns only those IDs, and
`src/validate.js` raises `duplicate-number` across the whole ledger — but a
reproduction would be stronger evidence and should exist before the fix is
accepted.

The honest options, and the choice is a contract decision:

- **Allocate the number rather than accepting one.** A caller that cannot choose
  the value cannot collide on it. This is the shape `create`'s caller-generated
  ULID deliberately avoided, and for the same reason it would need coordination
  the current design does not have.
- **Lock the ledger for a number change.** Correct, and it makes one narrow
  operation a global writer, which the coordination scope currently forbids.
- **Accept the race and make recovery cheap.** A duplicate is already a
  validation error that a merge resolves, and item 28 argued exactly that: a
  duplicate `number` is recoverable because the ULID still distinguishes the
  items. If this is the answer, the contract should say so, and refusing
  `number` at create becomes unjustified for the same reason.

The third is probably right and the current state is the worst of the three: the
race exists, the contract does not admit it, and `create` is restricted as
though it had been solved.

Acceptance:

- a concurrent reproduction exists, or the race is shown not to occur;
- the contract states which of the three answers holds for `number`; and
- whatever holds applies to `create` and `patch` alike, rather than one being
  restricted because the other was not.

Surfaced 2026-08-08 while asking whether an earlier fix had solved the problem
or relocated it.
