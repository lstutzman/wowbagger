---
schema_version: 2
id: wb_01M05FJKJFKMHHTS3YMBAG3WXC
number: 105
title: "Give the item body a sanctioned mutation verb"
kind: task
priority: 10
status: backlog
created: 2026-08-16
updated: 2026-08-16
provenance:
  source: "maintainer-dogfood"
  recorded_at: "2026-08-16T14:28:25Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-16
    summary: "Accept into the backlog."
    rationale: "Field friction 11: mirror-based consumers need body writes more than priority writes; hand-edits bypass the managed path today."
---

Field friction 11 from PropertyCompass2 (docs/wowbagger-feedback.md, commits 0f1243821/badcd6bf2): an item's body has no sanctioned mutation verb. `transition` refuses a body by contract; `patch` (post-#90) changes priority, depends_on, and related only. Mirror-based consumers (every ledger item mirrors a legacy backlog card that keeps being edited) hand-edit the Markdown and bump `updated` — works, validates, bypasses the managed path entirely. Concrete damage: consumer item #1475 was `done` in the ledger while its card read `backlog` for a day; the parent epic's checklist disagreed with both. Body rot is invisible to `validate` because body content is not an invariant.

Consumer asks: extend `patch` to `body` (and `tags`/`data`), or a dedicated `wowbagger amend --body <file>` that revalidates and republishes without touching the lifecycle.

Scope (decide the verb shape first, then implement):
1. Decide: `patch` set gains `body`, or a separate amend verb. Bias from #90's precedent: patch already carries the lock/CAS/candidate-validation machinery and the whole-value-replace semantics fit (body is one value). But body is not frontmatter — the contract's §9 promotion rules and the "patch changes caller-supplied fields" framing need explicit widening either way. `tags`/`data` ride the existing permitted-extension-member channel; decide whether extension members join the patchable set in the same move or stay out (smaller is safer — body alone answers the field pain).
2. Request shape: body as a JSON string (same rules as create's body member: empty and LF-leading distinct and valid). Exact-byte CAS against expected_revision as today; updated set to request.date.
3. Lossless preservation of every frontmatter byte (anchors, aliases, extension members) — the #90 serialization lessons apply; the body swap must not rewrite frontmatter at all.
4. Claimed items stay refused, same as every patch.
5. Contract §9, oracle mirror, conformance fixtures, skill (the mirror-sync use case is exactly what agents need to read), all in lockstep, mutation-guarded both directions.

Acceptance:
- A fixture proves a body-only patch changes the body bytes exactly, bumps updated, and leaves every other frontmatter byte identical.
- Refusals: claimed item, revision conflict, non-string body — all pinned.
- Oracle and core agree, mutation-guarded both directions; gate green on both runtimes.
