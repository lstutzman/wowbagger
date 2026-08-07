---
schema_version: 1
id: wb_01KZCRA000XRT6Z7Z5YE6QZRDK
title: "Carry priority and number in the core view, or say why they are absent"
kind: task
status: backlog
created: 2026-08-07
updated: 2026-08-07
provenance:
  source: "maintainer-dogfood/wowbagger"
  recorded_at: "2026-08-07T15:45:00.000Z"
depends_on: []
related: []
parent: wb_01KZ77NSW8PNA4S48NYT26AGMH
priority: 5
number: 37
decisions:
  - action: accept
    date: 2026-08-07
    summary: "Accept: priority and number are validated schema fields absent from the core view."
    rationale: "Confirmed live while filing this batch: an item file carrying priority 10 and number 35 returns neither from inspect. The contract lists core members exhaustively and that list predates both fields, so each falls through to the permitted-unknown clause. This is ADR 0006 inverted, and it weakens item 26, which was closed on the rule that frontmatter is read from core."
---

`priority` and `number` are schema version 1 fields. `src/validate.js` enforces
both: priority must be a non-negative integer, number must be a positive integer
unique within the ledger. `ready` sorts by priority. Items are referred to by
number in conversation.

Neither appears in `item.core`.

The normalized core view in `docs/mutation-contract.md` lists its members
exhaustively, and that list still reads as it did before `b0ee411` restored
priority and `eac8954` added number. Both fields fall through to the clause for
"permitted unknown top-level fields", which are omitted from core and left
recoverable from `source_base64`.

So the two fields this ledger most recently made first-class are the two a
consumer cannot read from any result without base64-decoding the file.
Confirmed live while filing three items in this session:

    file:        priority: 10, number: 35
    item.core:   created, depends_on, id, kind, parent, provenance,
                 related, schema_version, status, title, updated

This is the failure ADR 0006 describes, in the other direction. There the
contract text lost a field the code still needed. Here the code gained two
fields the contract text never learned about. Neither had an ADR.

It also weakens item 26's answer. That item was closed on the grounds that a
caller learns the assigned status from `item.core.status`, which is true. The
same caller cannot learn the item's priority the same way, so the rule "read
frontmatter from core" holds only for the fields core happens to carry.

The decision is which way to close the gap, and it belongs to the contract:

- **Carry them.** Add priority and number to the core view. This is the answer
  that matches how the fields are actually used, and it is what a consumer
  expects. It changes the byte-compared mutation fixtures and the adapter
  oracle, so it is a deliberate contract change, not a fix.
- **Leave them out and say so.** Declare the core view a deliberately minimal
  identity-and-lifecycle projection, and state that ranking and handle fields
  live outside it. Cheaper, but a consumer must decode base64 to read a
  priority, which is the friction item 26 was filed about.

The first is recommended. The second is defensible only if something is gained
by the smaller view, and nothing obvious is.

Related, and the reason this matters beyond wowbagger's own ledger: every
PropertyCompass extension field has the same problem. `severity`, `complexity`,
`tags` and the rest are all invisible in inspect output.

Acceptance:

- a decision is recorded on whether the core view carries priority and number;
- `docs/mutation-contract.md` and the implementation agree, whichever way it
  goes, with the member list stated as exhaustive; and
- a test pins the core member set, so the next field added to the schema cannot
  silently miss the view again.

Surfaced 2026-08-07 while filing items through the CLI, one commit after both
fields shipped.
