---
schema_version: 1
id: wb_01KZ77NSW8363H1V6QG1HZRG11
title: "Evaluate PropertyCompass adoption after standalone release"
kind: task
status: triage
created: 2026-08-04
updated: 2026-08-06
provenance:
  source: "repository-backlog"
  recorded_at: "2026-08-04T20:33:09Z"
depends_on: []
parent: wb_01KZBT435CG4HMTP0H6F3CTTNA
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
  - action: reparent
    date: 2026-08-06
    summary: "Parented to the productization epic and given the migration shape; still triage."
    rationale: "The item recorded that adoption was deferred but not what adoption involves, so a reader learned only that it was not yet authorized. It now carries the current PropertyCompass state, the hard gate, the migration steps and the rollback. Status stays triage: adoption remains unauthorized."
---

Migrate PropertyCompass's backlog onto wowbagger. This item is the FULL
migration and remains unauthorized; wb_01KZBT447HVZ9798DXV1NTT515 covers the earlier milestone of
running an installed wowbagger inside PropertyCompass with its existing backlog
left in place.

**What PropertyCompass has today.** A mature backlog under `docs/backlog/` with
numeric ids, a `claim-backlog-id.sh` script that pushes a claim commit directly
to the shared branch to avoid id collisions, a `backlog-format.md` schema, and
an `sdlc-backlog` skill implementing create, prioritize, groom and report modes.
Roughly twenty worktrees are live at once and multiple agent sessions write the
backlog concurrently.

**The hard gate: wb_01KZBMBEZKPE7D15HKW9Q3GSZV.** Advisory claims coordinate cooperating agents and
enforce nothing — a writer that ignores a claim still wins. That is acceptable
for a single worker; it is not acceptable for twenty concurrent worktrees
racing id allocation. Do not migrate writes before fenced claims exist.

**What the migration involves.** Map numeric ids to wowbagger ULIDs and decide
whether history keeps both. Translate the existing schema, including fields
wowbagger has no equivalent for (priority scoring outputs, tier and area
vocabularies, snooze). Decide what happens to `claim-backlog-id.sh`, whose
whole purpose disappears once claims are fenced. Retire or rewrite the
`sdlc-backlog` skill's four modes against the core commands, keeping
consumer-specific scoring policy host-side per the policy-input contract.
Migrate several hundred existing items without losing decision history.

**Rollback.** The Markdown files remain in git throughout, so a failed
migration is recoverable by reverting the commit that rewrites them — provided
the migration is a single reviewable change per stage and not an in-place
rewrite spread across sessions.

Adoption stays triage until an explicit consumer-adoption decision is accepted
in the appropriate repository.
