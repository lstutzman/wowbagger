---
schema_version: 1
id: wb_01KZ77NSW8ZP1289HFMN2ECNXD
title: "Deliver the Claude Code adapter"
kind: task
status: backlog
created: 2026-08-04
updated: 2026-08-06
provenance:
  source: "repository-backlog"
  recorded_at: "2026-08-04T20:33:09Z"
depends_on: []
related:
  - wb_01KZ77NSW876B92APQN8Q8NK6X
  - wb_01KZ77NSW8CG8NMNZ726CFKWQE
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
decisions:
  - action: accept
    date: 2026-08-04
    summary: "A Claude Code adapter is accepted as standalone integration work."
    rationale: "Claude Code is an initial compatibility target, but it must remain an adapter rather than the core architecture."
  - action: reparent
    date: 2026-08-06
    summary: "Moved from the standalone v0 epic to the productization epic."
    rationale: "This is consumability work, not core work. Separating them lets the v0 epic close when the core is done instead of dragging distribution along with it."
  - action: record
    date: 2026-08-06
    summary: "Acceptance criteria pinned to adapter-contract section 10 Conformance and the vectors in spec/fixtures/adapters/."
    rationale: "The previous bar required passing 'the shared black-box compatibility evidence', a phrase that appears nowhere in the adapter contract. An unpinned bar on the work-claim contract produced four rejected review rounds; the item now names the fixture directory, the runner result shape, the case count, and the per-mode obligations, so it can be finished."
---

Build a thin Claude Code integration that invokes the common core contract and
is proven against `docs/adapter-contract.md` section 10 Conformance. The
adapter must add no behaviour the core does not have; path safety, authority,
instruction input, handoff, process containment, and negotiation are adapter
concerns and must not be pushed into the core.

The acceptance criteria are:

- an implementation runner exists that accepts the same fixture directory,
  `spec/fixtures/adapters/`, that `spec/run-adapter-vectors.js` accepts, and
  evaluates each assertion against the installed Claude Code entrypoint rather
  than against a reference model;
- the implementation runner emits the same result shape as the reference
  runner — top-level `status`, `implementations`, `observed_error_codes`, and
  `cases`, each case carrying `case`, `status`, `executed_mode`,
  `executed_assertions`, `assertion_evidence`, and `observed_error_codes` —
  plus the evidence platform the contract requires;
- every one of the 15 fixture cases lists `claude-code` in its targets, and the
  runner executes all 183 of their assertions against the adapter; a skipped,
  unknown, or unconsumed assertion fails the run, as does an
  `adapter_vector_version` other than exactly 1;
- for the three `equivalence` cases (`03-ready-forwarding`,
  `04-validation-failure-forwarding`, `10-capabilities-forwarding`) the adapter
  preserves the direct-core baseline exit code and the exact standard-output
  and standard-error bytes; an equivalent-looking reconstructed object is a
  failure, not a pass;
- for the `negative-capability` cases (`01-capability-separation`,
  `05-path-no-follow`, `06-bounded-output`, `07-mutation-approval`) the adapter
  refuses before core launch and does not manufacture a core result;
- for the `protocol` cases the adapter preserves the declared contract input or
  handoff without requiring a core command;
- the run is reported on a real native platform, and the section 10 status
  table's Claude Code column moves off `Unverified` for all eight requirement
  rows on the strength of that run; and
- the run happens inside a real git checkout. A `10-capabilities-forwarding`
  byte mismatch from a tarball or a `.git`-less container context is an
  environment fault, documented in `spec/fixtures/adapters/README.md`, and does
  not count as an adapter defect.

Passing the vectors on Node 26 and Node 20 is required, as it is for the rest
of the suite. Nothing here permits the adapter to advertise fenced claims or
safe exclusive dispatch; claims stay advisory until fencing is implemented.
