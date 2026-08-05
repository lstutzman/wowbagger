---
schema_version: 1
id: wb_01KZ77NSW8363H1V6QG1HZRG11
title: "Evaluate PropertyCompass adoption after standalone release"
kind: task
status: triage
created: 2026-08-04
updated: 2026-08-05
provenance:
  source: "repository-backlog"
  recorded_at: "2026-08-04T20:33:09Z"
depends_on: []
related:
  - wb_01KZ77NSW8PNA4S48NYT26AGMH
decisions:
  - action: record
    date: 2026-08-04
    summary: "PropertyCompass adoption is recorded as a separate deferred consumer decision."
    rationale: "It must be considered only after a versioned standalone Wowbagger release exists and has independent migration evidence."
  - action: record
    date: 2026-08-05
    summary: "The live remainder of PropertyCompass2 backlog item 1422 is captured here: PropertyCompass2 retires its in-repo copies and consumes an adapter."
    rationale: "Full migration is intended but not yet authorized; fenced work claims in the core CLI gate it, because PropertyCompass2 writes its backlog from many concurrent worktrees while the mutation runtime covers one working copy."
---

This item intentionally has no parent in the standalone v0 epic and authorizes
no PropertyCompass changes. It remains triage until a separate consumer-adoption
decision is explicitly accepted in the appropriate repository.
