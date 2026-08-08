---
schema_version: 1
id: wb_01KZA5VGVR0W5ZJMV6G8K5F77P
number: 15
title: "Reconcile create's default item path with repository naming"
kind: task
status: done
created: 2026-08-05
updated: 2026-08-08
completed: 2026-08-08
provenance:
  source: "repository-backlog"
  recorded_at: "2026-08-05T23:59:02Z"
depends_on: []
related: []
parent: wb_01KZ77NSW8PNA4S48NYT26AGMH
decisions:
  - action: accept
    date: 2026-08-05
    summary: "Accept the create default-path reconciliation."
    rationale: "Filing this repository's own items through the CLI exposed the mismatch, so the tool owes a decision on what it guarantees about the filename."
  - action: complete
    date: 2026-08-08
    summary: "Decided: the default path stays identity-derived; conventions are Git renames after create."
    rationale: "The no-clobber publication protocol and every collision rule are defined against the identity-derived default; an arbitrary or templated path member would let a caller aim them elsewhere and buys nothing that a rename does not. The tool guarantees: create writes <ledger>/<id>.md, the filename is never identity, and a repository convention is applied by renaming in Git afterwards — reviewable, and validation-neutral because identity resolves from frontmatter. The mutation contract now states this where the default path is defined. Reopen trigger: a consumer whose tooling cannot tolerate the create-then-rename window asks; a constrained, collision-checked template would then be specified before implementation, per ADR-0006's discipline."
---

Create writes every new item to <ledger>/<id>.md and admits no path member,
so it cannot produce a filename matching a repository's own naming convention.
This ledger names its files <date>-<slug>.md, so filing an item through the CLI
requires a follow-up rename. Create also leaves the new file untracked, so that
rename needs a git add first.

Decide whether the default path should stay identity-derived, whether a
convention is expressible without letting a caller choose an arbitrary path, and
what the tool should guarantee about the filename. Identity must keep resolving
from frontmatter, not from the filename.

Found by using the tool on this repository's own backlog.
