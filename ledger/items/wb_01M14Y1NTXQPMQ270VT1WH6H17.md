---
schema_version: 2
id: wb_01M14Y1NTXQPMQ270VT1WH6H17
number: 181
title: "Prevent duplicate schema-v2 numbers across worktrees"
kind: task
priority: 1
status: done
created: 2026-08-28
updated: 2026-08-29
completed: 2026-08-29
provenance:
  source: "PropertyCompass2 field failures"
  recorded_at: "2026-08-28T19:38:40Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-29
    summary: "Accept the cross-worktree number allocation safety fix."
    rationale: "Ordinary sequential creates in stale cooperating worktrees can commit duplicate immutable numbers and invalidate the whole ledger. The approved design at c947a29 journal-fences create under the shared namespace lock, validates the complete candidate before publication, refuses stale creates unchanged, preserves the ledger as number authority, and leaves existing duplicate recovery to #182. The implementation plan is committed at 2340584."
  - action: complete
    date: 2026-08-29
    summary: "Complete the cross-worktree number allocation fence."
    rationale: "Journal-fenced create now prevents duplicate numbers across cooperating alpha.14 worktrees sharing one Git common directory. Lee confirmed the PropertyCompass2 incident was same-clone, so the reported failure is covered. Separate clones, separate machines, alpha.13 journal-silent writers before cutover, and noncooperating manual writes remain outside the guarantee; integration plus validate remains their backstop. Create now commits intent before atomic publication, validates the complete candidate under the namespace fence, pairs terminal or abort exactly once, recovers committed/absent/unknown outcomes, and auto-commits item plus reconciliation log without absorbing prior dirt. Stale allocation refuses unchanged; the tested escape synchronizes Git, clears claim-verify, and commits the identical request file and ID at the next number. Alpha.14 requires commit-per-create because a create has no authorized predecessor from which reconciliation can reason; other mutations retain the authorized predecessor/successor window while the workflow still requires commits. #186 owns safe batch-create design. Upgrade every writer before the first alpha.14 create: published alpha.13 was executed against real new journal bytes and failed closed with claim-store-unavailable / claim-store-unreadable, state unchanged, and no item write. Current Node and Node 20 each passed 1819 tests; adapter conformance passed; ledger validation and claim verification were clean; npm audit found zero vulnerabilities; final whole-range review found no Critical, Important, or Minor issue. Implementation is on main at 7175177; alpha.14 publication remains an explicit external-side-effect decision and has not happened."
---
## Problem

PropertyCompass2 observed successful schema-v2 creates publish duplicate human-facing numbers. Existing advertising mirrors `wb_01M14JTJBCSGHGKF7BX9BS22B4` / #1685 (create `bc39320a9`) and `wb_01M14JWGEMHM6BRB3V27F777H9` / #1686 (`bb233c9f7`) were followed by successful mentorship creates `wb_01M14K5MKX474PN1C8K6YV836B` and `wb_01M14M0NW9JD5X0SWDSDHG3QZ4`, also published as #1685/#1686 (`e9862b341` / `a629e6551`). `wowbagger validate` then failed globally with `duplicate-number` on all four items.

A create must never return committed when its assigned number already exists in committed ledger bytes. Evidence suggests stale or concurrent number allocation across worktrees or journal surfaces. Determine whether this is reachable in current Wowbagger through ordinary cooperating use or depends on consumer misuse; if ordinary, treat it as a live core safety defect.

## Emergency repair already performed

Lee ruled the advertising items were newer business work. PropertyCompass2 manually changed their numbers to free #1693/#1694, committed those out-of-band bytes, then CAS `claim-adopt`ed both revisions. Advertising legacy #1692/#1693 now bind to ledger #1693/#1694 through `data.legacy_id`; duplicate numbers are gone and `wowbagger validate` passes. This worked but is not a sanctioned recovery procedure.

## Acceptance criteria

- Reproduce duplicate allocation through public create seams across cooperating worktrees or identify the exact unsupported consumer action required.
- Serialize number allocation against the committed ledger state within one Git coordination domain.
- Validate the complete candidate ledger under the allocation fence immediately before publication.
- A stale or concurrent create whose candidate number now exists refuses unchanged; it never reports committed.
- Preserve atomic no-clobber item publication and core-assigned immutable numbering.
- Add current Node and Node 20 public regressions plus cross-worktree contention coverage.
