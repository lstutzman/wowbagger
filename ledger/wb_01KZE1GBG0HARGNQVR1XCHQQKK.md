---
schema_version: 1
id: wb_01KZE1GBG0HARGNQVR1XCHQQKK
number: 31
title: "Release-note the claim request __proto__ behaviour change"
kind: task
status: done
created: 2026-08-07
updated: 2026-08-07
completed: 2026-08-07
provenance:
  source: "maintainer-dogfood/wowbagger"
  recorded_at: "2026-08-07T12:00:00.000Z"
depends_on: []
related: []
parent: wb_01KZ77NSW8PNA4S48NYT26AGMH
priority: 20
decisions:
  - action: accept
    date: 2026-08-07
    summary: "Accepted: a behaviour change shipped inside a commit about the adapter."
    rationale: "Consolidating four drifted JSON normalizers changed how claim requests treat an own __proto__ member. The change is correct and tested; it simply needs recording as a behaviour change rather than a refactor. If there is nowhere to record it, that absence is the finding."
  - action: complete
    date: 2026-08-07
    summary: "Completed: CHANGELOG.md exists and records the __proto__ change as a behaviour change."
    rationale: "The item said that if there were nowhere to record a behaviour change, that absence was the finding. There was nowhere, so the file was created. The claim-request __proto__ refusal is recorded as a behaviour change rather than a refactor, with the mechanism: the conformance runner and the code it measured disagreed on exactly that input. Six adapter fixes that had shipped unrecorded were back-filled, along with the priority restoration and the number field."
---

`src/cli.js` changed behaviour outside the adapter work that prompted it. A
claim request carrying an own `__proto__` member is now refused as
`invalid-request` rather than silently accepted with the member erased.

It came from consolidating four drifted copies of the same JSON normalizer into
one shared implementation in `src/request.js`. Three copies rebuilt objects with
assignment, which for the key `__proto__` invokes the prototype setter and drops
the member as an own key; one used `Object.fromEntries` and kept it. The
measuring instrument and the thing being measured disagreed on exactly that
input, so the shipped adapter accepted a request its own conformance runner
would have refused.

The fix is correct and tested, and 112 claim tests pass unchanged. The point of
this item is only that it is a **behaviour change, not a refactor**, and it
shipped inside a commit about the adapter.

No stored data is affected: the old code erased such a member before it could be
persisted, so no ledger can contain one.

Acceptance:

- the change appears in whatever release notes or changelog the first tagged
  release carries, described as a behaviour change; and
- if no changelog exists yet, that is the finding — a project shipping a
  consumable plugin needs somewhere to record behaviour changes.

Surfaced 2026-08-07 by the whole-branch review of the adapter work.
