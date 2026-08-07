---
schema_version: 1
id: wb_01KZCRA000REB43BDEVZBM37F3
title: "Decide whether a mutation may reformat an unpatched flow collection"
kind: task
status: backlog
created: 2026-08-07
updated: 2026-08-07
provenance:
  source: "maintainer-dogfood/wowbagger"
  recorded_at: "2026-08-07T17:30:00.000Z"
depends_on: []
related: []
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
priority: 10
number: 38
decisions:
  - action: accept
    date: 2026-08-07
    summary: "Accepted: a mutation reformats a flow collection it was not asked to touch."
    rationale: "Verified for both patch and transition, so it is pre-existing rather than a regression from the patch work. It is not a validation hole — node identity is genuinely preserved — but the contract sentence can be read as a promise about bytes or about nodes, and nothing says which. PropertyCompass writes flow-style tags on 1260 of 1473 items, so the ambiguity turns into 1260 spurious diffs on first migration."
---

A mutation rewrites a flow-style collection it was never asked to touch.

    before:  tags: [bug, stripe]
    after:   tags: [ bug, stripe ]

Verified against the real CLI for **both** `patch` and `transition`, so this is
not new. `transition` has behaved this way since long before `patch` existed;
it surfaced while checking whether the new patch operation preserved unpatched
fields, and it does exactly as well as transition does — which is the point.

The node identity check passes because the node is semantically unchanged: same
key, same sequence, same scalars. Only the flow presentation differs. So this
is not a validation hole; it is a question about what the contract promises.

`docs/mutation-contract.md` says transition "preserves every permitted
extension YAML node, including tags, aliases, mapping structure, scalar
precision, and extra provenance members". A reader can take that as a promise
about **nodes**, which is kept, or about **bytes**, which is not. The two
readings differ only in presentation, and nothing states which one is meant.

**Why it matters now.** PropertyCompass writes `tags: [bug, stripe]` in flow
style, and 1260 of its 1473 items carry a `tags` list. If wowbagger reformats
that on every mutation, the first transition of each item produces a whitespace
diff nobody asked for, on a field the mutation never named. Across a migration
that is 1260 spurious diffs, each one noise in a review that is supposed to make
ledger changes auditable.

Options, and the choice belongs to the contract:

- **Promise nodes, not bytes.** State plainly that presentation may be
  normalised and that only node identity is preserved. Cheapest, and it is what
  the code already does. It costs the migration a one-off reformat commit.
- **Promise bytes for unpatched fields.** Preserve the original source range of
  any pair the mutation did not name. Stronger and matches what a reader
  expects from "plain Markdown and Git", but it is real work in the serializer.

The second is the better promise for a tool whose thesis is that the ledger is
just text in Git. The first is honest and free. Either is defensible; the
current state — an ambiguous sentence and a silent reformat — is not.

Acceptance:

- the contract states whether a mutation preserves bytes or only nodes for a
  field it did not name;
- the implementation matches whichever is chosen, for `patch` and `transition`
  alike; and
- a test pins it, using a flow-style collection, so the answer cannot drift.

Surfaced 2026-08-07 while verifying the patch defect fixes. Pre-existing in
transition; not a regression.
