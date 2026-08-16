---
schema_version: 2
id: wb_01M05ESRM258XEJJW7G15TXJ68
number: 98
title: "Drop the misleading clause from the foreign-writer remediation"
kind: task
priority: 10
status: done
created: 2026-08-16
updated: 2026-08-16
completed: 2026-08-16
provenance:
  source: "maintainer-dogfood"
  recorded_at: "2026-08-16T14:14:51Z"
depends_on: []
related: []
decisions:
  - action: accept
    date: 2026-08-16
    summary: "Accept into the backlog."
    rationale: "Lee accepted on 2026-08-16. Cheap honesty fix proven misleading by the #89 fixture."
  - action: complete
    date: 2026-08-16
    summary: "Foreign-writer remediation names only the working recovery."
    rationale: "Synchronize (pull or merge), then claim-verify here - the claim-verify-in-the-writing-worktree clause item 89 proved useless is gone. Pins and contract section 6 aligned."
---

Found during item #89's two-worktree fixture work: the `worktree-synchronization-required` remediation string is half wrong. It reads "Run claim-verify in the worktree that wrote `<path>` after committing it, or synchronize this worktree to that commit." The #89 fixture's vector 2 proves the first clause does not help the blocked reader: claim-verify in the writing worktree finalizes that worktree only and leaves the sibling blocked. Only the second clause (synchronize) works.

Scope: drop or reword the misleading first clause so the remediation names only the action that unblocks the reader (wait for the writing worktree's commit to become visible, pull or merge, then claim-verify here). One template literal in src/claim-publication.js plus the test pins that assert the string (item #89 added deep-equal pins on the whole finding object in test/cross-worktree-coordination.test.js; the docs in work-claim-contract section 3.2 already teach the correct recovery).

Acceptance:
- The foreign-writer remediation string names only the working recovery; the two-worktree fixture pins the new wording.
- Contract section 3.2 prose and the emitted string agree.
- Gate green on both runtimes.
