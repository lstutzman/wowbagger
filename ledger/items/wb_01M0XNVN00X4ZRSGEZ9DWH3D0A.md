---
schema_version: 2
id: wb_01M0XNVN00X4ZRSGEZ9DWH3D0A
number: 167
title: "Remove the false live-item precondition from parent-migrate help"
kind: task
priority: 3
status: backlog
created: 2026-08-26
updated: 2026-08-26
provenance:
  source: "exploratory-stress/2026-08-26/phase2-help"
  recorded_at: "2026-08-26T22:53:00.000Z"
depends_on: []
related: [ wb_01M0XNVN00TRMBY86QXZV6EH3D ]
tags:
  - "stress-run-2026-08-26-alpha10"
  - "documentation-defect"
decisions:
  - action: accept
    date: 2026-08-26
    summary: "Accept the parent-migrate help-text defect."
    rationale: "The command correctly supports terminal items, while help invents a live-item precondition and needs a wording-only correction."
---
## Help-text defect

Pinned source summary is exactly:

```text
Move one live item to or from an epic with CAS fencing.
```

Rendered output is exactly:

```text
wowbagger parent-migrate — Move one live item to or from an epic with CAS fencing.
```

The word `live` invents a liveness/status precondition. `parent-migrate` has no such precondition and correctly moved terminal done items #11 and #107 when each request date equaled the item's existing `updated`. A caller can wrongly conclude historical items cannot be reparented.

## Version and evidence provenance

- Distribution: `0.1.0-alpha.10`.
- Binary: `/Users/leestutzman/.nvm/versions/node/v20.20.2/bin/wowbagger`, resolving to `/Users/leestutzman/Documents/GitHub/wowbagger/bin/wowbagger.js`.
- Source HEAD: `b06db85c42d3795a82ad0b57b400e1c7b9a7025b`, clean, local `main` ahead of `origin/main` by two metadata-only commits.
- Recovery ref: local annotated tag `v0.1.0-alpha.10`, unpushed.
- Ahead commits: `b06db85` Cut 0.1.0-alpha.10; `e6c012f` Prepare alpha10 release notes. Neither changes behavior.
- Reproducibility: exact pinned tree is local-only; tested behavior is present on published `origin/main`, which reports alpha.9.
- Evidence came post-reinitialization from on-disk drivers and direct CLI. No shared eval-kernel evidence supports this item.

## Inline evidence

Item #107 was `done`, with `updated` and `completed` both `2026-09-03`. A request using its fresh revision, its current epic #5 as `expected_parent`, `parent: null`, and `date: 2026-09-03` returned exit 0, state committed, removed the parent, created Git commit `3be6619`, and left the ledger valid. Independent done item #11 also detached successfully at `date == updated`.

## Source adjudication

At pinned source `src/cli.js:122`, `COMMAND_SUMMARIES` carries the false `live` wording. `src/mutation.js:932-961` validates request shape. `src/mutation.js:963-1015` checks date floors, `expected_parent` CAS, self-parent, and that a non-null parent exists with `kind === epic`; it never checks target status. Kind, not status, constrains parent migration.

The #11 and #107 successes are correct behavior and must not be fixed by adding a liveness precondition. This item asks for a help-string correction only.

## Acceptance criteria

- Replace the summary with contract-accurate wording and pin rendered help in a test.
- Cross-link #166, which supplies the actual constraint: any item may migrate, but a done, killed, archived, or deferred item may do so only at its existing `updated` date.
- Do not add a status/liveness guard to `parent-migrate`.
- Current Node, Node 20, adapter conformance, and ledger validation gates pass.

No fix is included. No production code was edited during this campaign. Implementation requires separate user-approved work.
