---
schema_version: 1
id: wb_01KZFAPQ00JWPC1HRPWV2V7QSY
title: "An item cannot be born with a priority, so none of them are"
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
priority: 5
number: 43
decisions:
  - action: accept
    date: 2026-08-08
    summary: "Accepted: an item cannot be born with a priority, so none of them are."
    rationale: "Immediately after priority was restored, this repository accumulated 16 unprioritised ready items sorting by creation date below the prioritised block — item 30 reproduced one level down — and two items referred to by numbers they did not have. priority carries no cross-item constraint, so refusing it at create has no safety justification; it was collateral from sharing a code path with number."
  - action: record
    date: 2026-08-08
    summary: "Rank at 5 and allocate handle 43."
    rationale: "Filed by patching after create, which is the flow these two items are about — the second operation nothing prompts."
---

`create` refuses `priority` and `number` as controlled members, and neither is
required by the schema, so **every item is born with neither and validates
clean**. Acquiring either takes a second, separate `patch` that nothing prompts
and nothing checks.

The result is not hypothetical. Immediately after `priority` was restored and
`number` shipped, this repository's own ledger reached 42 items in which:

- 16 ready items had no priority at all, so they sorted by creation date below
  the prioritised block — **the exact defect item 30 was filed about, one level
  down**; and
- two items filed the same session had no number, and were referred to as
  "item 39" and "item 40" in a commit message before those numbers existed —
  the ULID-versus-handle confusion item 28 exists to prevent.

Both were corrected by hand afterwards. Neither would have been noticed without
someone reading the ready table and observing the dashes.

**The refusals are not equally justified.** `number` carries a ledger-wide
uniqueness constraint (`duplicate-number` in `src/validate.js`), and `create`
takes no ledger-wide lock, so refusing it there has a real reason — though see
the companion item, because `patch` has the same problem.

`priority` has no cross-item constraint whatsoever. `src/validate.js` checks only
that it is a non-negative integer. There is no uniqueness rule, no ordering rule,
nothing that another item's value can invalidate. It was refused at create only
because it travelled with `number` through the same dropped-extension code path,
and the fix that stopped create silently discarding both refused both.

So the field a consumer most wants to set when filing — the one whose absence
buried every dogfood finding at the bottom of the queue — is the one they cannot
set while filing, for no safety reason.

Acceptance:

- an item can be given a priority at create, validated exactly as `patch`
  validates it, or the contract states why not in terms of a constraint that
  actually exists;
- something surfaces items that carry no priority, so the omission is visible
  without reading a table for dashes; and
- whatever is decided for `number` follows from its uniqueness constraint rather
  than from having shared a code path with `priority`.

Surfaced 2026-08-08 while correcting this repository's own unprioritised
backlog.
