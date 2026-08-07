---
schema_version: 1
id: wb_01KZCRA000EC7FXNJQ0KW8DFYT
title: "Give the unchanged-patch outcome an adapter conformance vector"
kind: task
status: backlog
created: 2026-08-07
updated: 2026-08-07
provenance:
  source: "maintainer-dogfood/wowbagger"
  recorded_at: "2026-08-07T22:00:00.000Z"
depends_on: []
related: []
parent: wb_01KZ77NSW8PNA4S48NYT26AGMH
decisions:
  - action: accept
    date: 2026-08-07
    summary: "Accepted: the unchanged-patch oracle rule is unreachable from third-party certification."
    rationale: "The patch-unchanged vector went into spec/fixtures/mutations/, which is byte-compared by the CLI vector runner and never calls mapProcessOutcome. Adapter certification reads spec/fixtures/adapters/, where no fixture produces an unchanged success. The rule is covered in-repo by a test proven non-vacuous, so this is a certification gap rather than an untested rule. The comment beside the new vector claimed otherwise, which is the second consecutive round where a comment asserted a property its artifact did not have."
---

A successful patch whose requested values are already in effect returns
`state: "unchanged"`. The oracle rule for that outcome,
`validUnchangedPatchCorrelation`, is reachable from an in-repo test but not
from third-party certification.

The two fixture trees are consumed by different runners:

- `spec/fixtures/mutations/` is byte-compared by `test/mutation-vectors.test.js`,
  which runs the CLI and diffs stdout. It never calls `mapProcessOutcome`.
- `spec/fixtures/adapters/` is what `spec/run-adapter-implementation.js` reads
  when certifying another implementation, and that path does run the oracle.

The `patch-unchanged` vector added in the ninth round went into the first tree.
It correctly pins the CLI's unchanged bytes, and the before and after digests
are identical, which is the claim it makes. It does not measure any adapter
against the oracle's unchanged rule.

So a third-party backend that returns `ok: true, state: "unchanged"` while
silently discarding every patch is still never checked against the rule written
to catch exactly that. In-repo, `adapter oracle refuses an unchanged patch whose
requested value is not in effect` covers it, and that test is proven
non-vacuous — deleting `patchValuesInEffect` makes it fail. Certification is the
gap.

Worth recording plainly: the comment added beside the new vector claimed it
closed this, and it did not. That is the second consecutive review round in
which a comment asserted a property the artifact underneath it did not have.

Acceptance:

- a fixture under `spec/fixtures/adapters/` produces a successful patch with
  `state: "unchanged"` and is exercised by `spec/run-adapter-implementation.js`;
- an implementation that returns that envelope while having discarded the patch
  fails the vector; and
- the coverage assertion in `test/patch-cli.test.js` names which tree each
  vector belongs to, so the two are not conflated again.

Surfaced 2026-08-07 by the ninth review round.
