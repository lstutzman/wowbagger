---
schema_version: 1
id: wb_01KZA5VGVR0W5ZJMV6G8K5F77P
number: 15
title: "Reconcile create's default item path with repository naming"
kind: task
status: backlog
created: 2026-08-05
updated: 2026-08-05
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
